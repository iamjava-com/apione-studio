/**
 * Where each operation sits in the team's workflow — design → pending_dev → developing →
 * pending_release → released.
 *
 * The App only stores it. Nothing here advances a stage on its own, and no stage gates an edit:
 * teams run their own process, through the API and the agent skill, and a tool that enforced a
 * lifecycle it doesn't own would only be worked around.
 *
 * Exactly one stage means anything to the App: `released` is what a filtered export keeps. The
 * other four are the team's to read, which is why the set is fixed rather than customisable —
 * a per-project vocabulary would leave "which of these counts as shipped?" unanswerable.
 *
 * Keyed by the operation's id, never by its address — an address is something the author edits,
 * and a row holding one is stale the moment they do.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { CHUNK, deleteOpRowsNotIn } from '../db/batch.js';
import { transact } from '../db/txn.js';
import { operationStatus } from '../db/schema.js';
import { ValidationError } from '../errors.js';

export const STAGES = ['design', 'pending_dev', 'developing', 'pending_release', 'released'] as const;
export type Stage = (typeof STAGES)[number];

/** An operation nobody has staged yet is still being designed — the state a new endpoint is in. */
export const DEFAULT_STAGE: Stage = 'design';

const now = () => Date.now();

function assertStage(stage: string): asserts stage is Stage {
  if (!(STAGES as readonly string[]).includes(stage)) {
    throw new ValidationError(`stage must be one of ${STAGES.join('|')}`, 'stage_invalid');
  }
}

/** Every staged operation in the project. Absent from the map = {@link DEFAULT_STAGE}. */
export function stageMap(projectId: string): Map<string, Stage> {
  const rows = db
    .select({ opId: operationStatus.opId, stage: operationStatus.stage })
    .from(operationStatus)
    .where(eq(operationStatus.projectId, projectId))
    .all();
  return new Map(rows.map((r) => [r.opId, r.stage as Stage]));
}

/** Absent row = the default, so an untouched project needs no rows at all. */
export function getStage(projectId: string, opId: string): Stage {
  const row = db
    .select({ stage: operationStatus.stage })
    .from(operationStatus)
    .where(and(eq(operationStatus.projectId, projectId), eq(operationStatus.opId, opId)))
    .get();
  return (row?.stage as Stage | undefined) ?? DEFAULT_STAGE;
}

/** The operations a filtered export keeps. */
export function releasedOpIds(projectId: string): Set<string> {
  const rows = db
    .select({ opId: operationStatus.opId })
    .from(operationStatus)
    .where(and(eq(operationStatus.projectId, projectId), eq(operationStatus.stage, 'released')))
    .all();
  return new Set(rows.map((r) => r.opId));
}

/**
 * Stage one operation. Not validated against the spec: the caller has already resolved the opId,
 * and a stage for an operation that has since gone is dropped by the next reconcile anyway.
 */
export function setStage(projectId: string, opId: string, stage: string, updatedBy: string | null): Stage {
  assertStage(stage);
  setStages(projectId, [opId], stage, updatedBy);
  return stage;
}

/**
 * Stage many operations at once — the migration shape: a project imported from a tool that had no
 * stages arrives entirely in `design`, and someone has to say "these 758 are live" in one call.
 *
 * Upsert on (project, op) rather than delete-then-insert, so a concurrent read never sees a gap.
 */
export function setStages(projectId: string, opIds: string[], stage: string, updatedBy: string | null): number {
  assertStage(stage);
  const unique = [...new Set(opIds.filter((id) => typeof id === 'string' && id))];
  if (!unique.length) return 0;
  const ts = now();
  transact(() => {
    for (let i = 0; i < unique.length; i += CHUNK) {
      db.insert(operationStatus)
        .values(
          unique
            .slice(i, i + CHUNK)
            .map((opId) => ({ id: randomUUID(), projectId, opId, stage, updatedBy, updatedAt: ts })),
        )
        .onConflictDoUpdate({
          target: [operationStatus.projectId, operationStatus.opId],
          set: { stage, updatedBy, updatedAt: ts },
        })
        .run();
    }
  });
  return unique.length;
}

/** Forget every operation not in `live` — the spec no longer declares them. */
export function keepOnly(projectId: string, live: Set<string>): void {
  deleteOpRowsNotIn(operationStatus, projectId, live);
}
