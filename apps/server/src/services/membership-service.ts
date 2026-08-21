import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { transact } from '../db/txn.js';
import { memberships, projects, users } from '../db/schema.js';
import { ALL_PERMISSIONS, ROLE_PERMISSIONS, type Permission } from '../permissions.js';
import { selectProjects, type ProjectWithGroup } from './project-service.js';
import { ConflictError, NotFoundError } from '../errors.js';

export type ProjectRole = 'owner' | 'editor' | 'tester' | 'viewer';
export const PROJECT_ROLES: readonly ProjectRole[] = ['owner', 'editor', 'tester', 'viewer'];

export interface Actor {
  sub: string;
  role: string; // system role: 'admin' | 'member'
}

export function getMembership(userId: string, projectId: string) {
  return db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.projectId, projectId)))
    .get();
}

/** The permissions an actor holds on a project — admin holds all. Empty for non-members. */
export function permissionsForActor(actor: Actor | undefined, projectId: string): readonly Permission[] {
  if (!actor) return [];
  if (actor.role === 'admin') return ALL_PERMISSIONS;
  const m = getMembership(actor.sub, projectId);
  if (!m) return [];
  return [...(ROLE_PERMISSIONS[m.role as ProjectRole] ?? [])];
}

/** admin bypasses; otherwise the actor's project role must grant `perm`. No actor → no access. */
export function hasProjectPermission(actor: Actor | undefined, projectId: string, perm: Permission): boolean {
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  const m = getMembership(actor.sub, projectId);
  return !!m && (ROLE_PERMISSIONS[m.role as ProjectRole]?.has(perm) ?? false);
}

export function addMembership(userId: string, projectId: string, role: ProjectRole): void {
  const existing = getMembership(userId, projectId);
  if (existing) {
    db.update(memberships).set({ role }).where(eq(memberships.id, existing.id)).run();
    return;
  }
  db.insert(memberships).values({ id: randomUUID(), userId, projectId, role }).run();
}

/**
 * Copy members from another project, keeping each one's role. A one-off copy, not a link: the two
 * rosters drift apart from here, which is the point — a project's membership is its own.
 * Users already on `projectId` are left alone so an existing role is never silently overwritten.
 * Returns how many were added.
 */
export function copyMemberships(fromProjectId: string, toProjectId: string, userIds: string[]): number {
  const source = new Map(listMembers(fromProjectId).map((m) => [m.userId, m.role as ProjectRole]));
  const already = new Set(listMembers(toProjectId).map((m) => m.userId));
  const additions = userIds.filter((id) => source.has(id) && !already.has(id));
  transact(() => {
    for (const userId of additions) addMembership(userId, toProjectId, source.get(userId)!);
  });
  return additions.length;
}

/** True if this user is the project's only owner — removing/demoting them would orphan it. */
export function isLastOwner(userId: string, projectId: string): boolean {
  const m = getMembership(userId, projectId);
  if (!m || m.role !== 'owner') return false;
  return countOwners(projectId) === 1;
}

function countOwners(projectId: string): number {
  return (
    db
      .select({ n: count() })
      .from(memberships)
      .where(and(eq(memberships.projectId, projectId), eq(memberships.role, 'owner')))
      .get()?.n ?? 0
  );
}

/** Change an existing member's role. A project must always keep at least one owner. */
export function setMemberRole(userId: string, projectId: string, role: ProjectRole): void {
  const existing = getMembership(userId, projectId);
  if (!existing) throw new NotFoundError('member not found', 'member_not_found');
  if (role !== 'owner' && isLastOwner(userId, projectId))
    throw new ConflictError('cannot demote the last owner', 'last_owner');
  db.update(memberships).set({ role }).where(eq(memberships.id, existing.id)).run();
}

export function removeMembership(userId: string, projectId: string): void {
  if (isLastOwner(userId, projectId)) throw new ConflictError('cannot remove the last owner', 'last_owner');
  db.delete(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.projectId, projectId)))
    .run();
}

export function listMembers(projectId: string) {
  // status comes along so the UI can flag a globally-disabled member — their membership is kept
  // (re-enabling restores project access), but they can't actually log in.
  //
  // Owners first, down to viewers. Memberships carry no timestamp, so the tie-break is insertion
  // order — the rowid.
  const byRole = sql`case ${memberships.role} ${sql.join(
    PROJECT_ROLES.map((r, i) => sql`when ${r} then ${i}`),
    sql` `,
  )} else ${PROJECT_ROLES.length} end`;
  return db
    .select({ userId: memberships.userId, username: users.username, role: memberships.role, status: users.status })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.projectId, projectId))
    .orderBy(byRole, sql`memberships.rowid`)
    .all();
}

export interface ProjectWithRole extends ProjectWithGroup {
  /** The caller's own membership role, or null when they hold none — which happens only for an
   *  admin, who sees every project. Deliberately not the admin bypass: the list uses this to say
   *  what someone is responsible for, and reaching everything is a capability, not a role. */
  myRole: ProjectRole | null;
}

/** Strict visibility: admin sees all; others see only projects they belong to. */
export function listProjectsForActor(actor: Actor | undefined): ProjectWithRole[] {
  if (!actor) return [];
  const roles = new Map(
    db
      .select({ pid: memberships.projectId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.userId, actor.sub))
      .all()
      .map((r) => [r.pid, r.role as ProjectRole] as const),
  );
  const ids = [...roles.keys()];
  const rows =
    actor.role === 'admin'
      ? selectProjects().orderBy(desc(projects.createdAt)).all()
      : ids.length === 0
        ? []
        : selectProjects().where(inArray(projects.id, ids)).orderBy(desc(projects.createdAt)).all();
  return rows.map((p) => ({ ...p, myRole: roles.get(p.id) ?? null }));
}
