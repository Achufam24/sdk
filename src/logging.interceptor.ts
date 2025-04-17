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

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  constructor(private readonly loggingService: LoggingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const requestId = uuidv4();
    const ctx = context.switchToHttp();
    const request = ctx.getRequest();
    const { method, url, body, headers, ip } = request;
    const userAgent = headers['user-agent'] || '';
    const timestamp = new Date().toISOString();

    // Log request
    const requestLog: RequestLog = {
      requestId,
      timestamp,
      method,
      url,
      userAgent,
      ip,
      body: this.sanitizeBody(body),
      type: 'request'
    };

    this.logger.log(requestLog);
    this.loggingService.saveLog(requestLog);

    const now = Date.now();

    return next.handle().pipe(
      tap({
        next: (body: any) => {
          const responseTime = Date.now() - now;
          
          const responseLog: ResponseLog = {
            requestId,
            timestamp: new Date().toISOString(),
            method,
            url,
            statusCode: context.switchToHttp().getResponse().statusCode,
            responseTime: `${responseTime}ms`,
            type: 'response',
            body: this.sanitizeBody(body)
          };

          this.logger.log(responseLog);
          this.loggingService.saveLog(responseLog);
        },
        error: (error: any) => {
          const responseTime = Date.now() - now;
          
          const responseLog: ResponseLog = {
            requestId,
            timestamp: new Date().toISOString(),
            method,
            url,
            statusCode: error.status || 500,
            responseTime: `${responseTime}ms`,
            type: 'response',
            body: {
              error: error.message,
              stack: error.stack
            }
          };

          this.logger.error(responseLog);
          this.loggingService.saveLog(responseLog);
        }
      })
    );
  }

  private sanitizeBody(body: any): any {
    if (!body) return body;
    
    // Create a copy of the body to avoid modifying the original
    const sanitizedBody = { ...body };
    
    // Remove sensitive information (customize as needed)
    const sensitiveFields = ['password', 'token', 'authorization', 'apiKey'];
    sensitiveFields.forEach(field => {
      if (field in sanitizedBody) {
        sanitizedBody[field] = '[REDACTED]';
      }
    });
    
    return sanitizedBody;
  }
} 