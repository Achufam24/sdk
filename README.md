# Nugi Logs SDK

A NestJS logging SDK that captures request and response data and sends it to a backend server using middleware.

## Installation

```bash
npm install nugi-logs-sdk
```

## Usage

### Basic Setup

Import the `LoggingModule` in your app module and configure it with `forRoot`:

```typescript
import { Module } from '@nestjs/common';
import { LoggingModule } from 'nugi-logs-sdk';

@Module({
  imports: [
    LoggingModule.forRoot({
      apiUrl: 'https://your-logging-server.com/api/logs',
      apiKey: 'your-api-key', // Optional
      appId: 'your-app-id', // Optional
      environment: 'production', // Optional
    }),
  ],
})
export class AppModule {}
```

### Configuration Options

The `LoggingModule.forRoot()` method accepts the following options:

- `apiUrl` (required): The URL of your logging server API endpoint
- `apiKey` (optional): API key for authentication with your logging server
- `appId` (optional): Identifier for your application
- `environment` (optional): Environment name (e.g., 'development', 'production')

### What Gets Logged

The SDK automatically logs:

1. **Request Information**:
   - Timestamp
   - HTTP method
   - URL
   - User agent
   - IP address
   - Request body (with sensitive data redacted)

2. **Response Information**:
   - Timestamp
   - HTTP method
   - URL
   - Status code
   - Response time

### Sensitive Data Handling

The SDK automatically redacts sensitive information from request bodies, including:
- Passwords
- Tokens
- Authorization headers
- API keys

### Custom Route Configuration

You can customize which routes the middleware applies to by extending the `LoggingModule`:

```typescript
import { Module } from '@nestjs/common';
import { LoggingModule } from 'nugi-logs-sdk';

@Module({
  imports: [LoggingModule.forRoot({
    apiUrl: 'https://your-logging-server.com/api/logs',
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

## License

MIT 