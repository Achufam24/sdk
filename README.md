# Nugi Logs SDK

A NestJS logging SDK that captures request and response data, correlates them, and provides error reporting capabilities.

## Installation

```bash
npm install nugi-logs-sdk
```

## Features

- 🔄 Request-Response Correlation
- 🚨 Error Reporting
- 📊 Automatic Request/Response Logging
- 🔒 Sensitive Data Redaction
- 🎯 Customizable Route Configuration

## Usage

### Basic Setup

Import the `LoggingModule` in your app module and configure it with `forRoot`:

```typescript
import { Module } from '@nestjs/common';
import { LoggingModule } from 'nugi-logs-sdk';

@Module({
  imports: [
    LoggingModule.forRoot({
      apiUrl: 'https://your-logging-server.com/api/logs', // Optional
      apiKey: 'your-api-key', // Required
      appId: 'your-app-id', // Required
      environment: 'production', // Required
    }),
  ],
})
export class AppModule {}
```

### Configuration Options

The `LoggingModule.forRoot()` method accepts the following options:

- `apiUrl` (optional): The URL of your logging server API endpoint. If not provided, logs will only be stored locally.
- `apiKey` (required): API key for authentication with your logging server
- `appId` (required): Identifier for your application
- `environment` (required): Environment name (e.g., 'development', 'production')

### Request-Response Correlation

The SDK automatically correlates requests and responses using a unique request ID. This allows you to track the complete lifecycle of each request:

```typescript
// Logs will include:
{
  requestId: "unique-uuid",
  request: {
    timestamp: "2024-03-20T10:00:00Z",
    method: "POST",
    url: "/api/users",
    // ... other request data
  },
  response: {
    timestamp: "2024-03-20T10:00:01Z",
    statusCode: 201,
    responseTime: "120ms",
    // ... other response data
  },
  appId: "your-app-id",
  environment: "production"
}
```

### Error Reporting

The SDK provides a dedicated error reporting function that you can use throughout your application:

1. Initialize error reporting (typically in `main.ts`):

```typescript
import { initializeErrorReporting } from 'nugi-logs-sdk';

initializeErrorReporting({
  apiKey: 'your-api-key',
  appId: 'your-app-id',
  environment: 'production',
  apiUrl: 'https://your-logging-server.com/api/logs' // optional
});
```

2. Use the `ReportError` function in your catch blocks:

```typescript
import { ReportError } from 'nugi-logs-sdk';

// Basic usage
try {
  throw new Error('Something went wrong');
} catch (error) {
  await ReportError(error);
}

// With additional context
try {
  await someApiCall();
} catch (error) {
  await ReportError(error, {
    code: 'API_ERROR',
    context: {
      endpoint: '/api/data',
      method: 'GET',
      userId: '123'
    }
  });
}
```

### What Gets Logged

The SDK automatically logs:

1. **Request Information**:
   - Request ID (for correlation)
   - Timestamp
   - HTTP method
   - URL
   - User agent
   - IP address
   - Request body (with sensitive data redacted)

2. **Response Information**:
   - Request ID (for correlation)
   - Timestamp
   - Status code
   - Response time
   - Response body (with sensitive data redacted)

3. **Error Information**:
   - Error name
   - Error message
   - Stack trace
   - Custom error code
   - Additional context
   - System information (Node.js version, platform)

### Sensitive Data Handling

The SDK automatically redacts sensitive information from request and response bodies, including:
- Passwords
- Tokens
- Authorization headers
- API keys

### Custom Route Configuration

You can customize which routes the middleware applies to:

```typescript
import { Module, RequestMethod } from '@nestjs/common';
import { LoggingModule, LoggingMiddleware } from 'nugi-logs-sdk';

@Module({
  imports: [LoggingModule.forRoot({
    apiKey: 'your-api-key',
    appId: 'your-app-id',
    environment: 'production'
  })],
})
export class AppModule extends LoggingModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggingMiddleware)
      .forRoutes(
        { path: 'api/*', method: RequestMethod.ALL },
        { path: 'auth/*', method: RequestMethod.ALL },
      );
  }
}
```

### Local-Only Logging

If you don't provide an `apiUrl`, the SDK will only log locally (using NestJS Logger). This is useful for development or when you want to handle the logs yourself:

```typescript
LoggingModule.forRoot({
  apiKey: 'your-api-key',
  appId: 'your-app-id',
  environment: 'development'
  // No apiUrl - logs will only be stored locally
})
```

## Error Reporting Types

The SDK provides TypeScript types for error reporting:

```typescript
interface ErrorMetadata {
  message?: string;
  stack?: string;
  code?: string | number;
  context?: Record<string, any>;
}

interface ErrorReportingConfig {
  apiKey: string;
  appId: string;
  environment: string;
  apiUrl?: string;
}
```

## License

MIT 