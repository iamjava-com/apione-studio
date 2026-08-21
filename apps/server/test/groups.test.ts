import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { bootApp, createUser, type AuthHeaders } from './helpers.js';

let app: FastifyInstance;
let adminH: AuthHeaders;
let bobH: AuthHeaders;

const newUser = (username: string) => createUser(app, adminH, username);

const createGroup = async (headers: AuthHeaders, name: string) =>
  app.inject({ method: 'POST', url: '/api/groups', headers, payload: { name } });

const createProject = async (headers: AuthHeaders, name: string, groupId?: string) =>
  app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name, groupId } });

before(async () => {
  ({ app, headers: adminH } = await bootApp('apione-groups-'));
  bobH = (await newUser('bob')).headers;
});

test('a new project is ungrouped by default — the list is exactly as it was', async () => {
  const p = await createProject(adminH, 'Loose');
  assert.equal(p.statusCode, 201);
  assert.equal(p.json().groupId, null);
});

test('the project list carries the caller’s own role, not the admin bypass', async () => {
  const mine = (await createProject(bobH, 'Bobs Own')).json();
  const theirs = (await createProject(adminH, 'Admins Own')).json();
  await app.inject({
    method: 'POST',
    url: `/api/projects/${theirs.id}/members`,
    headers: adminH,
    payload: { username: 'bob', role: 'viewer' },
  });

  const asBob = (await app.inject({ url: '/api/projects', headers: bobH })).json();
  const roleOf = (list: { id: string; myRole: string | null }[], id: string) => list.find((p) => p.id === id)?.myRole;
  assert.equal(roleOf(asBob, mine.id), 'owner');
  assert.equal(roleOf(asBob, theirs.id), 'viewer');

  // The admin reaches every project but is only the owner of what they actually created.
  const asAdmin = (await app.inject({ url: '/api/projects', headers: adminH })).json();
  assert.equal(roleOf(asAdmin, theirs.id), 'owner');
  assert.equal(roleOf(asAdmin, mine.id), null);
});

test('every project shape carries the group name, and it follows a rename', async () => {
  const g = (await createGroup(bobH, 'Payments')).json();
  const created = (await createProject(bobH, 'Named', g.id)).json();
  assert.equal(created.groupName, 'Payments');

  const inList = (await app.inject({ url: '/api/projects', headers: bobH })).json();
  assert.equal(inList.find((p: { id: string }) => p.id === created.id).groupName, 'Payments');

  await app.inject({ method: 'PATCH', url: `/api/groups/${g.id}`, headers: bobH, payload: { name: 'Billing' } });
  const one = (await app.inject({ url: `/api/projects/${created.id}`, headers: bobH })).json();
  assert.equal(one.groupName, 'Billing');

  const ungrouped = await app.inject({
    method: 'PATCH',
    url: `/api/projects/${created.id}`,
    headers: bobH,
    payload: { groupId: null },
  });
  assert.equal(ungrouped.json().groupName, null);
});

test('creator can rename their group; a stranger cannot', async () => {
  const g = (await createGroup(bobH, 'Bob Group')).json();
  assert.equal(g.canManage, true);

  const byOther = await app.inject({
    method: 'PATCH',
    url: `/api/groups/${g.id}`,
    headers: adminH, // admin may — it is the creator-or-admin rule
    payload: { name: 'Renamed by admin' },
  });
  assert.equal(byOther.statusCode, 200);

  const carol = await newUser('carol');
  const byStranger = await app.inject({
    method: 'PATCH',
    url: `/api/groups/${g.id}`,
    headers: carol.headers,
    payload: { name: 'Nope' },
  });
  assert.equal(byStranger.statusCode, 403);
});

test('deleting a group keeps its projects — they fall back to ungrouped', async () => {
  const g = (await createGroup(bobH, 'Temp')).json();
  const p = (await createProject(bobH, 'Filed', g.id)).json();
  assert.equal(p.groupId, g.id);

  const del = await app.inject({ method: 'DELETE', url: `/api/groups/${g.id}`, headers: bobH });
  assert.equal(del.statusCode, 204);

  const after = await app.inject({ url: `/api/projects/${p.id}`, headers: bobH });
  assert.equal(after.statusCode, 200);
  assert.equal(after.json().groupId, null);
});

test('groups are visible only to their creator and to members of a project inside them', async () => {
  const g = (await createGroup(adminH, 'Admin Only')).json();
  const mine = await app.inject({ url: '/api/groups', headers: bobH });
  assert.equal(
    mine.json().some((x: { id: string }) => x.id === g.id),
    false,
  );

  // Bob joins a project filed under it → the group appears, but he still can't manage it.
  const p = (await createProject(adminH, 'Shared', g.id)).json();
  await app.inject({
    method: 'POST',
    url: `/api/projects/${p.id}/members`,
    headers: adminH,
    payload: { username: 'bob', role: 'viewer' },
  });
  const now = (await app.inject({ url: '/api/groups', headers: bobH })).json();
  const seen = now.find((x: { id: string }) => x.id === g.id);
  assert.ok(seen);
  assert.equal(seen.canManage, false);
});

test('a project cannot be filed under a group the caller cannot see', async () => {
  const hidden = (await createGroup(adminH, 'Hidden')).json();
  const carol = await newUser('carol2');
  const res = await createProject(carol.headers, 'Sneaky', hidden.id);
  assert.equal(res.statusCode, 404); // not 403 — the group's existence stays hidden
});

test('moving a project needs project:admin', async () => {
  const g = (await createGroup(bobH, 'Bob Files')).json();
  const p = (await createProject(bobH, 'Bobs')).json();
  const editor = await newUser('carol3');
  await app.inject({
    method: 'POST',
    url: `/api/projects/${p.id}/members`,
    headers: bobH,
    payload: { username: 'carol3', role: 'editor' },
  });
  const asEditor = await app.inject({
    method: 'PATCH',
    url: `/api/projects/${p.id}`,
    headers: editor.headers,
    payload: { groupId: g.id },
  });
  assert.equal(asEditor.statusCode, 403);

  const asOwner = await app.inject({
    method: 'PATCH',
    url: `/api/projects/${p.id}`,
    headers: bobH,
    payload: { groupId: g.id },
  });
  assert.equal(asOwner.statusCode, 200);
  assert.equal(asOwner.json().groupId, g.id);
});

test('filing a project changes nobody access — groups grant nothing', async () => {
  const g = (await createGroup(adminH, 'No Powers')).json();
  const p = (await createProject(adminH, 'Private', g.id)).json();
  // Bob created a group of his own but has no membership here.
  assert.equal((await app.inject({ url: `/api/projects/${p.id}`, headers: bobH })).statusCode, 404);
  const list = await app.inject({ url: '/api/projects', headers: bobH });
  assert.equal(
    list.json().some((x: { id: string }) => x.id === p.id),
    false,
  );
});
