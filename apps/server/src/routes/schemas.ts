/**
 * Shared JSON Schema fragments for route definitions. They do double duty: Fastify validates
 * requests against them, and @fastify/swagger derives `GET /docs/openapi.yaml` from the same
 * objects — the published spec cannot drift from the code because it is generated from it.
 *
 * OAS 3.1's Schema Object *is* JSON Schema, so these travel into the spec unchanged; nothing
 * here should be written in 3.0 dialect (no `nullable:` — use `type: ['string', 'null']`).
 *
 * Response schemas carry `additionalProperties: true` on purpose: fast-json-stringify strips
 * whatever a response schema fails to name, so a field added to a service but not mirrored here
 * would silently vanish from the wire instead of failing loudly.
 */
import { STAGES } from '../services/operation-status-service.js';

/** Route groups in the published spec. Untagged routes are omitted (see buildApp's hideUntagged),
 *  which is what keeps the mock gateway and static assets out of it. */
export const TAG = {
  meta: 'meta',
  auth: 'auth',
  tokens: 'tokens',
  users: 'users',
  groups: 'groups',
  projects: 'projects',
  members: 'members',
  spec: 'spec',
  files: 'files',
  history: 'history',
  mock: 'mock',
} as const;

const string = { type: 'string' } as const;
const integer = { type: 'integer' } as const;
const nullableString = { type: ['string', 'null'] } as const;

/** The one error envelope every failure uses (see errors.ts + the app error handler). */
export const errorResponse = {
  type: 'object',
  additionalProperties: true,
  properties: {
    /** Stable machine-readable code, e.g. `conflict` or `username_taken`. */
    error: string,
    message: string,
    details: {},
  },
};

// ── path params ──
export const projectIdParam = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: string },
};
export const idParam = { type: 'object', required: ['id'], properties: { id: string } };
export const groupIdParam = { type: 'object', required: ['groupId'], properties: { groupId: string } };

/** Fastify exposes a wildcard segment as the param named `*`; here it is the project-relative
 *  file path, e.g. `openapi.yaml` or `schemas/User.yaml`. */
export const filePathParam = {
  type: 'object',
  required: ['projectId', '*'],
  properties: { projectId: string, '*': { ...string, description: 'Project-relative file path' } },
};

// ── entities ──
export const project = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: string,
    name: string,
    groupId: nullableString,
    groupName: { ...nullableString, description: 'Display name of the group, or null when ungrouped' },
    createdAt: integer,
    updatedAt: integer,
  },
};

/** Listing shape: adds the caller's own role (null only for an admin seeing a project they
 *  aren't a member of). */
export const projectWithRole = {
  ...project,
  properties: { ...project.properties, myRole: nullableString },
};

/** Single-project shape. `myRole` and `permissions` are separate facts: an admin holds every
 *  permission whether or not they are a member. The role→permission map stays server-side. */
export const projectWithPermissions = {
  ...project,
  properties: { ...project.properties, myRole: nullableString, permissions: { type: 'array', items: string } },
};

export const group = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: string,
    name: string,
    createdBy: nullableString,
    createdAt: integer,
    updatedAt: integer,
    canManage: { type: 'boolean' },
  },
};

export const member = {
  type: 'object',
  additionalProperties: true,
  properties: { userId: string, username: string, role: string, status: string },
};

export const user = {
  type: 'object',
  additionalProperties: true,
  properties: { id: string, username: string, role: string },
};

export const adminUser = {
  type: 'object',
  additionalProperties: true,
  properties: { id: string, username: string, role: string, status: string, createdAt: integer },
};

/** A freshly issued password, shown once and never retrievable again. */
export const issuedPassword = {
  type: 'object',
  additionalProperties: true,
  properties: { password: { ...string, description: 'Plain text, returned only here' } },
};

export const apiToken = {
  type: 'object',
  additionalProperties: true,
  properties: { id: string, name: string, createdAt: integer, lastUsedAt: { type: ['integer', 'null'] } },
};

export const fileMeta = {
  type: 'object',
  additionalProperties: true,
  properties: { path: string, currentVersion: integer, contentHash: nullableString, updatedAt: integer },
};

export const fileContent = {
  type: 'object',
  additionalProperties: true,
  properties: { path: string, version: integer, contentHash: nullableString, content: string },
};

export const rebaseResult = {
  type: 'object',
  additionalProperties: true,
  properties: { path: string, version: integer, content: string, head: string },
};

export const versionMeta = {
  type: 'object',
  additionalProperties: true,
  properties: {
    versionNo: integer,
    /** `user` | `external` | `import` | `restore` | `system` */
    authorType: string,
    authorRef: nullableString,
    sourceVersion: { type: ['integer', 'null'] },
    contentHash: string,
    createdAt: integer,
  },
};

export const versionList = {
  type: 'object',
  additionalProperties: true,
  properties: { path: string, currentVersion: integer, versions: { type: 'array', items: versionMeta } },
};

export const versionContent = {
  type: 'object',
  additionalProperties: true,
  properties: { path: string, version: integer, content: string },
};

export const lintResult = {
  type: 'object',
  additionalProperties: true,
  properties: {
    errorCount: integer,
    warnCount: integer,
    problems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: { ruleId: string, severity: string, message: string, location: nullableString },
      },
    },
  },
};

/** One shape for `/breaking` and `/changelog`: the same rows, filtered differently. */
export const breakingReport = {
  type: 'object',
  additionalProperties: true,
  properties: {
    /** False when the oasdiff engine isn't installed — the report is then empty, not wrong. */
    available: { type: 'boolean' },
    baseVersion: { type: ['integer', 'null'] },
    targetVersion: integer,
    errorCount: integer,
    warnCount: integer,
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: string,
          level: string,
          text: string,
          operation: nullableString,
          method: nullableString,
          path: nullableString,
          section: nullableString,
        },
      },
    },
  },
};

export const graphResult = {
  type: 'object',
  additionalProperties: true,
  properties: {
    nodes: {
      type: 'array',
      items: { type: 'object', additionalProperties: true, properties: { id: string, type: string, label: string } },
    },
    edges: {
      type: 'array',
      items: { type: 'object', additionalProperties: true, properties: { from: string, to: string } },
    },
    orphans: { type: 'array', items: string },
  },
};

/** `opId` throughout is the `x-apione-id` written inside the operation — the identity that
 *  survives renaming, unlike method+path. */
export const operationSummary = {
  type: 'object',
  additionalProperties: true,
  properties: {
    opId: string,
    method: string,
    path: string,
    summary: string,
    operationId: string,
    tags: { type: 'array', items: string },
    deprecated: { type: 'boolean' },
    stage: { type: 'string', enum: [...STAGES], description: "The team's workflow stage" },
  },
};

/** The catalog's own shape: one tag rather than all of them, plus how the operation is mocked. */
export const mockOperation = {
  type: 'object',
  additionalProperties: true,
  properties: {
    opId: string,
    method: string,
    path: string,
    summary: string,
    tag: string,
    mode: string,
    hasCode: { type: 'boolean' },
  },
};

export const mockCatalog = {
  type: 'object',
  additionalProperties: true,
  properties: {
    operations: { type: 'array', items: mockOperation },
    /** Declared tag order, so groups render in the author's order. */
    tagOrder: { type: 'array', items: string },
    /** Base paths from `servers[]`, in declaration order; an operation answers behind these and
     *  nowhere else. `''` is the root. */
    basePaths: { type: 'array', items: string },
  },
};

export const mockCode = {
  type: 'object',
  additionalProperties: true,
  properties: { opId: string, content: string, version: integer },
};

/** An arbitrary OpenAPI document (bundled spec, mock response schema) — shape is the user's. */
export const anyObject = { type: 'object', additionalProperties: true };
