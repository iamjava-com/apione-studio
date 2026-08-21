/**
 * Mocks are stored under their operation's id, so a rename moves nothing, and keeping the two in
 * step is a set comparison against the spec rather than a diff of what changed. These tests come
 * at that from every direction a document can be edited — the App, by hand, an import, a restore
 * — because the whole point of reconciling against state is that the route in doesn't matter.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { FastifyInstance } from 'fastify';
import { bootApp, createProject, putFile } from './helpers.js';
import { opIdOf as opIdOfCtx, putSpec as putSpecCtx, scriptedMock, type MockCtx } from './mock-helpers.js';

const ID = 'x-apione-id';

const spec = (paths: string) => `openapi: 3.1.0
info: { title: T, version: 1.0.0 }
paths:
${paths}`;

const OP = (summary = 'get one') => `    get:
      summary: ${summary}
      responses:
        '200': { description: ok }`;

let tmp: string;
let app: FastifyInstance;
let h: Record<string, string>;
let projectId: string;
/** Shared-helper context; `projectId` is re-pointed by every `newProject`. */
const ctx = {} as MockCtx;

/* eslint-disable @typescript-eslint/no-explicit-any */
const readSpec = async () =>
  (await app.inject({ url: `/api/projects/${projectId}/files/openapi.yaml`, headers: h })).json();
const specDoc = async (): Promise<any> => YAML.parse((await readSpec()).content);

const putSpec = (content: string) => putSpecCtx(ctx, content);

/** Edit the parsed document and save it — what both editors ultimately do, ids and all. */
const editSpec = async (mutate: (doc: any) => void) => {
  const doc = await specDoc();
  mutate(doc);
  return putSpec(YAML.stringify(doc));
};

const catalog = async () => (await app.inject({ url: `/api/projects/${projectId}/mock`, headers: h })).json();

const findOp = async (method: string, p: string) =>
  (await catalog()).operations.find((o: { method: string; path: string }) => o.method === method && o.path === p);

const opIdOf = (method: string, p: string) => opIdOfCtx(ctx, method, p);

const readCodeById = async (opId: string) =>
  (await app.inject({ url: `/api/projects/${projectId}/mock/code?opId=${opId}`, headers: h })).json().content;

const readCode = async (method: string, p: string) => readCodeById(await opIdOf(method, p));

/** Straight off disk, which is where the answer actually lives. (Not via GET /files — that route
 *  owns spec files and deliberately refuses the mocks/ subtree; see mock-path-guard.test.ts.) */
const mockFiles = (): string[] => {
  try {
    return fs
      .readdirSync(path.join(tmp, 'projects', projectId, 'mocks'))
      .map((f) => `mocks/${f}`)
      .sort();
  } catch {
    return []; // no mocks directory yet — nothing has ever been stored
  }
};

const newProject = async (paths: string) => {
  projectId = (await createProject(app, h, 'B')).id;
  ctx.projectId = projectId;
  await putFile(app, h, projectId, 'openapi.yaml', spec(paths));
};

/** Switch an operation to scripted and give it code. */
const mockUp = (method: string, p: string, code: string) => scriptedMock(ctx, method, p, code);

before(async () => {
  ({ app, tmp, headers: h } = await bootApp('apione-binding-'));
  ctx.app = app;
  ctx.headers = h;
});

test('every operation gets an id on the very first save', async () => {
  await newProject(`  /a:\n${OP()}\n  /b:\n${OP('two')}\n`);

  const doc = await specDoc();
  assert.match(doc.paths['/a'].get[ID], /^[0-9a-f]{12}$/);
  assert.match(doc.paths['/b'].get[ID], /^[0-9a-f]{12}$/);
  assert.notEqual(doc.paths['/a'].get[ID], doc.paths['/b'].get[ID]);
});

test('ids are stable across edits — an ordinary save re-mints nothing', async () => {
  await newProject(`  /a:\n${OP()}\n`);
  const first = (await specDoc()).paths['/a'].get[ID];
  const version = (await readSpec()).version;

  await editSpec((d) => (d.paths['/a'].get.summary = 'edited'));
  assert.equal((await specDoc()).paths['/a'].get[ID], first);

  await editSpec(() => {});
  assert.equal((await readSpec()).version, version + 1, 'a no-op save mints no phantom version');
});

test('a mock is stored under its operation id, and a rename moves nothing at all', async () => {
  await newProject(`  /users/{id}:\n${OP()}\n`);
  const opId = await mockUp('get', '/users/{id}', 'export default () => ({ status: 201 });\n');
  assert.deepEqual(mockFiles(), [`mocks/${opId}.js`]);

  await editSpec((d) => {
    d.paths['/people/{id}'] = d.paths['/users/{id}'];
    delete d.paths['/users/{id}'];
  });

  assert.deepEqual(mockFiles(), [`mocks/${opId}.js`], 'nothing on disk had to change');
  assert.equal((await findOp('get', '/people/{id}')).opId, opId);
  assert.equal((await findOp('get', '/people/{id}')).mode, 'scripted');
  assert.match(await readCodeById(opId), /status: 201/);

  assert.equal((await app.inject({ url: `/mock/${projectId}/people/7` })).statusCode, 201);
  assert.equal((await app.inject({ url: `/mock/${projectId}/users/7` })).statusCode, 404);
});

test('path, method and body can all change at once', async () => {
  await newProject(`  /a:\n${OP('before')}\n  /b:\n${OP('before')}\n`);
  const idA = await mockUp('get', '/a', 'export default () => ({ status: 210 });\n');
  const idB = await mockUp('get', '/b', 'export default () => ({ status: 220 });\n');

  await editSpec((d) => {
    const a = d.paths['/a'].get;
    const b = d.paths['/b'].get;
    a.summary = 'rewritten';
    b.summary = 'also rewritten';
    b.responses = { '204': { description: 'gone' } };
    d.paths = { '/alpha': { post: a }, '/beta': { get: b } };
  });

  assert.equal((await findOp('post', '/alpha')).opId, idA);
  assert.equal((await findOp('get', '/beta')).opId, idB);
  assert.match(await readCodeById(idA), /status: 210/);
  assert.match(await readCodeById(idB), /status: 220/);
});

test('deleting an operation deletes its mock; an unrelated new one gets nothing', async () => {
  await newProject(`  /legacy-report:\n${OP('the old report')}\n`);
  const gone = await mockUp('get', '/legacy-report', 'export default () => ({ body: { report: true } });\n');

  await editSpec((d) => {
    delete d.paths['/legacy-report'];
    d.paths['/billing/invoices'] = {
      post: { summary: 'create an invoice', responses: { '201': { description: 'created' } } },
    };
  });

  assert.deepEqual(mockFiles(), []);
  assert.equal((await findOp('post', '/billing/invoices')).mode, 'auto');
  assert.notEqual((await findOp('post', '/billing/invoices')).opId, gone);
  assert.equal((await app.inject({ method: 'POST', url: `/mock/${projectId}/billing/invoices` })).statusCode, 201);
});

test('a deleted id loses the mock rather than handing it to another operation', async () => {
  await newProject(`  /a:\n${OP()}\n`);
  await mockUp('get', '/a', 'export default () => ({ status: 230 });\n');

  await editSpec((d) => {
    delete d.paths['/a'].get[ID]; // the author wiped a field they didn't recognize
    d.paths['/z'] = d.paths['/a'];
    delete d.paths['/a'];
  });

  assert.deepEqual(mockFiles(), [], 'the unidentifiable mock went, rather than binding wrongly');
  assert.equal((await findOp('get', '/z')).mode, 'auto');
  assert.equal(await readCode('get', '/z'), '');

  // and starting over mints a fresh id, so the loss isn't sticky
  const again = await mockUp('get', '/z', 'export default () => ({ status: 231 });\n');
  assert.deepEqual(mockFiles(), [`mocks/${again}.js`]);
});

test('a duplicated id is broken up rather than believed', async () => {
  await newProject(`  /a:\n${OP()}\n`);
  const opId = await mockUp('get', '/a', 'export default () => ({ status: 240 });\n');

  await editSpec((d) => {
    d.paths['/copy'] = { get: structuredClone(d.paths['/a'].get) }; // copy-paste, id and all
  });

  const doc = await specDoc();
  assert.equal(doc.paths['/a'].get[ID], opId, 'the original keeps its id');
  assert.notEqual(doc.paths['/copy'].get[ID], opId, 'the copy got its own');
  assert.match(await readCodeById(opId), /status: 240/);
  assert.equal(await readCode('get', '/copy'), '');
});

test('editing the spec by hand, outside the App, keeps the mock attached', async () => {
  await newProject(`  /a:\n${OP()}\n`);
  const opId = await mockUp('get', '/a', 'export default () => ({ body: { precious: true } });\n');

  // the author's own editor, on the file in the vault — no write path of ours involved
  const abs = path.join(tmp, 'projects', projectId, 'openapi.yaml');
  fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replace('/a:', '/renamed:'), 'utf8');

  assert.equal((await findOp('get', '/renamed')).opId, opId);
  assert.equal((await findOp('get', '/renamed')).mode, 'scripted');
  assert.deepEqual((await app.inject({ url: `/mock/${projectId}/renamed` })).json(), { precious: true });

  // and a later save through the App doesn't mistake it for a vanished operation
  await editSpec((d) => (d.info.version = '1.0.1'));
  assert.deepEqual(mockFiles(), [`mocks/${opId}.js`]);
  assert.match(await readCodeById(opId), /precious/);
});

test('an overwrite-import keeps mocks attached, and drops the ones it removed', async () => {
  await newProject(`  /a:\n${OP()}\n  /gone:\n${OP('two')}\n`);
  const kept = await mockUp('get', '/a', 'export default () => ({ status: 320 });\n');
  await mockUp('get', '/gone', 'export default () => ({ status: 321 });\n');

  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/import`,
    headers: h,
    payload: {
      content: JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'B', version: '2.0.0' },
        paths: { '/renamed': { get: { [ID]: kept, responses: { '200': { description: 'ok' } } } } },
      }),
    },
  });
  assert.equal(res.statusCode, 200, res.body);

  assert.equal((await findOp('get', '/renamed')).opId, kept);
  assert.match(await readCodeById(kept), /status: 320/);
  assert.deepEqual(mockFiles(), [`mocks/${kept}.js`], 'the removed operation took its mock');
});

test('restoring an old version restores the mocks that version had', async () => {
  await newProject(`  /v1:\n${OP()}\n`);
  const opId = await mockUp('get', '/v1', 'export default () => ({ status: 270 });\n');
  const stamped = (await readSpec()).version;

  await editSpec((d) => delete d.paths['/v1']);
  assert.deepEqual(mockFiles(), [], 'deleting it took the mock');

  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/restore`,
    headers: h,
    payload: { path: 'openapi.yaml', versionNo: stamped },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().restoredFrom, stamped, 'still recorded as a restore, for the history panel');

  // the operation is back with the same id; its code was destroyed with it and does not return
  assert.equal((await findOp('get', '/v1')).opId, opId);
  assert.equal((await findOp('get', '/v1')).mode, 'auto');
});

test('a fragmented spec is never taken as proof an operation is gone', async () => {
  await newProject(`  /here:\n${OP()}\n`);
  const opId = await mockUp('get', '/here', 'export default () => ({ status: 310 });\n');

  // paths pushed into another file: the root can't see them, so it can't judge what is stale
  await editSpec((d) => (d.paths['/elsewhere'] = { $ref: './paths/elsewhere.yaml' }));

  assert.deepEqual(mockFiles(), [`mocks/${opId}.js`], 'kept, not swept');
});

test('export is the whole document by default; opting out drops every x- extension', async () => {
  await newProject(`  /e:\n${OP()}\n`);
  await mockUp('get', '/e', 'export default () => ({ status: 290 });\n');
  await editSpec((d) => (d.paths['/e'].get['x-team'] = 'payments')); // the author's own extension

  const full = await app.inject({ url: `/api/projects/${projectId}/spec.json`, headers: h });
  assert.match(full.json().paths['/e'].get[ID], /^[0-9a-f]{12}$/, 'nothing is redacted by default');
  assert.equal(full.json().paths['/e'].get['x-team'], 'payments');

  const clean = await app.inject({ url: `/api/projects/${projectId}/spec.json?strip=x`, headers: h });
  assert.equal(clean.json().paths['/e'].get[ID], undefined);
  assert.equal(clean.json().paths['/e'].get['x-team'], undefined, 'every extension, not only ours');
  assert.equal(clean.body.includes('x-'), false);
});

test('an operation with no id yet is not offered a mock', async () => {
  await newProject(`  /known:\n${OP()}\n`);

  // added to the file outside the App, so nothing has minted an id for it
  const abs = path.join(tmp, 'projects', projectId, 'openapi.yaml');
  fs.writeFileSync(
    abs,
    `${fs.readFileSync(abs, 'utf8')}  /unsaved:\n    get:\n      responses:\n        "200": { description: ok }\n`,
    'utf8',
  );

  const paths = (await catalog()).operations.map((o: { path: string }) => o.path);
  assert.deepEqual(paths, ['/known'], 'listing it would only produce a mock with nowhere to live');

  // a save mints one, and then it is offered
  await editSpec(() => {});
  assert.deepEqual((await catalog()).operations.map((o: { path: string }) => o.path).sort(), ['/known', '/unsaved']);
});
