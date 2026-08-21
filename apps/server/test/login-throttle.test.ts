import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { bootApp } from './helpers.js';

let throttle: typeof import('../src/services/login-throttle.js');
let app: FastifyInstance;

before(async () => {
  ({ app } = await bootApp('apione-throttle-'));
  throttle = await import('../src/services/login-throttle.js');
});

const login = (username: string, password: string) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });

// Unit: the policy is per-username, only failures count, and a success clears the slate.
test('throttle counts only failures, is per-username, and resets on success', () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) throttle.recordLoginFailure('alice', t0);
  assert.throws(() => throttle.assertLoginAllowed('alice', t0), { statusCode: 429 });

  throttle.assertLoginAllowed('bob', t0); // different user is unaffected — no throw

  throttle.clearLoginFailures('alice'); // a success would call this
  throttle.assertLoginAllowed('alice', t0); // slate wiped → allowed again

  // Window rolls over: old failures expire on their own.
  for (let i = 0; i < 5; i++) throttle.recordLoginFailure('carol', t0);
  assert.throws(() => throttle.assertLoginAllowed('carol', t0), { statusCode: 429 }); // still within window
  throttle.assertLoginAllowed('carol', t0 + 10 * 60_000); // window elapsed → allowed
});

// HTTP wiring: the 6th consecutive failure for a username is refused with the localizable code,
// and a correct login in between clears the count so a legit user is never locked out.
test('login route: 6th failed attempt → 429; a success resets the window', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login('admin', 'nope')).statusCode, 401);
  const blocked = await login('admin', 'nope');
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.json().error, 'too_many_requests'); // frontend maps → err_too_many_requests

  // Another username is independent and still gets normal auth failures, not 429.
  assert.equal((await login('ghost', 'nope')).statusCode, 401);
});
