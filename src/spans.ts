import { Logger } from '@nestjs/common';
import axios from 'axios';
import { AsyncLocalStorage } from 'async_hooks';
import { getHostMetadata, getRuntimeMetadata } from './metadata';

const logger = new Logger('Spans');

export type SpanAttributeValue = string | number | boolean;
export type SpanStatus = 'ok' | 'error' | 'unset';

export interface SpanOptions {
  attributes?: Record<string, SpanAttributeValue>;
  spanKind?: string;
  parentSpanId?: string;
  traceId?: string;
}

export interface SpansConfig {
  apiUrl?: string;
  apiKey: string;
  appId: string;
  environment: string;
  serviceName?: string;
  release?: string;
}

export interface ActiveSpan {
  spanId: string;
  traceId: string;
  /** True after end() has been called (idempotent). */
  readonly ended: boolean;
  setAttribute(key: string, value: SpanAttributeValue): void;
  setStatus(status: SpanStatus, message?: string): void;
  end(status?: SpanStatus, statusMessage?: string): void;
}

export interface FinishedSpanInput {
  name: string;
  durationMs: number;
  endTime?: string;
  attributes?: Record<string, SpanAttributeValue>;
  spanKind?: string;
  status?: SpanStatus;
  statusMessage?: string;
  parentSpanId?: string;
  traceId?: string;
}

const REQUEST_TIMEOUT_MS = 5000;
const HEX = '0123456789abcdef';

let spansConfig: SpansConfig | null = null;
const spanAls = new AsyncLocalStorage<{ span: ActiveSpan }>();

/** Configure the process-wide spans client (also called from LoggingModule). */
export function initializeSpans(config: SpansConfig): void {
  if (!config.apiKey) throw new Error('apiKey is required for spans');
  if (!config.appId) throw new Error('appId is required for spans');
  if (!config.environment) throw new Error('environment is required for spans');
  spansConfig = config;
}

/** Current request/work span when running inside `spans.run` / middleware ALS. */
export function getActiveSpan(): ActiveSpan | undefined {
  return spanAls.getStore()?.span;
}

function randomHex(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += HEX[Math.floor(Math.random() * 16)];
  }
  return out;
}

function isValidAttrValue(v: unknown): v is SpanAttributeValue {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function sanitizeAttrs(
  attrs?: Record<string, SpanAttributeValue>,
): Record<string, SpanAttributeValue> {
  if (!attrs) return {};
  const out: Record<string, SpanAttributeValue> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof k === 'string' && k.length > 0 && isValidAttrValue(v)) {
      out[k] = v;
    }
  }
  return out;
}

async function emitSpan(payload: {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  spanKind: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  status: SpanStatus;
  statusMessage?: string;
  attributes: Record<string, SpanAttributeValue>;
}): Promise<void> {
  try {
    if (!spansConfig) {
      logger.warn(
        'Spans not initialized — call LoggingModule.forRoot or initializeSpans first',
      );
      return;
    }
    if (!spansConfig.apiUrl) return;

    await axios.post(
      spansConfig.apiUrl,
      {
        type: 'span',
        appId: spansConfig.appId,
        environment: spansConfig.environment,
        serviceName: spansConfig.serviceName || spansConfig.appId,
        release: spansConfig.release,
        name: payload.name,
        traceId: payload.traceId,
        spanId: payload.spanId,
        parentSpanId: payload.parentSpanId,
        spanKind: payload.spanKind,
        startTime: payload.startTime,
        endTime: payload.endTime,
        durationMs: payload.durationMs,
        status: payload.status,
        statusMessage: payload.statusMessage,
        attributes: payload.attributes,
        timestamp: payload.startTime,
        meta: { ...getHostMetadata(), ...getRuntimeMetadata() },
      },
      {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': spansConfig.apiKey,
        },
      },
    );
  } catch (err) {
    const message = axios.isAxiosError(err) ? err.message : String(err);
    logger.error(`Failed to send span: ${message}`);
  }
}

function createActiveSpan(name: string, options: SpanOptions = {}): ActiveSpan {
  const active = getActiveSpan();
  const spanId = randomHex(16);
  const traceId = options.traceId || active?.traceId || randomHex(32);
  const parentSpanId = options.parentSpanId ?? active?.spanId;
  const spanKind = options.spanKind || 'internal';
  const attributes = sanitizeAttrs(options.attributes);
  const startMs = Date.now();
  const startTime = new Date(startMs).toISOString();
  let status: SpanStatus = 'unset';
  let statusMessage: string | undefined;
  let ended = false;

  return {
    spanId,
    traceId,
    get ended() {
      return ended;
    },
    setAttribute(key: string, value: SpanAttributeValue) {
      if (isValidAttrValue(value) && typeof key === 'string' && key.length > 0) {
        attributes[key] = value;
      }
    },
    setStatus(next: SpanStatus, message?: string) {
      status = next;
      statusMessage = message;
    },
    end(endStatus?: SpanStatus, endMessage?: string) {
      if (ended) return;
      ended = true;
      if (endStatus !== undefined) {
        status = endStatus;
      } else if (status === 'unset') {
        status = 'ok';
      }
      if (endMessage !== undefined) statusMessage = endMessage;
      const endMs = Date.now();
      void emitSpan({
        name,
        traceId,
        spanId,
        parentSpanId,
        spanKind,
        startTime,
        endTime: new Date(endMs).toISOString(),
        durationMs: endMs - startMs,
        status,
        statusMessage,
        attributes,
      });
    },
  };
}

/**
 * Manual span API for tracing work units.
 */
export const spans = {
  /** Start a span; call end() when done. */
  start(name: string, options?: SpanOptions): ActiveSpan {
    return createActiveSpan(name, options);
  },

  /**
   * Run `fn` with `span` as the active parent for nested work (e.g. DB queries).
   */
  run<T>(span: ActiveSpan, fn: () => T): T {
    return spanAls.run({ span }, fn);
  },

  /**
   * Record a span that already finished (known duration) — used for DB queries.
   */
  recordFinished(input: FinishedSpanInput): void {
    const active = getActiveSpan();
    const durationMs = Math.max(0, Number(input.durationMs) || 0);
    const endMs = input.endTime ? new Date(input.endTime).getTime() : Date.now();
    const endTime = new Date(Number.isNaN(endMs) ? Date.now() : endMs).toISOString();
    const startTime = new Date(
      new Date(endTime).getTime() - durationMs,
    ).toISOString();
    const spanId = randomHex(16);
    const traceId = input.traceId || active?.traceId || randomHex(32);
    const parentSpanId = input.parentSpanId ?? active?.spanId;
    void emitSpan({
      name: input.name,
      traceId,
      spanId,
      parentSpanId,
      spanKind: input.spanKind || 'client',
      startTime,
      endTime,
      durationMs,
      status: input.status || 'ok',
      statusMessage: input.statusMessage,
      attributes: sanitizeAttrs(input.attributes),
    });
  },

  /** Run async (or sync) fn inside a span and auto-end. */
  async withSpan<T>(
    name: string,
    fn: (span: ActiveSpan) => Promise<T> | T,
    options?: SpanOptions,
  ): Promise<T> {
    const span = createActiveSpan(name, options);
    return spanAls.run({ span }, async () => {
      try {
        const result = await fn(span);
        span.end();
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        span.end('error', message);
        throw err;
      }
    });
  },
};

export type SpansApi = typeof spans;
