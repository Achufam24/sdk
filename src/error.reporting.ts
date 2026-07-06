import { Logger } from '@nestjs/common';
import axios from 'axios';
import { sharedBreadcrumbs } from './breadcrumbs';
import { getHostMetadata, getRuntimeMetadata } from './metadata';

const logger = new Logger('ErrorReporting');

export interface ErrorMetadata {
  message?: string;
  stack?: string;
  code?: string | number;
  context?: Record<string, any>;
  // How the error was captured, e.g. 'auto.node.uncaughtException'.
  mechanism?: string;
  // false when the error was uncaught / crashed a request. Default true.
  handled?: boolean;
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

// Cap outbound error reports so a slow backend can't block the caller.
const REQUEST_TIMEOUT_MS = 5000;

// Never throws and never rejects: reporting an error must not itself crash the
// host application. Safe to call fire-and-forget (no await required).
export async function ReportError(
  error: Error | unknown,
  metadata: ErrorMetadata = {}
): Promise<void> {
  try {
    if (!globalConfig) {
      logger.warn('Error reporting not initialized; call initializeErrorReporting first. Skipping report.');
      return;
    }

    const errorObject = error instanceof Error ? error : new Error(String(error));
    const { context, mechanism, handled, ...errorMeta } = metadata;

    const errorLog = {
      type: 'error',
      timestamp: new Date().toISOString(),
      appId: globalConfig.appId,
      environment: globalConfig.environment,
      // Correlation / grouping metadata for the Sentry-style Errors view.
      handled: handled ?? true,
      mechanism: mechanism ?? (handled === false ? 'auto' : 'manual'),
      // Snapshot of the breadcrumb trail (console/logs) leading up to the error.
      breadcrumbs: sharedBreadcrumbs.snapshot(),
      error: {
        name: errorObject.name,
        message: errorObject.message,
        stack: errorObject.stack,
        ...errorMeta,
      },
      context: {
        ...context,
        nodeVersion: process.version,
        platform: process.platform,
        // Host + runtime snapshot so the error carries device/OS/runtime context.
        meta: { ...getHostMetadata(), ...getRuntimeMetadata() },
      }
    };

    // Log locally first
    logger.error('Error reported:', errorLog);

    // If apiUrl is provided, send to backend
    if (globalConfig.apiUrl) {
      try {
        await axios.post(`${globalConfig.apiUrl}/errors`, errorLog, {
          timeout: REQUEST_TIMEOUT_MS,
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': globalConfig.apiKey,
          },
        });
      } catch (sendError) {
        const message = axios.isAxiosError(sendError) ? sendError.message : String(sendError);
        logger.error(`Failed to send error to reporting service: ${message}`);
      }
    }
  } catch (unexpected) {
    // Absolute last resort — reporting must never crash the host.
    logger.error('Unexpected failure in ReportError', unexpected as Error);
  }
} 