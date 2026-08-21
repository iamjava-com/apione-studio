/**
 * Reading and identifying the operations in an OpenAPI document.
 *
 * An operation's address — method + path — is where it answers, not which operation it is: the
 * author edits it freely. Its identity is `x-apione-id`, minted on save and written *inside* the
 * operation object, so anything keyed to it survives a rename for free. Rename a path in any
 * editor, by hand, or by restoring an old version, and the id is simply already at the new
 * address, because it was never anywhere else.
 *
 * Vendor extensions are part of OpenAPI and every tool must ignore the ones it doesn't know, so a
 * document carrying these stays valid, portable OAS3; export can strip them.
 *
 * Losing an id is safe: that operation is unidentified until the next save mints a fresh one, so
 * whatever was keyed to the old id stops resolving — it never resolves to the wrong operation.
 */
import { randomUUID } from 'node:crypto';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const OP_ID_KEY = 'x-apione-id';

/** The operation fields of a Path Item Object — everything else there is not an operation. */
export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Short enough to read in a diff, wide enough that collisions don't happen in practice — and
 *  they are detected and re-minted anyway. */
const mintId = (): string => randomUUID().replace(/-/g, '').slice(0, 12);

/** Walk a document's operations: paths in file order, methods in the specification's field order
 *  rather than the file's, which carries no meaning. Only a file with a top-level `paths` map has
 *  any; operations pushed into `$ref`'d fragments are walked when that file is read. */
export function* operations(doc: any): Generator<{ method: HttpMethod; path: string; op: any }> {
  const paths = doc?.paths;
  if (!paths || typeof paths !== 'object') return;
  for (const [path, item] of Object.entries(paths as Record<string, any>)) {
    for (const method of HTTP_METHODS) {
      const op = item?.[method];
      if (op && typeof op === 'object') yield { method, path, op };
    }
  }
}

/** Every id the document declares — the set anything keyed by operation reconciles against. */
export function operationIds(doc: any): Set<string> {
  const ids = new Set<string>();
  for (const { op } of operations(doc)) {
    const id = op[OP_ID_KEY];
    if (typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}

/**
 * Let each operation in `next` inherit the id the same method+path carried in `prev`. Mutates
 * `next`.
 *
 * A spec from anywhere else arrives with no ids of its own, so a re-import would mint a fresh one
 * for an endpoint that never moved and orphan its mock and its stage. Address is the only evidence
 * of sameness such a document offers.
 *
 * Ids the incoming document states are left alone — it knows its own identity better than we do —
 * and so is an id `next` already spends elsewhere, which would otherwise answer for two operations.
 */
export function adoptOperationIds(prev: any, next: any): void {
  const spoken = operationIds(next);
  const byAddress = new Map<string, string>();
  for (const { method, path, op } of operations(prev)) {
    const id = op[OP_ID_KEY];
    if (typeof id !== 'string' || !id || spoken.has(id)) continue;
    byAddress.set(`${method} ${path}`, id);
    spoken.add(id); // a hand-edited prev can hold the same id twice; only the first address gets it
  }
  for (const { method, path, op } of operations(next)) {
    if (op[OP_ID_KEY]) continue;
    const id = byAddress.get(`${method} ${path}`);
    if (id !== undefined) op[OP_ID_KEY] = id;
  }
}

/**
 * Give every operation an id, and break up duplicates — a copy-pasted operation arrives wearing
 * the original's, and an id two operations answer to identifies neither. Mutates `doc`; returns
 * whether anything changed, so an ordinary save isn't rewritten for nothing.
 */
export function stampOperationIds(doc: any): boolean {
  const used = new Set<string>();
  let changed = false;
  for (const { op } of operations(doc)) {
    const id = op[OP_ID_KEY];
    if (typeof id === 'string' && id !== '' && !used.has(id)) {
      used.add(id);
      continue;
    }
    let fresh = mintId();
    while (used.has(fresh)) fresh = mintId();
    op[OP_ID_KEY] = fresh;
    used.add(fresh);
    changed = true;
  }
  return changed;
}
