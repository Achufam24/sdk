import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface LoggingOptions {
  apiUrl: string;
  apiKey?: string;
  appId?: string;
  environment?: string;
}

@Injectable()
export class LoggingService {
  private readonly logger = new Logger(LoggingService.name);
  private readonly apiUrl: string;
  private readonly apiKey?: string;
  private readonly appId?: string;
  private readonly environment?: string;

  constructor(options: LoggingOptions) {
    this.apiUrl = options.apiUrl;
    this.apiKey = options.apiKey;
    this.appId = options.appId;
    this.environment = options.environment;
  }

  async saveLog(logData: any): Promise<void> {
    try {
      const enrichedLogData = {
        ...logData,
        appId: this.appId,
        environment: this.environment,
        timestamp: new Date().toISOString(),
      };

      await axios.post(this.apiUrl, enrichedLogData, {
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'X-API-Key': this.apiKey }),
        },
      });
    } catch (error) {
      this.logger.error('Failed to save log to backend server', error);
      // We don't throw the error to prevent disrupting the main application flow
    }
  }
} 