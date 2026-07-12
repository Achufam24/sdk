import { AsyncLocalStorage } from 'async_hooks';
import { Logger } from '@nestjs/common';
import axios from 'axios';
import { getHostMetadata, getRuntimeMetadata } from './metadata';

const logger = new Logger('Metrics');

/** Attribute values mirror Sentry: string | number | boolean. */
export type MetricAttributeValue = string | number | boolean;

export type MetricType = 'counter' | 'gauge' | 'distribution';

export interface MetricOptions {
  unit?: string;
  attributes?: Record<string, MetricAttributeValue>;
}

export interface MetricEventPayload {
  name: string;
  type: MetricType;
  value: number;
  unit?: string;
  attributes: Record<string, MetricAttributeValue>;
  timestamp: string;
}

export type BeforeSendMetric = (
  metric: MetricEventPayload,
) => MetricEventPayload | null | undefined;

export interface MetricsConfig {
  apiUrl?: string;
  apiKey: string;
  appId: string;
  environment: string;
  serviceName?: string;
  release?: string;
  /** Drop or mutate metrics before send. Return null to drop. */
  beforeSendMetric?: BeforeSendMetric;
  /** Soft cap on serialized attributes size (bytes). Default 2048. */
  maxAttributesBytes?: number;
}

interface ScopeState {
  attributes: Record<string, MetricAttributeValue>;
}

const scopeAls = new AsyncLocalStorage<ScopeState>();

let globalAttributes: Record<string, MetricAttributeValue> = {};
let metricsConfig: MetricsConfig | null = null;

const REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_ATTR_LIMIT = 2048;

/** Configure the process-wide metrics client (also called from LoggingModule). */
export function initializeMetrics(config: MetricsConfig): void {
  if (!config.apiKey) throw new Error('apiKey is required for metrics');
  if (!config.appId) throw new Error('appId is required for metrics');
  if (!config.environment) throw new Error('environment is required for metrics');
  metricsConfig = config;
}

/** Global attributes applied to every metric (and available to merge into logs later). */
export function setAttributes(
  attrs: Record<string, MetricAttributeValue>,
): void {
  globalAttributes = { ...globalAttributes, ...sanitizeAttrs(attrs) };
}

export function clearAttributes(): void {
  globalAttributes = {};
}

export function getAttributes(): Record<string, MetricAttributeValue> {
  return { ...globalAttributes, ...currentScopeAttributes() };
}

/**
 * Run `fn` with a nested attribute scope. Attributes set on the scope apply
 * only to metrics recorded inside the callback (plus globals).
 */
export function withScope<T>(
  fn: (scope: {
    setAttribute: (key: string, value: MetricAttributeValue) => void;
    setAttributes: (attrs: Record<string, MetricAttributeValue>) => void;
  }) => T,
): T {
  const parent = scopeAls.getStore();
  const state: ScopeState = {
    attributes: { ...(parent?.attributes || {}) },
  };
  const scope = {
    setAttribute(key: string, value: MetricAttributeValue) {
      if (isValidAttrValue(value)) state.attributes[key] = value;
    },
    setAttributes(attrs: Record<string, MetricAttributeValue>) {
      Object.assign(state.attributes, sanitizeAttrs(attrs));
    },
  };
  return scopeAls.run(state, () => fn(scope));
}

function currentScopeAttributes(): Record<string, MetricAttributeValue> {
  return scopeAls.getStore()?.attributes || {};
}

function isValidAttrValue(v: unknown): v is MetricAttributeValue {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function sanitizeAttrs(
  attrs?: Record<string, MetricAttributeValue>,
): Record<string, MetricAttributeValue> {
  if (!attrs) return {};
  const out: Record<string, MetricAttributeValue> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof k === 'string' && k.length > 0 && isValidAttrValue(v)) {
      out[k] = v;
    }
  }
  return out;
}

function mergeAttributes(
  local?: Record<string, MetricAttributeValue>,
): Record<string, MetricAttributeValue> {
  return {
    ...globalAttributes,
    ...currentScopeAttributes(),
    ...sanitizeAttrs(local),
  };
}

function attributesWithinLimit(
  attrs: Record<string, MetricAttributeValue>,
  limit: number,
): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(attrs), 'utf8') <= limit;
  } catch {
    return false;
  }
}

async function emit(
  name: string,
  type: MetricType,
  value: number,
  options: MetricOptions = {},
): Promise<void> {
  try {
    if (!metricsConfig) {
      logger.warn(
        'Metrics not initialized — call LoggingModule.forRoot or initializeMetrics first',
      );
      return;
    }
    if (typeof value !== 'number' || Number.isNaN(value)) return;
    if (!name || typeof name !== 'string') return;

    const limit = metricsConfig.maxAttributesBytes ?? DEFAULT_ATTR_LIMIT;
    let attributes = mergeAttributes(options.attributes);
    if (!attributesWithinLimit(attributes, limit)) {
      logger.warn(
        `Metric "${name}" dropped — attributes exceed ${limit} byte limit`,
      );
      return;
    }

    let metric: MetricEventPayload = {
      name,
      type,
      value,
      unit: options.unit,
      attributes,
      timestamp: new Date().toISOString(),
    };

    if (metricsConfig.beforeSendMetric) {
      const next = metricsConfig.beforeSendMetric(metric);
      if (next == null) return;
      metric = next;
      if (!attributesWithinLimit(metric.attributes || {}, limit)) {
        logger.warn(`Metric "${name}" dropped after beforeSendMetric size check`);
        return;
      }
    }

    if (!metricsConfig.apiUrl) {
      logger.warn(
        `Metric "${name}" dropped — apiUrl is not configured (set LoggingOptions.apiUrl to …/api/v1/logs)`,
      );
      return;
    }

    await axios.post(
      metricsConfig.apiUrl,
      {
        type: 'metric',
        appId: metricsConfig.appId,
        environment: metricsConfig.environment,
        serviceName: metricsConfig.serviceName || metricsConfig.appId,
        release: metricsConfig.release,
        name: metric.name,
        metricType: metric.type,
        value: metric.value,
        unit: metric.unit,
        attributes: metric.attributes,
        timestamp: metric.timestamp,
        meta: { ...getHostMetadata(), ...getRuntimeMetadata() },
      },
      {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': metricsConfig.apiKey,
        },
      },
    );
  } catch (err) {
    const message = axios.isAxiosError(err) ? err.message : String(err);
    logger.error(`Failed to send metric: ${message}`);
  }
}

/**
 * Sentry-style metrics API.
 *
 * @example
 * metrics.count('orders_created', 1);
 * metrics.gauge('active_connections', 42);
 * metrics.distribution('api_latency', 187, { unit: 'millisecond' });
 */
export const metrics = {
  /** Count occurrences (orders, clicks, API calls). */
  count(name: string, value = 1, options?: MetricOptions): void {
    void emit(name, 'counter', value, options);
  },

  /** Track a point-in-time value (queue depth, connections). */
  gauge(name: string, value: number, options?: MetricOptions): void {
    void emit(name, 'gauge', value, options);
  },

  /** Track a distribution of values (latency, payload size). */
  distribution(name: string, value: number, options?: MetricOptions): void {
    void emit(name, 'distribution', value, options);
  },
};

export type MetricsApi = typeof metrics;
