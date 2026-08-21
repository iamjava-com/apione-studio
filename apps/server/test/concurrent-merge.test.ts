import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { bootData } from './helpers.js';

let projectSvc: typeof import('../src/services/project-service.js');
let fileSvc: typeof import('../src/services/file-service.js');

before(async () => {
  await bootData('apione-merge-');
  projectSvc = await import('../src/services/project-service.js');
  fileSvc = await import('../src/services/file-service.js');
});

const doc = (paths: string) => `openapi: 3.1.0\ninfo:\n  title: T\n  version: 1.0.0\npaths:\n${paths}`;
const isConflict = (e: unknown) => e instanceof Error && (e as { statusCode?: number }).statusCode === 409;

/** Seed a file at v1 and hand back the project id — both writers then save against base 1. */
function seed(name: string, content: string) {
  const p = projectSvc.createProject(name);
  const v1 = fileSvc.writeFile(p.id, 'openapi.yaml', content, 0);
  assert.equal(v1.version, 1);
  return p.id;
}

test('different endpoints: the second save merges instead of conflicting', () => {
  const id = seed('Disjoint', doc('  /users:\n    get:\n      summary: list users\n'));

  fileSvc.writeFile(
    id,
    'openapi.yaml',
    doc('  /users:\n    get:\n      summary: list users\n    post:\n      summary: create user\n'),
    1,
  );
  const bob = fileSvc.writeFile(
    id,
    'openapi.yaml',
    doc('  /users:\n    get:\n      summary: list users\n  /orders:\n    get:\n      summary: list orders\n'),
    1,
  );

  assert.equal(bob.version, 3);
  assert.match(bob.content, /create user/, "alice's endpoint survives");
  assert.match(bob.content, /list orders/, "bob's endpoint is written");
});

test('different fields of the same operation still merge', () => {
  const id = seed('SameOp', doc('  /users:\n    get:\n      summary: list\n'));

  fileSvc.writeFile(id, 'openapi.yaml', doc('  /users:\n    get:\n      summary: list all users\n'), 1);
  const bob = fileSvc.writeFile(
    id,
    'openapi.yaml',
    doc('  /users:\n    get:\n      summary: list\n      operationId: listUsers\n'),
    1,
  );

  assert.match(bob.content, /list all users/);
  assert.match(bob.content, /listUsers/);
});

test('same field, different values → conflict', () => {
  const id = seed('Overlap', doc('  /users:\n    get:\n      summary: list\n'));

  fileSvc.writeFile(id, 'openapi.yaml', doc('  /users:\n    get:\n      summary: alice wording\n'), 1);
  assert.throws(
    () => fileSvc.writeFile(id, 'openapi.yaml', doc('  /users:\n    get:\n      summary: bob wording\n'), 1),
    isConflict,
  );
});

test('same field, same value → not a conflict', () => {
  const id = seed('Agree', doc('  /users:\n    get:\n      summary: list\n'));

  fileSvc.writeFile(id, 'openapi.yaml', doc('  /users:\n    get:\n      summary: agreed\n'), 1);
  const bob = fileSvc.writeFile(id, 'openapi.yaml', doc('  /users:\n    get:\n      summary: agreed\n'), 1);
  assert.match(bob.content, /agreed/);
});

test('arrays are atomic: both sides editing one list conflicts', () => {
  const base = doc('  /users:\n    get:\n      tags: [a]\n');
  const id = seed('Arrays', base);

  fileSvc.writeFile(id, 'openapi.yaml', doc('  /users:\n    get:\n      tags: [a, alice]\n'), 1);
  assert.throws(
    () => fileSvc.writeFile(id, 'openapi.yaml', doc('  /users:\n    get:\n      tags: [a, bob]\n'), 1),
    isConflict,
  );
});

test('deleting an endpoint the other side edited conflicts; deleting an untouched one does not', () => {
  const base = doc('  /users:\n    get:\n      summary: list\n  /legacy:\n    get:\n      summary: old\n');

  const edited = seed('DeleteEdit', base);
  fileSvc.writeFile(
    edited,
    'openapi.yaml',
    doc('  /users:\n    get:\n      summary: list\n  /legacy:\n    get:\n      summary: still used\n'),
    1,
  );
  assert.throws(
    () => fileSvc.writeFile(edited, 'openapi.yaml', doc('  /users:\n    get:\n      summary: list\n'), 1),
    isConflict,
  );

  const untouched = seed('DeleteClean', base);
  fileSvc.writeFile(
    untouched,
    'openapi.yaml',
    doc('  /users:\n    get:\n      summary: list users\n  /legacy:\n    get:\n      summary: old\n'),
    1,
  );
  const dropped = fileSvc.writeFile(untouched, 'openapi.yaml', doc('  /users:\n    get:\n      summary: list\n'), 1);
  assert.doesNotMatch(dropped.content, /\/legacy/);
  assert.match(dropped.content, /list users/, "the other side's edit survives the deletion");
});

test('a reorder survives a concurrent edit elsewhere', () => {
  const id = seed('Reorder', doc('  /a:\n    get:\n      summary: a\n  /b:\n    get:\n      summary: b\n'));

  fileSvc.writeFile(
    id,
    'openapi.yaml',
    doc('  /a:\n    get:\n      summary: a edited\n  /b:\n    get:\n      summary: b\n'),
    1,
  );
  const reordered = fileSvc.writeFile(
    id,
    'openapi.yaml',
    doc('  /b:\n    get:\n      summary: b\n  /a:\n    get:\n      summary: a\n'),
    1,
  );

  assert.ok(reordered.content.indexOf('/b') < reordered.content.indexOf('/a'), reordered.content);
  assert.match(reordered.content, /a edited/);
});

// The open editor's side of the same merge: same trees, same verdict, nothing written.
test('rebase replays an unsaved document onto the current version without saving it', () => {
  const id = seed('Rebase', doc('  /users:\n    get:\n      summary: list\n'));
  fileSvc.writeFile(id, 'openapi.yaml', doc('  /users:\n    get:\n      summary: list\n  /orders:\n    get: {}\n'), 1);

  const r = fileSvc.rebaseFile(
    id,
    'openapi.yaml',
    doc('  /users:\n    get:\n      summary: list\n      operationId: listUsers\n'),
    1,
  );

  assert.equal(r.version, 2, 'reports where the file is, not a new version');
  assert.match(r.content, /listUsers/, 'the unsaved edit is kept');
  assert.match(r.content, /\/orders/, "and lands on top of the other author's save");
  assert.doesNotMatch(r.head, /listUsers/, 'head is the file as saved, so the caller still knows it is dirty');
  assert.equal(fileSvc.listVersions(id, 'openapi.yaml').currentVersion, 2, 'no version minted');
});

test('rebase refuses an overlapping edit with the same 409 the save would give', () => {
  const id = seed('RebaseOverlap', doc('  /users:\n    get:\n      summary: list\n'));
  fileSvc.writeFile(id, 'openapi.yaml', doc('  /users:\n    get:\n      summary: alice wording\n'), 1);

  assert.throws(
    () => fileSvc.rebaseFile(id, 'openapi.yaml', doc('  /users:\n    get:\n      summary: bob wording\n'), 1),
    isConflict,
  );
});

test('code sidecars have no structure to merge on: stale base still conflicts', () => {
  const p = projectSvc.createProject('Sidecar');
  const js = '.apione/mocks/op-1.js';
  fileSvc.writeFile(p.id, js, 'export default () => 1;\n', 0);
  fileSvc.writeFile(p.id, js, 'export default () => 2;\n', 1);
  assert.throws(() => fileSvc.writeFile(p.id, js, 'export default () => 3;\n', 1), isConflict);
});
