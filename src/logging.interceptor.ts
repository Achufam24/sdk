import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { LoggingService } from './logging.service';
import { v4 as uuidv4 } from 'uuid';
import { RequestLog, ResponseLog } from './interfaces/log.interface';
import { extractTraceContext } from './metadata';
import { sanitizeBody, sanitizeHeaders } from './sanitize';
import { byteLength, extractUserId } from './http.util';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  constructor(private readonly loggingService: LoggingService) { }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    let requestId = '';
    let method = '';
    let url = '';
    let traceId: string | undefined;
    let spanId: string | undefined;
    const now = Date.now();

    // Logging setup must never crash the request pipeline.
    try {
      requestId = uuidv4();
      const ctx = context.switchToHttp();
      const request = ctx.getRequest();
      const headers = request.headers || {};
      ({ method, url } = request);
      const { body, ip } = request;
      const userAgent = headers['user-agent'] || '';
      const timestamp = new Date().toISOString();
      ({ traceId, spanId } = extractTraceContext(headers));

      // Log request
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
        userId: extractUserId(request),
        body: sanitizeBody(body, this.loggingService.redact),
        type: 'request'
      };

      this.logger.log(requestLog);
      void this.loggingService.saveLog(requestLog);
    } catch (err) {
      this.logger.error('Failed to log request', err as Error);
    }

    return next.handle().pipe(
      tap({
        next: (body: any) => {
          // Never let response logging break the response stream.
          try {
            const responseTime = Date.now() - now;
            const response = context.switchToHttp().getResponse();

            const responseLog: ResponseLog = {
              requestId,
              timestamp: new Date().toISOString(),
              traceId,
              spanId,
              method,
              url,
              statusCode: response.statusCode,
              responseTime: `${responseTime}ms`,
              responseSize: byteLength(response.getHeader?.('content-length'), body),
              type: 'response',
              body: sanitizeBody(body, this.loggingService.redact)
            };

            this.logger.log(responseLog);
            void this.loggingService.saveLog(responseLog);
          } catch (err) {
            this.logger.error('Failed to log response', err as Error);
          }
        },
        error: (error: any) => {
          // Log the error but never swallow it — rethrow path is preserved by tap.
          try {
            const responseTime = Date.now() - now;

            const responseLog: ResponseLog = {
              requestId,
              timestamp: new Date().toISOString(),
              traceId,
              spanId,
              method,
              url,
              statusCode: error?.status || 500,
              responseTime: `${responseTime}ms`,
              type: 'response',
              body: sanitizeBody({
                error: error?.message,
                stack: error?.stack
              }, this.loggingService.redact)
            };

            this.logger.error(responseLog);
            void this.loggingService.saveLog(responseLog);
          } catch (err) {
            this.logger.error('Failed to log error response', err as Error);
          }
        }
      })
    );
  }
} 