import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { bootData } from './helpers.js';

let projectSvc: typeof import('../src/services/project-service.js');
let fileSvc: typeof import('../src/services/file-service.js');
let importSvc: typeof import('../src/services/import-service.js');

before(async () => {
  await bootData('apione-import-');
  projectSvc = await import('../src/services/project-service.js');
  fileSvc = await import('../src/services/file-service.js');
  importSvc = await import('../src/services/import-service.js');
});

const SWAGGER2 = JSON.stringify({
  swagger: '2.0',
  info: { title: 'Legacy API', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        responses: { '200': { description: 'ok', schema: { type: 'array', items: { $ref: '#/definitions/User' } } } },
      },
    },
  },
  definitions: { User: { type: 'object', properties: { id: { type: 'integer' } } } },
});

test('import Swagger 2 → converted to OpenAPI 3 as v1', async () => {
  const p = projectSvc.createProject('Legacy');
  const r = await importSvc.importSpec(p.id, SWAGGER2, 'auto', 'bob');
  assert.equal(r.sourceFormat, 'swagger2');
  assert.equal(r.version, 1);

  const read = fileSvc.readFile(p.id, 'openapi.yaml');
  assert.match(read.content, /openapi: 3\./, 'should be OpenAPI 3 now');
  assert.match(read.content, /\/users:/);
  // Swagger2 definitions become components/schemas in OAS3
  assert.match(read.content, /components:/);

  const hist = fileSvc.listVersions(p.id, 'openapi.yaml');
  const v1 = hist.versions.find((v) => v.versionNo === 1);
  assert.equal(v1?.authorType, 'import');
  assert.equal(v1?.authorRef, 'bob', 'import records the acting user');
});

test('import normalizes to 3.1: stamps version, strips YApi junk, lifts nullable/exclusive', async () => {
  const p = projectSvc.createProject('Normalize');
  const oas30 = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'N', version: '1' },
    paths: {
      '/x': {
        get: {
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    $$ref: '#/junk',
                    properties: {
                      name: { type: 'string', nullable: true, mock: '@name', enumDesc: 'x' },
                      age: { type: 'integer', minimum: 0, exclusiveMinimum: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  await importSvc.importSpec(p.id, oas30, 'oas3');
  const doc = YAML.parse(fileSvc.readFile(p.id, 'openapi.yaml').content);
  assert.equal(doc.openapi, '3.1.0', 'stamped 3.1');

  const schema = doc.paths['/x'].get.responses['200'].content['application/json'].schema;
  assert.equal(schema.$$ref, undefined, '$$ref stripped');
  assert.deepEqual(schema.properties.name.type, ['string', 'null'], 'nullable → 3.1 type union');
  assert.equal(schema.properties.name.mock, undefined, 'mock stripped');
  assert.equal(schema.properties.name.enumDesc, undefined, 'enumDesc stripped');
  assert.equal(schema.properties.age.exclusiveMinimum, 0, 'exclusiveMinimum boolean → numeric');
  assert.equal(schema.properties.age.minimum, undefined, 'minimum folded into exclusiveMinimum');
});

test('import OpenAPI 3 passes through; re-import bumps version', async () => {
  const p = projectSvc.createProject('Passthru');
  const oas = 'openapi: 3.1.0\ninfo: { title: Fresh, version: 1.0.0 }\npaths: {}\n';
  const r1 = await importSvc.importSpec(p.id, oas);
  assert.equal(r1.sourceFormat, 'oas3');
  assert.equal(r1.version, 1);
  // re-importing the SAME content is a no-op; a CHANGED re-import appends a version
  assert.equal((await importSvc.importSpec(p.id, oas)).version, 1);
  const changed = 'openapi: 3.1.0\ninfo: { title: Fresh v2, version: 1.0.0 }\npaths: {}\n';
  assert.equal((await importSvc.importSpec(p.id, changed)).version, 2);
});

// Everything keyed by an operation — mocks, stages — hangs off the id, and a foreign spec
// carries none, so a re-import must recognize the endpoints it already has.
test('re-import keeps the id of an endpoint at the same address, and only that', async () => {
  const spec = (paths: string) => `openapi: 3.1.0\ninfo: { title: Re, version: 1.0.0 }\npaths:\n${paths}`;
  const idsOf = (id: string) => {
    const doc = YAML.parse(fileSvc.readFile(id, 'openapi.yaml').content);
    const out = new Map<string, string>();
    for (const [p, item] of Object.entries<any>(doc.paths)) {
      for (const [m, op] of Object.entries<any>(item)) out.set(`${m} ${p}`, op['x-apione-id']);
    }
    return out;
  };

  const p = projectSvc.createProject('Reimport');
  await importSvc.importSpec(p.id, spec('  /users:\n    get: { responses: { 200: { description: ok } } }\n'));
  const first = idsOf(p.id);

  await importSvc.importSpec(
    p.id,
    spec(
      '  /users:\n    get: { responses: { 200: { description: changed } } }\n' +
        '  /orders:\n    get: { responses: { 200: { description: ok } } }\n',
    ),
  );
  const second = idsOf(p.id);

  assert.equal(second.get('get /users'), first.get('get /users'), 'same address → same operation');
  assert.ok(second.get('get /orders'), 'a new endpoint is still stamped');
  assert.notEqual(second.get('get /orders'), first.get('get /users'), 'and gets an id of its own');

  // An endpoint that moved is a different operation as far as the document can tell.
  await importSvc.importSpec(p.id, spec('  /people:\n    get: { responses: { 200: { description: ok } } }\n'));
  assert.notEqual(idsOf(p.id).get('get /people'), first.get('get /users'));
});

test('an id the imported spec states wins over the one at that address', async () => {
  const spec = (id: string) =>
    `openapi: 3.1.0\ninfo: { title: Stated, version: 1.0.0 }\npaths:\n  /users:\n    get:\n      x-apione-id: ${id}\n      responses: { 200: { description: ok } }\n`;
  const p = projectSvc.createProject('StatedId');
  await importSvc.importSpec(p.id, spec('aaaaaaaaaaaa'));
  await importSvc.importSpec(p.id, spec('bbbbbbbbbbbb'));

  const doc = YAML.parse(fileSvc.readFile(p.id, 'openapi.yaml').content);
  assert.equal(doc.paths['/users'].get['x-apione-id'], 'bbbbbbbbbbbb');
});

const POSTMAN = JSON.stringify({
  info: { name: 'My Collection', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    {
      name: 'Users',
      item: [
        {
          name: 'Get user',
          request: {
            method: 'GET',
            url: {
              raw: 'https://api.test/users/:id?verbose=1',
              host: ['api', 'test'],
              path: ['users', ':id'],
              query: [{ key: 'verbose', value: '1' }],
            },
          },
          response: [{ code: 200, name: 'ok', body: '{"id":1}' }],
        },
        {
          name: 'Create user',
          request: {
            method: 'POST',
            url: { raw: 'https://api.test/users', host: ['api', 'test'], path: ['users'] },
            body: { mode: 'raw', raw: '{"name":"a"}' },
          },
        },
      ],
    },
  ],
});

test('import Postman collection → OpenAPI 3 (paths, params, body, responses)', async () => {
  const p = projectSvc.createProject('Postman');
  const r = await importSvc.importSpec(p.id, POSTMAN);
  assert.equal(r.sourceFormat, 'postman');
  assert.equal(r.version, 1);

  const read = fileSvc.readFile(p.id, 'openapi.yaml');
  assert.match(read.content, /openapi: 3\./);
  assert.match(read.content, /title: My Collection/);
  assert.match(read.content, /\/users\/\{id\}:/, ':id → {id} path templating');
  assert.match(read.content, /name: verbose/, 'query param carried over');
  assert.match(read.content, /requestBody:/, 'raw JSON body → requestBody');
  assert.match(read.content, /\/users:/);
});

test('import garbage → validation error', async () => {
  const p = projectSvc.createProject('Bad');
  await assert.rejects(
    () => importSvc.importSpec(p.id, 'just: a: random: yaml'),
    (e: unknown) => e instanceof Error && (e as { statusCode?: number }).statusCode === 400,
  );
});

// Empty content is just another unreadable spec — one code, so every entry point reports the same.
test('import empty content → invalid_spec, same as garbage', async () => {
  const p = projectSvc.createProject('Empty');
  for (const content of ['', '   \n']) {
    await assert.rejects(
      () => importSvc.importSpec(p.id, content),
      (e: unknown) => (e as { code?: string }).code === 'invalid_spec',
    );
  }
});

test('importAsNewProject: valid spec creates a project named from info.title', async () => {
  const before = projectSvc.listProjects().length;
  const p = await importSvc.importAsNewProject(
    undefined,
    'openapi: 3.1.0\ninfo: { title: Fresh One, version: 1.0.0 }\npaths: {}\n',
  );
  assert.equal(p.name, 'Fresh One');
  assert.equal(projectSvc.listProjects().length, before + 1);
  assert.match(fileSvc.readFile(p.id, 'openapi.yaml').content, /title: Fresh One/);
  // A caller-supplied name wins over the spec title.
  const named = await importSvc.importAsNewProject(
    'My Name',
    'openapi: 3.1.0\ninfo: { title: Ignored, version: 1.0.0 }\npaths: {}\n',
  );
  assert.equal(named.name, 'My Name');
});

test('importAsNewProject: an invalid spec creates NO project (atomic)', async () => {
  const before = projectSvc.listProjects().length;
  await assert.rejects(
    () => importSvc.importAsNewProject(undefined, 'just: a: random: yaml'),
    (e: unknown) => e instanceof Error && (e as { statusCode?: number }).statusCode === 400,
  );
  assert.equal(projectSvc.listProjects().length, before, 'no orphan project left behind');
});
