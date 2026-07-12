import type { StackFrame } from '../stacktrace';

export interface ErrorReport {
  type: 'error';
  timestamp: string;
  appId: string;
  environment: string;
  serviceName?: string;
  handled?: boolean;
  mechanism?: string;
  breadcrumbs?: Array<{
    timestamp: string;
    type: string;
    level: string;
    message: string;
    data?: Record<string, unknown>;
  }>;
  error: {
    name: string;
    message: string;
    stack?: string;
    /** Sentry-style frames with optional source context. */
    frames?: StackFrame[];
    code?: string | number;
  };
  context: {
    nodeVersion: string;
    platform: string;
    meta?: Record<string, unknown>;
    [key: string]: any;
  };
}
