import { sqlite } from './client.js';

let depth = 0;
const pending: Array<() => void> = [];

/**
 * The one way to open a write transaction. Nesting is fine — better-sqlite3 turns an inner one
 * into a savepoint — and only the outermost commit releases the work queued by {@link onCommit}.
 *
 * Everything goes through here rather than `sqlite.transaction` directly, because the deferral
 * below can only be honoured by a transaction that knows it is the outermost one.
 */
export function transact<T>(fn: () => T): T {
  depth++;
  try {
    const out = sqlite.transaction(fn)();
    if (depth === 1) for (const action of pending.splice(0)) action();
    return out;
  } catch (e) {
    if (depth === 1) pending.length = 0;
    throw e;
  } finally {
    depth--;
  }
}

/**
 * Queue work to run once the outermost transaction has committed, for the one effect a rollback
 * cannot undo: deleting from disk.
 *
 * A write can stay inside the transaction — if it fails the transaction rolls back and the file it
 * would have written never mattered. A delete cannot: pruning a mock happens inside the spec save
 * that retired it, so removing the file there would take it away for good even when the save
 * itself rolls back, leaving a row that points at nothing. Deferring also closes the opposite gap,
 * where the rows commit and the unlink then fails, orphaning the file.
 */
export function onCommit(action: () => void): void {
  if (depth === 0) {
    action();
    return;
  }
  pending.push(action);
}
