import { Logger } from '@nestjs/common';
import axios from 'axios';

const logger = new Logger('ErrorReporting');

export interface ErrorMetadata {
  message?: string;
  stack?: string;
  code?: string | number;
  context?: Record<string, any>;
}

export interface ErrorReportingConfig {
  apiKey: string;
  appId: string;
  environment: string;
  apiUrl?: string;
}

let globalConfig: ErrorReportingConfig | null = null;

export function initializeErrorReporting(config: ErrorReportingConfig) {
  if (!config.apiKey) throw new Error('apiKey is required for error reporting');
  if (!config.appId) throw new Error('appId is required for error reporting');
  if (!config.environment) throw new Error('environment is required for error reporting');
  
  globalConfig = config;
}

export async function ReportError(
  error: Error | unknown,
  metadata: ErrorMetadata = {}
): Promise<void> {
  if (!globalConfig) {
    throw new Error('Error reporting not initialized. Call initializeErrorReporting first.');
  }

  const errorObject = error instanceof Error ? error : new Error(String(error));
  
  const errorLog = {
    type: 'error',
    timestamp: new Date().toISOString(),
    appId: globalConfig.appId,
    environment: globalConfig.environment,
    error: {
      name: errorObject.name,
      message: errorObject.message,
      stack: errorObject.stack,
      ...metadata,
    },
    context: {
      ...metadata.context,
      nodeVersion: process.version,
      platform: process.platform,
    }
  };

  // Log locally first
  logger.error('Error reported:', errorLog);

  // If apiUrl is provided, send to backend
  if (globalConfig.apiUrl) {
    try {
      await axios.post(`${globalConfig.apiUrl}/errors`, errorLog, {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': globalConfig.apiKey,
        },
      });
    } catch (sendError) {
      logger.error('Failed to send error to reporting service', sendError);
    }
  }
} 