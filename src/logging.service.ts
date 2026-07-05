import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import axios from 'axios';
import { RequestLog, ResponseLog, CombinedLog, LogMetadata } from './interfaces/log.interface';
import { getHostMetadata, getRuntimeMetadata } from './metadata';

export interface LoggingOptions {
  apiUrl?: string;
  apiKey: string;
  appId: string;
  environment: string;
  // Logical name of the service emitting logs. Defaults to appId.
  serviceName?: string;
  // Extra field names to redact from captured bodies/headers, in addition to
  // the built-in sensitive patterns. Case-insensitive exact match, any depth.
  redact?: string[];
}

// Logging must never block or slow down the host application. Cap every
// outbound request so a slow/unreachable backend can't hold sockets or memory.
const REQUEST_TIMEOUT_MS = 5000;

@Injectable()
export class LoggingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LoggingService.name);
  private readonly apiUrl?: string;
  private readonly apiKey: string;
  private readonly appId: string;
  private readonly environment: string;
  private readonly serviceName: string;
  // Extra field names to redact, exposed for the middleware/interceptor.
  readonly redact: string[];
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

    this.apiUrl = options.apiUrl ?? "https://2239-102-90-100-55.ngrok-free.app";
    this.apiKey = options.apiKey;
    this.appId = options.appId;
    this.environment = options.environment;
    this.serviceName = options.serviceName ?? options.appId;
    this.redact = Array.isArray(options.redact)
      ? options.redact.filter((k) => typeof k === 'string' && k.length > 0)
      : [];
  }

  // Assembles host + runtime + service metadata for an outbound log. Host data
  // is cached; runtime data (memory/CPU) is sampled fresh on each call.
  private buildMetadata(): LogMetadata {
    return {
      ...getHostMetadata(),
      ...getRuntimeMetadata(),
      environment: this.environment,
      serviceName: this.serviceName,
    };
  }

  onModuleInit() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleRequests();
    }, 5 * 60 * 1000);
    // Don't let the background timer keep the host process alive on shutdown.
    this.cleanupInterval.unref?.();
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

  // Never throws and never rejects: a logging failure must not surface in the
  // host request path. Safe to call fire-and-forget (no await required).
  async saveLog(logData: RequestLog | ResponseLog): Promise<void> {
    try {
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
          serviceName: this.serviceName,
          traceId: pendingLog.request.traceId ?? pendingLog.response.traceId,
          spanId: pendingLog.request.spanId ?? pendingLog.response.spanId,
          timestamp: new Date().toISOString(),
          meta: this.buildMetadata(),
        } as CombinedLog;

        this.logger.log('Combined log:', combinedLog);

        if (this.apiUrl) {
          try {
            await axios.post(this.apiUrl, combinedLog, {
              timeout: REQUEST_TIMEOUT_MS,
              headers: {
                'Content-Type': 'application/json',
                'X-API-Key': this.apiKey,
              },
            });
          } catch (error) {
            this.logger.error('Failed to save combined log to backend server', this.describeError(error));
          }
        }

        this.pendingLogs.delete(requestId);
      }
    } catch (error) {
      // Swallow everything: logging must never crash the host application.
      this.logger.error('Unexpected error while saving log', this.describeError(error));
    }
  }

  // Never throws and never rejects. Safe to call fire-and-forget.
  async logQuery(query: string, durationMs: number, requestId?: string): Promise<void> {
    try {
      if (this.apiUrl) {
        await axios.post(this.apiUrl, {
          appId: this.appId,
          environment: this.environment,
          serviceName: this.serviceName,
          type: 'query',
          query,
          durationMs,
          requestId,
          timestamp: new Date().toISOString(),
          meta: this.buildMetadata(),
        }, {
          timeout: REQUEST_TIMEOUT_MS,
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
          },
        });
      }
    } catch (error) {
      this.logger.error('Failed to send query log to backend server', this.describeError(error));
    }
  }

  // Compact, safe error description — avoids logging huge axios error objects
  // (which can themselves throw on circular refs when serialized).
  private describeError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      return error.response
        ? `HTTP ${error.response.status} ${error.message}`
        : error.message;
    }
    return error instanceof Error ? error.message : String(error);
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