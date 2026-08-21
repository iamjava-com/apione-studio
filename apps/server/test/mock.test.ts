import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { bootData } from './helpers.js';

let projectSvc: typeof import('../src/services/project-service.js');
let fileSvc: typeof import('../src/services/file-service.js');
let mockSvc: typeof import('../src/services/mock-service.js');
let gen: typeof import('../src/services/mock-generator.js');
let projectId: string; // the mock is addressed by project id (set in the first mock test)

before(async () => {
  await bootData('apione-mock-');
  projectSvc = await import('../src/services/project-service.js');
  fileSvc = await import('../src/services/file-service.js');
  mockSvc = await import('../src/services/mock-service.js');
  gen = await import('../src/services/mock-generator.js');
});

test('generator: example wins, then enum, then type/format defaults', () => {
  assert.equal(gen.generateFromSchema({ type: 'string', example: 'hi' }, {}), 'hi');
  assert.equal(gen.generateFromSchema({ type: 'string', enum: ['a', 'b'] }, {}), 'a');
  assert.equal(gen.generateFromSchema({ type: 'string', format: 'email' }, {}), 'user@example.com');
  assert.equal(gen.generateFromSchema({ type: 'integer', minimum: 5 }, {}), 5);
  assert.deepEqual(gen.generateFromSchema({ type: 'array', items: { type: 'boolean' } }, {}), [true]);
  const obj = gen.generateFromSchema(
    { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } },
    {},
  );
  assert.deepEqual(obj, { id: 0, name: 'string' });
});

test('generator: format table yields canonical, reproducible values', () => {
  assert.equal(gen.generateFromSchema({ type: 'string', format: 'uuid' }, {}), '00000000-0000-0000-0000-000000000000');
  assert.equal(gen.generateFromSchema({ type: 'string', format: 'date-time' }, {}), '2024-01-01T00:00:00Z');
  assert.equal(gen.generateFromSchema({ type: 'string', format: 'ipv6' }, {}), '::1');
  // unknown format → plain string placeholder
  assert.equal(gen.generateFromSchema({ type: 'string', format: 'nope' }, {}), 'string');
});

test('generator: composition — oneOf/anyOf pick first branch, allOf merges', () => {
  assert.equal(gen.generateFromSchema({ oneOf: [{ type: 'string' }, { type: 'integer' }] }, {}), 'string');
  assert.equal(gen.generateFromSchema({ anyOf: [{ type: 'integer', minimum: 7 }, { type: 'string' }] }, {}), 7);
  const merged = gen.generateFromSchema(
    {
      allOf: [
        { type: 'object', properties: { a: { type: 'integer' } } },
        { type: 'object', properties: { b: { type: 'string' } } },
      ],
    },
    {},
  );
  assert.deepEqual(merged, { a: 0, b: 'string' });
});

test('generator: default and examples are ignored (form is the value source)', () => {
  // the form can't set these, so mocking from them would be an invisible source
  assert.equal(gen.generateFromSchema({ type: 'string', default: 'd' }, {}), 'string');
  assert.equal(gen.generateFromSchema({ type: 'string', examples: ['e'] }, {}), 'string');
  // example (singular) and enum are still honored
  assert.equal(gen.generateFromSchema({ type: 'string', example: 'x', default: 'd' }, {}), 'x');
});

test('generator: $ref is resolved and cycles are broken', () => {
  const root = {
    components: {
      schemas: {
        Node: { type: 'object', properties: { next: { $ref: '#/components/schemas/Node' } } },
      },
    },
  };
  // self-referential schema must terminate (next → null when the ref repeats)
  const v = gen.generateFromSchema({ $ref: '#/components/schemas/Node' }, root) as { next: unknown };
  assert.deepEqual(v, { next: null });
});

const SPEC = `openapi: 3.1.0
info: { title: Mock API, version: 1.0.0 }
paths:
  /hello:
    get:
      operationId: hello
      responses:
        '200':
          description: ok
          content:
            application/json:
              example: { msg: "hello world" }
  /users/{id}:
    get:
      operationId: getUser
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  id: { type: integer }
                  email: { type: string, format: email }
`;

test('mock: example response is returned with status 200', async () => {
  const p = projectSvc.createProject('Mock');
  projectId = p.id;
  fileSvc.writeFile(p.id, 'openapi.yaml', SPEC, 0);
  const r = await mockSvc.mockRequest(projectId, 'GET', '/hello');
  assert.equal(r.status, 200);
  assert.equal(r.contentType, 'application/json');
  assert.deepEqual(r.body, { msg: 'hello world' });
});

test('mock: templated path matches and body is schema-generated', async () => {
  const r = await mockSvc.mockRequest(projectId, 'GET', '/users/42');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { id: 0, email: 'user@example.com' });
});

test('mock: unmatched path → not_found', async () => {
  await assert.rejects(
    () => mockSvc.mockRequest(projectId, 'GET', '/nope'),
    (e: unknown) => e instanceof Error && (e as { code?: string }).code === 'not_found',
  );
});

test('mock: a concrete path wins over a template that also fits it', async () => {
  // Declared template-first, which is what a router must not go by: /users/me is the answer for
  // /users/me even though /users/{id} matches it too.
  const p = projectSvc.createProject('Precedence');
  fileSvc.writeFile(
    p.id,
    'openapi.yaml',
    `openapi: 3.1.0
info: { title: T, version: 1.0.0 }
paths:
  /users/{id}:
    get:
      responses:
        '200':
          content:
            application/json:
              example: { matched: "template" }
  /users/me:
    get:
      responses:
        '200':
          content:
            application/json:
              example: { matched: "concrete" }
`,
    0,
  );
  assert.deepEqual((await mockSvc.mockRequest(p.id, 'GET', '/users/me')).body, { matched: 'concrete' });
  assert.deepEqual((await mockSvc.mockRequest(p.id, 'GET', '/users/42')).body, { matched: 'template' });
});

/** A document whose base path lives where OpenAPI puts it: in `servers[].url`, not in every key. */
const based = (servers: string) => `openapi: 3.1.0
info: { title: T, version: 1.0.0 }
${servers}
paths:
  /users/{id}:
    get:
      responses:
        '200':
          content:
            application/json:
              example: { ok: true }
`;

test('mock: a declared base path moves the endpoint — the bare address stops answering', async () => {
  const p = projectSvc.createProject('Base');
  fileSvc.writeFile(p.id, 'openapi.yaml', based('servers: [{ url: "https://api.example.com/v1" }]'), 0);
  assert.deepEqual((await mockSvc.mockRequest(p.id, 'GET', '/v1/users/42')).body, { ok: true });
  // The API being mocked doesn't answer at /users/42 either — one endpoint, one address.
  await assert.rejects(
    () => mockSvc.mockRequest(p.id, 'GET', '/users/42'),
    (e: unknown) => (e as { code?: string }).code === 'not_found',
  );
});

test('mock: an undeclared prefix is still a 404', async () => {
  const p = projectSvc.createProject('BaseStrict');
  fileSvc.writeFile(p.id, 'openapi.yaml', based('servers: [{ url: /v1 }]'), 0);
  // The whole reason only declared bases are stripped: a stale version prefix has to stay a 404
  // rather than quietly answer as if it were v1.
  for (const bad of ['/v2/users/42', '/v1beta/users/42', '/x/v1/users/42']) {
    await assert.rejects(
      () => mockSvc.mockRequest(p.id, 'GET', bad),
      (e: unknown) => (e as { code?: string }).code === 'not_found',
      bad,
    );
  }
});

test('mock: every declared base answers, and the longer of two overlapping ones is taken off first', async () => {
  const p = projectSvc.createProject('BaseOverlap');
  fileSvc.writeFile(p.id, 'openapi.yaml', based('servers: [{ url: /v1 }, { url: /v1/beta }]'), 0);
  assert.deepEqual((await mockSvc.mockRequest(p.id, 'GET', '/v1/beta/users/42')).body, { ok: true });
  assert.deepEqual((await mockSvc.mockRequest(p.id, 'GET', '/v1/users/42')).body, { ok: true });
});

test('mock: a server with no path in it leaves the bare address answering', async () => {
  const p = projectSvc.createProject('BaseNone');
  fileSvc.writeFile(p.id, 'openapi.yaml', based('servers: [{ url: "https://api.example.com" }]'), 0);
  assert.deepEqual((await mockSvc.mockRequest(p.id, 'GET', '/users/42')).body, { ok: true });
});

test('mock: declaring the root alongside a base path keeps both answering', async () => {
  // `url: /` is a declaration, not an omission — it says the API answers at the root, and the spec
  // itself uses it as the default. Dropping it would make that server do nothing at all.
  const p = projectSvc.createProject('BaseRoot');
  fileSvc.writeFile(p.id, 'openapi.yaml', based('servers: [{ url: /api }, { url: / }]'), 0);
  assert.deepEqual((await mockSvc.mockRequest(p.id, 'GET', '/api/users/42')).body, { ok: true });
  assert.deepEqual((await mockSvc.mockRequest(p.id, 'GET', '/users/42')).body, { ok: true });
});

test('mock: a server variable resolves through its default', async () => {
  const p = projectSvc.createProject('BaseVars');
  fileSvc.writeFile(
    p.id,
    'openapi.yaml',
    based(`servers:
  - url: "https://{env}.example.com/{ver}"
    variables:
      env: { default: api }
      ver: { default: v1, enum: [v1, v2] }`),
    0,
  );
  assert.deepEqual((await mockSvc.mockRequest(p.id, 'GET', '/v1/users/42')).body, { ok: true });
  // The enum is not expanded — one prefix per server, so the accepted set stays predictable.
  await assert.rejects(
    () => mockSvc.mockRequest(p.id, 'GET', '/v2/users/42'),
    (e: unknown) => (e as { code?: string }).code === 'not_found',
  );
});

test('serverBasePaths: deduped, in declaration order, root included', async () => {
  const { serverBasePaths, sortByStripOrder } = await import('../src/services/spec-servers.js');
  // Declaration order, because this list is what the author is shown; stripping order is a
  // separate concern and a separate function.
  assert.deepEqual(
    serverBasePaths({
      servers: [
        { url: 'https://api.example.com/v1' },
        { url: 'https://api-staging.example.com/v1' }, // same base, different host
        { url: 'https://api.example.com' }, // no path at all → the root
        { url: '/' }, // the same root, said the other way
        { url: '/v1/beta/' }, // trailing slash is not part of the base
        { url: 'https://api.example.com/{ver}' }, // no default to resolve {ver} with
      ],
    }),
    ['/v1', '', '/v1/beta'],
  );
  // A document declaring nothing is the spec's own default, `[{ url: '/' }]`.
  assert.deepEqual(serverBasePaths({}), ['']);
  assert.deepEqual(serverBasePaths({ servers: [] }), ['']);
  // Nothing resolvable at all still leaves the bare path served, rather than nothing.
  assert.deepEqual(serverBasePaths({ servers: [{ url: 'https://x.example.com/{ver}' }] }), ['']);
  assert.deepEqual(sortByStripOrder(['/v1', '', '/v1/beta']), ['/v1/beta', '/v1', '']);
});
