/** A folder for projects. Organisation only — a group has no members and grants nothing, so
 *  nothing here feeds the permission gates. */
export interface Group {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Whether the caller may rename/delete it — creator or instance admin. */
  canManage: boolean;
}

export interface Project {
  id: string;
  name: string;
  /** null = ungrouped. */
  groupId: string | null;
  /** The group's display name, null when ungrouped — travels with the project so a view can name
   *  the group without holding the group list. */
  groupName: string | null;
  createdAt: number;
  updatedAt: number;
  /** Membership role, null when they hold none. Says nothing about what they may do — that is
   *  `permissions`. */
  myRole?: string | null;
  /** present on GET /:id — the atomic permissions that role grants. The map lives
   *  server-side only, so the UI gates on capabilities and never re-derives them from the role. */
  permissions?: Permission[];
}

/** Mirrors the server's atomic permission union — the names only; the role→permission map is
 *  never duplicated here (it ships with each project). */
export type Permission =
  | 'project:read'
  | 'project:admin'
  | 'members:read'
  | 'members:manage'
  | 'spec:read'
  | 'spec:write'
  | 'history:read'
  | 'history:restore'
  | 'mock:read'
  | 'mock:write';

export interface FileMeta {
  path: string;
  currentVersion: number;
  contentHash: string | null;
  updatedAt: number;
}

export interface ReadResult {
  path: string;
  version: number;
  contentHash: string | null;
  content: string;
}

export interface WriteResult {
  path: string;
  version: number;
  contentHash: string;
  content: string;
}

export interface RebaseResult {
  path: string;
  version: number;
  content: string; // ours, replayed on top of `head`
  head: string; // the file as it now stands on the server
}

export interface LintProblem {
  ruleId: string;
  severity: 'error' | 'warn';
  message: string;
  location: string | null;
}

export interface LintResult {
  errorCount: number;
  warnCount: number;
  problems: LintProblem[];
}

export interface BreakingChange {
  id: string;
  level: 'error' | 'warning' | 'info';
  text: string;
  operation: string | null; // "GET /users/{id}"
  method: string | null;
  path: string | null;
  section: string | null;
}
export interface BreakingReport {
  available: boolean;
  baseVersion: number | null;
  targetVersion: number;
  errorCount: number;
  warnCount: number;
  changes: BreakingChange[];
}

export interface GraphNode {
  id: string;
  type: 'schema' | 'operation';
  label: string;
}
export interface GraphEdge {
  from: string;
  to: string;
}
export interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  orphans: string[];
}

export interface VersionMeta {
  versionNo: number;
  authorType: string;
  authorRef: string | null;
  sourceVersion: number | null;
  contentHash: string;
  createdAt: number;
}
export interface VersionList {
  path: string;
  currentVersion: number;
  versions: VersionMeta[];
}
export interface VersionContent {
  path: string;
  version: number;
  content: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const TOKEN_KEY = 'apione-token';
export const token = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function http<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const tok = token.get();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  // A failure does not have to be ours: a proxy in front can answer with an HTML error page, and
  // parsing that as JSON would raise a SyntaxError that never reaches the ApiError path — the
  // caller would show "Unexpected token <" instead of what went wrong.
  let data: { message?: string; error?: string; details?: unknown } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    if (res.ok) throw new ApiError(res.status, res.statusText);
  }
  if (!res.ok) {
    if (res.status === 401) unauthorized();
    throw new ApiError(res.status, data?.message ?? res.statusText, data?.error, data?.details);
  }
  return data as T;
}

/** A 401 means the token is missing/expired: drop it and let the UI prompt a re-login. */
function unauthorized(): void {
  token.clear();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('apione-unauthorized'));
}

const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
function versionsQuery(id: string, route: string, base?: number, target?: number): string {
  const q = new URLSearchParams();
  if (base) q.set('base', String(base));
  if (target) q.set('target', String(target));
  const qs = q.toString();
  return `/api/projects/${id}/${route}${qs ? `?${qs}` : ''}`;
}

export const api = {
  listGroups: () => http<Group[]>('GET', '/api/groups'),
  createGroup: (name: string) => http<Group>('POST', '/api/groups', { name }),
  renameGroup: (id: string, name: string) => http<Group>('PATCH', `/api/groups/${id}`, { name }),
  // Its projects fall back to ungrouped — deleting a folder never deletes what is filed in it.
  deleteGroup: (id: string) => http<void>('DELETE', `/api/groups/${id}`),

  listProjects: () => http<Project[]>('GET', '/api/projects'),
  createProject: (name: string, groupId?: string | null) =>
    http<Project>('POST', '/api/projects', { name, groupId: groupId ?? null }),
  // Atomic import-as-new: the server validates the spec before creating anything (no orphan on failure).
  importNewProject: (content: string, name?: string, groupId?: string | null) =>
    http<Project>('POST', '/api/projects/import', { content, name, groupId: groupId ?? null }),
  // Dry-run: validate a spec and read its title before creating a project.
  importPreview: (content: string) =>
    http<{ title: string | null; sourceFormat: 'oas3' | 'swagger2' | 'postman' }>(
      'POST',
      '/api/projects/import/preview',
      {
        content,
      },
    ),
  updateProject: (id: string, patch: { name?: string; groupId?: string | null }) =>
    http<Project>('PATCH', `/api/projects/${id}`, patch),
  getProject: (id: string) => http<Project>('GET', `/api/projects/${id}`),
  listFiles: (id: string) => http<FileMeta[]>('GET', `/api/projects/${id}/files`),
  readFile: (id: string, path: string) => http<ReadResult>('GET', `/api/projects/${id}/files/${enc(path)}`),
  writeFile: (id: string, path: string, content: string, baseVersion: number) =>
    http<WriteResult>('PUT', `/api/projects/${id}/files/${enc(path)}`, { content, baseVersion }),
  // Writes nothing: it replays an unsaved document onto the current version so an open editor can
  // take in a co-author's save. 409 when the two edits overlap.
  rebaseFile: (id: string, path: string, content: string, baseVersion: number) =>
    http<RebaseResult>('POST', `/api/projects/${id}/rebase`, { path, content, baseVersion }),
  importSpec: (id: string, content: string, format: 'auto' | 'oas3' | 'swagger2' | 'postman' = 'auto') =>
    http<{ version: number; sourceFormat: string }>('POST', `/api/projects/${id}/import`, { content, format }),
  lint: (id: string) => http<LintResult>('GET', `/api/projects/${id}/lint`),
  breaking: (id: string, base?: number, target?: number) =>
    http<BreakingReport>('GET', versionsQuery(id, 'breaking', base, target)),
  changelog: (id: string, base?: number, target?: number) =>
    http<BreakingReport>('GET', versionsQuery(id, 'changelog', base, target)),
  graph: (id: string) => http<GraphResult>('GET', `/api/projects/${id}/graph`),

  // ── workflow stages (kept out of the spec: setting one writes no version) ──
  /** Only endpoints somebody has staged come back; anything absent is at {@link DEFAULT_STAGE}. */
  operationStatuses: (id: string) =>
    http<{ statuses: OperationStatus[] }>('GET', `/api/projects/${id}/operations/status`),
  setOperationStage: (id: string, opId: string, stage: Stage) =>
    http<{ opId: string; stage: Stage }>('PATCH', `/api/projects/${id}/operations/${encodeURIComponent(opId)}/status`, {
      stage,
    }),
  /** Omit `opIds` to stage every endpoint in the project. */
  setOperationStages: (id: string, stage: Stage, opIds?: string[]) =>
    http<{ stage: Stage; updated: number }>('PATCH', `/api/projects/${id}/operations/status`, { stage, opIds }),

  // ── mock authoring (serving traffic is /mock/{id}/*, which needs no auth) ──
  mockCatalog: (id: string) => http<MockCatalog>('GET', `/api/projects/${id}/mock`),
  // The schema comes from the spec, so it is addressed by method+path; mocks are addressed by opId.
  mockSchema: (id: string, method: string, path: string) =>
    http<MockSchema>('GET', `/api/projects/${id}/mock/schema?${new URLSearchParams({ method, path })}`),
  readMockCode: (id: string, opId: string) =>
    http<MockCode>('GET', `/api/projects/${id}/mock/code?opId=${encodeURIComponent(opId)}`),
  writeMockCode: (id: string, opId: string, content: string, baseVersion: number) =>
    http<MockCode>('PUT', `/api/projects/${id}/mock/code`, { opId, content, baseVersion }),
  setMockMode: (id: string, opId: string, mode: MockMode) =>
    http<{ mode: MockMode }>('PATCH', `/api/projects/${id}/mock/mode`, { opId, mode }),
  deleteProject: (id: string) => http<void>('DELETE', `/api/projects/${id}`),
  deleteFile: (id: string, path: string) => http<void>('DELETE', `/api/projects/${id}/files/${enc(path)}`),
  listVersions: (id: string, path: string) =>
    http<VersionList>('GET', `/api/projects/${id}/versions?path=${encodeURIComponent(path)}`),
  getVersionContent: (id: string, path: string, n: number) =>
    http<VersionContent>('GET', `/api/projects/${id}/versions/${n}?path=${encodeURIComponent(path)}`),
  restoreVersion: (id: string, path: string, n: number) =>
    http('POST', `/api/projects/${id}/restore`, { path, versionNo: n }),
  /** `stripExt` drops every `x-` specification extension — a copy for tools that want only the
   *  standard. Mock bindings live in one of those extensions, so they don't survive it.
   *  `releasedOnly` narrows the document to released endpoints, taking the schemas and tags none
   *  of them reach with it. `html` is a rendered reading copy, not a machine format: one
   *  self-contained page (~4 MB, renderer included) that opens from disk. */
  exportSpec: async (
    id: string,
    format: ExportFormat,
    opts: { stripExt?: boolean; releasedOnly?: boolean } = {},
  ): Promise<string> => {
    const tok = token.get();
    const q = new URLSearchParams();
    if (opts.stripExt) q.set('strip', 'x');
    if (opts.releasedOnly) q.set('stage', 'released');
    const res = await fetch(`/api/projects/${id}/spec.${format}${q.size ? `?${q}` : ''}`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
    if (!res.ok) {
      if (res.status === 401) unauthorized();
      throw new ApiError(res.status, `export failed (${res.status})`);
    }
    return res.text();
  },
  listMembers: (id: string) => http<Member[]>('GET', `/api/projects/${id}/members`),
  addMember: (id: string, username: string, role: string) =>
    http<void>('POST', `/api/projects/${id}/members`, { username, role }),
  updateMemberRole: (id: string, userId: string, role: string) =>
    http<void>('PATCH', `/api/projects/${id}/members/${userId}`, { role }),
  removeMember: (id: string, userId: string) => http<void>('DELETE', `/api/projects/${id}/members/${userId}`),
  leaveProject: (id: string) => http<void>('POST', `/api/projects/${id}/leave`),
  // Other projects whose roster the caller may read — the only valid copy sources.
  memberSources: (id: string) => http<{ id: string; name: string }[]>('GET', `/api/projects/${id}/members/sources`),
  copyMembers: (id: string, fromProjectId: string, userIds: string[]) =>
    http<{ added: number }>('POST', `/api/projects/${id}/members/copy`, { fromProjectId, userIds }),
  // GET /api/users answers by caller role: admins get AdminUser[] (status + createdAt), others the
  // bare directory — callers that know they are admin ask for the wider row.
  listUsers: <T extends AuthUser = AuthUser>() => http<T[]>('GET', '/api/users'),
  /** The password is issued by the server and comes back once, in this response. */
  adminCreateUser: (username: string, role: 'admin' | 'member') =>
    http<AdminUser & { password: string }>('POST', '/api/users', { username, role }),
  adminUpdateUser: (id: string, patch: { role?: 'admin' | 'member'; status?: 'active' | 'disabled' }) =>
    http<AdminUser>('PATCH', `/api/users/${id}`, patch),
  adminResetPassword: (id: string) => http<{ password: string }>('POST', `/api/users/${id}/password`),
  adminDeleteUser: (id: string) => http<void>('DELETE', `/api/users/${id}`),
  authStatus: () => http<{ needsSetup: boolean }>('GET', '/api/auth/status'),
  me: () => http<{ user: AuthUser }>('GET', '/api/auth/me'),
  login: (username: string, password: string) =>
    http<{ token: string; user: AuthUser }>('POST', '/api/auth/login', { username, password }),
  register: (username: string, password: string) =>
    http<{ token?: string; user: AuthUser }>('POST', '/api/auth/register', { username, password }),
  // Swaps in the fresh token: the change signs out every session on this account, this one included.
  changePassword: async (currentPassword: string, newPassword: string) => {
    const r = await http<{ token: string }>('POST', '/api/auth/change-password', {
      currentPassword,
      newPassword,
    });
    token.set(r.token);
  },

  // ── API tokens (the caller's own; all three need a password session, not a token) ──
  listApiTokens: () => http<ApiToken[]>('GET', '/api/tokens'),
  createApiToken: (name: string) => http<CreatedApiToken>('POST', '/api/tokens', { name }),
  revokeApiToken: (id: string) => http<void>('DELETE', `/api/tokens/${id}`),
};

/** A token as it can be shown after creation: everything but the secret. */
export interface ApiToken {
  id: string;
  name: string;
  createdAt: number;
  /** null = never used. Coarse (server updates it at most hourly). */
  lastUsedAt: number | null;
}

/** Only POST /api/tokens ever carries `plaintext`; it is unrecoverable once discarded. */
export interface CreatedApiToken extends ApiToken {
  plaintext: string;
}

/** `json`/`yaml` are the spec itself; `html` is a rendered page for reading, not for tooling. */
export type ExportFormat = 'json' | 'yaml' | 'html';

/**
 * The team's own workflow, in the order it runs. Nothing enforces that order — any stage can
 * follow any other — and only `released` changes what the App does: it is what a filtered export
 * keeps. Retirement is not here; that is `deprecated` in the document itself.
 */
export const STAGES = ['design', 'pending_dev', 'developing', 'pending_release', 'released'] as const;
export type Stage = (typeof STAGES)[number];

/** An endpoint nobody has staged. No row exists for it server-side. */
export const DEFAULT_STAGE: Stage = 'design';

export interface OperationStatus {
  opId: string;
  stage: Stage;
}

export type MockMode = 'auto' | 'scripted';

export interface MockOperation {
  /** The operation's identity — what a mock is addressed by. The path below can change. */
  opId: string;
  method: string;
  path: string;
  summary?: string;
  tag?: string;
  mode: MockMode;
  hasCode: boolean;
}

export interface MockCatalog {
  operations: MockOperation[];
  /** Declared tag order, so groups render in the author's order. */
  tagOrder: string[];
  /** Base paths taken from `servers[]`, in declaration order. An operation answers behind these
   *  and nowhere else. Never empty; `''` is the root, i.e. no base path. */
  basePaths: string[];
}

/** The response schema auto mode generates from, with `$ref`s inlined so it reads on its own. */
export interface MockSchema {
  status: number;
  contentType: string | null;
  schema: unknown;
}

export interface MockCode {
  opId: string;
  content: string;
  /** 0 when nothing is saved yet — the baseVersion a first write must send. */
  version: number;
}

export interface AuthUser {
  id: string;
  username: string;
  role: string;
}

export interface AdminUser {
  id: string;
  username: string;
  role: 'admin' | 'member';
  status: 'active' | 'disabled';
  createdAt: number;
}

export interface Member {
  userId: string;
  username: string;
  role: string;
  status: 'active' | 'disabled';
}
