// Captures the service's own console output as first-class telemetry — so a
// service reports its logs even when it serves no HTTP traffic. Each call also
// becomes a breadcrumb. Ported from nugi-logs-ts-sdk.

import { Breadcrumb, BreadcrumbBuffer, BreadcrumbLevel } from './breadcrumbs';

export type ConsoleMethod = 'debug' | 'info' | 'log' | 'warn' | 'error';

const METHOD_LEVEL: Record<ConsoleMethod, BreadcrumbLevel> = {
  debug: 'debug',
  info: 'info',
  log: 'info',
  warn: 'warn',
  error: 'error',
};

export interface ConsoleLogRecord {
  level: BreadcrumbLevel;
  message: string;
  timestamp: string;
}

export interface ConsoleCaptureOptions {
  levels: ConsoleMethod[];
  /** Called with each captured entry so it can be shipped as a log event. */
  onLog?: (record: ConsoleLogRecord) => void;
}

/**
 * Monkey-patches the global console. Original behaviour is always preserved and
 * restored on stop; capture is re-entrancy guarded so the SDK's own logging can
 * never recurse.
 */
export class ConsoleCapture {
  private originals: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {};
  private patched = false;
  private inHandler = false;

  constructor(
    private readonly breadcrumbs: BreadcrumbBuffer,
    private readonly options: ConsoleCaptureOptions,
  ) {}

  start(): void {
    if (this.patched || typeof console === 'undefined') return;
    this.patched = true;

    for (const method of this.options.levels) {
      const original = (console as any)[method] as ((...args: unknown[]) => void) | undefined;
      if (typeof original !== 'function') continue;
      this.originals[method] = original.bind(console);

      (console as any)[method] = (...args: unknown[]): void => {
        this.originals[method]?.(...args); // preserve app behaviour first
        if (this.inHandler) return;
        this.inHandler = true;
        try {
          this.handle(method, args);
        } catch {
          /* never let capture break the host */
        } finally {
          this.inHandler = false;
        }
      };
    }
  }

  stop(): void {
    if (!this.patched) return;
    for (const method of Object.keys(this.originals) as ConsoleMethod[]) {
      const original = this.originals[method];
      if (original) (console as any)[method] = original;
    }
    this.originals = {};
    this.patched = false;
  }

  private handle(method: ConsoleMethod, args: unknown[]): void {
    const level = METHOD_LEVEL[method];
    const message = formatArgs(args);
    if (!message) return;

    const timestamp = new Date().toISOString();
    const crumb: Breadcrumb = { timestamp, type: 'console', level, message };
    this.breadcrumbs.add(crumb);
    this.options.onLog?.({ level, message, timestamp });
  }
}

/** Best-effort console.* argument formatting into a single message string. */
export function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ')
    .slice(0, 8192);
}
