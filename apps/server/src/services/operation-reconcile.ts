/**
 * The one place everything keyed by an operation id is brought back in line with the document.
 *
 * It compares what is stored against the ids the document declares, so it is correct however the
 * document came to look this way — saved in the App, hand-edited, imported, or restored — and
 * never has to be told what changed. Anything new that keys off `x-apione-id` joins the list
 * below; nothing else needs a hook.
 */
import { operationIds } from './operations.js';
import { pruneMocks } from './mock-catalog-service.js';
import * as status from './operation-status-service.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Drop every row and file stored under an id the document doesn't declare. Idempotent, and a
 * function of the document alone.
 *
 * A document with no `paths` (a fragment, a code sidecar) proves nothing about which operations
 * exist, and neither does one whose path items are `$ref`s into other files. Never delete on the
 * strength of that.
 */
export function reconcileOperations(projectId: string, doc: any): void {
  if (!doc?.paths) return;
  const complete = Object.values(doc.paths as Record<string, any>).every(
    (item) => item && typeof item === 'object' && !('$ref' in item),
  );
  if (!complete) return;

  const live = operationIds(doc);
  pruneMocks(projectId, live);
  status.keepOnly(projectId, live);
}
