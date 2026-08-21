import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Bounds on the child process. Without a timeout a wedged binary holds the request open with
 * nothing to time it out; without room in the buffer, the diff of a large spec overflows the 1 MB
 * default and surfaces as a failure rather than a report.
 */
const OASDIFF_TIMEOUT_MS = 30_000;
const OASDIFF_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

const execOasdiff = promisify(execFile);
const pexec = (args: string[]) =>
  execOasdiff('oasdiff', args, { timeout: OASDIFF_TIMEOUT_MS, maxBuffer: OASDIFF_MAX_OUTPUT_BYTES });

/**
 * Adapter over the `oasdiff` CLI (Go binary) — breaking-change detection.
 * We shell out to the binary rather than reimplement diff rules; the rest of the app
 * only sees this module.
 * The binary is optional at runtime — callers check isAvailable() and degrade gracefully.
 */

export type BreakingLevel = 'error' | 'warning' | 'info';

export interface BreakingChange {
  id: string;
  level: BreakingLevel;
  text: string;
  operation: string | null; // e.g. "GET /users/{id}"
  section: string | null;
}

/** oasdiff numeric levels: 3 = ERR, 2 = WARN, 1 = INFO. Accept strings too, for safety. */
function mapLevel(l: unknown): BreakingLevel {
  if (l === 3 || l === 'ERR' || l === 'error') return 'error';
  if (l === 2 || l === 'WARN' || l === 'warning') return 'warning';
  return 'info';
}

/** Parse `oasdiff breaking -f json` stdout. Exported for unit testing without the binary. */
export function parseBreaking(stdout: string): BreakingChange[] {
  const raw = stdout.trim();
  if (!raw) return [];
  const arr = JSON.parse(raw) as Array<Record<string, unknown>>;
  return arr.map((c) => {
    const op = c.operation ? String(c.operation).toUpperCase() : '';
    const p = c.path ? String(c.path) : '';
    return {
      id: String(c.id ?? ''),
      level: mapLevel(c.level),
      text: String(c.text ?? ''),
      operation: op || p ? `${op} ${p}`.trim() : null,
      section: c.section ? String(c.section) : null,
    };
  });
}

let availableCache: boolean | null = null;

/** Is the oasdiff binary on PATH? Cached after the first probe. */
export async function isAvailable(): Promise<boolean> {
  if (availableCache !== null) return availableCache;
  try {
    await pexec(['--version']);
    availableCache = true;
  } catch {
    availableCache = false;
  }
  return availableCache;
}

/**
 * Diff two spec documents and return breaking changes (base → revision).
 * Both specs are written to a private temp dir; oasdiff resolves them by file path.
 */
export async function diffBreaking(baseSpec: string, revisionSpec: string): Promise<BreakingChange[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oasdiff-'));
  const baseFile = path.join(dir, 'base.yaml');
  const revFile = path.join(dir, 'revision.yaml');
  try {
    fs.writeFileSync(baseFile, baseSpec, 'utf8');
    fs.writeFileSync(revFile, revisionSpec, 'utf8');
    const { stdout } = await pexec(['breaking', baseFile, revFile, '-f', 'json']).catch(
      (e: NodeJS.ErrnoException & { stdout?: string }) => {
        // Defensive: some versions exit non-zero when changes are found; stdout still holds JSON.
        if (typeof e.stdout === 'string') return { stdout: e.stdout };
        throw e;
      },
    );
    return parseBreaking(stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
