import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { authHeader, bootApp, type AuthHeaders } from './helpers.js';

let app: FastifyInstance;
let pwSession: AuthHeaders; // signed in with a password
let apiToken: AuthHeaders; // the same person's API token
let victimId: string;

before(async () => {
  ({ app, headers: pwSession } = await bootApp('apione-harden-', { admin: { username: 'root' } }));

  const tok = await app.inject({ method: 'POST', url: '/api/tokens', headers: pwSession, payload: { name: 'ci' } });
  apiToken = authHeader(tok.json().plaintext);

  const victim = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: pwSession,
    payload: { username: 'victim', role: 'admin' },
  });
  victimId = victim.json().id;
});

test('the app answers with a content security policy and the sniffing guards', async () => {
  const r = await app.inject({ url: '/api/auth/status' });
  const csp = r.headers['content-security-policy'] as string;
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-eval/, 'the bundle needs no eval; allowing it would be free reach for an injection');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
});

test('an API token cannot mint a credential, by any of the routes that make one', async () => {
  // Each of these hands back or sets a password, and a password buys a session — which may do the
  // two things a token may not. Blocking only the obvious one leaves the others as a way around.
  const attempts = [
    ['POST', '/api/users', { username: 'mallory', role: 'admin' }],
    ['PATCH', `/api/users/${victimId}`, { role: 'admin' }],
    ['POST', `/api/users/${victimId}/password`, undefined],
    ['DELETE', `/api/users/${victimId}`, undefined],
  ] as const;
  for (const [method, url, payload] of attempts) {
    const r = await app.inject({ method, url, headers: apiToken, payload });
    assert.equal(r.statusCode, 403, `${method} ${url} answered ${r.statusCode}`);
    assert.equal(r.json().error, 'session_required');
  }
});

test('the same person, signed in with a password, may still manage accounts', async () => {
  // The rule is about which credential is present, not about who the caller is — if it locked the
  // admin out too it would just be a missing feature.
  const r = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: pwSession,
    payload: { username: 'hired' },
  });
  assert.equal(r.statusCode, 201);
  assert.ok(r.json().password, 'the issued password should come back once');
});

test('an API token can still read the directory and do its actual job', async () => {
  // The block list must not creep: naming people is not creating them.
  assert.equal((await app.inject({ url: '/api/users', headers: apiToken })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/projects', headers: apiToken })).statusCode, 200);
});

test('resetting a password signs out that account, and leaves its API tokens alone', async () => {
  const victimLogin = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'victim', password: await issueVictimPassword() },
  });
  const victimSession = { authorization: `Bearer ${victimLogin.json().token}` };
  assert.equal((await app.inject({ url: '/api/auth/me', headers: victimSession })).statusCode, 200);

  await app.inject({ method: 'POST', url: `/api/users/${victimId}/password`, headers: pwSession });
  assert.equal(
    (await app.inject({ url: '/api/auth/me', headers: victimSession })).statusCode,
    401,
    'a session signed before the reset must stop working',
  );
  // The caller's own token predates none of this and keeps working: tokens are revoked one by one.
  assert.equal((await app.inject({ url: '/api/users', headers: apiToken })).statusCode, 200);
});

test('a session token carries an expiry', async () => {
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'root', password: 'secret12' },
  });
  const [, payload] = (login.json().token as string).split('.');
  const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as { exp?: number };
  assert.ok(claims.exp, 'a session that never expires can only be revoked by rotating the signing key');
  assert.ok(claims.exp * 1000 > Date.now(), 'and it should not be issued already expired');
});

/** Issue the victim a password the test knows, so it can sign in as them. */
async function issueVictimPassword(): Promise<string> {
  const r = await app.inject({ method: 'POST', url: `/api/users/${victimId}/password`, headers: pwSession });
  return r.json().password as string;
}
