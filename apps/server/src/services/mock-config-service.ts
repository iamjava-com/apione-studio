/**
 * The DB half of the mock storage split: whether an operation answers from its
 * scripted code or from the generator. The code itself is a vault file, written through the
 * single write path.
 *
 * Keyed by the operation's id, never by its address — an address is something the author edits,
 * and a row holding one is stale the moment they do.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { deleteOpRowsNotIn } from '../db/batch.js';
import { mockConfigs } from '../db/schema.js';
import { ValidationError } from '../errors.js';

export type MockMode = 'auto' | 'scripted';

/** Every operation this project has switched off auto. */
export function scriptedOpIds(projectId: string): Set<string> {
  const rows = db
    .select({ opId: mockConfigs.opId })
    .from(mockConfigs)
    .where(and(eq(mockConfigs.projectId, projectId), eq(mockConfigs.mode, 'scripted')))
    .all();
  return new Set(rows.map((r) => r.opId));
}

/** Absent row = 'auto', so an untouched project needs no rows at all. */
export function getMode(projectId: string, opId: string): MockMode {
  const row = db
    .select()
    .from(mockConfigs)
    .where(and(eq(mockConfigs.projectId, projectId), eq(mockConfigs.opId, opId)))
    .get();
  return (row?.mode as MockMode | undefined) ?? 'auto';
}

export function setMode(projectId: string, opId: string, mode: MockMode): void {
  if (mode !== 'auto' && mode !== 'scripted') throw new ValidationError('mode must be auto|scripted', 'mode_invalid');
  const existing = db
    .select()
    .from(mockConfigs)
    .where(and(eq(mockConfigs.projectId, projectId), eq(mockConfigs.opId, opId)))
    .get();
  if (existing) {
    db.update(mockConfigs).set({ mode }).where(eq(mockConfigs.id, existing.id)).run();
    return;
  }
  db.insert(mockConfigs).values({ id: randomUUID(), projectId, opId, mode }).run();
}

/** Forget every operation not in `live` — the spec no longer declares them. */
export function keepOnly(projectId: string, live: Set<string>): void {
  deleteOpRowsNotIn(mockConfigs, projectId, live);
}
