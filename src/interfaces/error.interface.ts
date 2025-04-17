export interface ErrorReport {
  type: 'error';
  timestamp: string;
  appId: string;
  environment: string;
  error: {
    name: string;
    message: string;
    stack?: string;
    code?: string | number;
    context?: Record<string, any>;
  };
  context: {
    nodeVersion: string;
    platform: string;
    [key: string]: any;
  };
} 