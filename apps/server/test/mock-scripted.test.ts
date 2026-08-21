import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bootApp, createProject, createUser, putFile } from './helpers.js';
import { opIdOf, putCode, putSpec, readCode, scriptedMock, setMode, type MockCtx } from './mock-helpers.js';

const SPEC = `openapi: 3.1.0
info: { title: T, version: 1.0.0 }
paths:
  /users/{id}:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                type: object
                properties:
                  id: { type: string }
  /items:
    post:
      responses:
        '201':
          content:
            application/json:
              schema: { type: object }
  /plain:
    get:
      responses:
        '200':
          content:
            text/plain:
              schema: { type: object, properties: { a: { type: string } } }
`;

let tmp: string;
let h: Record<string, string>;
let projectId: string;
const ctx = {} as MockCtx;

before(async () => {
  const booted = await bootApp('apione-scripted-');
  tmp = booted.tmp;
  ctx.app = booted.app;
  h = booted.headers;
  ctx.headers = h;

  projectId = (await createProject(ctx.app, h, 'M')).id;
  ctx.projectId = projectId;
  await putFile(ctx.app, h, projectId, 'openapi.yaml', SPEC);
});

test('a scripted operation overrides the generator; an untouched one does not', async () => {
  // Nothing runs until an operation is explicitly switched: 'auto' is the default for every one.
  await putCode(
    ctx,
    'get',
    '/users/{id}',
    'export default (req) => ({ status: 200, body: { echoed: req.params.id } })\n',
  );
  const beforeSwitch = await ctx.app.inject({ url: `/mock/${projectId}/users/42` });
  assert.equal(beforeSwitch.json().echoed, undefined, 'code on disk is inert until the mode says otherwise');

  await setMode(ctx, 'get', '/users/{id}', 'scripted');
  const on = await ctx.app.inject({ url: `/mock/${projectId}/users/42` });
  assert.equal(on.statusCode, 200);
  assert.deepEqual(on.json(), { echoed: '42' });
});

test('switching back to auto keeps the code but stops running it', async () => {
  await scriptedMock(ctx, 'get', '/users/{id}', 'export default (req) => ({ body: { echoed: req.params.id } })\n');

  await setMode(ctx, 'get', '/users/{id}', 'auto');
  const res = await ctx.app.inject({ url: `/mock/${projectId}/users/42` });
  assert.equal(res.json().echoed, undefined);

  const code = await readCode(ctx, await opIdOf(ctx, 'get', '/users/{id}'));
  assert.match(code.json().content, /echoed/);
});

test('the sandbox has no fs, network, process or timers to reach for', async () => {
  const probe = `export default () => ({
    body: ['require', 'process', 'fetch', 'XMLHttpRequest', 'setTimeout', 'WebSocket', 'Deno']
      .filter((g) => typeof globalThis[g] !== 'undefined'),
  })`;
  await scriptedMock(ctx, 'get', '/users/{id}', `${probe}\n`);
  const r = await ctx.app.inject({ url: `/mock/${projectId}/users/1` });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), [], 'no host capability should be reachable from the guest');
});

test('the gateway derives params, query and body from the real request', async () => {
  await scriptedMock(
    ctx,
    'get',
    '/users/{id}',
    'export default (req) => ({ body: { p: req.params, q: req.query, m: req.method, path: req.path } })\n',
  );
  const r = await ctx.app.inject({ url: `/mock/${projectId}/users/42?t=1` });
  assert.deepEqual(r.json().p, { id: '42' });
  assert.deepEqual(r.json().q, { t: '1' });
  assert.equal(r.json().m, 'GET');
  assert.equal(r.json().path, '/users/42');
});

test('an infinite loop is interrupted rather than hanging the server', async () => {
  await scriptedMock(ctx, 'get', '/users/{id}', 'export default () => { while (true) {} }\n');
  const r = await ctx.app.inject({ url: `/mock/${projectId}/users/1` });
  assert.equal(r.statusCode, 500);
  assert.equal(r.json().error, 'mock_script_failed');
  // 'interrupted' is QuickJS's own deadline handler firing — the CPU guard, not the outer
  // race that only backstops a promise which never settles.
  assert.match(r.json().message, /interrupted|timed out/);
});

test('a broken mock fails the gateway request as 500 — the caller is not at fault', async () => {
  await scriptedMock(ctx, 'get', '/users/{id}', 'export default () => { throw new Error("kaboom") }\n');
  const res = await ctx.app.inject({ url: `/mock/${projectId}/users/1` });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error, 'mock_script_failed');
  assert.match(res.json().message, /kaboom/);
});

test('console output is attached only for an authorized debugger asking for it', async () => {
  await scriptedMock(
    ctx,
    'get',
    '/users/{id}',
    'export default () => { console.log("peek", 1); return { body: { ok: true } }; }\n',
  );
  const LOGS = 'x-apione-mock-logs';
  const decode = (v?: string) => (v ? (JSON.parse(Buffer.from(v, 'base64').toString('utf8')) as string[]) : null);

  const plain = await ctx.app.inject({ url: `/mock/${projectId}/users/1` });
  assert.equal(plain.headers[LOGS], undefined, 'ordinary callers must never see console output');

  const anon = await ctx.app.inject({ url: `/mock/${projectId}/users/1`, headers: { 'x-apione-mock-debug': '1' } });
  assert.equal(anon.headers[LOGS], undefined, 'asking without a token is still ordinary traffic');

  const authed = await ctx.app.inject({
    url: `/mock/${projectId}/users/1`,
    headers: { ...h, 'x-apione-mock-debug': '1' },
  });
  assert.deepEqual(decode(authed.headers[LOGS] as string), ['peek 1']);
});

test('async handlers work, and headers/status from the envelope reach the caller', async () => {
  await scriptedMock(
    ctx,
    'get',
    '/users/{id}',
    `export default async (req) => {
       const v = await Promise.resolve(7);
       return { status: 202, headers: { 'x-answer': String(v) }, body: { v } };
     }
`,
  );
  const r = await ctx.app.inject({ url: `/mock/${projectId}/users/1` });
  assert.equal(r.statusCode, 202);
  assert.equal(r.headers['x-answer'], '7');
  assert.deepEqual(r.json(), { v: 7 });
});

test('delayMs holds the response back', async () => {
  // The runner reports the delay rather than sleeping it (see the clamp test below), so the exact
  // number is asserted there. The gateway is the one that waits — verified with a delay small
  // enough not to slow the suite.
  const { runScriptedMock } = await import('../src/services/mock-sandbox.js');
  const req = { method: 'GET', path: '/x', params: {}, query: {}, headers: {}, body: undefined };
  const result = await runScriptedMock({
    code: 'export default () => ({ body: { ok: true }, delayMs: 150 })',
    req,
  });
  assert.equal(result.delayMs, 150);

  await scriptedMock(ctx, 'get', '/users/{id}', 'export default () => ({ body: { ok: true }, delayMs: 25 })\n');
  const started = Date.now();
  const r = await ctx.app.inject({ url: `/mock/${projectId}/users/1` });
  assert.equal(r.statusCode, 200);
  assert.ok(Date.now() - started >= 15, 'the response should have been held back');
});

test('a delay longer than the cap is clamped, not honoured', async () => {
  // Asserted on the runner, which reports the delay rather than sleeping it — the gateway does
  // the waiting. Going through the gateway here would mean actually sitting out the cap.
  const { runScriptedMock } = await import('../src/services/mock-sandbox.js');
  const req = { method: 'GET', path: '/x', params: {}, query: {}, headers: {}, body: undefined };
  const result = await runScriptedMock({
    code: 'export default () => ({ body: {}, delayMs: 86400000 })',
    req,
  });
  assert.equal(result.delayMs, 30_000);

  const negative = await runScriptedMock({ code: 'export default () => ({ body: {}, delayMs: -5 })', req });
  assert.equal(negative.delayMs, 0);
});

test('the gateway takes any body type instead of rejecting it', async () => {
  await scriptedMock(
    ctx,
    'post',
    '/items',
    'export default (req) => ({ body: { type: typeof req.body, got: req.body } })\n',
  );

  const json = await ctx.app.inject({
    method: 'POST',
    url: `/mock/${projectId}/items`,
    headers: { 'content-type': 'application/json' },
    payload: { a: 1 },
  });
  assert.deepEqual(json.json().got, { a: 1 }, 'JSON is still parsed');

  // A form post is ordinary traffic for a real API; the mock used to answer 415.
  const form = await ctx.app.inject({
    method: 'POST',
    url: `/mock/${projectId}/items`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'a=1',
  });
  assert.equal(form.statusCode, 200);
  assert.equal(form.json().got, 'a=1', 'an unrecognized type arrives as the raw string');
});

test('a payload that merely has a status *field* is a body, not a response envelope', async () => {
  // `{ status: 'active' }` is data; reading it as an envelope would silently return nothing.
  await scriptedMock(ctx, 'get', '/users/{id}', `export default () => ({ status: 'active', name: 'ada' })\n`);
  const r = await ctx.app.inject({ url: `/mock/${projectId}/users/1` });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { status: 'active', name: 'ada' });
});

test('a structured body under a non-JSON content type is still sent, not a 500', async () => {
  // Fastify refuses to send an object unless the type is JSON; a spec may well declare text/plain
  // (or */*) for a structured schema, and the generator honours the schema either way.
  const r = await ctx.app.inject({ url: `/mock/${projectId}/plain` });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'] as string, /text\/plain/);
  assert.deepEqual(JSON.parse(r.body), { a: 'string' });
});

test('the response schema is served with $refs inlined, and survives a self-reference', async () => {
  const withTree =
    SPEC.replace(
      '  /plain:',
      `  /tree:
    get:
      responses:
        '200':
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Node' }
  /plain:`,
    ) +
    `components:
  schemas:
    Node:
      type: object
      properties:
        name: { type: string }
        child: { $ref: '#/components/schemas/Node' }
`;
  await putSpec(ctx, withTree);

  const r = await ctx.app.inject({
    url: `/api/projects/${projectId}/mock/schema?method=get&path=${encodeURIComponent('/tree')}`,
    headers: h,
  });
  assert.equal(r.statusCode, 200);
  const schema = r.json().schema;
  assert.equal(schema.properties.name.type, 'string', 'the ref must be inlined, not left as a pointer');
  // The self-reference stays a pointer — inlining it would never terminate.
  assert.equal(schema.properties.child.$ref, '#/components/schemas/Node');
});

test('code is stored verbatim in a vault file named by operation id (no YAML canonicalization)', async () => {
  await putCode(
    ctx,
    'post',
    '/items',
    `export default (req) => {
       // a comment, and single quotes, that canonicalization would have rewritten
       return { status: 201, body: { got: req.body } };
     }\n`,
  );

  const opId = await opIdOf(ctx, 'post', '/items');
  const onDisk = fs.readFileSync(path.join(tmp, 'projects', projectId, 'mocks', `${opId}.js`), 'utf8');
  assert.match(onDisk, /\/\/ a comment, and single quotes/, 'comments and formatting must survive untouched');

  const catalog = await ctx.app.inject({ url: `/api/projects/${projectId}/mock`, headers: h });
  assert.equal(catalog.json().operations.find((o: { path: string }) => o.path === '/items').hasCode, true);
});

test('a tester can author mocks but cannot touch the spec', async () => {
  const qa = await createUser(ctx.app, h, 'qa');
  await ctx.app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/members`,
    headers: h,
    payload: { username: 'qa', role: 'tester' },
  });

  const opId = await opIdOf(ctx, 'get', '/users/{id}');
  const current = await ctx.app.inject({
    url: `/api/projects/${projectId}/mock/code?opId=${opId}`,
    headers: qa.headers,
  });
  assert.equal(current.statusCode, 200, 'tester holds mock:read');

  const write = await ctx.app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/mock/code`,
    headers: qa.headers,
    payload: { opId, content: 'export default () => ({ body: {} })\n', baseVersion: current.json().version },
  });
  assert.equal(write.statusCode, 200, 'tester holds mock:write');

  // Reads the spec's current version first — a tester holds spec:read, just not spec:write.
  const specNow = await ctx.app.inject({ url: `/api/projects/${projectId}/files/openapi.yaml`, headers: qa.headers });
  assert.equal(specNow.statusCode, 200);
  const spec = await ctx.app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/files/openapi.yaml`,
    headers: qa.headers,
    payload: { content: SPEC, baseVersion: specNow.json().version },
  });
  assert.equal(spec.statusCode, 403, 'tester must not hold spec:write');
});
