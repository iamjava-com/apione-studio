import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import YAML from 'yaml';
import { bootApp } from './helpers.js';

let app: FastifyInstance;
let headers: Record<string, string>;
let statusSvc: typeof import('../src/services/operation-status-service.js');
let specExport: typeof import('../src/services/spec-export.js');
let specWrite: typeof import('../src/services/spec-write-service.js');
let projectSvc: typeof import('../src/services/project-service.js');

/* eslint-disable @typescript-eslint/no-explicit-any */

const SHOP = `openapi: 3.1.0
info: { title: Shop, version: 1.0.0 }
tags:
  - name: orders
  - name: drafts
components:
  securitySchemes:
    bearer: { type: http, scheme: bearer }
  schemas:
    Order:
      type: object
      properties:
        item: { $ref: '#/components/schemas/Item' }
    Item:
      type: object
      properties: { sku: { type: string } }
    Draft: { type: object }
paths:
  /orders:
    get:
      tags: [orders]
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Order' }
    post:
      tags: [drafts]
      deprecated: true
      responses:
        '201':
          description: made
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Draft' }
  /drafts:
    get:
      tags: [drafts]
      responses:
        '200': { description: ok }
`;

before(async () => {
  ({ app, headers } = await bootApp('apione-stage-'));
  statusSvc = await import('../src/services/operation-status-service.js');
  specExport = await import('../src/services/spec-export.js');
  specWrite = await import('../src/services/spec-write-service.js');
  projectSvc = await import('../src/services/project-service.js');
});

/** A project holding SHOP, plus its operations keyed by "METHOD /path". */
async function seedShop(name: string) {
  const created = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name } });
  const projectId = created.json().id as string;
  const imported = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/import`,
    headers,
    payload: { content: SHOP },
  });
  assert.equal(imported.statusCode, 200, imported.body);

  const listed = await app.inject({ url: `/api/projects/${projectId}/operations`, headers });
  const byAddress = new Map<string, any>(
    listed.json().operations.map((o: any) => [`${o.method.toUpperCase()} ${o.path}`, o]),
  );
  return { projectId, byAddress };
}

/**
 * Edit the root file the way a client does: read the stamped content back, change the parsed
 * document, write it with the version that came with it. Re-submitting the raw fixture would
 * arrive without ids and be stamped afresh — a different set of operations, not an edit.
 */
async function editRoot(projectId: string, mutate: (doc: any) => void) {
  const read = await app.inject({ url: `/api/projects/${projectId}/files/openapi.yaml`, headers });
  const doc = YAML.parse(read.json().content);
  mutate(doc);
  specWrite.saveSpecFile(projectId, 'openapi.yaml', YAML.stringify(doc), read.json().version, {
    type: 'user',
    ref: 'admin',
  });
}

test('an operation nobody has staged reads as design', async () => {
  const { byAddress } = await seedShop('Default');
  assert.deepEqual(
    [...byAddress.values()].map((o) => o.stage),
    ['design', 'design', 'design'],
  );
});

test('the stage list carries only what somebody has staged', async () => {
  const { projectId, byAddress } = await seedShop('StatusList');
  const empty = await app.inject({ url: `/api/projects/${projectId}/operations/status`, headers });
  assert.deepEqual(empty.json().statuses, [], 'an untouched project has no rows at all');

  const opId = byAddress.get('GET /orders').opId;
  await app.inject({
    method: 'PATCH',
    url: `/api/projects/${projectId}/operations/${opId}/status`,
    headers,
    payload: { stage: 'developing' },
  });

  const listed = await app.inject({ url: `/api/projects/${projectId}/operations/status`, headers });
  assert.deepEqual(listed.json().statuses, [{ opId, stage: 'developing' }]);
});

test('a stage survives the endpoint being renamed', async () => {
  const { projectId, byAddress } = await seedShop('Rename');
  const opId = byAddress.get('GET /orders').opId;
  await app.inject({
    method: 'PATCH',
    url: `/api/projects/${projectId}/operations/${opId}/status`,
    headers,
    payload: { stage: 'released' },
  });

  await editRoot(projectId, (doc) => {
    doc.paths['/v2/orders'] = doc.paths['/orders'];
    delete doc.paths['/orders'];
  });

  const listed = await app.inject({ url: `/api/projects/${projectId}/operations`, headers });
  const moved = listed.json().operations.find((o: any) => o.path === '/v2/orders' && o.method === 'get');
  assert.equal(moved.opId, opId, 'identity is the id, not the address');
  assert.equal(moved.stage, 'released');
});

test('an operation deleted from the spec drops its stage row', async () => {
  const { projectId, byAddress } = await seedShop('Prune');
  const doomed = byAddress.get('GET /drafts').opId;
  const kept = byAddress.get('GET /orders').opId;
  statusSvc.setStages(projectId, [doomed, kept], 'released', null);
  assert.equal(statusSvc.stageMap(projectId).size, 2);

  await editRoot(projectId, (doc) => delete doc.paths['/drafts']);

  assert.deepEqual([...statusSvc.stageMap(projectId).keys()], [kept], 'only the live operation keeps a row');
});

test('staging the whole project in one call is one request', async () => {
  const { projectId } = await seedShop('Bulk');
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/projects/${projectId}/operations/status`,
    headers,
    payload: { stage: 'released' },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().updated, 3);

  const listed = await app.inject({ url: `/api/projects/${projectId}/operations`, headers });
  assert.ok(listed.json().operations.every((o: any) => o.stage === 'released'));
});

// The design canvas mints an id and stages an endpoint before the save that first writes it, so a
// stage for an id the saved spec has never seen is a normal state, not an error.
test('an endpoint can be staged before the spec declares it', async () => {
  const { projectId } = await seedShop('Unsaved');
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/projects/${projectId}/operations/aaaaaaaaaaaa/status`,
    headers,
    payload: { stage: 'developing' },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(statusSvc.getStage(projectId, 'aaaaaaaaaaaa'), 'developing');

  await editRoot(projectId, () => {}); // the next save reconciles it away
  assert.equal(statusSvc.getStage(projectId, 'aaaaaaaaaaaa'), 'design');
});

// Re-importing the upstream export is the whole YApi migration workflow: the stages someone
// set here must not be collateral damage every time.
test('a stage outlives re-importing the same spec', async () => {
  const { projectId, byAddress } = await seedShop('Reimported');
  const opId = byAddress.get('GET /orders').opId;
  await app.inject({
    method: 'PATCH',
    url: `/api/projects/${projectId}/operations/${opId}/status`,
    headers,
    payload: { stage: 'developing' },
  });

  const again = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/import`,
    headers,
    payload: { content: SHOP.replace('title: Shop', 'title: Shop v2') },
  });
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(statusSvc.getStage(projectId, opId), 'developing');
});

test('an unknown stage is refused', async () => {
  const { projectId, byAddress } = await seedShop('BadStage');
  const opId = byAddress.get('GET /orders').opId;
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/projects/${projectId}/operations/${opId}/status`,
    headers,
    payload: { stage: 'shipped' },
  });
  assert.equal(res.statusCode, 400);
});

test('setting a stage writes no version — the contract history is the contract’s', async () => {
  const { projectId, byAddress } = await seedShop('History');
  const before = await app.inject({ url: `/api/projects/${projectId}/files/openapi.yaml`, headers });
  const opId = byAddress.get('GET /orders').opId;
  await app.inject({
    method: 'PATCH',
    url: `/api/projects/${projectId}/operations/${opId}/status`,
    headers,
    payload: { stage: 'released' },
  });
  const after = await app.inject({ url: `/api/projects/${projectId}/files/openapi.yaml`, headers });

  assert.equal(after.json().version, before.json().version);
  assert.equal(after.json().content, before.json().content);
});

test('a released-only export keeps the released endpoints and nothing they do not reach', async () => {
  const { projectId, byAddress } = await seedShop('Export');
  await app.inject({
    method: 'PATCH',
    url: `/api/projects/${projectId}/operations/${byAddress.get('GET /orders').opId}/status`,
    headers,
    payload: { stage: 'released' },
  });

  const res = await app.inject({ url: `/api/projects/${projectId}/spec.json?stage=released`, headers });
  const doc = res.json();

  assert.deepEqual(Object.keys(doc.paths), ['/orders'], 'a path with nothing left goes entirely');
  assert.deepEqual(Object.keys(doc.paths['/orders']), ['get'], 'the unreleased sibling is cut');
  assert.deepEqual(Object.keys(doc.components.schemas).sort(), ['Item', 'Order'], 'Item survives via Order');
  assert.ok(doc.components.securitySchemes.bearer, 'schemes are named, never $ref-ed — never shaken out');
  assert.deepEqual(
    doc.tags.map((t: any) => t.name),
    ['orders'],
    'a tag heading with nothing under it goes',
  );
});

test('deprecated earns an unreleased endpoint nothing', () => {
  const doc: any = {
    paths: { '/gone': { get: { 'x-apione-id': 'a1', deprecated: true }, post: { 'x-apione-id': 'a2' } } },
  };
  const { omitted } = specExport.keepReleased(doc, new Set(['a2']));
  assert.equal(omitted, 1);
  assert.deepEqual(Object.keys(doc.paths['/gone']), ['post']);
});

test('an endpoint with no id is never in a released export', () => {
  const doc: any = { paths: { '/fresh': { get: { summary: 'never saved through the App' } } } };
  const { omitted } = specExport.keepReleased(doc, new Set(['a1']));
  assert.equal(omitted, 1);
  assert.deepEqual(doc.paths, {});
});

test('the unfiltered export is still the whole document', async () => {
  const { projectId } = await seedShop('Whole');
  const res = await app.inject({ url: `/api/projects/${projectId}/spec.json`, headers });
  const doc = res.json();
  assert.deepEqual(Object.keys(doc.paths).sort(), ['/drafts', '/orders']);
  assert.ok(doc.components.schemas.Draft, 'nothing is shaken out when nothing is filtered');
});

test('?stage=released composes with ?strip=x', async () => {
  const { projectId, byAddress } = await seedShop('Both');
  await app.inject({
    method: 'PATCH',
    url: `/api/projects/${projectId}/operations/${byAddress.get('GET /orders').opId}/status`,
    headers,
    payload: { stage: 'released' },
  });

  const res = await app.inject({ url: `/api/projects/${projectId}/spec.json?stage=released&strip=x`, headers });
  const doc = res.json();
  assert.deepEqual(Object.keys(doc.paths), ['/orders'], 'filtering reads the ids before stripping removes them');
  assert.equal(JSON.stringify(doc).includes('x-apione-id'), false);
});

test('deleting a project takes its stage rows with it', async () => {
  const { projectId, byAddress } = await seedShop('Doomed');
  statusSvc.setStage(projectId, byAddress.get('GET /orders').opId, 'released', null);

  projectSvc.deleteProject(projectId);

  assert.equal(statusSvc.stageMap(projectId).size, 0);
});
