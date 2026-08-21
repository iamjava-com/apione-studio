import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { bootApp, createProject, putFile } from './helpers.js';

/**
 * The vault holds scripted mock sources next to spec files, because mocks reuse the single write
 * path to get concurrency and a version ledger. That is an internal arrangement; the spec file
 * API must not expose it. Before this guard, `GET /files` listed mock sources as if they were
 * fragments and `DELETE /files/mocks/<id>.js` silently destroyed someone's mock.
 */

let app: FastifyInstance;
let headers: Record<string, string>;
let projectId: string;
let opId: string;
let codePath: string;

before(async () => {
  ({ app, headers } = await bootApp('apione-mockguard-'));
  projectId = (await createProject(app, headers, 'Guarded')).id;
  await putFile(
    app,
    headers,
    projectId,
    'openapi.yaml',
    `openapi: 3.1.0\ninfo: { title: G, version: 1.0.0 }\npaths:\n  /a:\n    get:\n      responses: { '200': { description: ok } }\n`,
  );
  opId = (await app.inject({ url: `/api/projects/${projectId}/mock`, headers })).json().operations[0].opId;
  await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/mock/code`,
    headers,
    payload: { opId, content: 'export default () => ({ status: 200, body: {} })\n', baseVersion: 0 },
  });
  codePath = encodeURIComponent(`mocks/${opId}.js`);
});

test('the spec file listing holds spec files only', async () => {
  const files = (await app.inject({ url: `/api/projects/${projectId}/files`, headers })).json() as { path: string }[];
  assert.ok(files.some((f) => f.path === 'openapi.yaml'));
  assert.ok(!files.some((f) => f.path.startsWith('mocks/')), 'mock sources are the mock API’s, not this one’s');
});

test('mock source cannot be read as a spec file', async () => {
  const r = await app.inject({ url: `/api/projects/${projectId}/files/${codePath}`, headers });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().error, 'mock_path_reserved');
});

// The one that actually loses data: a caller tidying up "stray files" wipes a teammate's mock.
test('mock source cannot be deleted through the spec file route', async () => {
  const r = await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}/files/${codePath}`, headers });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().error, 'mock_path_reserved');
  const catalog = (await app.inject({ url: `/api/projects/${projectId}/mock`, headers })).json();
  assert.equal(catalog.operations[0].hasCode, true, 'the mock survived');
});

test('the whole mocks/ directory is reserved, not just files that parse as mocks', async () => {
  const r = await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/files/mocks%2Fnotes.yaml`,
    headers,
    payload: { content: 'openapi: 3.1.0\n', baseVersion: 0 },
  });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().error, 'mock_path_reserved');
});

test('history routes are guarded too — no reading or restoring mock source through them', async () => {
  const list = await app.inject({ url: `/api/projects/${projectId}/versions?path=mocks%2F${opId}.js`, headers });
  assert.equal(list.statusCode, 400);
  const one = await app.inject({ url: `/api/projects/${projectId}/versions/1?path=mocks%2F${opId}.js`, headers });
  assert.equal(one.statusCode, 400);
  const restore = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/restore`,
    headers,
    payload: { path: `mocks/${opId}.js`, versionNo: 1 },
  });
  assert.equal(restore.statusCode, 400);
});

test('the mock API still reaches its own storage', async () => {
  const r = await app.inject({ url: `/api/projects/${projectId}/mock/code?opId=${opId}`, headers });
  assert.equal(r.statusCode, 200);
  assert.match(r.json().content, /export default/);
});
