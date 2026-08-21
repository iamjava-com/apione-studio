import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bootData } from './helpers.js';

let projectSvc: typeof import('../src/services/project-service.js');
let fileSvc: typeof import('../src/services/file-service.js');
let vault: typeof import('../src/storage/vault.js');

before(async () => {
  await bootData('apione-filesvc-');
  projectSvc = await import('../src/services/project-service.js');
  fileSvc = await import('../src/services/file-service.js');
  vault = await import('../src/storage/vault.js');
});

test('create project + write new file → v1, canonicalized', () => {
  const p = projectSvc.createProject('Demo API');
  const r = fileSvc.writeFile(p.id, 'openapi.yaml', 'openapi: 3.1.0\ninfo:\n  title: Demo\n  version: 1.0.0\n', 0);
  assert.equal(r.version, 1);
  // canonical preserves authored key order (not sorted): "openapi" stays first
  assert.match(r.content, /^openapi:/);
  const read = fileSvc.readFile(p.id, 'openapi.yaml');
  assert.equal(read.version, 1);
  assert.equal(read.content, r.content);
});

test('no-op save (identical content) does not mint a phantom version', () => {
  const p = projectSvc.createProject('NoOp');
  const spec = 'openapi: 3.1.0\ninfo: { title: N, version: 1.0.0 }\npaths: {}\n';
  const v1 = fileSvc.writeFile(p.id, 'openapi.yaml', spec, 0);
  assert.equal(v1.version, 1);
  const again = fileSvc.writeFile(p.id, 'openapi.yaml', spec, 1); // same content at the current base
  assert.equal(again.version, 1, 'unchanged content keeps the same version');
  assert.equal(fileSvc.listVersions(p.id, 'openapi.yaml').versions.length, 1);
});

test('canonical preserves authored order (drag-reorder survives save)', () => {
  const p = projectSvc.createProject('Order');
  const spec = 'openapi: 3.1.0\ninfo: { title: O, version: 1.0.0 }\npaths:\n  /zebra: {}\n  /apple: {}\n';
  const r = fileSvc.writeFile(p.id, 'openapi.yaml', spec, 0);
  // /zebra was authored before /apple → it stays first (would be reversed if sorted)
  assert.ok(r.content.indexOf('/zebra') < r.content.indexOf('/apple'), r.content);
});

test('optimistic concurrency: stale baseVersion → 409 conflict', () => {
  const p = projectSvc.createProject('Concurrency');
  fileSvc.writeFile(p.id, 'openapi.yaml', 'openapi: 3.1.0\ninfo: { title: A, version: 1.0.0 }\n', 0);
  // correct base advances to v2
  const v2 = fileSvc.writeFile(p.id, 'openapi.yaml', 'openapi: 3.1.0\ninfo: { title: B, version: 1.0.0 }\n', 1);
  assert.equal(v2.version, 2);
  // stale base (1) now conflicts
  assert.throws(
    () => fileSvc.writeFile(p.id, 'openapi.yaml', 'openapi: 3.1.0\ninfo: { title: C, version: 1.0.0 }\n', 1),
    (e: unknown) => e instanceof Error && (e as { statusCode?: number }).statusCode === 409,
  );
});

test('reconcile-on-access: external disk edit is absorbed as a new version', () => {
  const p = projectSvc.createProject('Reconcile');
  fileSvc.writeFile(p.id, 'openapi.yaml', 'openapi: 3.1.0\ninfo: { title: X, version: 1.0.0 }\n', 0);
  // simulate an external editor / git pull writing the file directly
  const abs = vault.fileAbsPath(p.id, 'openapi.yaml');
  fs.writeFileSync(abs, 'openapi: 3.1.0\ninfo: { title: EDITED-EXTERNALLY, version: 2.0.0 }\n', 'utf8');

  const read = fileSvc.readFile(p.id, 'openapi.yaml');
  assert.equal(read.version, 2, 'external edit should bump to v2');
  assert.match(read.content, /EDITED-EXTERNALLY/);

  const hist = fileSvc.listVersions(p.id, 'openapi.yaml');
  const v2 = hist.versions.find((v) => v.versionNo === 2);
  assert.equal(v2?.authorType, 'external');
});

test('restore: old version content comes back as a new version', () => {
  const p = projectSvc.createProject('Restore');
  const v1 = fileSvc.writeFile(p.id, 'openapi.yaml', 'openapi: 3.1.0\ninfo: { title: ONE, version: 1.0.0 }\n', 0);
  fileSvc.writeFile(p.id, 'openapi.yaml', 'openapi: 3.1.0\ninfo: { title: TWO, version: 1.0.0 }\n', 1);

  const restored = fileSvc.restoreVersion(p.id, 'openapi.yaml', 1, { type: 'restore', ref: 'alice' });
  assert.equal(restored.version, 3, 'restore appends a new version');
  assert.equal(restored.content, v1.content, 'content matches v1');

  const read = fileSvc.readFile(p.id, 'openapi.yaml');
  assert.match(read.content, /ONE/);

  const v3 = fileSvc.listVersions(p.id, 'openapi.yaml').versions.find((v) => v.versionNo === 3);
  assert.equal(v3?.authorType, 'restore');
  assert.equal(v3?.authorRef, 'alice', 'restore records who did it');
  assert.equal(v3?.sourceVersion, 1, 'restore records which version it came from');
});
