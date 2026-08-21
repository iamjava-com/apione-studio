// Ordered: this suite walks the first-run lifecycle in sequence — needs-setup, first registration,
// then authed traffic — so later tests depend on the state earlier ones created. It deliberately
// registers its own admin instead of using the bootApp default: the setup IS what it tests.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { bootApp } from './helpers.js';

let app: FastifyInstance;

before(async () => {
  ({ app } = await bootApp('apione-auth-', { admin: false }));
});

test('first run: no open mode — writes require auth; status says needsSetup', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Open' } });
  assert.equal(r.statusCode, 401);
  assert.equal((await app.inject({ url: '/api/auth/status' })).json().needsSetup, true);
});

test('first register creates the admin + returns a token; setup completes', async () => {
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'admin', password: 'secret12' },
  });
  assert.equal(r.statusCode, 201);
  const body = r.json();
  assert.equal(body.user.role, 'admin');
  assert.ok(body.token, 'first user auto-login token');
  assert.equal((await app.inject({ url: '/api/auth/status' })).json().needsSetup, false);
});

test('write without a token → 401 once auth is enabled', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Nope' } });
  assert.equal(r.statusCode, 401);
});

test('reads also require a token once auth is enabled', async () => {
  const noTok = await app.inject({ url: '/api/projects' });
  assert.equal(noTok.statusCode, 401);
});

test('login → read + write with token succeed', async () => {
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'admin', password: 'secret12' },
  });
  assert.equal(login.statusCode, 200);
  const token = login.json().token as string;
  const headers = { authorization: `Bearer ${token}` };
  assert.equal((await app.inject({ url: '/api/projects', headers })).statusCode, 200);
  const w = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers,
    payload: { name: 'Authed' },
  });
  assert.equal(w.statusCode, 201);
});

test('bad credentials → 401', async () => {
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'admin', password: 'wrong' },
  });
  assert.equal(r.statusCode, 401);
});

test('saves record the acting user as author', async () => {
  const token = (
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'secret12' } })
  ).json().token as string;
  const headers = { authorization: `Bearer ${token}` };
  const pid = (
    await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'Author Test' } })
  ).json().id as string;
  await app.inject({
    method: 'PUT',
    url: `/api/projects/${pid}/files/openapi.yaml`,
    headers,
    payload: { content: 'openapi: 3.1.0\ninfo: { title: A, version: 1.0.0 }\npaths: {}\n', baseVersion: 0 },
  });
  const versions = (await app.inject({ url: `/api/projects/${pid}/versions?path=openapi.yaml`, headers })).json()
    .versions as Array<{ versionNo: number; authorType: string; authorRef: string }>;
  const v1 = versions.find((v) => v.versionNo === 1)!;
  assert.equal(v1.authorType, 'user');
  assert.equal(v1.authorRef, 'admin');
});

test('after setup, self-register is closed → 403 (admins provision accounts instead)', async () => {
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'sneaky', password: 'secret12' },
  });
  assert.equal(r.statusCode, 403);
});

test('after setup, an admin can provision additional (member) accounts via /api/users', async () => {
  const token = (
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'secret12' } })
  ).json().token as string;
  const r = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { authorization: `Bearer ${token}` },
    payload: { username: 'editor1' },
  });
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().role, 'member'); // defaults to member
  assert.equal(r.json().status, 'active');
});
