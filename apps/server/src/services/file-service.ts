import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { onCommit, transact } from '../db/txn.js';
import { projects, specFiles, versions, type ProjectRow, type SpecFileRow } from '../db/schema.js';
import { canonicalize, isCanonicalizable, normalizeCode } from '../storage/canonical.js';
import * as vault from '../storage/vault.js';
import { ConflictError, NotFoundError } from '../errors.js';
import { mergeDocuments } from './three-way-merge.js';

export type AuthorType = 'user' | 'external' | 'import' | 'restore' | 'system';
export interface Author {
  type: AuthorType;
  ref?: string | null;
}

const now = () => Date.now();

function getProjectOrThrow(projectId: string): ProjectRow {
  const p = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!p) throw new NotFoundError(`project not found: ${projectId}`);
  return p;
}

function getFile(projectId: string, filePath: string): SpecFileRow | undefined {
  return db
    .select()
    .from(specFiles)
    .where(and(eq(specFiles.projectId, projectId), eq(specFiles.path, filePath)))
    .get();
}

/**
 * Append a version row and advance the file's head pointer — the one shape every write has.
 * Must be called inside a transaction. Returns the row as it now stands.
 */
function appendVersion(
  file: SpecFileRow,
  content: string,
  contentHash: string,
  author: Author,
  sourceVersion?: number,
): SpecFileRow {
  const newVer = file.currentVersion + 1;
  const ts = now();
  db.insert(versions)
    .values({
      id: randomUUID(),
      fileId: file.id,
      versionNo: newVer,
      content,
      contentHash,
      authorType: author.type,
      authorRef: author.ref ?? null,
      sourceVersion: sourceVersion ?? null,
      createdAt: ts,
    })
    .run();
  db.update(specFiles)
    .set({ currentVersion: newVer, contentHash, updatedAt: ts })
    .where(eq(specFiles.id, file.id))
    .run();
  return { ...file, currentVersion: newVer, contentHash, updatedAt: ts };
}

/**
 * reconcile-on-access: if the disk bytes differ from the recorded hash, the file was
 * edited outside the App — absorb it verbatim as a new version (author=external), so
 * external edits are honored and never silently overwritten. Returns the up-to-date row
 * plus the bytes it was reconciled against (null = disk missing), so a caller answering
 * a read can hand back exactly what the row now describes without a second racy read.
 * Must be called inside a transaction.
 */
function reconcile(file: SpecFileRow, absPath: string): { file: SpecFileRow; disk: string | null } {
  const disk = vault.readIfExists(absPath);
  if (disk === null) return { file, disk }; // disk missing — nothing to absorb (MVP: ignore deletes)
  const diskHash = vault.sha256(disk);
  if (diskHash === file.contentHash) return { file, disk };
  return { file: appendVersion(file, disk, diskHash, { type: 'external', ref: null }), disk };
}

export interface ReadResult {
  path: string;
  version: number;
  contentHash: string | null;
  content: string;
}

export function readFile(projectId: string, filePath: string): ReadResult {
  const project = getProjectOrThrow(projectId);
  const file = getFile(projectId, filePath);
  if (!file) throw new NotFoundError(`file not found: ${filePath}`);
  const absPath = vault.fileAbsPath(project.id, filePath);

  const { file: reconciled, disk } = transact(() => reconcile(file, absPath));
  if (disk === null) throw new NotFoundError(`file missing on disk: ${filePath}`);
  return { path: filePath, version: reconciled.currentVersion, contentHash: reconciled.contentHash, content: disk };
}

function versionContent(fileId: string, versionNo: number): string | undefined {
  return db
    .select({ content: versions.content })
    .from(versions)
    .where(and(eq(versions.fileId, fileId), eq(versions.versionNo, versionNo)))
    .get()?.content;
}

/**
 * A stale baseVersion only means someone else saved first — not that the two edits collide.
 * Merge the writer's document into what the file became; null means they really do overlap.
 * Must be called inside a transaction, after reconcile.
 */
function mergeOntoHead(file: SpecFileRow, baseVersion: number, incoming: string): string | null {
  const base = versionContent(file.id, baseVersion);
  const head = versionContent(file.id, file.currentVersion);
  if (base === undefined || head === undefined) return null;
  return mergeDocuments(base, head, incoming);
}

export interface RebaseResult {
  path: string;
  version: number;
  content: string; // the caller's document, replayed on top of the current one
  head: string; // the current one, so the caller can tell what of theirs is still unsaved
}

/**
 * The write path's merge without the write: replay `rawContent` (authored against `baseVersion`)
 * onto what the file is now. An editor left open for an hour can absorb a co-author's save as it
 * lands instead of discovering it at save time. Throws ConflictError when the two really did edit
 * the same thing — the caller keeps its own document and finds out properly when it saves.
 */
export function rebaseFile(projectId: string, filePath: string, rawContent: string, baseVersion: number): RebaseResult {
  const project = getProjectOrThrow(projectId);
  const absPath = vault.fileAbsPath(project.id, filePath);
  const canonicalizable = isCanonicalizable(filePath);
  const canonical = canonicalizable ? canonicalize(rawContent) : normalizeCode(rawContent);

  return transact(() => {
    const row = getFile(projectId, filePath);
    if (!row) throw new NotFoundError(`file not found: ${filePath}`);
    const file = reconcile(row, absPath).file;
    const head = versionContent(file.id, file.currentVersion);
    if (head === undefined) throw new NotFoundError(`file has no version content: ${filePath}`);

    const conflict = () =>
      new ConflictError('version conflict: file was modified', 'version_conflict', {
        currentVersion: file.currentVersion,
      });
    if (baseVersion > file.currentVersion) throw conflict(); // ahead of the ledger: not ours to rebase
    if (baseVersion === file.currentVersion) {
      return { path: filePath, version: file.currentVersion, content: canonical, head };
    }
    const merged = canonicalizable ? mergeOntoHead(file, baseVersion, canonical) : null;
    if (merged === null) throw conflict();
    return { path: filePath, version: file.currentVersion, content: merged, head };
  });
}

export interface WriteResult {
  path: string;
  version: number;
  contentHash: string;
  content: string;
}

/**
 * The single write path. canonicalizes input, then atomically (one transaction):
 *   reconcile external edits → optimistic-concurrency check → append version → write disk.
 * Disk write is last inside the txn, so an fs failure rolls back the DB; a crash between
 * the disk write and commit self-heals via reconcile-on-access on the next read.
 */
export function writeFile(
  projectId: string,
  filePath: string,
  rawContent: string,
  baseVersion: number | undefined,
  author: Author = { type: 'user', ref: 'anonymous' },
): WriteResult {
  const project = getProjectOrThrow(projectId);
  const absPath = vault.fileAbsPath(project.id, filePath);
  // Code sidecars are stored verbatim; spec files go through canonical-on-write.
  const canonicalizable = isCanonicalizable(filePath);
  let canonical = canonicalizable
    ? canonicalize(rawContent) // throws ValidationError on bad YAML/JSON
    : normalizeCode(rawContent);
  let hash = vault.sha256(canonical);

  return transact(() => {
    let file = getFile(projectId, filePath);

    if (!file) {
      if (baseVersion !== undefined && baseVersion !== 0) {
        throw new ConflictError('file does not exist; expected baseVersion 0', 'version_conflict', {
          currentVersion: 0,
        });
      }
      const ts = now();
      const id = randomUUID();
      db.insert(specFiles)
        .values({ id, projectId, path: filePath, currentVersion: 0, contentHash: null, createdAt: ts, updatedAt: ts })
        .run();
      file = getFile(projectId, filePath)!;
    } else {
      file = reconcile(file, absPath).file;
      if (baseVersion === undefined) {
        throw new ConflictError('baseVersion is required for an existing file', 'version_conflict', {
          currentVersion: file.currentVersion,
        });
      }
      if (baseVersion !== file.currentVersion) {
        // Code sidecars have no structure to merge on, so for them any overlap in time is a conflict.
        const merged = canonicalizable ? mergeOntoHead(file, baseVersion, canonical) : null;
        if (merged === null) {
          throw new ConflictError('version conflict: file was modified', 'version_conflict', {
            currentVersion: file.currentVersion,
          });
        }
        canonical = merged;
        hash = vault.sha256(canonical);
      }
      // No-op save: identical canonical content → don't mint a phantom version.
      if (file.contentHash === hash) {
        return { path: filePath, version: file.currentVersion, contentHash: hash, content: canonical };
      }
    }

    file = appendVersion(file, canonical, hash, author);
    vault.writeFileAtomic(absPath, canonical); // last: fs failure rolls back the txn
    return { path: filePath, version: file.currentVersion, contentHash: hash, content: canonical };
  });
}

export function listFiles(projectId: string) {
  getProjectOrThrow(projectId);
  return db
    .select({
      path: specFiles.path,
      currentVersion: specFiles.currentVersion,
      contentHash: specFiles.contentHash,
      updatedAt: specFiles.updatedAt,
    })
    .from(specFiles)
    .where(eq(specFiles.projectId, projectId))
    .orderBy(specFiles.path)
    .all();
}

/** Delete one file: its versions + index row, and the file on disk. */
export function deleteFile(projectId: string, filePath: string): void {
  const project = getProjectOrThrow(projectId);
  const file = getFile(projectId, filePath);
  if (!file) throw new NotFoundError(`file not found: ${filePath}`);
  const absPath = vault.fileAbsPath(project.id, filePath);
  transact(() => {
    db.delete(versions).where(eq(versions.fileId, file.id)).run();
    db.delete(specFiles).where(eq(specFiles.id, file.id)).run();
    onCommit(() => vault.removeFile(absPath));
  });
}

export interface VersionMeta {
  versionNo: number;
  authorType: string;
  authorRef: string | null;
  sourceVersion: number | null;
  contentHash: string;
  createdAt: number;
}

export function listVersions(
  projectId: string,
  filePath: string,
): {
  path: string;
  currentVersion: number;
  versions: VersionMeta[];
} {
  getProjectOrThrow(projectId);
  const file = getFile(projectId, filePath);
  if (!file) throw new NotFoundError(`file not found: ${filePath}`);
  const rows = db
    .select({
      versionNo: versions.versionNo,
      authorType: versions.authorType,
      authorRef: versions.authorRef,
      sourceVersion: versions.sourceVersion,
      contentHash: versions.contentHash,
      createdAt: versions.createdAt,
    })
    .from(versions)
    .where(eq(versions.fileId, file.id))
    .orderBy(desc(versions.versionNo))
    .all();
  return { path: filePath, currentVersion: file.currentVersion, versions: rows };
}

export function getVersionContent(projectId: string, filePath: string, versionNo: number) {
  getProjectOrThrow(projectId);
  const file = getFile(projectId, filePath);
  if (!file) throw new NotFoundError(`file not found: ${filePath}`);
  const row = db
    .select()
    .from(versions)
    .where(and(eq(versions.fileId, file.id), eq(versions.versionNo, versionNo)))
    .get();
  if (!row) throw new NotFoundError(`version ${versionNo} not found`);
  return {
    path: filePath,
    version: versionNo,
    content: row.content,
    contentHash: row.contentHash,
    author: { type: row.authorType, ref: row.authorRef },
  };
}

/** Restore = write an old version's content back as a brand-new version (append-only). */
export function restoreVersion(
  projectId: string,
  filePath: string,
  versionNo: number,
  author: Author = { type: 'restore' },
): WriteResult & { restoredFrom: number } {
  const project = getProjectOrThrow(projectId);
  const absPath = vault.fileAbsPath(project.id, filePath);

  return transact(() => {
    let file = getFile(projectId, filePath);
    if (!file) throw new NotFoundError(`file not found: ${filePath}`);
    file = reconcile(file, absPath).file;

    const target = db
      .select()
      .from(versions)
      .where(and(eq(versions.fileId, file.id), eq(versions.versionNo, versionNo)))
      .get();
    if (!target) throw new NotFoundError(`version ${versionNo} not found`);

    file = appendVersion(file, target.content, target.contentHash, { type: 'restore', ref: author.ref }, versionNo);
    vault.writeFileAtomic(absPath, target.content);
    return {
      path: filePath,
      version: file.currentVersion,
      contentHash: target.contentHash,
      content: target.content,
      restoredFrom: versionNo,
    };
  });
}
