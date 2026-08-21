import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { bootApp, createUser, type AuthHeaders } from './helpers.js';

let app: FastifyInstance;
/** Password sessions. `session` = admin; `otherSession` = a second account, for cross-user checks. */
let session: AuthHeaders;
let otherSession: AuthHeaders;

/** Mint a token via the password session and return its plaintext + id. */
async function mint(name: string, headers = session) {
  const r = await app.inject({ method: 'POST', url: '/api/tokens', headers, payload: { name } });
  assert.equal(r.statusCode, 201);
  return r.json() as { id: string; name: string; plaintext: string };
}

before(async () => {
  ({ app, headers: session } = await bootApp('apione-tokens-'));
  otherSession = (await createUser(app, session, 'other')).headers;
});

test('a token authenticates exactly like its owner — same reads, same writes', async () => {
  const { plaintext } = await mint('ci');
  const headers = { authorization: `Bearer ${plaintext}` };
  assert.equal((await app.inject({ url: '/api/projects', headers })).statusCode, 200);
  const created = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'By Token' } });
  assert.equal(created.statusCode, 201);
  assert.equal((await app.inject({ url: '/api/auth/me', headers })).json().user.username, 'admin');
});

test('writes made with a token are attributed to the person, not the credential', async () => {
  const { plaintext } = await mint('authorship');
  const headers = { authorization: `Bearer ${plaintext}` };
  const pid = (await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'Trail' } })).json()
    .id as string;
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

test('the plaintext is returned once and never appears in a listing', async () => {
  const { plaintext, id } = await mint('once');
  assert.ok(plaintext.startsWith('apione_'));
  const rows = (await app.inject({ url: '/api/tokens', headers: session })).json() as Array<Record<string, unknown>>;
  const row = rows.find((r) => r.id === id)!;
  assert.equal(row.plaintext, undefined);
  assert.equal(row.tokenHash, undefined);
  assert.equal(row.name, 'once');
});

test('revoking a token locks it out on the very next request', async () => {
  const { plaintext, id } = await mint('short-lived');
  const headers = { authorization: `Bearer ${plaintext}` };
  assert.equal((await app.inject({ url: '/api/projects', headers })).statusCode, 200);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/tokens/${id}`, headers: session })).statusCode, 204);
  assert.equal((await app.inject({ url: '/api/projects', headers })).statusCode, 401);
});

test('disabling the user kills their tokens immediately', async () => {
  // A user of this test's own — disabling the shared one would strand every later cross-user check.
  const doomed = await createUser(app, session, 'doomed');
  const { plaintext } = await mint('doomed', doomed.headers);
  const headers = { authorization: `Bearer ${plaintext}` };
  assert.equal((await app.inject({ url: '/api/projects', headers })).statusCode, 200);
  await app.inject({
    method: 'PATCH',
    url: `/api/users/${doomed.id}`,
    headers: session,
    payload: { status: 'disabled' },
  });
  assert.equal((await app.inject({ url: '/api/projects', headers })).statusCode, 401);
});

// Without this a single leaked token mints its own replacements and revocation never catches up.
test('a token cannot manage tokens — that needs a password session', async () => {
  const { plaintext, id } = await mint('bootstrap');
  const headers = { authorization: `Bearer ${plaintext}` };
  assert.equal((await app.inject({ url: '/api/tokens', headers })).statusCode, 403);
  const spawn = await app.inject({ method: 'POST', url: '/api/tokens', headers, payload: { name: 'child' } });
  assert.equal(spawn.statusCode, 403);
  assert.equal(spawn.json().error, 'session_required');
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/tokens/${id}`, headers })).statusCode, 403);
});

/**
 * A token may do anything that lands in the version ledger, because all of it can be diffed and
 * rolled back. The handful of operations that destroy the ledger leave nothing to roll back to,
 * so they want the person present — the same shape of rule as tokens not managing tokens.
 */
test('a token cannot destroy history — that needs a password session', async () => {
  const { plaintext } = await mint('destroyer');
  const headers = { authorization: `Bearer ${plaintext}` };
  const pid = (await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'Doomed' } })).json()
    .id as string;
  await app.inject({
    method: 'PUT',
    url: `/api/projects/${pid}/files/openapi.yaml`,
    headers,
    payload: { content: 'openapi: 3.1.0\ninfo: { title: D, version: 1.0.0 }\npaths: {}\n', baseVersion: 0 },
  });

  const file = await app.inject({ method: 'DELETE', url: `/api/projects/${pid}/files/openapi.yaml`, headers });
  assert.equal(file.statusCode, 403);
  assert.equal(file.json().error, 'session_required');

  const project = await app.inject({ method: 'DELETE', url: `/api/projects/${pid}`, headers });
  assert.equal(project.statusCode, 403);
  assert.equal(project.json().error, 'session_required');

  const otherId = (
    (await app.inject({ url: '/api/users', headers: session })).json() as Array<{ id: string; username: string }>
  ).find((u) => u.username === 'other')!.id;
  const user = await app.inject({ method: 'DELETE', url: `/api/users/${otherId}`, headers });
  assert.equal(user.statusCode, 403);
  assert.equal(user.json().error, 'session_required');

  // Still there, and the password session can still do all three.
  assert.equal((await app.inject({ url: `/api/projects/${pid}`, headers })).statusCode, 200);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/projects/${pid}`, headers: session })).statusCode, 204);
});

// The line is destroy-vs-append, not "dangerous": an overwrite is recoverable, so it stays open.
test('a token can still overwrite a spec, because that appends a version', async () => {
  const { plaintext } = await mint('overwriter');
  const headers = { authorization: `Bearer ${plaintext}` };
  const pid = (
    await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'Rewritten' } })
  ).json().id as string;
  const doc = (v: string) => `openapi: 3.1.0\ninfo: { title: R, version: ${v} }\npaths: {}\n`;
  await app.inject({
    method: 'PUT',
    url: `/api/projects/${pid}/files/openapi.yaml`,
    headers,
    payload: { content: doc('1.0.0'), baseVersion: 0 },
  });
  const imported = await app.inject({
    method: 'POST',
    url: `/api/projects/${pid}/import`,
    headers,
    payload: { content: doc('2.0.0') },
  });
  assert.equal(imported.statusCode, 200);
  const versions = (await app.inject({ url: `/api/projects/${pid}/versions?path=openapi.yaml`, headers })).json()
    .versions as unknown[];
  assert.equal(versions.length, 2, 'the old content is still in history');
});

test("one user cannot revoke another's token", async () => {
  const { id, plaintext } = await mint('mine');
  const r = await app.inject({ method: 'DELETE', url: `/api/tokens/${id}`, headers: otherSession });
  assert.equal(r.statusCode, 404);
  // still works — the failed revoke changed nothing
  assert.equal(
    (await app.inject({ url: '/api/projects', headers: { authorization: `Bearer ${plaintext}` } })).statusCode,
    200,
  );
});

test('listings are per-user', async () => {
  const mineBefore = (await app.inject({ url: '/api/tokens', headers: session })).json() as unknown[];
  await mint('theirs', otherSession);
  const theirs = (await app.inject({ url: '/api/tokens', headers: otherSession })).json() as Array<{ name: string }>;
  const mineAfter = (await app.inject({ url: '/api/tokens', headers: session })).json() as unknown[];
  assert.ok(theirs.some((t) => t.name === 'theirs'));
  assert.equal(mineAfter.length, mineBefore.length);
});

test('a made-up token is rejected', async () => {
  const headers = { authorization: 'Bearer apione_not-a-real-token' };
  assert.equal((await app.inject({ url: '/api/projects', headers })).statusCode, 401);
});

test('a nameless token is refused', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/tokens', headers: session, payload: { name: '  ' } });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().error, 'token_name_required');
});
