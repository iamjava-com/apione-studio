/**
 * The spec write path: stamp operation ids, write the file, then bring everything keyed by those
 * ids — mocks, workflow stages — back in line with what the document now declares.
 *
 * The second step is a reconciliation, not a reaction — it compares what is stored against the ids
 * the document declares, so it is correct however the document came to look this way and doesn't
 * have to be told what changed.
 */
import { transact } from '../db/txn.js';
import { canonicalizeTree, parseOrNull } from '../storage/canonical.js';
import * as fsvc from './file-service.js';
import { reconcileOperations } from './operation-reconcile.js';
import { stampOperationIds } from './operations.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Save a spec file. Documents that declare no operations (fragments, code sidecars) fall straight
 * through to the plain write — there is nothing to identify and nothing to reconcile.
 */
export function saveSpecFile(
  projectId: string,
  filePath: string,
  rawContent: string,
  baseVersion: number | undefined,
  author: fsvc.Author,
): fsvc.WriteResult {
  return transact(() => {
    const doc = parseOrNull(rawContent) as any;
    if (!doc?.paths) return fsvc.writeFile(projectId, filePath, rawContent, baseVersion, author);

    stampOperationIds(doc);
    const canonical = canonicalizeTree(doc);
    const result = fsvc.writeFile(projectId, filePath, canonical, baseVersion, author);
    // Reconcile against what was written, not what was submitted: a concurrent save may have been
    // merged in, and the operations it added are not this writer's to prune. When nothing was
    // merged the written bytes are ours, so the tree is too — no need to parse them again.
    reconcileOperations(projectId, result.content === canonical ? doc : parseOrNull(result.content));
    return result;
  });
}

/**
 * Restore an old version, mocks and stages included. The bytes written are the old version's,
 * untouched — a restore that rewrote the document wouldn't be one — so nothing is stamped; the ids
 * that version carries are what everything else reconciles against.
 */
export function restoreSpecVersion(
  projectId: string,
  filePath: string,
  versionNo: number,
  author: fsvc.Author,
): fsvc.WriteResult & { restoredFrom: number } {
  return transact(() => {
    const target = fsvc.getVersionContent(projectId, filePath, versionNo); // throws 404
    const result = fsvc.restoreVersion(projectId, filePath, versionNo, author);
    reconcileOperations(projectId, parseOrNull(target.content));
    return result;
  });
}
