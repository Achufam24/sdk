import { HostMetadata, RuntimeMetadata } from '../metadata';

export interface BaseLog {
  requestId: string;
  timestamp: string;
  method: string;
  url: string;
  // Distributed-tracing correlation ids (from incoming headers or generated).
  traceId?: string;
  spanId?: string;
}

export interface RequestLog extends BaseLog {
  type: 'request';
  userAgent: string;
  ip: string;
  body: any;
  // Full (sanitized) request headers.
  headers?: Record<string, any>;
  // Request payload size in bytes (from content-length or measured body).
  requestSize?: number;
  // Authenticated principal id, when the host app has populated req.user.
  userId?: string;
}

export interface ResponseLog extends BaseLog {
  type: 'response';
  statusCode: number;
  responseTime: string;
  body: any;
  // Response payload size in bytes.
  responseSize?: number;
}

// Host + runtime environment metadata attached to every outbound log.
export interface LogMetadata extends HostMetadata, RuntimeMetadata {
  environment: string;
  serviceName: string;
  release?: string;
}

export interface CombinedLog {
  requestId: string;
  request?: RequestLog;
  response?: ResponseLog;
  appId: string;
  environment: string;
  serviceName: string;
  release?: string;
  timestamp: string;
  traceId?: string;
  spanId?: string;
  meta: LogMetadata;
}
