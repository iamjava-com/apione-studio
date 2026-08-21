import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { bootApp, createProject as newProject, createUser, type AuthHeaders } from './helpers.js';

let app: FastifyInstance;
let adminH: AuthHeaders;
let bobH: AuthHeaders;
/** Source project: dave=editor, erin=viewer. */
let sourceId: string;
let daveId: string;
let erinId: string;

const addMember = (projectId: string, username: string, role: string) =>
  app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/members`,
    headers: adminH,
    payload: { username, role },
  });

const createProject = async (headers: AuthHeaders, name: string) => (await newProject(app, headers, name)).id;

before(async () => {
  ({ app, headers: adminH } = await bootApp('apione-copy-'));

  bobH = (await createUser(app, adminH, 'bob')).headers;
  daveId = (await createUser(app, adminH, 'dave')).id;
  erinId = (await createUser(app, adminH, 'erin')).id;

  sourceId = await createProject(adminH, 'Source');
  await addMember(sourceId, 'dave', 'editor');
  await addMember(sourceId, 'erin', 'viewer');
});

test('copy brings each member over with the role they had', async () => {
  const target = await createProject(adminH, 'Target');
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${target}/members/copy`,
    headers: adminH,
    payload: { fromProjectId: sourceId, userIds: [daveId, erinId] },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().added, 2);

  const roster = (await app.inject({ url: `/api/projects/${target}/members`, headers: adminH })).json();
  const roleOf = (id: string) => roster.find((m: { userId: string }) => m.userId === id)?.role;
  assert.equal(roleOf(daveId), 'editor');
  assert.equal(roleOf(erinId), 'viewer');
});

test('someone already on the target keeps their existing role', async () => {
  const target = await createProject(adminH, 'Target2');
  await addMember(target, 'dave', 'viewer'); // lower than the source's editor
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${target}/members/copy`,
    headers: adminH,
    payload: { fromProjectId: sourceId, userIds: [daveId, erinId] },
  });
  assert.equal(res.json().added, 1);

  const roster = (await app.inject({ url: `/api/projects/${target}/members`, headers: adminH })).json();
  assert.equal(roster.find((m: { userId: string }) => m.userId === daveId).role, 'viewer');
});

test('copy is a snapshot: later changes on the source do not follow', async () => {
  // A source of this test's own, so removing erin from it cannot bleed into other tests.
  const source = await createProject(adminH, 'Source3');
  await addMember(source, 'erin', 'viewer');
  const target = await createProject(adminH, 'Target3');
  await app.inject({
    method: 'POST',
    url: `/api/projects/${target}/members/copy`,
    headers: adminH,
    payload: { fromProjectId: source, userIds: [erinId] },
  });
  await app.inject({ method: 'DELETE', url: `/api/projects/${source}/members/${erinId}`, headers: adminH });

  const roster = (await app.inject({ url: `/api/projects/${target}/members`, headers: adminH })).json();
  assert.ok(roster.some((m: { userId: string }) => m.userId === erinId));
});

test('copying from a project you do not manage is a 404, not a roster leak', async () => {
  const target = await createProject(bobH, 'Bobs Own');
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${target}/members/copy`,
    headers: bobH,
    payload: { fromProjectId: sourceId, userIds: [daveId] },
  });
  assert.equal(res.statusCode, 404);

  const roster = (await app.inject({ url: `/api/projects/${target}/members`, headers: bobH })).json();
  assert.equal(roster.length, 1); // bob alone
});

test('the source picker lists only projects the caller manages members of', async () => {
  const target = await createProject(bobH, 'Bobs Target');
  const other = await createProject(bobH, 'Bobs Other');
  const sources = (await app.inject({ url: `/api/projects/${target}/members/sources`, headers: bobH })).json();
  const ids = sources.map((p: { id: string }) => p.id);
  assert.ok(ids.includes(other));
  assert.equal(ids.includes(target), false); // not itself
  assert.equal(ids.includes(sourceId), false); // not admin's project
});

test('userIds outside the source roster are ignored', async () => {
  const target = await createProject(adminH, 'Target4');
  const stranger = (await createUser(app, adminH, 'frank')).id;
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${target}/members/copy`,
    headers: adminH,
    payload: { fromProjectId: sourceId, userIds: [stranger] },
  });
  assert.equal(res.json().added, 0);
});
