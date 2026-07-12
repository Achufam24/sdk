import { Logger } from '@nestjs/common';

export interface QueryCaptureInfo {
  query: string;
  durationMs: number;
  /** Driver / ORM that produced the query. */
  orm?: string;
  success?: boolean;
  error?: string;
}

export type QueryCaptureHandler = (info: QueryCaptureInfo) => void;

const logger = new Logger('QueryCapture');

type StopFn = () => void;

/**
 * Auto-instrument common Node DB drivers/ORMs so SQL is captured without
 * manual logQuery() calls. Safe no-ops when a package isn't installed.
 *
 * Patches (best-effort):
 * - `pg` Client + Pool
 * - `mysql2` / `mysql2/promise`
 * - `sequelize` Sequelize.prototype.query
 * - `typeorm` AbstractLogger path via optional Logger helper (see createTypeOrmLogger)
 *
 * Prisma needs an explicit client wrap — use `instrumentPrisma(prisma)`.
 */
export function startQueryCapture(onQuery: QueryCaptureHandler): StopFn {
  const stops: StopFn[] = [];

  try {
    stops.push(patchPg(onQuery));
  } catch (err) {
    logger.debug(`pg patch skipped: ${String(err)}`);
  }

  try {
    stops.push(patchMysql2(onQuery));
  } catch (err) {
    logger.debug(`mysql2 patch skipped: ${String(err)}`);
  }

  try {
    stops.push(patchSequelize(onQuery));
  } catch (err) {
    logger.debug(`sequelize patch skipped: ${String(err)}`);
  }

  return () => {
    for (const stop of stops) {
      try {
        stop();
      } catch {
        /* ignore */
      }
    }
  };
}

/** Wrap a PrismaClient so every query is reported. Returns the same client. */
export function instrumentPrisma<T extends { $extends: Function }>(
  prisma: T,
  onQuery: QueryCaptureHandler,
): T {
  try {
    return (prisma as any).$extends({
      name: 'nugi-logs-query-capture',
      query: {
        async $allOperations({
          operation,
          model,
          args,
          query,
        }: {
          operation: string;
          model?: string;
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) {
          const start = Date.now();
          let success = true;
          let error: string | undefined;
          try {
            return await query(args);
          } catch (err) {
            success = false;
            error = err instanceof Error ? err.message : String(err);
            throw err;
          } finally {
            const label = model ? `${model}.${operation}` : operation;
            safeEmit(onQuery, {
              query: `prisma:${label}`,
              durationMs: Date.now() - start,
              orm: 'prisma',
              success,
              error,
            });
          }
        },
      },
    });
  } catch (err) {
    logger.warn(`instrumentPrisma failed: ${String(err)}`);
    return prisma;
  }
}

function safeEmit(onQuery: QueryCaptureHandler, info: QueryCaptureInfo): void {
  try {
    // Truncate huge SQL blobs.
    const query =
      info.query && info.query.length > 4000
        ? `${info.query.slice(0, 4000)}…`
        : info.query;
    onQuery({ ...info, query });
  } catch {
    /* never break the host query */
  }
}

function tryRequire(id: string): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id);
  } catch {
    return null;
  }
}

function patchPg(onQuery: QueryCaptureHandler): StopFn {
  const pg = tryRequire('pg');
  if (!pg?.Client?.prototype?.query) return () => undefined;

  const Client = pg.Client;
  const Pool = pg.Pool;
  const origClient = Client.prototype.query;
  const origPool = Pool?.prototype?.query;

  Client.prototype.query = function patchedClientQuery(this: any, ...args: any[]) {
    return wrapDriverQuery(origClient, this, args, onQuery, 'pg');
  };

  if (Pool && origPool) {
    Pool.prototype.query = function patchedPoolQuery(this: any, ...args: any[]) {
      return wrapDriverQuery(origPool, this, args, onQuery, 'pg');
    };
  }

  return () => {
    Client.prototype.query = origClient;
    if (Pool && origPool) Pool.prototype.query = origPool;
  };
}

/**
 * mysql2's Query object defines a trap `.then()` that *throws* this exact
 * error when awaited. Never treat "has .then" as Promise-like for drivers.
 */
function isRealPromise(value: unknown): value is Promise<unknown> {
  return value instanceof Promise;
}

function wrapDriverQuery(
  orig: Function,
  ctx: any,
  args: any[],
  onQuery: QueryCaptureHandler,
  orm: string,
): any {
  const sql = extractSql(args[0]);
  const start = Date.now();
  let finished = false;

  const finish = (success: boolean, error?: string) => {
    if (finished || !sql) return;
    finished = true;
    safeEmit(onQuery, {
      query: sql,
      durationMs: Date.now() - start,
      orm,
      success,
      error,
    });
  };

  // Callback style — wrap the callback *before* invoking (never call twice).
  const last = args[args.length - 1];
  if (typeof last === 'function') {
    const wrapped = args.slice();
    wrapped[wrapped.length - 1] = function (err: unknown, res: unknown) {
      finish(
        !err,
        err instanceof Error ? err.message : err ? String(err) : undefined,
      );
      return last(err, res);
    };
    return orig.apply(ctx, wrapped);
  }

  const result = orig.apply(ctx, args);

  if (isRealPromise(result)) {
    return result.then(
      (v: unknown) => {
        finish(true);
        return v;
      },
      (err: unknown) => {
        finish(false, err instanceof Error ? err.message : String(err));
        throw err;
      },
    );
  }

  // mysql2 Query / streaming result — EventEmitter, not a Promise.
  if (result && typeof result.on === 'function') {
    result.on('end', () => finish(true));
    result.on('error', (err: unknown) => {
      finish(false, err instanceof Error ? err.message : String(err));
    });
    return result;
  }

  finish(true);
  return result;
}

function extractSql(input: unknown): string | undefined {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.sql === 'string') return o.sql;
  }
  return undefined;
}

function patchMysql2(onQuery: QueryCaptureHandler): StopFn {
  const mysql = tryRequire('mysql2');
  if (!mysql) return () => undefined;

  const stops: StopFn[] = [];

  const patchProto = (proto: any) => {
    if (!proto?.query || (proto.query as any).__nugiPatched) return;
    const orig = proto.query;
    function patched(this: any, ...args: any[]) {
      return wrapDriverQuery(orig, this, args, onQuery, 'mysql2');
    }
    (patched as any).__nugiPatched = true;
    proto.query = patched;
    stops.push(() => {
      proto.query = orig;
    });
  };

  // Patch the callback API only. `mysql2/promise` delegates to these, so
  // wrapping both layers would double-emit every query.
  patchProto(mysql.Connection?.prototype);
  patchProto(mysql.Pool?.prototype);
  patchProto(mysql.PoolConnection?.prototype);

  return () => stops.forEach((s) => s());
}

function patchSequelize(onQuery: QueryCaptureHandler): StopFn {
  const sequelize = tryRequire('sequelize');
  const Sequelize = sequelize?.Sequelize || sequelize?.default || sequelize;
  if (!Sequelize?.prototype?.query) return () => undefined;

  const orig = Sequelize.prototype.query;
  Sequelize.prototype.query = async function patchedSequelizeQuery(
    this: any,
    sql: any,
    options?: any,
  ) {
    const text =
      typeof sql === 'string'
        ? sql
        : sql?.query || sql?.sql || extractSql(sql) || String(sql);
    const start = Date.now();
    let success = true;
    let error: string | undefined;
    try {
      return await orig.call(this, sql, options);
    } catch (err) {
      success = false;
      error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      safeEmit(onQuery, {
        query: text,
        durationMs: Date.now() - start,
        orm: 'sequelize',
        success,
        error,
      });
    }
  };

  return () => {
    Sequelize.prototype.query = orig;
  };
}
