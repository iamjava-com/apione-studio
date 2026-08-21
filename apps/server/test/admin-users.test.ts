import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { authHeader, bootApp, createUser, login, type AuthHeaders } from './helpers.js';

let app: FastifyInstance;
let adminH: AuthHeaders;

/** Provision an account the way both the console and an API client do: the server issues the
 *  password and returns it once. */
const newUser = (username: string, role?: 'admin' | 'member') => createUser(app, adminH, username, role);

before(async () => {
  ({ app, headers: adminH } = await bootApp('apione-admin-', { admin: { username: 'root' } }));
});

test('non-admin cannot reach any management endpoint', async () => {
  const plain = await newUser('plain');

  for (const call of [
    app.inject({ method: 'POST', url: '/api/users', headers: plain.headers, payload: { username: 'x' } }),
    app.inject({
      method: 'PATCH',
      url: `/api/users/${plain.id}`,
      headers: plain.headers,
      payload: { role: 'admin' },
    }),
    app.inject({ method: 'DELETE', url: `/api/users/${plain.id}`, headers: plain.headers }),
  ]) {
    assert.equal((await call).statusCode, 403);
  }
});

test('admin listing is detailed; member listing is a lightweight directory', async () => {
  const asAdmin = (await app.inject({ url: '/api/users', headers: adminH })).json() as Array<Record<string, unknown>>;
  assert.ok(asAdmin[0]!.status !== undefined && asAdmin[0]!.createdAt !== undefined, 'admin sees status + createdAt');

  const looker = await newUser('looker');
  const asMember = (await app.inject({ url: '/api/users', headers: looker.headers })).json() as Array<
    Record<string, unknown>
  >;
  assert.equal(asMember[0]!.status, undefined, 'member does not see status');
});

test('create → promote → the new admin can act', async () => {
  const bob = await newUser('bob', 'member');

  const promoted = await app.inject({
    method: 'PATCH',
    url: `/api/users/${bob.id}`,
    headers: adminH,
    payload: { role: 'admin' },
  });
  assert.equal(promoted.statusCode, 200);
  assert.equal(promoted.json().role, 'admin');

  // bob (now admin) can create a user.
  const bobTok = await login(app, 'bob', bob.password);
  const r = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: authHeader(bobTok),
    payload: { username: 'carol' },
  });
  assert.equal(r.statusCode, 201);
  // The one-time password comes back with the account, and only here.
  assert.match(r.json().password, /^.{10}$/);
});

test('disabling a user is immediate: their token stops working and login is refused', async () => {
  const dave = await newUser('dave');
  assert.equal((await app.inject({ url: '/api/projects', headers: dave.headers })).statusCode, 200);

  await app.inject({
    method: 'PATCH',
    url: `/api/users/${dave.id}`,
    headers: adminH,
    payload: { status: 'disabled' },
  });

  // Existing token is rejected on the very next request (guard reads the DB, not the token).
  assert.equal((await app.inject({ url: '/api/projects', headers: dave.headers })).statusCode, 401);
  // And a fresh login is refused.
  const relogin = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'dave', password: dave.password },
  });
  assert.equal(relogin.statusCode, 403);

  // Re-enabling restores access.
  await app.inject({
    method: 'PATCH',
    url: `/api/users/${dave.id}`,
    headers: adminH,
    payload: { status: 'active' },
  });
  assert.equal((await login(app, 'dave', dave.password)).length > 0, true);
});

test('reset-password: the server issues the new one, the old one stops working', async () => {
  const eve = await newUser('eve');

  const r = await app.inject({ method: 'POST', url: `/api/users/${eve.id}/password`, headers: adminH });
  assert.equal(r.statusCode, 200);
  const issued = r.json().password as string;
  assert.match(issued, /^.{10}$/);
  assert.notEqual(issued, eve.password);

  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'eve', password: eve.password } }))
      .statusCode,
    401,
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'eve', password: issued } }))
      .statusCode,
    200,
  );
});

test('self-service change-password: current password required, then the new one works', async () => {
  const gwen = await newUser('gwen');
  const change = (body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/auth/change-password', headers: gwen.headers, payload: body });

  // Wrong current password → refused, nothing changes.
  const wrong = await change({ currentPassword: 'nope1234', newPassword: 'brandnew2' });
  assert.equal(wrong.statusCode, 400);
  assert.equal(wrong.json().error, 'wrong_password');

  // New password must still pass policy.
  assert.equal((await change({ currentPassword: gwen.password, newPassword: 'short7!' })).statusCode, 400);

  // Correct current → the caller is handed a fresh session, and the one it replaces is dead.
  const ok = await change({ currentPassword: gwen.password, newPassword: 'brandnew2' });
  assert.equal(ok.statusCode, 200);
  const reissued = ok.json().token as string;
  assert.ok(reissued && reissued !== gwen.token, 'a new session token should come back');
  assert.equal((await app.inject({ url: '/api/auth/me', headers: gwen.headers })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/auth/me', headers: authHeader(reissued) })).statusCode, 200);

  const oldLogin = {
    method: 'POST' as const,
    url: '/api/auth/login',
    payload: { username: 'gwen', password: gwen.password },
  };
  const newLogin = {
    method: 'POST' as const,
    url: '/api/auth/login',
    payload: { username: 'gwen', password: 'brandnew2' },
  };
  assert.equal((await app.inject(oldLogin)).statusCode, 401);
  assert.equal((await app.inject(newLogin)).statusCode, 200);
});

test('delete removes the user and their memberships; history author ref survives', async () => {
  const frank = await newUser('frank');
  // Frank authors a project version so there's an author ref to check.
  const pid = (
    await app.inject({ method: 'POST', url: '/api/projects', headers: frank.headers, payload: { name: 'Franks' } })
  ).json().id as string;
  await app.inject({
    method: 'PUT',
    url: `/api/projects/${pid}/files/openapi.yaml`,
    headers: frank.headers,
    payload: { content: 'openapi: 3.1.0\ninfo: { title: A, version: 1.0.0 }\npaths: {}\n', baseVersion: 0 },
  });

  const del = await app.inject({ method: 'DELETE', url: `/api/users/${frank.id}`, headers: adminH });
  assert.equal(del.statusCode, 204);
  // Login now fails (user gone).
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'frank', password: frank.password },
      })
    ).statusCode,
    401,
  );
  // History still carries frank as the author (author ref is a plain string, not an FK).
  const versions = (
    await app.inject({ url: `/api/projects/${pid}/versions?path=openapi.yaml`, headers: adminH })
  ).json().versions as Array<{ authorRef: string }>;
  assert.ok(versions.some((v) => v.authorRef === 'frank'));
});

test('self-guards: an admin cannot change, disable, or delete their own account', async () => {
  const rootId = (await app.inject({ url: '/api/auth/me', headers: adminH })).json().user.id as string;

  for (const [method, payload] of [
    ['PATCH', { role: 'member' }],
    ['PATCH', { status: 'disabled' }],
    ['DELETE', undefined],
  ] as const) {
    const r = await app.inject({ method, url: `/api/users/${rootId}`, headers: adminH, payload });
    assert.equal(r.statusCode, 400, `${method} ${JSON.stringify(payload)} on self must be refused`);
  }
});

test('disabling a member keeps them in the project roster, flagged disabled', async () => {
  const graceId = (await newUser('grace')).id;
  const pid = (
    await app.inject({ method: 'POST', url: '/api/projects', headers: adminH, payload: { name: 'Roster' } })
  ).json().id as string;
  await app.inject({
    method: 'POST',
    url: `/api/projects/${pid}/members`,
    headers: adminH,
    payload: { username: 'grace', role: 'editor' },
  });

  await app.inject({
    method: 'PATCH',
    url: `/api/users/${graceId}`,
    headers: adminH,
    payload: { status: 'disabled' },
  });

  // Membership is retained (re-enabling restores access); the row is flagged disabled.
  const roster = (await app.inject({ url: `/api/projects/${pid}/members`, headers: adminH })).json() as Array<{
    username: string;
    status: string;
  }>;
  const grace = roster.find((m) => m.username === 'grace');
  assert.equal(grace?.status, 'disabled');
});

test('user and member listings put the higher role first, then the older record', async () => {
  await newUser('zoe-member');
  await newUser('ada-admin', 'admin');

  const users = (await app.inject({ method: 'GET', url: '/api/users', headers: adminH })).json() as {
    id: string;
    username: string;
    role: string;
  }[];
  const listed = users.filter((u) => ['root', 'ada-admin', 'zoe-member'].includes(u.username)).map((u) => u.username);
  assert.deepEqual(listed, ['root', 'ada-admin', 'zoe-member']); // admins first, oldest admin first

  const projectId = (
    await app.inject({ method: 'POST', url: '/api/projects', headers: adminH, payload: { name: 'Roles' } })
  ).json().id as string;
  const add = async (username: string, role: string) =>
    app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/members`,
      headers: adminH,
      payload: { username, role },
    });
  await add('zoe-member', 'viewer');
  await add('ada-admin', 'editor');

  const members = (
    await app.inject({ method: 'GET', url: `/api/projects/${projectId}/members`, headers: adminH })
  ).json() as { username: string; role: string }[];
  assert.deepEqual(
    members.map((m) => m.role),
    ['owner', 'editor', 'viewer'],
  );
});
