import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { ValidationError } from '../errors.js';

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

export function projectDir(projectId: string): string {
  return path.join(config.vaultDir, projectId);
}

export function ensureProjectDir(projectId: string): void {
  fs.mkdirSync(projectDir(projectId), { recursive: true });
}

/** Reject absolute paths and traversal before touching the filesystem. */
export function assertSafePath(rel: string): void {
  if (!rel || path.isAbsolute(rel)) {
    throw new ValidationError('path must be relative and non-empty');
  }
  const norm = path.normalize(rel);
  if (norm === '..' || norm.startsWith(`..${path.sep}`) || norm.includes(`${path.sep}..${path.sep}`)) {
    throw new ValidationError('path traversal is not allowed');
  }
}

export function fileAbsPath(projectId: string, rel: string): string {
  assertSafePath(rel);
  const base = projectDir(projectId);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new ValidationError('path escapes project directory');
  }
  return abs;
}

export function readIfExists(abs: string): string | null {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * Write temp, flush, rename, flush the directory — so a reader never sees a half-written file and
 * a power cut never leaves one.
 *
 * The flushes are what make this safe rather than merely tidy. The version row is committed in the
 * same breath as this write, and SQLite's own commit is durable; without an fsync here the ledger
 * could survive a crash that the document did not, leaving the truth behind its own index — the
 * one inversion "files are the source of truth" cannot tolerate.
 */
export function writeFileAtomic(abs: string, content: string): void {
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${randomUUID()}`;
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, content, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, abs);
    fsyncDir(dir); // the rename itself has to reach the disk, not just the bytes it points at
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** Best-effort: some platforms refuse to open a directory for fsync, and that is not a write error. */
function fsyncDir(dir: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch {
    /* ignore */
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function removeFile(abs: string): void {
  fs.rmSync(abs, { force: true });
}

export function removeProjectDir(projectId: string): void {
  fs.rmSync(projectDir(projectId), { recursive: true, force: true });
}
