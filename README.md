# Nugi Logs SDK

A NestJS logging SDK that captures HTTP request/response pairs, structured logs, database queries, and errors — then ships them to a [Nugi Logs server](https://github.com/Achufam24/nugi-logs-server) with automatic redaction, distributed tracing, breadcrumbs, and fault-tolerant delivery.

## Installation

```bash
npm install nugi-logs-sdk
```

Peer dependencies: `@nestjs/common` (^9 || ^10 || ^11), `rxjs` (^7).

## Features

- **HTTP request/response logging** — automatic middleware captures every request lifecycle
- **Structured manual logging** — `debug()`, `info()`, `warn()`, `error()`, `log()` APIs
- **Database query logging** — `logQuery()` for SQL timing telemetry
- **Error reporting** — `ReportError()` with Sentry-style breadcrumb trail
- **Console capture** — monkey-patches `console.*` to ship logs even with zero HTTP traffic
- **NestJS Logger bridge** — `NugiLoggerService` replaces the built-in framework logger
- **Distributed tracing** — W3C `traceparent`, `x-trace-id`, `x-b3-traceid`, `x-amzn-trace-id`
- **IPv4 + IPv6 server IPs** — resolves all non-internal interfaces, both address families
- **Client IP normalization** — strips `::ffff:` mapped prefixes, reads `x-forwarded-for`
- **Sensitive data redaction** — built-in patterns + custom `redact` list
- **Host & runtime metadata** — hostname, IPs, OS, PID, memory, CPU on every log
- **Fault-tolerant** — never crashes, blocks, or slows the host app

## Quick Start

```typescript
import { Module } from '@nestjs/common';
import { LoggingModule } from 'nugi-logs-sdk';

@Module({
  imports: [
    LoggingModule.forRoot({
      apiUrl: 'https://your-server.com/api/v1/logs',
      apiKey: 'nugi_sk_...',
      appId: 'your-app-id',
      environment: 'production',
    }),
  ],
})
export class AppModule {}
```

This applies `LoggingMiddleware` to all routes automatically.

## Configuration

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `apiUrl` | No | `undefined` | Full URL of the logging server ingest endpoint (e.g. `https://host/api/v1/logs`). SDK POSTs directly here; error reports go to `<apiUrl>/errors`. Omit for local-only logging. |
| `apiKey` | Yes | — | API key sent as `X-API-Key` header |
| `appId` | Yes | — | Application identifier |
| `environment` | Yes | — | Environment name (`production`, `staging`, `development`) |
| `serviceName` | No | `appId` | Logical service name on every log |
| `redact` | No | `[]` | Extra field names to redact (case-insensitive exact match, any depth) |
| `captureConsole` | No | `true` | Intercept `console.*` and ship as telemetry |
| `consoleLevels` | No | all | Which console methods to capture: `debug`, `info`, `log`, `warn`, `error` |
| `maxBreadcrumbs` | No | `50` | Ring buffer capacity for error context trail |

> **`apiUrl` must include the endpoint path** (e.g. `/api/v1/logs`). The SDK sends directly to this URL.

## Structured Logging

Inject `LoggingService` to emit structured log events from anywhere in your app:

```typescript
import { LoggingService } from 'nugi-logs-sdk';

@Injectable()
export class PaymentService {
  constructor(private readonly logger: LoggingService) {}

  async charge(userId: string, amount: number) {
    this.logger.info('Processing payment', { userId, amount });
    try {
      const result = await this.stripe.charge(amount);
      this.logger.info('Payment succeeded', { userId, chargeId: result.id });
    } catch (err) {
      this.logger.error('Payment failed', { userId, error: err.message });
      throw err;
    }
  }
}
```

All levels: `debug()`, `info()`, `warn()`, `error()`, `log(level, message, attributes?)`.

Each call ships a `type: 'log'` event to the server and records a breadcrumb.

## Console Capture

Enabled by default (`captureConsole: true`). The SDK monkey-patches `console.debug/info/log/warn/error` so your existing `console.log()` calls become telemetry — useful for services with zero HTTP traffic.

- Original behavior is always preserved
- Re-entrancy guarded (SDK's own logs don't recurse)
- Each call becomes a breadcrumb for error context

Disable with `captureConsole: false`.

## NestJS Logger Bridge

Replace NestJS's built-in logger so framework logs (bootstrap, route registration, errors) become structured telemetry:

```typescript
import { NugiLoggerService } from 'nugi-logs-sdk';

const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(NugiLoggerService));
```

## Error Reporting

```typescript
import { initializeErrorReporting, ReportError } from 'nugi-logs-sdk';

// In main.ts — before app bootstrap
initializeErrorReporting({
  apiKey: 'nugi_sk_...',
  appId: 'your-app-id',
  environment: 'production',
  apiUrl: 'https://your-server.com/api/v1/logs',
});

// In catch blocks anywhere
try {
  await riskyOperation();
} catch (error) {
  await ReportError(error, {
    code: 'PAYMENT_FAILED',
    mechanism: 'manual',
    handled: true,
    context: { userId: '123', orderId: 'abc' },
  });
}
```

Error reports include:
- Error name, message, stack trace
- Breadcrumb trail (console output + structured logs leading up to the error)
- Host & runtime metadata snapshot
- `handled` / `mechanism` flags (Sentry-style)

Reports are posted to `<apiUrl>/errors`.

## Database Query Logging

```typescript
import { LoggingService } from 'nugi-logs-sdk';

@Injectable()
export class UserRepository {
  constructor(private readonly logger: LoggingService) {}

  async findById(id: string) {
    const start = Date.now();
    const user = await this.db.query('SELECT * FROM users WHERE id = $1', [id]);
    this.logger.logQuery('SELECT * FROM users WHERE id = $1', Date.now() - start, requestId);
    return user;
  }
}
```

## IP Resolution

### Server IP

The SDK resolves all non-internal network interfaces at startup and caches the result:

```typescript
// HostMetadata.serverIp  → primary IP (prefers IPv4, falls back to IPv6)
// HostMetadata.serverIps → { ipv4: string[], ipv6: string[] }
```

- Collects both IPv4 and IPv6 addresses
- Skips internal/loopback interfaces
- Skips link-local `fe80::` IPv6 addresses
- Handles Node 18.4+ numeric family values

### Client IP

The middleware resolves the real client IP from each request:

1. Checks `x-forwarded-for` header (first entry = real client behind proxy/LB)
2. Falls back to `req.ip` → `req.socket.remoteAddress`
3. Normalizes IPv4-mapped IPv6 (`::ffff:10.0.0.1` → `10.0.0.1`)

## Sensitive Data Redaction

Bodies and headers are deep-redacted before leaving the process.

**Built-in patterns** (substring, case-insensitive):
`password`, `passwd`, `pwd`, `token`, `secret`, `apikey`, `api-key`, `authorization`, `auth`, `cookie`, `session`, `credential`, `private`

**Custom fields** — add your own via the `redact` option:

```typescript
LoggingModule.forRoot({
  apiKey: '...',
  appId: '...',
  environment: 'production',
  redact: ['ssn', 'accountNumber', 'x-tenant-id'],
});
```

Redaction is depth-limited (6 levels), cycle-safe, and never mutates the original object.

## What Gets Logged

### HTTP Requests (automatic via middleware)

| Field | Description |
|-------|-------------|
| `requestId` | UUID v4 for req/res correlation |
| `traceId` / `spanId` | From headers or auto-generated |
| `method`, `url`, `path` | HTTP method and URL |
| `ip` | Normalized client IP |
| `userAgent` | User-Agent header |
| `headers` | Sanitized request headers |
| `requestSize` / `responseSize` | Payload sizes in bytes |
| `userId` | From `req.user` (Passport/JWT) |
| `body` | Redacted request/response body |
| `statusCode`, `responseTime` | Response status and timing |

### Host & Runtime Metadata (on every outbound log)

| Field | Description |
|-------|-------------|
| `hostname` | Machine hostname |
| `serverIp` | Primary server IP |
| `serverIps` | `{ ipv4: [...], ipv6: [...] }` |
| `sdkVersion` | SDK package version |
| `nodeVersion` | Node.js version |
| `os` | OS type, release, platform, arch |
| `pid` | Process ID |
| `memoryUsage` | RSS, heap used/total, external |
| `cpuUsage` | CPU % (delta-based), user, system |

## Reliability

- All capture and delivery runs in `try/catch` — failures are swallowed
- Log delivery is **fire-and-forget** — never blocks the request pipeline
- Outbound requests have a **5-second timeout**
- The middleware always calls `next()` even if setup fails
- Stale pending logs are cleaned up every 5 minutes (30-minute TTL)

## Custom Route Configuration

Override `LoggingModule.configure()` to scope the middleware:

```typescript
@Module({
  imports: [LoggingModule.forRoot({ ... })],
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

## Exports

### NestJS Integration
- `LoggingModule` — dynamic module with `forRoot(options)`
- `LoggingMiddleware` — Express middleware (default HTTP capture)
- `LoggingService` — core logging + delivery service
- `NugiLoggerService` — NestJS `LoggerService` implementation

### Error Reporting
- `initializeErrorReporting(config)` — set global error config
- `ReportError(error, metadata?)` — ship error + breadcrumbs

### Types
- `LoggingOptions`, `LogLevel`
- `BaseLog`, `RequestLog`, `ResponseLog`, `CombinedLog`, `LogMetadata`
- `ErrorMetadata`, `ErrorReportingConfig`
- `HostMetadata`, `RuntimeMetadata`, `TraceContext`
- `Breadcrumb`, `BreadcrumbLevel`, `BreadcrumbBuffer`
- `ConsoleCapture`, `ConsoleMethod`, `ConsoleLogRecord`

### Utilities
- `getHostMetadata()`, `getRuntimeMetadata()`, `extractTraceContext(headers)`
- `sanitizeBody()`, `sanitizeHeaders()`, `REDACTED`
- `sharedBreadcrumbs` — process-wide breadcrumb buffer

## License

MIT
