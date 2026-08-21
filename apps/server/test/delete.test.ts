import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bootData } from './helpers.js';

let tmp: string;
let projectSvc: typeof import('../src/services/project-service.js');
let fileSvc: typeof import('../src/services/file-service.js');
let mockCfg: typeof import('../src/services/mock-config-service.js');
let statusSvc: typeof import('../src/services/operation-status-service.js');

before(async () => {
  tmp = await bootData('apione-del-');
  projectSvc = await import('../src/services/project-service.js');
  fileSvc = await import('../src/services/file-service.js');
  mockCfg = await import('../src/services/mock-config-service.js');
  statusSvc = await import('../src/services/operation-status-service.js');
});

test('deleteFile removes the file, its versions, and the disk file', () => {
  const p = projectSvc.createProject('DelFile');
  fileSvc.writeFile(p.id, 'openapi.yaml', 'openapi: 3.1.0\ninfo: {title: A, version: 1.0.0}\npaths: {}\n', 0);
  fileSvc.writeFile(p.id, 'schemas/User.yaml', 'type: object\n', 0);
  const abs = path.join(tmp, 'projects', p.id, 'schemas', 'User.yaml');
  assert.ok(fs.existsSync(abs));

  fileSvc.deleteFile(p.id, 'schemas/User.yaml');

  assert.equal(fs.existsSync(abs), false, 'disk file gone');
  assert.deepEqual(
    fileSvc.listFiles(p.id).map((f) => f.path),
    ['openapi.yaml'],
    'index row gone',
  );
  assert.throws(
    () => fileSvc.readFile(p.id, 'schemas/User.yaml'),
    (e: unknown) => e instanceof Error && (e as { code?: string }).code === 'not_found',
  );
});

test('deleteProject removes the project, its files, and the vault folder', () => {
  const p = projectSvc.createProject('DelProject');
  fileSvc.writeFile(p.id, 'openapi.yaml', 'openapi: 3.1.0\ninfo: {title: B, version: 1.0.0}\npaths: {}\n', 0);
  const dir = path.join(tmp, 'projects', p.id);
  assert.ok(fs.existsSync(dir));

  projectSvc.deleteProject(p.id);

  assert.equal(fs.existsSync(dir), false, 'vault folder gone');
  assert.equal(
    projectSvc.listProjects().some((x) => x.id === p.id),
    false,
    'project row gone',
  );
  assert.throws(
    () => projectSvc.getProject(p.id),
    (e: unknown) => e instanceof Error && (e as { code?: string }).code === 'not_found',
  );
});

// Foreign keys are enforced, so a table keyed to the project that delete forgets doesn't leave an
// orphan row behind — it makes the project undeletable.
test('deleteProject clears what its operations were keyed to', () => {
  const p = projectSvc.createProject('DelKeyed');
  fileSvc.writeFile(p.id, 'openapi.yaml', 'openapi: 3.1.0\ninfo: {title: C, version: 1.0.0}\npaths: {}\n', 0);
  mockCfg.setMode(p.id, 'abc123abc123', 'scripted');
  statusSvc.setStage(p.id, 'abc123abc123', 'released', null);

  projectSvc.deleteProject(p.id);

  assert.equal(
    projectSvc.listProjects().some((x) => x.id === p.id),
    false,
  );
});
