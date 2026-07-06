// NestJS LoggerService bridge. Wire it so the framework's own logs — and any
// `this.logger.log()` calls — become structured telemetry (and breadcrumbs),
// not just stdout:
//
//   const app = await NestFactory.create(AppModule, { bufferLogs: true });
//   app.useLogger(app.get(NugiLoggerService));
//
// Ported from nugi-logs-ts-sdk's NugiLoggerService.

import { Injectable, LoggerService } from '@nestjs/common';
import { LoggingService, LogLevel } from './logging.service';

@Injectable()
export class NugiLoggerService implements LoggerService {
  constructor(private readonly logging: LoggingService) {}

  log(message: unknown, ...rest: unknown[]): void {
    this.emit('info', message, rest);
  }
  error(message: unknown, ...rest: unknown[]): void {
    const stack = typeof rest[0] === 'string' ? (rest[0] as string) : undefined;
    this.emit('error', message, rest, stack);
  }
  warn(message: unknown, ...rest: unknown[]): void {
    this.emit('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]): void {
    this.emit('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    this.emit('debug', message, rest);
  }

  private emit(level: LogLevel, message: unknown, rest: unknown[], stack?: string): void {
    try {
      // Nest passes the source class name as the trailing string argument.
      const context =
        rest.length > 0 && typeof rest[rest.length - 1] === 'string'
          ? (rest[rest.length - 1] as string)
          : undefined;
      const attributes: Record<string, unknown> = { origin: 'nest.logger' };
      if (context) attributes.context = context;
      if (stack && stack !== context) attributes.stack = stack;
      this.logging.log(level, formatMessage(message), attributes);
    } catch {
      /* logging must never throw into the framework */
    }
  }
}

function formatMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return `${message.name}: ${message.message}`;
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}
