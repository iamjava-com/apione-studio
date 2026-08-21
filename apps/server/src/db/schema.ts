import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * A folder for projects — organisation only. Groups carry no members and grant no permissions:
 * the organisational axis (business line) and the authorisation axis (who works on what) are not
 * the same axis, so authorisation stays entirely on the project.
 */
export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Who may rename/delete it, alongside any instance admin. Goes null when that user is deleted
   *  — the group outlives them, and from then on only an admin can manage it. */
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** A Project = one API = one root OpenAPI doc (+ $ref fragments) = one vault folder. */
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Null = ungrouped. Not a fallback row: a magic group would need its own can't-delete,
   *  can't-rename rules, and a NOT NULL column can't carry a REFERENCES clause in SQLite. */
  groupId: text('group_id').references(() => groups.id),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** A file within a project's vault. The disk file is the truth; this row is the index. */
export const specFiles = sqliteTable(
  'spec_files',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    /** Project-relative path, e.g. "openapi.yaml" or "schemas/User.yaml". */
    path: text('path').notNull(),
    currentVersion: integer('current_version').notNull().default(0),
    /** sha256 of the exact bytes currently on disk (drives reconcile-on-access). */
    contentHash: text('content_hash'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('uniq_project_path').on(t.projectId, t.path)],
);

/** Append-only full snapshots: concurrency token + history + restore source. */
export const versions = sqliteTable(
  'versions',
  {
    id: text('id').primaryKey(),
    fileId: text('file_id')
      .notNull()
      .references(() => specFiles.id),
    versionNo: integer('version_no').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    /** 'user' | 'external' | 'import' | 'restore' | 'system' */
    authorType: text('author_type').notNull(),
    /** who acted: a username (user/import/restore) or null (external/system). */
    authorRef: text('author_ref'),
    /** restore only: the version this snapshot was restored from. */
    sourceVersion: integer('source_version'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('uniq_file_version').on(t.fileId, t.versionNo)],
);

/** Local accounts. First registered user becomes 'admin'. */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('member'), // 'admin' | 'member'
  /** 'active' | 'disabled'. A disabled user keeps all data but can't log in or use any token. */
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at').notNull(),
  /** Bumped whenever this account's password changes. A session token carries the epoch it was
   *  signed under, so raising this invalidates every session issued before it — the one way to
   *  turn a stolen session off without rotating the instance-wide signing secret. API tokens are
   *  unaffected: they are revoked individually, by deleting their row. */
  sessionEpoch: integer('session_epoch').notNull().default(0),
});

/** Project-scoped role for a user (owner/editor/viewer). Reserved for §13 RBAC. */
export const memberships = sqliteTable(
  'memberships',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    role: text('role').notNull(), // 'owner' | 'editor' | 'viewer'
  },
  (t) => [uniqueIndex('uniq_user_project').on(t.userId, t.projectId)],
);

/**
 * A user's second way of proving who they are. Past the check it is that user, with the same
 * permissions and the same audit trail — hence no scope/perms columns.
 *
 * The stored hash is sha256, not argon2: a token is 32 bytes of entropy, so there is nothing to
 * brute-force and a slow hash would only tax every request.
 */
export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  /** The label its owner recognises it by ("CI", "my laptop") — never the secret. */
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  /** Coarse (updated at most hourly) — this is a "still in use?" signal for the revoke decision,
   *  not an access log, and writing on every request would put a DB write in the auth path. */
  lastUsedAt: integer('last_used_at'),
});

/**
 * Per-operation mock mode. Config, not content — the scripted code itself is a vault file. A row
 * exists only once an operation leaves the 'auto' default, and it survives switching back to auto
 * so the code file is never implicitly discarded.
 */
export const mockConfigs = sqliteTable(
  'mock_configs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    /** The operation's `x-apione-id` from the spec — not its address, which the author edits. */
    opId: text('op_id').notNull(),
    mode: text('mode').notNull().default('auto'), // 'auto' | 'scripted'
  },
  (t) => [uniqueIndex('uniq_mock_op').on(t.projectId, t.opId)],
);

/**
 * Where an operation sits in the team's own workflow. Not spec content — nothing here is OpenAPI,
 * and changing it must not write the file or append a version: the version log is the contract's
 * history, not a record of who dragged what to "done".
 *
 * Retirement is deliberately absent: an operation on its way out is `deprecated: true` in the
 * document, because that is a field consumers' generators and diff tools already act on. A stage
 * value would have hidden it from them.
 */
export const operationStatus = sqliteTable(
  'operation_status',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    /** The operation's `x-apione-id` from the spec — not its address, which the author edits. */
    opId: text('op_id').notNull(),
    /** 'design' | 'pending_dev' | 'developing' | 'pending_release' | 'released' */
    stage: text('stage').notNull().default('design'),
    /** Goes null when that user is deleted — the stage stands on its own. */
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('uniq_status_op').on(t.projectId, t.opId)],
);

export type UserRow = typeof users.$inferSelect;
export type ApiTokenRow = typeof apiTokens.$inferSelect;
export type GroupRow = typeof groups.$inferSelect;
export type SpecFileRow = typeof specFiles.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
