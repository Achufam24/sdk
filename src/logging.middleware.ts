import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { LoggingService } from './logging.service';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(LoggingMiddleware.name);

  constructor(private readonly loggingService: LoggingService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const { method, url, headers, body, ip } = req;
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
    
    // Capture response data
    const originalSend = res.send;
    res.send = function (body) {
      const responseTime = Date.now() - now;
      
      const responseLog = {
        timestamp: new Date().toISOString(),
        method,
        url,
        statusCode: res.statusCode,
        responseTime: `${responseTime}ms`,
        type: 'response',
      };

      // Log locally
      this.logger.log(responseLog);
      
      // Save to backend server
      this.loggingService.saveLog(responseLog);
      
      return originalSend.call(this, body);
    }.bind(this);

    next();
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