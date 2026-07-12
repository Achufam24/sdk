import { Logger } from '@nestjs/common';
import axios from 'axios';
import { sharedBreadcrumbs } from './breadcrumbs';
import { getHostMetadata, getRuntimeMetadata } from './metadata';
import { buildStackFrames, type StackFrame } from './stacktrace';

const logger = new Logger('ErrorReporting');

export interface ErrorMetadata {
  message?: string;
  stack?: string;
  code?: string | number;
  context?: Record<string, any>;
  /** How the error was captured, e.g. 'auto.node.uncaughtException'. */
  mechanism?: string;
  /** false when the error was uncaught / crashed a request. Default true. */
  handled?: boolean;
  /** Skip reading source files for stack context (faster, less detail). */
  skipSourceContext?: boolean;
}

export interface ErrorReportingConfig {
  apiKey: string;
  appId: string;
  environment: string;
  apiUrl?: string;
  serviceName?: string;
  release?: string;
}

let globalConfig: ErrorReportingConfig | null = null;

export function initializeErrorReporting(config: ErrorReportingConfig) {
  if (!config.apiKey) throw new Error('apiKey is required for error reporting');
  if (!config.appId) throw new Error('appId is required for error reporting');
  if (!config.environment) throw new Error('environment is required for error reporting');

  globalConfig = config;
}

const REQUEST_TIMEOUT_MS = 5000;

/**
 * Never throws and never rejects: reporting an error must not itself crash the
 * host application. Safe to call fire-and-forget (no await required).
 *
 * Attaches Sentry-style structured frames with source context
 * (preContext / contextLine / postContext) when source files are readable.
 */
export async function ReportError(
  error: Error | unknown,
  metadata: ErrorMetadata = {},
): Promise<void> {
  try {
    if (!globalConfig) {
      logger.warn(
        'Error reporting not initialized; call initializeErrorReporting first. Skipping report.',
      );
      return;
    }

    const errorObject = error instanceof Error ? error : new Error(String(error));
    const { context, mechanism, handled, skipSourceContext, ...errorMeta } = metadata;

    const stack = (errorMeta.stack as string | undefined) || errorObject.stack;
    let frames: StackFrame[] = [];
    try {
      frames = buildStackFrames(stack, { withSourceContext: !skipSourceContext });
    } catch {
      frames = [];
    }

    const errorLog = {
      type: 'error',
      timestamp: new Date().toISOString(),
      appId: globalConfig.appId,
      environment: globalConfig.environment,
      serviceName: globalConfig.serviceName || globalConfig.appId,
      release: globalConfig.release,
      handled: handled ?? true,
      mechanism: mechanism ?? (handled === false ? 'auto' : 'manual'),
      breadcrumbs: sharedBreadcrumbs.snapshot(),
      error: {
        name: errorObject.name,
        message: errorObject.message,
        stack,
        frames,
        ...errorMeta,
      },
      context: {
        ...context,
        nodeVersion: process.version,
        platform: process.platform,
        meta: { ...getHostMetadata(), ...getRuntimeMetadata() },
      },
    };

    logger.error('Error reported:', {
      name: errorLog.error.name,
      message: errorLog.error.message,
      frames: frames.length,
    });

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
        const message = axios.isAxiosError(sendError)
          ? sendError.message
          : String(sendError);
        logger.error(`Failed to send error to reporting service: ${message}`);
      }
    }
  } catch (unexpected) {
    logger.error('Unexpected failure in ReportError', unexpected as Error);
  }
}

export type { StackFrame };
