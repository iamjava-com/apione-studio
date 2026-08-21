import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { bootData } from './helpers.js';

let svc: typeof import('../src/services/project-service.js');

before(async () => {
  await bootData('apione-proj-');
  svc = await import('../src/services/project-service.js');
});

test('a project is created with a name and an opaque id', () => {
  const p = svc.createProject('My Cool API');
  assert.equal(p.name, 'My Cool API');
  assert.match(p.id, /^[0-9a-f-]{36}$/); // uuid — the only identifier
});

test('the name is trimmed; a blank name is rejected', () => {
  assert.equal(svc.createProject('  Spaced  ').name, 'Spaced');
  assert.throws(
    () => svc.createProject('   '),
    (e: unknown) => e instanceof Error && (e as { statusCode?: number }).statusCode === 400,
  );
});

test('renaming changes the name but keeps the id fixed', () => {
  const p = svc.createProject('Original Name');
  const renamed = svc.renameProject(p.id, '  New Name  ');
  assert.equal(renamed.name, 'New Name'); // trimmed
  assert.equal(renamed.id, p.id); // id is stable across renames
});

test('renaming to a blank name is rejected', () => {
  const p = svc.createProject('Rename Me');
  assert.throws(
    () => svc.renameProject(p.id, '  '),
    (e: unknown) => e instanceof Error && (e as { statusCode?: number }).statusCode === 400,
  );
});
