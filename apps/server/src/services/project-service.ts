import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { onCommit, transact } from '../db/txn.js';
import {
  groups,
  memberships,
  mockConfigs,
  operationStatus,
  projects,
  specFiles,
  versions,
  type ProjectRow,
} from '../db/schema.js';
import * as vault from '../storage/vault.js';
import { NotFoundError, ValidationError } from '../errors.js';

const now = () => Date.now();

/** A project row plus its group's display name — null when ungrouped. Carried along so a client
 *  showing "which folder" needs no second call, and no group list it may not be allowed to see. */
export interface ProjectWithGroup extends ProjectRow {
  groupName: string | null;
}

/** The one read shape for projects: every route that returns a project returns this. */
export function selectProjects() {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      groupId: projects.groupId,
      groupName: groups.name,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .leftJoin(groups, eq(groups.id, projects.groupId));
}

/**
 * Create a project. Its opaque `id` is the only identifier — it keys the vault dir, the
 * mock URL, and the workspace URL. Users only pick the display `name` (freely renamable).
 */
export function createProject(name: string, groupId?: string | null): ProjectWithGroup {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ValidationError('name is required', 'name_required');
  }
  const id = randomUUID();
  const ts = now();
  db.insert(projects)
    .values({ id, name: name.trim(), groupId: groupId ?? null, createdAt: ts, updatedAt: ts })
    .run();
  vault.ensureProjectDir(id);
  return getProject(id);
}

/** File a project under a group, or `null` to leave it ungrouped. Purely organisational — it
 *  moves no files and changes nobody's access (groups grant no permissions). */
export function moveProject(id: string, groupId: string | null): ProjectWithGroup {
  getProject(id); // 404 if missing
  db.update(projects).set({ groupId, updatedAt: now() }).where(eq(projects.id, id)).run();
  return getProject(id);
}

/** Rename a project (display name only; the id — vault dir / mock / URL key — never changes). */
export function renameProject(id: string, name: string): ProjectWithGroup {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ValidationError('name is required', 'name_required');
  }
  getProject(id); // 404 if missing
  db.update(projects).set({ name: name.trim(), updatedAt: now() }).where(eq(projects.id, id)).run();
  return getProject(id);
}

export function listProjects(): ProjectWithGroup[] {
  return selectProjects().orderBy(desc(projects.createdAt)).all();
}

export function getProject(id: string): ProjectWithGroup {
  const row = selectProjects().where(eq(projects.id, id)).get();
  if (!row) throw new NotFoundError(`project not found: ${id}`);
  return row;
}

/**
 * Delete a project: its files + versions (index), everything keyed to its operations, and its
 * vault folder (truth).
 *
 * Every table pointing at `projects.id` has to be cleared here — foreign keys are enforced and the
 * references are ON DELETE no action, so one missed table doesn't orphan a row, it fails the
 * delete outright.
 */
export function deleteProject(id: string): void {
  const project = getProject(id); // 404 if missing
  transact(() => {
    const fileIds = db
      .select({ id: specFiles.id })
      .from(specFiles)
      .where(eq(specFiles.projectId, id))
      .all()
      .map((r) => r.id);
    for (const fid of fileIds) db.delete(versions).where(eq(versions.fileId, fid)).run();
    db.delete(specFiles).where(eq(specFiles.projectId, id)).run();
    db.delete(memberships).where(eq(memberships.projectId, id)).run();
    db.delete(mockConfigs).where(eq(mockConfigs.projectId, id)).run();
    db.delete(operationStatus).where(eq(operationStatus.projectId, id)).run();
    db.delete(projects).where(eq(projects.id, id)).run();
    onCommit(() => vault.removeProjectDir(project.id));
  });
}
