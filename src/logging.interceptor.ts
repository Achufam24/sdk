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

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  constructor(private readonly loggingService: LoggingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, headers, body, ip } = request;
    const userAgent = headers['user-agent'] || '';
    const timestamp = new Date().toISOString();

    const requestLog = {
      timestamp,
      method,
      url,
      userAgent,
      ip,
      body: this.sanitizeBody(body),
      type: 'request',
    };

    // Log locally
    this.logger.log(requestLog);
    
    // Save to backend server
    this.loggingService.saveLog(requestLog);

    const now = Date.now();
    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        const responseTime = Date.now() - now;
        
        const responseLog = {
          timestamp: new Date().toISOString(),
          method,
          url,
          statusCode: response.statusCode,
          responseTime: `${responseTime}ms`,
          type: 'response',
        };

        // Log locally
        this.logger.log(responseLog);
        
        // Save to backend server
        this.loggingService.saveLog(responseLog);
      }),
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