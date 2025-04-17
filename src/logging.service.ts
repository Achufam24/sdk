import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { RequestLog, ResponseLog, CombinedLog } from './interfaces/log.interface';

export interface LoggingOptions {
  // Optional API URL - if not provided, logs will only be stored in memory
  apiUrl?: string;
  
  // Required fields
  apiKey: string;
  appId: string;
  environment: string;
}

@Injectable()
export class LoggingService {
  private readonly logger = new Logger(LoggingService.name);
  private readonly apiUrl?: string;
  private readonly apiKey: string;
  private readonly appId: string;
  private readonly environment: string;
  private readonly pendingLogs: Map<string, Partial<CombinedLog>> = new Map();

  constructor(options: LoggingOptions) {
    // Validate required fields
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

  async saveLog(logData: RequestLog | ResponseLog): Promise<void> {
    const { requestId } = logData;
    let pendingLog = this.pendingLogs.get(requestId) || {
      requestId,
      appId: this.appId,
      environment: this.environment,
    };

    if (logData.type === 'request') {
      pendingLog.request = logData;
    } else {
      pendingLog.response = logData;
    }

    this.pendingLogs.set(requestId, pendingLog);

    // If we have both request and response, process the combined log
    if (pendingLog.request && pendingLog.response) {
      const combinedLog = {
        ...pendingLog,
        appId: this.appId,
        environment: this.environment,
        timestamp: new Date().toISOString(),
      } as CombinedLog;

      // Log locally
      this.logger.log('Combined log:', combinedLog);

      // If apiUrl is provided, send to backend
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

      // Clear from pending logs after processing
      this.pendingLogs.delete(requestId);
    }
  }

  // Cleanup method to prevent memory leaks
  private cleanupStaleRequests() {
    const staleTimeout = 30 * 60 * 1000; // 30 minutes
    const now = Date.now();

    for (const [requestId, log] of this.pendingLogs.entries()) {
      const timestamp = new Date(log.request?.timestamp || log.response?.timestamp || '').getTime();
      if (now - timestamp > staleTimeout) {
        this.pendingLogs.delete(requestId);
      }
    }
  }
} 