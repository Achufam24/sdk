import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { LoggingService } from './logging.service';
import { v4 as uuidv4 } from 'uuid';
import { RequestLog, ResponseLog } from './interfaces/log.interface';
import { extractTraceContext } from './metadata';
import { sanitizeBody, sanitizeHeaders } from './sanitize';
import { byteLength, extractUserId } from './http.util';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(LoggingMiddleware.name);

  constructor(private readonly loggingService: LoggingService) { }

  use(req: Request, res: Response, next: NextFunction) {
    // Logging must never crash or block the request. Any failure here is
    // swallowed and the request continues untouched.
    try {
      const requestId = uuidv4();
      const { method, url, headers, body, ip } = req;
      const userAgent = (headers['user-agent'] as string) || '';
      const timestamp = new Date().toISOString();
      const { traceId, spanId } = extractTraceContext(headers);

      const requestLog: RequestLog = {
        requestId,
        timestamp,
        traceId,
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

      // Fire-and-forget: never await, never let a rejection escape.
      void this.loggingService.saveLog(requestLog);

      const now = Date.now();

      // Capture the middleware instance; `this` inside the override must stay the
      // Express Response so the original send can call Response methods (e.g. this.get).
      const self = this;
      const originalSend = res.send;
      res.send = function (this: Response, body) {
        // Never let logging break the actual response being sent.
        try {
          const responseTime = Date.now() - now;

          const responseLog: ResponseLog = {
            requestId,
            timestamp: new Date().toISOString(),
            traceId,
            spanId,
            method,
            url,
            statusCode: this.statusCode,
            responseTime: `${responseTime}ms`,
            responseSize: byteLength(this.getHeader?.('content-length'), body),
            type: 'response',
            body: sanitizeBody(body, self.loggingService.redact),
          };

          self.logger.log(responseLog);
          void self.loggingService.saveLog(responseLog);
        } catch (err) {
          self.logger.error('Failed to log response', err as Error);
        }

        return originalSend.call(this, body);
      };
    } catch (err) {
      this.logger.error('LoggingMiddleware setup failed', err as Error);
    }

    next();
  }
}
