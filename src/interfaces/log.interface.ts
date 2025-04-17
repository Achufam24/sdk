import { Request, Response } from 'express';

export interface BaseLog {
  requestId: string;
  timestamp: string;
  method: string;
  url: string;
}

export interface RequestLog extends BaseLog {
  type: 'request';
  userAgent: string;
  ip: string;
  body: any;
}

export interface ResponseLog extends BaseLog {
  type: 'response';
  statusCode: number;
  responseTime: string;
  body: any;
}

export interface CombinedLog {
  requestId: string;
  request?: RequestLog;
  response?: ResponseLog;
  appId: string;
  environment: string;
  timestamp: string;
} 