import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { bootApp, createProject, putFile } from './helpers.js';
import { scriptedMock, type MockCtx } from './mock-helpers.js';

const XSS = '<script>alert(document.domain)</script>';

const SPEC = `openapi: 3.1.0
info: { title: T, version: 1.0.0 }
paths:
  /page:
    get:
      responses:
        '200':
          content:
            text/html:
              example: "${XSS}"
  /picture:
    get:
      responses:
        '200':
          content:
            image/svg+xml:
              example: "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
  /doc:
    get:
      responses:
        '200':
          content:
            application/xhtml+xml:
              example: "<html xmlns='http://www.w3.org/1999/xhtml'><script>alert(1)</script></html>"
  /teapot:
    get:
      responses:
        '418':
          content:
            application/json:
              example: { brewing: false }
  /plain:
    get:
      responses:
        '200':
          content:
            application/json:
              example: { ok: true }
  /scripted:
    get:
      responses:
        '200':
          content:
            application/json:
              schema: { type: object }
`;

let app: FastifyInstance;
let h: Record<string, string>;
let projectId: string;
const ctx = {} as MockCtx;

/** Put scripted code on an operation and switch it on. */
const scripted = (method: string, p: string, content: string) => scriptedMock(ctx, method, p, content);

before(async () => {
  ({ app, headers: h } = await bootApp('apione-mockhard-'));
  ctx.app = app;
  ctx.headers = h;

  projectId = (await createProject(app, h, 'M')).id;
  ctx.projectId = projectId;
  await putFile(app, h, projectId, 'openapi.yaml', SPEC);
});

for (const [what, url] of [
  ['html', 'page'],
  ['svg', 'picture'],
  ['xhtml', 'doc'],
] as const) {
  test(`a ${what} mock is served sandboxed`, async () => {
    // The gateway shares an origin with the app, so a script-capable body must not be allowed to
    // run as a document there. nosniff alone does not do it — the type is declared, not sniffed.
    const r = await app.inject({ url: `/mock/${projectId}/${url}` });
    assert.equal(r.statusCode, 200);
    assert.match(r.headers['content-security-policy'] as string, /(^|;)\s*sandbox\s*(;|$)/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-frame-options'], 'DENY');
  });
}

test('a scripted mock cannot weaken the policy by declaring its own', async () => {
  await scripted(
    'get',
    '/scripted',
    `export default () => ({
       headers: { 'Content-Security-Policy': 'default-src *', 'content-type': 'text/html' },
       body: ${JSON.stringify(XSS)},
     })
`,
  );
  const r = await app.inject({ url: `/mock/${projectId}/scripted` });
  assert.match(r.headers['content-security-policy'] as string, /(^|;)\s*sandbox\s*(;|$)/);
  assert.doesNotMatch(r.headers['content-security-policy'] as string, /default-src \*/);
});

test('a scripted mock cannot set a cookie on the app origin', async () => {
  // Fastify appends set-cookie rather than replacing it, so this one has to be dropped on the way
  // in — no later header call can take it back.
  await scripted(
    'get',
    '/scripted',
    `export default () => ({ headers: { 'Set-Cookie': 'evil=1; Path=/' }, body: {} })\n`,
  );
  const r = await app.inject({ url: `/mock/${projectId}/scripted` });
  assert.equal(r.headers['set-cookie'], undefined);
});

test('an ordinary header from a scripted mock still reaches the caller', async () => {
  // The block list must stay a block list: mocking a real API means reproducing its headers.
  await scripted('get', '/scripted', `export default () => ({ headers: { 'x-answer': '42' }, body: { v: 42 } })\n`);
  const r = await app.inject({ url: `/mock/${projectId}/scripted` });
  assert.equal(r.headers['x-answer'], '42');
});

test('a mock answers a cross-origin caller', async () => {
  // A front end calls the mock from its own dev origin; without CORS the browser blocks it while
  // curl works, which is the confusing half of not having it.
  const r = await app.inject({ url: `/mock/${projectId}/plain`, headers: { origin: 'http://localhost:5173' } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['access-control-allow-origin'], 'http://localhost:5173');
  // Credentials stay off: this gateway is unauthenticated by design, and allowing them would let
  // any page drive the instance as whoever is signed in.
  assert.equal(r.headers['access-control-allow-credentials'], undefined);
  assert.match(r.headers['access-control-expose-headers'] as string, /x-apione-mock-logs/i);
});

test('a preflight for a mock is answered, for every method a real API uses', async () => {
  // The debug header makes any run a non-simple request, so the preflight has to pass before the
  // call itself is ever sent. DELETE is here because the library's default method list leaves it
  // out — the browser would then block it while the same call from curl worked.
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = await app.inject({
      method: 'OPTIONS',
      url: `/mock/${projectId}/plain`,
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': method,
        'access-control-request-headers': 'x-apione-mock-debug',
      },
    });
    assert.ok(r.statusCode < 300, `${method} preflight got ${r.statusCode}`);
    assert.equal(r.headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.match(r.headers['access-control-allow-methods'] as string, new RegExp(method), method);
  }
});

test('/api is not opened to other origins', async () => {
  // CORS belongs to the mock gateway alone — /api carries credentials and stays same-origin.
  const r = await app.inject({
    url: `/api/projects/${projectId}/mock`,
    headers: { ...h, origin: 'http://evil.example' },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['access-control-allow-origin'], undefined);
});

test('hardening changes neither the status nor the body a mock returns', async () => {
  const teapot = await app.inject({ url: `/mock/${projectId}/teapot` });
  assert.equal(teapot.statusCode, 418);

  const plain = await app.inject({ url: `/mock/${projectId}/plain` });
  assert.equal(plain.statusCode, 200);
  assert.match(plain.headers['content-type'] as string, /application\/json/);
  assert.deepEqual(plain.json(), { ok: true });
});
