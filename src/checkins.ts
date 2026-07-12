import { Logger } from '@nestjs/common';
import axios from 'axios';

const logger = new Logger('Checkins');

export type CheckinStatus = 'ok' | 'error' | 'in_progress';

export interface CheckinsConfig {
  /** Logs ingest URL; check-ins go to the sibling `/monitors/checkins` path. */
  apiUrl?: string;
  apiKey: string;
  appId: string;
}

const REQUEST_TIMEOUT_MS = 5000;

let checkinsConfig: CheckinsConfig | null = null;
let checkinUrl: string | undefined;

/**
 * Derive the monitor check-in URL from the logs ingest URL.
 * typical: http://host/api/v1/logs → http://host/api/v1/monitors/checkins
 */
export function resolveCheckinUrl(apiUrl?: string): string | undefined {
  if (!apiUrl) return undefined;
  if (apiUrl.includes('/logs')) {
    return apiUrl.replace(/\/logs\/?$/, '/monitors/checkins');
  }
  return apiUrl.replace(/\/$/, '') + '/monitors/checkins';
}

/** Configure the process-wide check-ins client (also called from LoggingModule). */
export function initializeCheckins(config: CheckinsConfig): void {
  if (!config.apiKey) throw new Error('apiKey is required for checkins');
  if (!config.appId) throw new Error('appId is required for checkins');
  checkinsConfig = config;
  checkinUrl = resolveCheckinUrl(config.apiUrl);
}

async function emit(slug: string, status: CheckinStatus, message?: string): Promise<void> {
  try {
    if (!checkinsConfig) {
      logger.warn(
        'Checkins not initialized — call LoggingModule.forRoot or initializeCheckins first',
      );
      return;
    }
    if (!checkinUrl) return;
    if (!slug || typeof slug !== 'string') return;

    await axios.post(
      checkinUrl,
      {
        appId: checkinsConfig.appId,
        slug,
        status,
        message,
      },
      {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': checkinsConfig.apiKey,
        },
      },
    );
  } catch (err) {
    const msg = axios.isAxiosError(err) ? err.message : String(err);
    logger.error(`Failed to send check-in: ${msg}`);
  }
}

/**
 * Cron monitor check-in API. `slug` must match the monitor's config.slug.
 *
 * @example
 * checkins.ok('nightly-report');
 * checkins.error('nightly-report', 'DB timeout');
 * checkins.capture('nightly-report', 'in_progress');
 */
export const checkins = {
  /** Record a cron monitor check-in. */
  capture(slug: string, status: CheckinStatus = 'ok', message?: string): void {
    void emit(slug, status, message);
  },

  ok(slug: string, message?: string): void {
    void emit(slug, 'ok', message);
  },

  error(slug: string, message?: string): void {
    void emit(slug, 'error', message);
  },
};

export type CheckinsApi = typeof checkins;
