/**
 * Project groups — organisation only. A group has no members and grants no
 * permissions: who may read or write a project is decided by that project's memberships alone,
 * exactly as before groups existed. So nothing here touches `permissions.ts` or `requirePermission`.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { transact } from '../db/txn.js';
import { groups, memberships, projects, type GroupRow } from '../db/schema.js';
import { AppError, NotFoundError, ValidationError } from '../errors.js';
import type { Actor } from './membership-service.js';

const now = () => Date.now();

function normalizeName(name: unknown): string {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ValidationError('name is required', 'name_required');
  }
  return name.trim();
}

export function getGroup(id: string): GroupRow {
  const row = db.select().from(groups).where(eq(groups.id, id)).get();
  if (!row) throw new NotFoundError(`group not found: ${id}`, 'group_not_found');
  return row;
}

/** Rename/delete is for the creator or any instance admin — a group is not project-scoped, so
 *  this stays out of the atomic-permission map rather than pretending to be a project role. */
export function canManage(actor: Actor, group: GroupRow): boolean {
  return actor.role === 'admin' || group.createdBy === actor.sub;
}

function assertCanManage(actor: Actor, group: GroupRow): void {
  if (!canManage(actor, group)) throw new AppError(403, 'forbidden', 'only the group creator can change it');
}

export function createGroup(actor: Actor, name: string): GroupRow {
  const id = randomUUID();
  const ts = now();
  db.insert(groups)
    .values({ id, name: normalizeName(name), createdBy: actor.sub, createdAt: ts, updatedAt: ts })
    .run();
  return getGroup(id);
}

export function renameGroup(actor: Actor, id: string, name: string): GroupRow {
  const group = getGroup(id);
  assertCanManage(actor, group);
  db.update(groups)
    .set({ name: normalizeName(name), updatedAt: now() })
    .where(eq(groups.id, id))
    .run();
  return getGroup(id);
}

/** Delete a group; its projects fall back to ungrouped. Deleting a folder must never delete what
 *  is filed in it, and requiring it to be empty first would make tidying up needlessly expensive. */
export function deleteGroup(actor: Actor, id: string): void {
  const group = getGroup(id);
  assertCanManage(actor, group);
  transact(() => {
    db.update(projects).set({ groupId: null, updatedAt: now() }).where(eq(projects.groupId, id)).run();
    db.delete(groups).where(eq(groups.id, id)).run();
  });
}

/** 404 if the group doesn't exist — a caller may only file a project under a group they can see. */
export function assertVisible(actor: Actor, groupId: string): void {
  const group = getGroup(groupId);
  if (actor.role === 'admin' || canManage(actor, group)) return;
  const holdsAProjectInIt = db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(memberships, eq(memberships.projectId, projects.id))
    .where(and(eq(projects.groupId, groupId), eq(memberships.userId, actor.sub)))
    .get();
  if (!holdsAProjectInIt) throw new NotFoundError(`group not found: ${groupId}`, 'group_not_found');
}

/**
 * The groups an actor sees: those holding a project they're a member of, plus those they created
 * (otherwise a group they just made would vanish before they could file anything under it).
 * Admin sees all.
 */
export function listGroupsForActor(actor: Actor): GroupRow[] {
  if (actor.role === 'admin') return db.select().from(groups).orderBy(desc(groups.createdAt)).all();
  const viaProjects = db
    .select({ gid: projects.groupId })
    .from(projects)
    .innerJoin(memberships, eq(memberships.projectId, projects.id))
    .where(eq(memberships.userId, actor.sub))
    .all()
    .map((r) => r.gid)
    .filter((gid): gid is string => gid !== null);
  return db
    .select()
    .from(groups)
    .where(
      viaProjects.length
        ? or(eq(groups.createdBy, actor.sub), inArray(groups.id, viaProjects))
        : eq(groups.createdBy, actor.sub),
    )
    .orderBy(desc(groups.createdAt))
    .all();
}
