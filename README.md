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
- **Application metrics** — Sentry-style `count` / `gauge` / `distribution` with attributes & scopes
- **Database query logging** — auto-capture for `pg` / `mysql2` / `sequelize` (+ Prisma helper)
- **Error reporting** — `ReportError()` with Sentry-style frames + source context + breadcrumbs
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
| `captureQueries` | No | `true` | Auto-instrument `pg` / `mysql2` / `sequelize` SQL |
| `slowQueryThresholdMs` | No | `500` | Queries at/above this duration are flagged slow + counted in `db.query.slow` |
| `enableMetrics` | No | `true` | Enable `metrics.count` / `gauge` / `distribution` |
| `beforeSendMetric` | No | — | Hook to filter/mutate metrics; return `null` to drop |

> **`apiUrl` must include the endpoint path** (e.g. `/api/v1/logs`). The SDK sends directly to this URL.

## Application Metrics

Metrics let you track numeric application health signals and correlate them with logs and errors in the Nugi admin **Metrics** view. Enabled automatically when you use `LoggingModule.forRoot`.

With the HTTP middleware installed, each response also auto-emits:

- `http.server.requests` (count)
- `http.server.duration` (distribution, ms)
- `http.server.errors` / `http.server.client_errors` (count, for 5xx / 4xx)

### Metric types

| Type | API | Use for |
|------|-----|---------|
| **Count** | `metrics.count(name, value?)` | Occurrences — orders, clicks, API calls |
| **Gauge** | `metrics.gauge(name, value)` | Point-in-time values — queue depth, connections |
| **Distribution** | `metrics.distribution(name, value, opts?)` | Value ranges — latency, payload size |

### Basic usage

```typescript
import { metrics } from 'nugi-logs-sdk';
// or: this.logging.metrics  (inject LoggingService)

// Count occurrences
metrics.count('orders_created', 1);

// Track current values
metrics.gauge('active_connections', 42);

// Track distributions (with unit)
metrics.distribution('api_latency', 187, {
  unit: 'millisecond',
});
```

### Attributes (filtering & grouping)

Attach metadata to filter and group metrics in the dashboard. Common uses: environment segmentation, feature flags, user tier.

There is a **2KB size limit** per metric's attributes — exceeding it drops the metric.

```typescript
metrics.count('api_calls', 1, {
  attributes: {
    endpoint: '/api/orders',
    user_tier: 'pro',
    region: 'us-west',
  },
});
```

### Shared attributes

**Global** — apply to every metric:

```typescript
import { setAttributes } from 'nugi-logs-sdk';

setAttributes({
  is_admin: true,
  auth_provider: 'google',
});
```

**Scoped** — apply only inside a callback:

```typescript
import { metrics, withScope } from 'nugi-logs-sdk';

withScope((scope) => {
  scope.setAttribute('step', 'authentication');

  // Includes global attrs + step=authentication
  metrics.count('clicks', 1);
  metrics.gauge('time_since_refresh', 4, { unit: 'second' });
});
```

### Units

Specify units on gauges and distributions for readable display:

```typescript
metrics.distribution('response_time', 187.5, { unit: 'millisecond' });
metrics.gauge('memory_usage', 1024, { unit: 'byte' });
```

Common units: `millisecond`, `second`, `byte`, `kilobyte`, `megabyte`.

### `beforeSendMetric`

Filter or mutate metrics before they leave the process. Return `null` to drop:

```typescript
LoggingModule.forRoot({
  apiUrl: '...',
  apiKey: '...',
  appId: '...',
  environment: 'production',
  beforeSendMetric(metric) {
    if (metric.name === 'debug_metric') return null;
    return {
      ...metric,
      attributes: { ...metric.attributes, processed: true },
    };
  },
});
```

### NestJS injection

```typescript
import { LoggingService } from 'nugi-logs-sdk';

@Injectable()
export class CheckoutService {
  constructor(private readonly logging: LoggingService) {}

  async complete(orderId: string) {
    this.logging.metrics.count('checkout.completed', 1, {
      attributes: { order_id: orderId },
    });
  }
}
```

Metrics are POSTed as `type: 'metric'` to your `apiUrl` and appear under **Observability → Metrics** in the admin UI.

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
- Error name, message, raw stack string
- **Structured stack frames** with Sentry-style source context (`preContext`, `contextLine`, `postContext`) read from disk at capture time
- `inApp` flags (application vs `node_modules`)
- Breadcrumb trail (console, structured logs, **SQL queries**)
- Host & runtime metadata snapshot
- `handled` / `mechanism` flags

Reports are posted to `<apiUrl>/errors`.

## Database Query Logging

### Automatic (default)

With `captureQueries: true` (default), the SDK patches common drivers when they are installed:

- `pg` (Client + Pool)
- `mysql2`
- `sequelize` (`Sequelize.prototype.query`)

Every query is shipped as `type: 'query'` and recorded as a breadcrumb for later error reports.
Slow queries (≥ `slowQueryThresholdMs`, default 500ms) are also:

- tagged `slow: true` on the query event
- emitted as a nested `db.*.query` client span (when an HTTP/request span is active)
- recorded as `db.query.duration` (distribution) and `db.query.slow` (counter) metrics

```typescript
LoggingModule.forRoot({
  apiUrl: '...',
  apiKey: '...',
  appId: '...',
  environment: 'production',
  captureQueries: true, // default
  slowQueryThresholdMs: 500, // default
});
```

### Prisma

Prisma uses its own engine — wrap the client once:

```typescript
import { instrumentPrisma } from 'nugi-logs-sdk';
// or: loggingService.wrapPrisma(prisma)

const prisma = instrumentPrisma(new PrismaClient(), (info) => {
  // optional custom handler — LoggingService.wrapPrisma wires this for you
});
```

```typescript
// Preferred with Nest DI
constructor(private readonly logging: LoggingService) {
  this.prisma = this.logging.wrapPrisma(new PrismaClient());
}
```

### Manual

```typescript
this.logger.logQuery('SELECT * FROM users WHERE id = $1', Date.now() - start, requestId);
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
- `ReportError(error, metadata?)` — ship error + breadcrumbs + source frames

### Metrics
- `metrics.count` / `metrics.gauge` / `metrics.distribution`
- `setAttributes`, `withScope`, `initializeMetrics`
- `LoggingService.metrics` — same API via DI

### Types
- `LoggingOptions`, `LogLevel`
- `BaseLog`, `RequestLog`, `ResponseLog`, `CombinedLog`, `LogMetadata`
- `ErrorMetadata`, `ErrorReportingConfig`, `StackFrame`
- `MetricOptions`, `MetricEventPayload`, `BeforeSendMetric`, `MetricAttributeValue`
- `HostMetadata`, `RuntimeMetadata`, `TraceContext`
- `Breadcrumb`, `BreadcrumbLevel`, `BreadcrumbBuffer`
- `ConsoleCapture`, `ConsoleMethod`, `ConsoleLogRecord`

### Utilities
- `getHostMetadata()`, `getRuntimeMetadata()`, `extractTraceContext(headers)`
- `sanitizeBody()`, `sanitizeHeaders()`, `REDACTED`
- `sharedBreadcrumbs` — process-wide breadcrumb buffer

## License

MIT
