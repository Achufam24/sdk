# Nugi Logs SDK

A NestJS logging SDK that captures request and response data, correlates them, and provides error reporting capabilities.

## Installation

```bash
npm install nugi-logs-sdk
```

## Features

- 🔄 Request-Response Correlation
- 🧭 Distributed-trace correlation (W3C `traceparent`) — `traceId` / `spanId` on every log
- 🚨 Error Reporting
- 📊 Automatic Request/Response Logging
- 🖥️ Rich host & runtime metadata (hostname, server IP, OS, PID, memory, CPU, versions)
- 🗄️ Database query logging
- 🔒 Sensitive Data Redaction (built-in patterns + custom `redact` list)
- 🛡️ Fault-tolerant & non-blocking — never crashes or slows the host app
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
      apiUrl: 'https://your-logging-server.com/api/v1/logs', // Optional
      apiKey: 'your-api-key', // Required
      appId: 'your-app-id', // Required
      environment: 'production', // Required
      serviceName: 'checkout-service', // Optional (defaults to appId)
      redact: ['ssn', 'creditCard'], // Optional extra fields to redact
    }),
  ],
})
export class AppModule {}
```

### Configuration Options

The `LoggingModule.forRoot()` method accepts the following options:

- `apiUrl` (optional): Full URL of your logging server's ingest endpoint, **including the path** — e.g. `https://host/api/v1/logs`. The SDK POSTs directly to this URL (error reports go to `<apiUrl>/errors`). If not provided, logs are only stored locally.
- `apiKey` (required): API key for authentication with your logging server (sent as the `X-API-Key` header).
- `appId` (required): Identifier for your application.
- `environment` (required): Environment name (e.g., 'development', 'production').
- `serviceName` (optional): Logical service name attached to every log. Defaults to `appId`.
- `redact` (optional): Extra field names to redact from bodies and headers, in addition to the built-in patterns. Matched case-insensitively by exact field name at any nesting depth.

> **Note:** `apiUrl` must include the endpoint path (`/api/v1/logs`). The SDK sends the combined log directly to `apiUrl`, so a bare host will 404.

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
   - Request ID (for correlation) + `traceId` / `spanId`
   - Timestamp
   - HTTP method, URL
   - User agent, IP address
   - Sanitized request headers
   - Request size (bytes)
   - Authenticated user ID (from `req.user`, when present)
   - Request body (with sensitive data redacted)

2. **Response Information**:
   - Request ID (for correlation) + `traceId` / `spanId`
   - Timestamp
   - Status code
   - Response time and response size (bytes)
   - Response body (with sensitive data redacted)

3. **Host & Runtime Metadata** (attached to every log as `meta`):
   - hostname, server IP, service name, environment
   - SDK version, Node.js version, OS, process ID
   - Memory usage (rss/heap/external) and CPU usage

4. **Error Information**:
   - Error name, message, stack trace, custom code
   - Additional context
   - System information (Node.js version, platform)

### Database Query Logging

Inject `LoggingService` and record slow/notable queries:

```typescript
import { LoggingService } from 'nugi-logs-sdk';

constructor(private readonly logging: LoggingService) {}

const start = Date.now();
const rows = await this.db.query(sql);
this.logging.logQuery(sql, Date.now() - start, requestId); // never throws / non-blocking
```

### Sensitive Data Handling

The SDK automatically redacts sensitive information from request/response bodies **and** headers. Built-in patterns (substring, case-insensitive) cover:
- Passwords (`password`, `passwd`, `pwd`)
- Tokens & secrets (`token`, `secret`, `apiKey`, `credential`)
- Auth material (`authorization`, `cookie`, `session`, `private`)

**Custom fields** — pass a `redact` array to redact your own fields (exact field name, case-insensitive, at any depth):

```typescript
LoggingModule.forRoot({
  apiKey: 'your-api-key',
  appId: 'your-app-id',
  environment: 'production',
  redact: ['ssn', 'accountNumber', 'x-tenant-id'],
});
```

### Reliability

Logging never crashes or blocks your application:
- All collection and delivery runs in `try/catch`; failures are swallowed (logged locally at most).
- Log delivery is **fire-and-forget** — requests are never held waiting on the network.
- Outbound requests have a **5s timeout**; a slow/unreachable backend can't pile up.

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