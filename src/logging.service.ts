import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import axios from 'axios';
import { RequestLog, ResponseLog, CombinedLog } from './interfaces/log.interface';

export interface LoggingOptions {
  apiUrl?: string;
  apiKey: string;
  appId: string;
  environment: string;
}

@Injectable()
export class LoggingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LoggingService.name);
  private readonly apiUrl?: string;
  private readonly apiKey: string;
  private readonly appId: string;
  private readonly environment: string;
  private readonly pendingLogs: Map<string, Partial<CombinedLog>> = new Map();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(options: LoggingOptions) {
    if (!options.apiKey) {
      throw new Error('apiKey is required in LoggingOptions');
    }
    if (!options.appId) {
      throw new Error('appId is required in LoggingOptions');
    }
    if (!options.environment) {
      throw new Error('environment is required in LoggingOptions');
    }

    this.apiUrl = options.apiUrl;
    this.apiKey = options.apiKey;
    this.appId = options.appId;
    this.environment = options.environment;
  }

  onModuleInit() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleRequests();
    }, 5 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  private getUrlPath(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname;
    } catch (error) {
      this.logger.warn(`Failed to parse URL: ${url}`, error);
      return url;
    }
  }

  private stringifyRequestBody(body: any): string {
    try {
      if (typeof body === 'string') {
        return body;
      }
      return JSON.stringify(body);
    } catch (error) {
      this.logger.warn('Failed to stringify request body', error);
      return '[Unable to stringify request body]';
    }
  }

  private stringifyResponseBody(body: any): string {
    try {
      if (typeof body === 'string') {
        return body;
      }
      return JSON.stringify(body);
    } catch (error) {
      this.logger.warn('Failed to stringify response body', error);
      return '[Unable to stringify response body]';
    }
  }

  async saveLog(logData: RequestLog | ResponseLog): Promise<void> {
    const { requestId } = logData;
    let pendingLog = this.pendingLogs.get(requestId) || {
      requestId,
      appId: this.appId,
      environment: this.environment,
    };

    if (logData.type === 'request') {
      const requestLog = {
        ...logData,
        path: this.getUrlPath(logData.url),
        body: this.stringifyRequestBody(logData.body),
      };
      pendingLog.request = requestLog;
    } else {
      const responseLog = {
        ...logData,
        body: this.stringifyResponseBody(logData.body),
      };
      pendingLog.response = responseLog;
    }

    this.pendingLogs.set(requestId, pendingLog);

    if (pendingLog.request && pendingLog.response) {
      const combinedLog = {
        ...pendingLog,
        appId: this.appId,
        environment: this.environment,
        timestamp: new Date().toISOString(),
      } as CombinedLog;


      this.logger.log('Combined log:', combinedLog);


      if (this.apiUrl) {
        try {
          await axios.post(this.apiUrl, combinedLog, {
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': this.apiKey,
            },
          });
        } catch (error) {
          this.logger.error('Failed to save combined log to backend server', error);
        }
      }

      this.pendingLogs.delete(requestId);
    }
  }

  private cleanupStaleRequests() {
    const staleTimeout = 30 * 60 * 1000; 
    const now = Date.now();
    let cleanedCount = 0;

    try {
      for (const [requestId, log] of this.pendingLogs.entries()) {
        const timestamp = new Date(log.request?.timestamp || log.response?.timestamp || '').getTime();
        if (now - timestamp > staleTimeout) {
          this.pendingLogs.delete(requestId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        this.logger.debug(`Cleaned up ${cleanedCount} stale request logs`);
      }
    } catch (error) {
      this.logger.error('Error during cleanup of stale requests', error);
    }
  }
} 