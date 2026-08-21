import { and, eq, inArray } from 'drizzle-orm';
import { db } from './client.js';
import { mockConfigs, operationStatus } from './schema.js';

/** Rows are written/deleted in batches of this many, keeping the bound parameters per statement
 *  well under SQLite's limit when a whole project changes at once. */
export const CHUNK = 500;

/** The tables keyed by (projectId, opId) that reconcile against the spec's operation set. */
type OpKeyedTable = typeof mockConfigs | typeof operationStatus;

/** Delete `projectId`'s rows whose opId is not in `live`, chunked so a large spec never puts the
 *  whole set into one statement's bound parameters. */
export function deleteOpRowsNotIn(table: OpKeyedTable, projectId: string, live: Set<string>): void {
  const stale = db
    .select({ opId: table.opId })
    .from(table)
    .where(eq(table.projectId, projectId))
    .all()
    .map((r) => r.opId)
    .filter((opId) => !live.has(opId));
  for (let i = 0; i < stale.length; i += CHUNK) {
    db.delete(table)
      .where(and(eq(table.projectId, projectId), inArray(table.opId, stale.slice(i, i + CHUNK))))
      .run();
  }
}
