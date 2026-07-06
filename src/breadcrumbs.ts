// Breadcrumb trail — a lightweight record of console output / logs / HTTP calls
// captured leading up to an error, mirroring Sentry's model. Ported from the
// framework-agnostic nugi-logs-ts-sdk so this NestJS SDK reaches feature parity.

export type BreadcrumbLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface Breadcrumb {
  timestamp: string;
  type: string; // 'console' | 'log' | 'http' | custom
  level: BreadcrumbLevel;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Fixed-capacity ring buffer of breadcrumbs. Oldest entries drop once capacity
 * is reached. A snapshot is attached to error reports so the trail that led to
 * a failure travels with it.
 */
export class BreadcrumbBuffer {
  private items: Breadcrumb[] = [];

  constructor(private capacity: number = 50) {}

  setCapacity(capacity: number): void {
    this.capacity = Math.max(0, capacity);
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity);
    }
  }

  add(crumb: Breadcrumb): void {
    if (this.capacity <= 0) return;
    this.items.push(crumb);
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity);
    }
  }

  /** Oldest-first snapshot suitable for attaching to an event. */
  snapshot(): Breadcrumb[] {
    return this.items.slice();
  }

  clear(): void {
    this.items = [];
  }
}

/**
 * Process-wide breadcrumb buffer shared between console capture, the logging
 * service and error reporting (which are separate units in this SDK). Capacity
 * is reconfigured from LoggingModule options at startup.
 */
export const sharedBreadcrumbs = new BreadcrumbBuffer(50);
