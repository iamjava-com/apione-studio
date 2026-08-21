import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bootData } from './helpers.js';

let tmp: string;
let projectSvc: typeof import('../src/services/project-service.js');
let fileSvc: typeof import('../src/services/file-service.js');
let specSvc: typeof import('../src/services/spec-service.js');

before(async () => {
  tmp = await bootData('apione-spec-');
  projectSvc = await import('../src/services/project-service.js');
  fileSvc = await import('../src/services/file-service.js');
  specSvc = await import('../src/services/spec-service.js');
});

const VALID_SPEC = `openapi: 3.1.0
info:
  title: Valid API
  version: 1.0.0
paths:
  /ping:
    get:
      operationId: ping
      summary: Ping
      responses:
        '200':
          description: ok
`;

test('lint: a valid spec has zero errors', async () => {
  const p = projectSvc.createProject('Lint OK');
  fileSvc.writeFile(p.id, 'openapi.yaml', VALID_SPEC, 0);
  const result = await specSvc.lintProject(p.id);
  assert.equal(result.errorCount, 0, `expected 0 errors, got problems: ${JSON.stringify(result.problems)}`);
});

test('lint: an invalid spec (missing info.version) reports an error', async () => {
  const p = projectSvc.createProject('Lint Bad');
  fileSvc.writeFile(p.id, 'openapi.yaml', 'openapi: 3.1.0\ninfo:\n  title: No Version\npaths: {}\n', 0);
  const result = await specSvc.lintProject(p.id);
  assert.ok(result.errorCount > 0, 'expected at least one error for missing info.version');
});

test('bundle: multi-file $ref is pulled into one document', async () => {
  const p = projectSvc.createProject('Bundle');
  const root = `openapi: 3.1.0
info:
  title: Bundle API
  version: 1.0.0
paths:
  /u:
    get:
      operationId: getU
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: './schemas/User.yaml'
`;
  fileSvc.writeFile(p.id, 'openapi.yaml', root, 0);
  fileSvc.writeFile(p.id, 'schemas/User.yaml', 'type: object\nproperties:\n  id:\n    type: integer\n', 0);

  const out = await specSvc.bundleProjectView(p.id);
  const doc = out.parsed as {
    openapi: string;
    paths: Record<string, { get: { responses: Record<string, { content: Record<string, { schema: unknown }> }> } }>;
  };
  assert.equal(doc.openapi, '3.1.0');
  // the external $ref should now resolve to a real schema object inside the bundle
  const schema = doc.paths['/u']?.get.responses['200']?.content['application/json']?.schema as {
    type?: string;
    $ref?: string;
  };
  assert.ok(schema, 'bundled response schema should exist');
  assert.ok(schema.type === 'object' || typeof schema.$ref === 'string', 'schema should be inlined or a local $ref');
});

test('graph: $ref edges (op→schema, schema→schema) and orphan detection', async () => {
  const p = projectSvc.createProject('Graph');
  const root = `openapi: 3.1.0
info: { title: Graph API, version: 1.0.0 }
paths:
  /u:
    get:
      operationId: getUser
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
components:
  schemas:
    User:
      type: object
      properties:
        address:
          $ref: '#/components/schemas/Address'
    Address:
      type: object
      properties:
        city: { type: string }
    Orphan:
      type: object
`;
  fileSvc.writeFile(p.id, 'openapi.yaml', root, 0);
  const g = await specSvc.graphProject(p.id);

  const ids = g.nodes.map((n) => n.id).sort();
  assert.ok(ids.includes('schema:User') && ids.includes('schema:Address') && ids.includes('op:getUser'));
  const has = (from: string, to: string) => g.edges.some((e) => e.from === from && e.to === to);
  assert.ok(has('op:getUser', 'schema:User'), 'operation → User edge');
  assert.ok(has('schema:User', 'schema:Address'), 'User → Address edge');
  assert.deepEqual(g.orphans, ['schema:Orphan'], 'Orphan has no inbound refs');
});

test('oasdiff parse: numeric levels map to error/warning; operation is composed', async () => {
  const { parseBreaking } = await import('../src/engines/oasdiff.js');
  const sample = JSON.stringify([
    {
      id: 'api-path-removed-without-deprecation',
      text: 'api path removed',
      level: 3,
      operation: 'get',
      path: '/gone',
      section: 'paths',
    },
    { id: 'something-soft', text: 'soft change', level: 2, operation: 'post', path: '/x' },
  ]);
  const out = parseBreaking(sample);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.level, 'error');
  assert.equal(out[0]!.operation, 'GET /gone');
  assert.equal(out[1]!.level, 'warning');
  assert.deepEqual(parseBreaking(''), []);
});

test('breaking: removing a path between versions is reported (when oasdiff is installed)', async () => {
  const p = projectSvc.createProject('Breaking');
  const v1 = `openapi: 3.1.0
info: { title: B, version: 1.0.0 }
paths:
  /keep:
    get:
      responses: { '200': { description: ok } }
  /remove-me:
    get:
      responses: { '200': { description: ok } }
`;
  const v2 = `openapi: 3.1.0
info: { title: B, version: 1.0.0 }
paths:
  /keep:
    get:
      responses: { '200': { description: ok } }
`;
  const w1 = fileSvc.writeFile(p.id, 'openapi.yaml', v1, 0);
  fileSvc.writeFile(p.id, 'openapi.yaml', v2, w1.version);

  const report = await specSvc.breakingProject(p.id);
  assert.equal(report.targetVersion, 2);
  assert.equal(report.baseVersion, 1);
  if (report.available) {
    assert.ok(report.errorCount >= 1, `expected a breaking error, got ${JSON.stringify(report.changes)}`);
    assert.ok(report.changes.some((c) => c.id === 'api-path-removed-without-deprecation'));
  } else {
    assert.deepEqual(report.changes, []); // graceful degradation without the binary
  }
});

test('breaking: no prior version → empty report, baseVersion null', async () => {
  const p = projectSvc.createProject('Breaking v1');
  fileSvc.writeFile(p.id, 'openapi.yaml', VALID_SPEC, 0);
  const report = await specSvc.breakingProject(p.id);
  assert.equal(report.baseVersion, null);
  assert.deepEqual(report.changes, []);
});

test('listFiles: returns every file written to the vault', () => {
  const p = projectSvc.createProject('List');
  fileSvc.writeFile(p.id, 'openapi.yaml', VALID_SPEC, 0);
  fileSvc.writeFile(p.id, 'schemas/A.yaml', 'type: object\n', 0);
  const files = fileSvc.listFiles(p.id);
  const paths = files.map((f) => f.path).sort();
  assert.deepEqual(paths, ['openapi.yaml', 'schemas/A.yaml']);
});

test('bundle: an edit made straight to the file is what the next bundle sees', async () => {
  // Bundling is cached to keep the anonymous mock gateway from re-parsing per request, and the
  // cache is keyed on the files themselves for exactly this reason: on disk is where the truth
  // lives, so an editor or a `git pull` has to win over anything remembered from before.
  const p = projectSvc.createProject('External edit');
  fileSvc.writeFile(p.id, 'openapi.yaml', VALID_SPEC, 0);
  const first = (await specSvc.bundleProjectView(p.id)).parsed as { info: { title: string } };
  assert.equal(first.info.title, 'Valid API');

  const abs = path.join(tmp, 'projects', p.id, 'openapi.yaml');
  fs.writeFileSync(abs, VALID_SPEC.replace('Valid API', 'Edited On Disk'), 'utf8');
  const second = (await specSvc.bundleProjectView(p.id)).parsed as { info: { title: string } };
  assert.equal(second.info.title, 'Edited On Disk', 'the bundle served a stale copy');
});

test('bundle: a mutable caller gets its own copy, so mutating it cannot corrupt the next reader', async () => {
  const p = projectSvc.createProject('Bundle isolation');
  fileSvc.writeFile(p.id, 'openapi.yaml', VALID_SPEC, 0);
  const a = (await specSvc.bundleProjectMutable(p.id)).parsed as { info: { title: string } };
  a.info.title = 'mutated by a caller';
  const b = (await specSvc.bundleProjectView(p.id)).parsed as { info: { title: string } };
  assert.equal(b.info.title, 'Valid API');
});
