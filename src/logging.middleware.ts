import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { LoggingService } from './logging.service';
import { v4 as uuidv4 } from 'uuid';
import { RequestLog, ResponseLog } from './interfaces/log.interface';
import { extractTraceContext } from './metadata';
import { sanitizeBody, sanitizeHeaders } from './sanitize';
import { byteLength, extractUserId, resolveClientIp } from './http.util';
import { spans } from './spans';
import { metrics } from './metrics';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(LoggingMiddleware.name);

  constructor(private readonly loggingService: LoggingService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // Logging must never crash or block the request. Any failure here is
    // swallowed and the request continues untouched.
    try {
      const requestId = uuidv4();
      const { method, url, headers, body } = req;
      const ip = resolveClientIp(req);
      const userAgent = (headers['user-agent'] as string) || '';
      const timestamp = new Date().toISOString();
      const { traceId, spanId: parentSpanId } = extractTraceContext(headers);

      // Auto HTTP server span — makes Traces useful without app changes.
      const routeLabel =
        (req as any).route?.path ||
        (req as any).baseUrl ||
        url?.split('?')[0] ||
        '/';
      const spanName = `${method || 'HTTP'} ${routeLabel}`;
      const httpSpan = spans.start(spanName, {
        traceId,
        parentSpanId,
        spanKind: 'server',
        attributes: {
          'http.method': method || '',
          'http.url': url || '',
          'http.route': String(routeLabel),
          'http.user_agent': userAgent.slice(0, 200),
          'net.peer.ip': ip || '',
        },
      });

      // Prefer the span's own spanId on logs so they correlate to the waterfall.
      const spanId = httpSpan.spanId;

      const requestLog: RequestLog = {
        requestId,
        timestamp,
        traceId: httpSpan.traceId,
        spanId,
        method,
        url,
        userAgent,
        ip,
        headers: sanitizeHeaders(headers, this.loggingService.redact),
        requestSize: byteLength(headers['content-length'], body),
        userId: extractUserId(req),
        body: sanitizeBody(body, this.loggingService.redact),
        type: 'request',
      };

      this.logger.log(requestLog);
      void this.loggingService.saveLog(requestLog);

      const now = Date.now();
      const self = this;
      const originalSend = res.send;
      res.send = function (this: Response, body) {
        try {
          const responseTime = Date.now() - now;
          const statusCode = this.statusCode;

          const responseLog: ResponseLog = {
            requestId,
            timestamp: new Date().toISOString(),
            traceId: httpSpan.traceId,
            spanId,
            method,
            url,
            statusCode,
            responseTime: `${responseTime}ms`,
            responseSize: byteLength(this.getHeader?.('content-length'), body),
            type: 'response',
            body: sanitizeBody(body, self.loggingService.redact),
          };

          self.logger.log(responseLog);
          void self.loggingService.saveLog(responseLog);

          httpSpan.setAttribute('http.status_code', statusCode);
          httpSpan.setAttribute('http.response_time_ms', responseTime);
          httpSpan.end(statusCode >= 500 ? 'error' : 'ok');

          // Auto HTTP metrics so Metrics UI has data without manual instrumentation.
          const metricAttrs = {
            'http.method': method || '',
            'http.status_code': statusCode,
            'http.route': String(routeLabel).slice(0, 120),
          };
          metrics.count('http.server.requests', 1, { attributes: metricAttrs });
          metrics.distribution('http.server.duration', responseTime, {
            unit: 'millisecond',
            attributes: metricAttrs,
          });
          if (statusCode >= 500) {
            metrics.count('http.server.errors', 1, { attributes: metricAttrs });
          } else if (statusCode >= 400) {
            metrics.count('http.server.client_errors', 1, {
              attributes: metricAttrs,
            });
          }
        } catch (err) {
          try {
            httpSpan.end('error', err instanceof Error ? err.message : String(err));
          } catch {
            /* ignore */
          }
          self.logger.error('Failed to log response', err as Error);
        }

        return originalSend.call(this, body);
      };

      // If the connection closes without send(), still end the span.
      res.on('close', () => {
        try {
          if (httpSpan.ended) return;
          httpSpan.setAttribute('http.status_code', res.statusCode || 0);
          httpSpan.end(res.statusCode >= 500 ? 'error' : 'ok');
        } catch {
          /* ignore */
        }
      });

      // Keep auto-captured DB queries nested under this HTTP span.
      spans.run(httpSpan, () => next());
      return;
    } catch (err) {
      this.logger.error('LoggingMiddleware setup failed', err as Error);
    }

    next();
  }
}
