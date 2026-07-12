import * as fs from 'fs';
import * as path from 'path';

/** Sentry-style stack frame with optional source context. */
export interface StackFrame {
  filename: string;
  absPath?: string;
  function: string;
  lineno?: number;
  colno?: number;
  inApp: boolean;
  /** The source line that threw. */
  contextLine?: string;
  /** Lines immediately before contextLine. */
  preContext?: string[];
  /** Lines immediately after contextLine. */
  postContext?: string[];
  module?: string;
  raw?: string;
}

const AT_RE = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
const AT_NOLOC_RE = /^\s*at\s+(.+?)\s*$/;

/** How many source lines to include above/below the crashing line. */
const CONTEXT_LINES = 7;

/** Cap frames we enrich with disk I/O so reporting stays fast. */
const MAX_CONTEXT_FRAMES = 40;

const fileCache = new Map<string, string[] | null>();

/**
 * Parse a V8/Node stack string into structured frames.
 * When `withSourceContext` is true (default), reads source files from disk
 * and attaches pre_context / context_line / post_context (Sentry-style).
 */
export function buildStackFrames(
  stack?: string,
  options: { withSourceContext?: boolean } = {},
): StackFrame[] {
  if (!stack) return [];
  const withSourceContext = options.withSourceContext !== false;

  const frames: StackFrame[] = [];
  for (const line of stack.split('\n')) {
    if (!line.trim().startsWith('at ')) continue;
    const m = AT_RE.exec(line);
    if (m) {
      const [, fn, file, ln, col] = m;
      frames.push({
        function: fn || '<anonymous>',
        filename: file,
        absPath: file,
        lineno: Number(ln),
        colno: Number(col),
        inApp: isInApp(file),
        module: moduleFromPath(file),
        raw: line.trim(),
      });
    } else {
      const nm = AT_NOLOC_RE.exec(line);
      const file = nm?.[1] ?? line.trim();
      frames.push({
        function: '<anonymous>',
        filename: file,
        absPath: file,
        inApp: isInApp(file),
        module: moduleFromPath(file),
        raw: line.trim(),
      });
    }
  }

  if (!withSourceContext) return frames;

  let enriched = 0;
  for (const frame of frames) {
    if (enriched >= MAX_CONTEXT_FRAMES) break;
    if (frame.lineno == null || !frame.absPath) continue;
    if (!looksLikeFilePath(frame.absPath)) continue;
    const ctx = readSourceContext(frame.absPath, frame.lineno);
    if (!ctx) continue;
    frame.preContext = ctx.preContext;
    frame.contextLine = ctx.contextLine;
    frame.postContext = ctx.postContext;
    enriched += 1;
  }

  return frames;
}

export function isInApp(file: string): boolean {
  if (!file) return false;
  if (file.startsWith('node:') || file.startsWith('internal/')) return false;
  if (file.includes(`${path.sep}node_modules${path.sep}`) || file.includes('/node_modules/')) {
    return false;
  }
  return file.includes('/') || file.includes('\\');
}

function moduleFromPath(file: string): string | undefined {
  if (!file) return undefined;
  if (file.startsWith('node:')) return file;
  const parts = file.split(/[\\/]/);
  const nm = parts.lastIndexOf('node_modules');
  if (nm >= 0 && parts[nm + 1]) {
    // @scope/pkg or pkg
    if (parts[nm + 1].startsWith('@') && parts[nm + 2]) {
      return `${parts[nm + 1]}/${parts[nm + 2]}`;
    }
    return parts[nm + 1];
  }
  return parts[parts.length - 1];
}

function looksLikeFilePath(file: string): boolean {
  if (file.startsWith('node:') || file.startsWith('internal/')) return false;
  // Native addons / eval frames
  if (file.includes('native') && !file.includes(path.sep) && !file.includes('/')) return false;
  return true;
}

function readSourceContext(
  filePath: string,
  lineno: number,
): { preContext: string[]; contextLine: string; postContext: string[] } | null {
  try {
    let lines = fileCache.get(filePath);
    if (lines === undefined) {
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        fileCache.set(filePath, null);
        return null;
      }
      // Cap file size — skip huge generated bundles.
      const stat = fs.statSync(filePath);
      if (stat.size > 2 * 1024 * 1024) {
        fileCache.set(filePath, null);
        return null;
      }
      const raw = fs.readFileSync(filePath, 'utf8');
      lines = raw.split(/\r?\n/);
      fileCache.set(filePath, lines);
    }
    if (!lines || lines.length === 0) return null;

    const idx = lineno - 1;
    if (idx < 0 || idx >= lines.length) return null;

    const start = Math.max(0, idx - CONTEXT_LINES);
    const end = Math.min(lines.length - 1, idx + CONTEXT_LINES);

    return {
      preContext: lines.slice(start, idx),
      contextLine: lines[idx] ?? '',
      postContext: lines.slice(idx + 1, end + 1),
    };
  } catch {
    fileCache.set(filePath, null);
    return null;
  }
}

/** Clear the source-file cache (useful in tests). */
export function clearStackSourceCache(): void {
  fileCache.clear();
}
