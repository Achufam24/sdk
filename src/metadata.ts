import * as os from 'os';

// ---------------------------------------------------------------------------
// Metadata collection for logs. Split into three concerns:
//   - Host metadata: static for the process lifetime, computed once and cached.
//   - Runtime metadata: memory/CPU, sampled per log.
//   - Trace context: traceId/spanId, derived per request from incoming headers.
// Everything here is defensive: collection must never throw into the host app.
// ---------------------------------------------------------------------------

export interface HostMetadata {
  hostname: string;
  serverIp: string;
  sdkVersion: string;
  nodeVersion: string;
  os: string;
  pid: number;
}

export interface RuntimeMetadata {
  memoryUsage: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  cpuUsage: {
    // Approximate percentage of a single core used by this process since the
    // previous sample. -1 until at least two samples have been taken.
    percent: number;
    user: number;
    system: number;
  };
}

export interface TraceContext {
  traceId: string;
  spanId: string;
}

function resolveSdkVersion(): string {
  try {
    // package.json sits at the package root, one level above dist/ (and src/).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../package.json').version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function resolveServerIp(): string {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        // First non-internal IPv4 address is the best "server IP" guess.
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch {
    /* fall through */
  }
  return '127.0.0.1';
}

let cachedHost: HostMetadata | undefined;

export function getHostMetadata(): HostMetadata {
  if (cachedHost) return cachedHost;
  try {
    cachedHost = {
      hostname: os.hostname(),
      serverIp: resolveServerIp(),
      sdkVersion: resolveSdkVersion(),
      nodeVersion: process.version,
      os: `${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
      pid: process.pid,
    };
  } catch {
    cachedHost = {
      hostname: 'unknown',
      serverIp: '127.0.0.1',
      sdkVersion: resolveSdkVersion(),
      nodeVersion: process.version,
      os: 'unknown',
      pid: process.pid,
    };
  }
  return cachedHost;
}

// State for computing CPU usage as a delta between samples.
let lastCpuUsage: NodeJS.CpuUsage | undefined;
let lastCpuSampleAt: number | undefined; // high-res ms

export function getRuntimeMetadata(): RuntimeMetadata {
  const mem = safeMemoryUsage();

  let percent = -1;
  let user = 0;
  let system = 0;
  try {
    const now = Date.now(); // ms
    const current = process.cpuUsage(); // cumulative micros
    user = current.user;
    system = current.system;

    if (lastCpuUsage && lastCpuSampleAt !== undefined) {
      const elapsedMs = now - lastCpuSampleAt;
      if (elapsedMs > 0) {
        const usedMicros =
          current.user - lastCpuUsage.user + (current.system - lastCpuUsage.system);
        // micros of CPU / (ms elapsed * 1000 micros/ms) * 100
        percent = Math.round((usedMicros / (elapsedMs * 1000)) * 100 * 100) / 100;
      }
    }
    lastCpuUsage = current;
    lastCpuSampleAt = now;
  } catch {
    /* leave defaults */
  }

  return {
    memoryUsage: mem,
    cpuUsage: { percent, user, system },
  };
}

function safeMemoryUsage(): RuntimeMetadata['memoryUsage'] {
  try {
    const m = process.memoryUsage();
    return {
      rss: m.rss,
      heapUsed: m.heapUsed,
      heapTotal: m.heapTotal,
      external: m.external,
    };
  } catch {
    return { rss: 0, heapUsed: 0, heapTotal: 0, external: 0 };
  }
}

const HEX = '0123456789abcdef';
function randomHex(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += HEX[Math.floor(Math.random() * 16)];
  }
  return out;
}

/**
 * Derive trace context from incoming request headers. Honours the W3C
 * `traceparent` header (version-traceId-spanId-flags) and common vendor
 * headers, falling back to freshly generated ids so every log is correlatable.
 */
export function extractTraceContext(headers: Record<string, any> = {}): TraceContext {
  try {
    const traceparent = pickHeader(headers, 'traceparent');
    if (traceparent) {
      const parts = traceparent.split('-');
      if (parts.length >= 3 && parts[1] && parts[2]) {
        return { traceId: parts[1], spanId: parts[2] };
      }
    }

    const traceId =
      pickHeader(headers, 'x-trace-id') ||
      pickHeader(headers, 'x-b3-traceid') ||
      pickHeader(headers, 'x-amzn-trace-id') ||
      randomHex(32);
    const spanId =
      pickHeader(headers, 'x-span-id') ||
      pickHeader(headers, 'x-b3-spanid') ||
      randomHex(16);

    return { traceId, spanId };
  } catch {
    return { traceId: randomHex(32), spanId: randomHex(16) };
  }
}

function pickHeader(headers: Record<string, any>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' && value.length ? value : undefined;
}
