/**
 * Mock storage and the editor-facing view of it. Kept apart from mock-service, which only answers
 * gateway traffic.
 *
 * A mock is stored under its operation's id — `mocks/<op-id>.js` plus a mode row keyed the same
 * way — never under the operation's address. An address is something the author edits, an id is
 * not, so renaming a path moves nothing. Keeping the two in step is then a set comparison against
 * the spec ({@link pruneMocks}), driven by operation-reconcile after every write.
 *
 * There is no delete-a-mock operation: switching back to auto stops the code running, rewriting it
 * replaces it, and deleting the operation takes it. A third way would only add a way to lose one.
 */
import { bundleProjectView } from './spec-service.js';
import * as fsvc from './file-service.js';
import * as cfg from './mock-config-service.js';
import { operations, OP_ID_KEY } from './operations.js';
import { serverBasePaths } from './spec-servers.js';
import { NotFoundError, ValidationError } from '../errors.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MOCKS_DIR = 'mocks';
const OP_ID = /^[0-9a-f]{6,}$/;

/** Where an operation's code lives. Opaque by design — the id is the binding, and a filename
 *  carrying the address would be one more copy of it to keep current. */
const codePath = (opId: string): string => `${MOCKS_DIR}/${opId}.js`;

/**
 * Whether a vault path belongs to mock storage rather than the spec.
 *
 * The whole `mocks/` subtree, not just files that parse as a mock: the spec API must refuse the
 * directory itself, or a caller can drop a `mocks/whatever.yaml` in there that is neither a mock
 * nor part of the document. Callers own the two namespaces separately (see routes/files.ts).
 */
export function isMockPath(filePath: string): boolean {
  return filePath === MOCKS_DIR || filePath.startsWith(`${MOCKS_DIR}/`);
}

/** The op id a vault file belongs to, or null if it isn't one of ours. */
function codeOwner(filePath: string): string | null {
  const [dir, file, ...rest] = filePath.split('/');
  if (dir !== MOCKS_DIR || rest.length || !file?.endsWith('.js')) return null;
  const id = file.slice(0, -3);
  return OP_ID.test(id) ? id : null;
}

export interface MockOperation {
  /** The operation's identity; the address below is only where it currently answers. */
  opId: string;
  method: string;
  path: string;
  summary?: string;
  /** First tag — lets the mock list group exactly like the design outline and the docs. */
  tag?: string;
  mode: cfg.MockMode;
  /** Whether code exists — it survives switching back to auto. */
  hasCode: boolean;
}

export interface MockCatalog {
  operations: MockOperation[];
  /** Declared tag order, so groups appear in the author's order rather than alphabetically. */
  tagOrder: string[];
  /** Base paths from `servers[]`, in declaration order — an operation answers behind these and
   *  nowhere else. Never empty; `''` is the root, which is what a document declaring no path says. */
  basePaths: string[];
}

/**
 * Every operation that can hold a mock. An operation with no id yet — added to the file outside
 * the App and not saved since — is not listed: there is nothing to attach a mock to until a save
 * mints one, and offering it would only produce a mock that couldn't be stored.
 */
export async function getCatalog(projectId: string): Promise<MockCatalog> {
  const spec = (await bundleProjectView(projectId)).parsed as any;
  const withCode = new Set(
    fsvc
      .listFiles(projectId)
      .map((f) => codeOwner(f.path))
      .filter(Boolean) as string[],
  );
  const scripted = cfg.scriptedOpIds(projectId);

  const ops: MockOperation[] = [];
  for (const { method, path, op } of operations(spec)) {
    const opId = op[OP_ID_KEY];
    if (typeof opId !== 'string' || !opId) continue;
    ops.push({
      opId,
      method,
      path,
      summary: typeof op.summary === 'string' ? op.summary : undefined,
      tag: Array.isArray(op.tags) && typeof op.tags[0] === 'string' ? op.tags[0] : undefined,
      mode: scripted.has(opId) ? 'scripted' : 'auto',
      hasCode: withCode.has(opId),
    });
  }

  const tagOrder = Array.isArray(spec.tags)
    ? (spec.tags as any[]).map((t) => t?.name).filter((n): n is string => typeof n === 'string')
    : [];
  return { operations: ops, tagOrder, basePaths: serverBasePaths(spec) };
}

/**
 * Drop every mock stored under an id outside `live` — the code file and the mode row together.
 * Call it through {@link operation-reconcile.reconcileOperations}, which owns deciding when a
 * document is authoritative enough to delete on.
 */
export function pruneMocks(projectId: string, live: Set<string>): void {
  for (const f of fsvc.listFiles(projectId)) {
    const owner = codeOwner(f.path);
    if (owner && !live.has(owner)) fsvc.deleteFile(projectId, f.path);
  }
  cfg.keepOnly(projectId, live);
}

export interface CodeResult {
  opId: string;
  content: string;
  /** 0 when nothing is written yet — the baseVersion a first write must send. */
  version: number;
}

export function readCode(projectId: string, opId: string): CodeResult {
  try {
    const f = fsvc.readFile(projectId, codePath(opId));
    return { opId, content: f.content, version: f.version };
  } catch (e) {
    if (e instanceof NotFoundError) return { opId, content: '', version: 0 };
    throw e;
  }
}

/** Writes through the single write path, so mocks get the same reconcile + optimistic-concurrency
 *  treatment as spec files (the version ledger is kept even though the UI shows no history). */
export function writeCode(
  projectId: string,
  opId: string,
  content: string,
  baseVersion: number | undefined,
  author: fsvc.Author,
): CodeResult {
  if (!OP_ID.test(opId)) throw new ValidationError('unknown operation id', 'op_id_invalid');
  const res = fsvc.writeFile(projectId, codePath(opId), content, baseVersion, author);
  return { opId, content: res.content, version: res.version };
}
