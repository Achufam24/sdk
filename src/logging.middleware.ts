import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { LoggingService } from './logging.service';
import { v4 as uuidv4 } from 'uuid';
import { RequestLog, ResponseLog } from './interfaces/log.interface';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(LoggingMiddleware.name);

  constructor(private readonly loggingService: LoggingService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const requestId = uuidv4(); 
    const { method, url, headers, body, ip } = req;
    const userAgent = headers['user-agent'] || '';
    const timestamp = new Date().toISOString();

    const requestLog: RequestLog = {
      requestId,
      timestamp,
      method,
      url,
      userAgent,
      ip,
      body: this.sanitizeBody(body),
      type: 'request',
    };

    this.logger.log(requestLog);
    
    this.loggingService.saveLog(requestLog);

    const now = Date.now();
    
    const originalSend = res.send;
    res.send = function (body) {
      const responseTime = Date.now() - now;
      
      const responseLog: ResponseLog = {
        requestId,
        timestamp: new Date().toISOString(),
        method,
        url,
        statusCode: res.statusCode,
        responseTime: `${responseTime}ms`,
        type: 'response',
        body: body
      };

      this.logger.log(responseLog);
      
      this.loggingService.saveLog(responseLog);
      
      return originalSend.call(this, body);
    }.bind(this);

    next();
  }

  private sanitizeBody(body: any): any {
    if (!body) return body;
    
    const sanitizedBody = { ...body };
    
    // Remove sensitive information (customize as needed)
    // const sensitiveFields = ['password', 'token', 'authorization', 'apiKey'];
    // sensitiveFields.forEach(field => {
    //   if (field in sanitizedBody) {
    //     sanitizedBody[field] = '[REDACTED]';
    //   }
    // });
    
    return sanitizedBody;
  }
} 