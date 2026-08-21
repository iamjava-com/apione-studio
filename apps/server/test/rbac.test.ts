import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { bootApp, createProject, createUser, type AuthHeaders } from './helpers.js';

const SPEC = 'openapi: 3.1.0\ninfo: {title: X, version: 1.0.0}\npaths: {}\n';

let app: FastifyInstance;
let adminH: AuthHeaders;
let bobH: AuthHeaders;

before(async () => {
  ({ app, headers: adminH } = await bootApp('apione-rbac-'));
  bobH = (await createUser(app, adminH, 'bob')).headers;
});

/** A project of the admin's, with bob given `role` on it (or kept off it entirely). */
async function projectWithBob(name: string, role?: string) {
  const projectId = (await createProject(app, adminH, name)).id;
  if (role) {
    const add = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/members`,
      headers: adminH,
      payload: { username: 'bob', role },
    });
    assert.equal(add.statusCode, 204, add.body);
  }
  return projectId;
}

test('strict visibility: bob does not see a project he is not a member of', async () => {
  const projectId = await projectWithBob('Invisible');
  const list = await app.inject({ url: '/api/projects', headers: bobH });
  assert.equal(
    list.json().some((p: { id: string }) => p.id === projectId),
    false,
  );
  assert.equal((await app.inject({ url: `/api/projects/${projectId}`, headers: bobH })).statusCode, 404);
});

test('non-member cannot write', async () => {
  const projectId = await projectWithBob('NoWrite');
  const w = await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/files/openapi.yaml`,
    headers: bobH,
    payload: { content: SPEC, baseVersion: 0 },
  });
  assert.equal(w.statusCode, 403);
});

test('owner adds bob as editor → bob can see + write, but not manage members', async () => {
  const projectId = await projectWithBob('EditorPowers', 'editor');

  const list = await app.inject({ url: '/api/projects', headers: bobH });
  assert.ok(list.json().some((p: { id: string }) => p.id === projectId));

  const w = await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/files/openapi.yaml`,
    headers: bobH,
    payload: { content: SPEC, baseVersion: 0 },
  });
  assert.equal(w.statusCode, 200);

  // editor is not an owner → cannot manage members
  const mgr = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/members`,
    headers: bobH,
    payload: { username: 'admin', role: 'viewer' },
  });
  assert.equal(mgr.statusCode, 403);
});

test('GET /:id ships the caller’s atomic permissions (the UI gates on these, not on the role)', async () => {
  const projectId = await projectWithBob('AtomicPerms', 'editor');
  const asEditor = (await app.inject({ url: `/api/projects/${projectId}`, headers: bobH })).json();
  assert.equal(asEditor.myRole, 'editor');
  for (const p of ['spec:read', 'spec:write', 'history:restore', 'mock:read', 'mock:write'])
    assert.ok(asEditor.permissions.includes(p), `editor should hold ${p}`);
  for (const p of ['project:admin', 'members:manage'])
    assert.ok(!asEditor.permissions.includes(p), `editor should not hold ${p}`);

  const asAdmin = (await app.inject({ url: `/api/projects/${projectId}`, headers: adminH })).json();
  assert.ok(asAdmin.permissions.includes('members:manage'));
});

test('history and spec are separate permissions (viewer keeps spec, not history)', async () => {
  const projectId = await projectWithBob('ViewerSplit', 'viewer');
  // A saved version, so there is a spec to read and a history entry to be refused.
  const w = await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/files/openapi.yaml`,
    headers: adminH,
    payload: { content: SPEC, baseVersion: 0 },
  });
  assert.equal(w.statusCode, 200, w.body);

  const v = (await app.inject({ url: `/api/projects/${projectId}`, headers: bobH })).json();
  assert.deepEqual([...v.permissions].sort(), ['members:read', 'project:read', 'spec:read']);

  // no mock:read → the mock catalog hides behind 404, same as it does for a non-member, so
  // failing the check never confirms the project exists
  assert.equal((await app.inject({ url: `/api/projects/${projectId}/mock`, headers: bobH })).statusCode, 404);

  // spec:read without history:read — the current contract reads, the version log doesn't, and it
  // hides behind 404 rather than 403 for the same non-disclosure reason as the mock catalog
  assert.equal(
    (await app.inject({ url: `/api/projects/${projectId}/versions?path=openapi.yaml`, headers: bobH })).statusCode,
    404,
  );
  assert.equal((await app.inject({ url: `/api/projects/${projectId}/spec.json`, headers: bobH })).statusCode, 200);
  const restore = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/restore`,
    headers: bobH,
    payload: { path: 'openapi.yaml', versionNo: 1 },
  });
  assert.equal(restore.statusCode, 403);
});

test('the roster reads to any member, writes to none but the owner', async () => {
  // bob is a viewer here — the weakest role — and still gets the list
  const projectId = await projectWithBob('Roster', 'viewer');
  const roster = await app.inject({ url: `/api/projects/${projectId}/members`, headers: bobH });
  assert.equal(roster.statusCode, 200);
  assert.deepEqual(
    roster
      .json()
      .map((m: { username: string }) => m.username)
      .sort(),
    ['admin', 'bob'],
  );

  // reading it is not managing it
  for (const req of [
    {
      method: 'POST' as const,
      url: `/api/projects/${projectId}/members`,
      payload: { username: 'admin', role: 'viewer' },
    },
    { method: 'GET' as const, url: `/api/projects/${projectId}/members/sources` },
  ])
    assert.equal((await app.inject({ ...req, headers: bobH })).statusCode, 403, `${req.method} ${req.url}`);

  // a non-member gets 404, not 403: failing the check must not confirm the project exists
  const carol = await createUser(app, adminH, 'carol');
  assert.equal(
    (await app.inject({ url: `/api/projects/${projectId}/members`, headers: carol.headers })).statusCode,
    404,
  );
});

test('admin bypasses project roles (can delete any project)', async () => {
  const projectId = (await createProject(app, adminH, 'Doomed')).id;
  const d = await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}`, headers: adminH });
  assert.equal(d.statusCode, 204);
});

test('GET /:id reports the membership row, not an effective role', async () => {
  const pid = (await createProject(app, adminH, 'membership-vs-permissions')).id;

  const asOwner = (await app.inject({ url: `/api/projects/${pid}`, headers: adminH })).json();
  assert.equal(asOwner.myRole, 'owner', 'the membership row, not a bypass sentinel');
  assert.ok(asOwner.permissions.includes('members:manage'));

  await app.inject({
    method: 'POST',
    url: `/api/projects/${pid}/members`,
    headers: adminH,
    payload: { username: 'bob', role: 'owner' },
  });
  assert.equal(
    (await app.inject({ method: 'POST', url: `/api/projects/${pid}/leave`, headers: adminH })).statusCode,
    204,
  );

  const afterLeaving = (await app.inject({ url: `/api/projects/${pid}`, headers: adminH })).json();
  assert.equal(afterLeaving.myRole, null, 'no membership left');
  assert.ok(afterLeaving.permissions.includes('members:manage'), 'admin keeps every permission');
});
