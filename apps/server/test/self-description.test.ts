import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import type { FastifyInstance } from 'fastify';
import { bootApp, createProject, createUser, putFile } from './helpers.js';

let app: FastifyInstance;
let headers: Record<string, string>;
let projectId: string;

const SPEC = `openapi: 3.1.0
info: { title: Orders, version: 1.0.0 }
tags:
  - name: orders
  - name: billing
paths:
  /orders:
    get:
      summary: List orders
      operationId: listOrders
      tags: [orders]
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/Order' }
  /orders/{id}/cancel:
    post:
      summary: Cancel an order
      tags: [orders]
      deprecated: true
      responses:
        '204': { description: gone }
  /invoices:
    get:
      summary: List invoices
      tags: [billing]
      responses:
        '200': { description: ok }
components:
  schemas:
    Order:
      type: object
      properties:
        id: { type: string }
        total: { type: number }
`;

before(async () => {
  ({ app, headers } = await bootApp('apione-selfdesc-'));
  projectId = (await createProject(app, headers, 'Orders')).id;
  await putFile(app, headers, projectId, 'openapi.yaml', SPEC);
});

test('the instance describes itself as OpenAPI 3.1, generated from the routes', async () => {
  const r = await app.inject({ url: '/docs/openapi.json', headers });
  assert.equal(r.statusCode, 200);
  const doc = r.json();
  assert.equal(doc.openapi, '3.1.0');
  // A route that exists is in the document — that equivalence is the entire point.
  assert.ok(doc.paths['/api/projects/{projectId}/operations'].get);
  assert.ok(doc.paths['/api/tokens/'].post);
  assert.equal(doc.components.securitySchemes.bearerAuth.scheme, 'bearer');
});

test('untagged surfaces stay out of it — the mock gateway is not part of the management API', async () => {
  const doc = (await app.inject({ url: '/docs/openapi.json', headers })).json();
  const paths = Object.keys(doc.paths);
  assert.ok(!paths.some((p: string) => p.startsWith('/mock')));
  assert.ok(!paths.includes('/health'));
  assert.ok(paths.every((p: string) => p.startsWith('/api/') || p.startsWith('/docs/')));
});

test('the YAML form parses back to the same document', async () => {
  const r = await app.inject({ url: '/docs/openapi.yaml', headers });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'] as string, /yaml/);
  assert.deepEqual(YAML.parse(r.body), (await app.inject({ url: '/docs/openapi.json', headers })).json());
});

// An agent fetches these before it has any credential; if they needed one, onboarding deadlocks.
test('the agent onboarding pair is readable without a token', async () => {
  for (const url of ['/docs/setup.md', '/docs/skill.md']) {
    const r = await app.inject({ url });
    assert.equal(r.statusCode, 200, url);
    assert.match(r.headers['content-type'] as string, /markdown/);
    assert.ok(r.body.length > 500, `${url} served real content`);
  }
});

// Same reason, one step further out: whoever is about to write a client or a CI job reads the
// spec before they have a token to read it with.
test('the generated spec is readable without a token, and says so about itself', async () => {
  for (const url of ['/docs', '/docs/openapi.yaml', '/docs/openapi.json']) {
    assert.equal((await app.inject({ url })).statusCode, 200, url);
  }
  // The document-wide bearerAuth requirement would otherwise claim these need one too.
  const doc = (await app.inject({ url: '/docs/openapi.json' })).json();
  for (const p of ['/docs/', '/docs/openapi.yaml', '/docs/openapi.json', '/docs/setup.md', '/docs/skill.md']) {
    assert.deepEqual(doc.paths[p].get.security, [], `${p} is documented as public`);
  }
  assert.equal(doc.paths['/api/projects/'].get.security, undefined, 'everything else inherits it');
  assert.equal((await app.inject({ url: '/api/projects' })).statusCode, 401);
});

// The page is served on the app's own origin, where `script-src 'self'` forbids inline script —
// so unlike the exported spec.html, it must reference the engine and the document, not carry them.
test('the reference page inlines nothing, so the app CSP allows it', async () => {
  const r = await app.inject({ url: '/docs' });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'] as string, /text\/html/);
  assert.ok(r.body.includes('data-url="/docs/openapi.json"'), 'the document is fetched');
  assert.match(r.body, /<script src="\/docs\/standalone\.js\?v=/, 'so is the engine');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[^<]/.test(r.body), 'no script carries a body');
  assert.ok(!/https?:\/\//.test(r.body), 'and nothing is pulled off this origin');

  const js = await app.inject({ url: '/docs/standalone.js' });
  assert.equal(js.statusCode, 200);
  assert.match(js.headers['content-type'] as string, /javascript/);
  assert.ok(js.body.length > 1_000_000, 'the engine is served whole');
});

// The rule these carry is the one an API token holder cannot discover by reading: same header,
// same person, refused anyway. Spelling the list out means adding a route to it is a decision.
test('operations that refuse an API token say so as their own security scheme', async () => {
  const doc = (await app.inject({ url: '/docs/openapi.json' })).json();
  const demanding = [];
  for (const [path, item] of Object.entries(doc.paths as Record<string, Record<string, { security?: unknown }>>)) {
    for (const [method, op] of Object.entries(item)) {
      if (JSON.stringify(op.security) === JSON.stringify([{ passwordSession: [] }])) {
        demanding.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  assert.deepEqual(demanding.sort(), [
    'DELETE /api/projects/{projectId}',
    'DELETE /api/projects/{projectId}/files/{*}',
    'DELETE /api/tokens/{id}',
    'DELETE /api/users/{id}',
    'GET /api/tokens/',
    'PATCH /api/users/{id}',
    'POST /api/tokens/',
    'POST /api/users/',
    'POST /api/users/{id}/password',
  ]);
  assert.equal(doc.components.securitySchemes.passwordSession.scheme, 'bearer');
});

// Every project route is behind requirePermission by construction, so every one of them can name
// the permission it needs. A new one that forgets its guard shows up here as a blank.
test('each project operation names the permission it needs', async () => {
  const doc = (await app.inject({ url: '/docs/openapi.json' })).json();
  const unlabelled = [];
  for (const [path, item] of Object.entries(doc.paths as Record<string, Record<string, { 'x-badges'?: unknown }>>)) {
    if (!path.includes('{projectId}')) continue;
    for (const [method, op] of Object.entries(item)) {
      if (!op['x-badges']) unlabelled.push(`${method.toUpperCase()} ${path}`);
    }
  }
  assert.deepEqual(unlabelled, []);
  assert.deepEqual(doc.paths['/api/projects/{projectId}/files/{*}'].put['x-badges'], [{ name: 'spec:write' }]);
});

// The document says it too, but a caller that just hit the wall should not have to go read it.
test('a refusal names the permission that was missing', async () => {
  const outsider = await createUser(app, headers, 'permless');
  await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/members`,
    headers,
    payload: { username: 'permless', role: 'viewer' },
  });
  const r = await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/files/openapi.yaml`,
    headers: outsider.headers,
    payload: { content: SPEC, baseVersion: 1 },
  });
  assert.equal(r.statusCode, 403);
  assert.equal(r.json().error, 'forbidden');
  assert.equal(r.json().details.requiredPermission, 'spec:write');
});

test('the skill points at the live spec instead of listing endpoints itself', async () => {
  const skill = (await app.inject({ url: '/docs/skill.md' })).body;
  assert.match(skill, /^---\ndescription:|^---\nname:/m, 'has skill frontmatter');
  assert.ok(skill.includes('/docs/openapi.yaml'), 'sends the agent to the generated spec');
  // The whole point of the split: endpoint paths live in the spec, which is generated, so a
  // copied skill file cannot go stale. Hardcoding them here would reintroduce the drift.
  assert.ok(!skill.includes('/api/projects/{projectId}/files'), 'no endpoint paths baked in');
});

test('search returns summaries, not the spec', async () => {
  const r = await app.inject({ url: `/api/projects/${projectId}/operations?q=order`, headers });
  assert.equal(r.statusCode, 200);
  const { operations, total, truncated } = r.json();
  assert.equal(total, 2); // /orders and /orders/{id}/cancel — not /invoices
  assert.equal(truncated, false);
  const list = operations.find((o: { path: string }) => o.path === '/orders');
  assert.equal(list.summary, 'List orders');
  assert.equal(list.operationId, 'listOrders');
  assert.deepEqual(list.tags, ['orders']);
  assert.ok(list.opId, 'every listed operation carries its identity');
  assert.equal(list.operation, undefined, 'summaries carry no operation body');
});

test('search matches tags and marks deprecation', async () => {
  const byTag = (await app.inject({ url: `/api/projects/${projectId}/operations?q=billing`, headers })).json();
  assert.equal(byTag.total, 1);
  assert.equal(byTag.operations[0].path, '/invoices');

  const all = (await app.inject({ url: `/api/projects/${projectId}/operations`, headers })).json();
  assert.equal(all.total, 3);
  assert.equal(all.operations.find((o: { path: string }) => o.path === '/orders/{id}/cancel').deprecated, true);
});

// A caller must never mistake a truncated page for the whole answer.
test('truncation is reported, not silent', async () => {
  const r = await app.inject({ url: `/api/projects/${projectId}/operations?limit=1`, headers });
  const { operations, total, truncated } = r.json();
  assert.equal(operations.length, 1);
  assert.equal(total, 3);
  assert.equal(truncated, true);
});

test('one operation comes back whole, with $refs inlined so it reads on its own', async () => {
  const { operations } = (await app.inject({ url: `/api/projects/${projectId}/operations?q=/orders`, headers })).json();
  const opId = operations.find((o: { path: string }) => o.path === '/orders').opId;

  const r = await app.inject({ url: `/api/projects/${projectId}/operations/${opId}`, headers });
  assert.equal(r.statusCode, 200);
  const detail = r.json();
  assert.equal(detail.method, 'get');
  assert.equal(detail.path, '/orders');
  const schema = detail.operation.responses['200'].content['application/json'].schema;
  assert.equal(schema.items.$ref, undefined, 'the $ref is resolved');
  assert.equal(schema.items.properties.total.type, 'number');
});

test('an unknown operation id is a 404, not an empty answer', async () => {
  const r = await app.inject({ url: `/api/projects/${projectId}/operations/nope`, headers });
  assert.equal(r.statusCode, 404);
  assert.equal(r.json().error, 'operation_not_found');
});

test('reading operations needs spec:read — a non-member cannot even confirm the project exists', async () => {
  const outsider = await createUser(app, headers, 'outsider');
  const r = await app.inject({
    url: `/api/projects/${projectId}/operations`,
    headers: outsider.headers,
  });
  assert.equal(r.statusCode, 404);
});
