import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { bootApp, createProject } from './helpers.js';

let vault: typeof import('../src/storage/vault.js');
let app: FastifyInstance;
let h: Record<string, string>;
let projectId: string;
let otherProjectId: string;
let OUTSIDE: string;

before(async () => {
  const booted = await bootApp('apione-vaultguard-', { admin: { username: 'root' } });
  ({ app, headers: h } = booted);
  vault = await import('../src/storage/vault.js');
  OUTSIDE = path.join(booted.tmp, 'outside.yaml');
  fs.writeFileSync(OUTSIDE, 'secret: yes\n', 'utf8');

  projectId = (await createProject(app, h, 'A')).id;
  otherProjectId = (await createProject(app, h, 'B')).id;
});

test('the guard refuses anything that is not a plain relative path', () => {
  for (const bad of [
    '',
    '/etc/passwd',
    '..',
    '../outside.yaml',
    '../../etc/passwd',
    'a/../../outside.yaml',
    'nested/../../escape.yaml',
    `${path.sep}absolute.yaml`,
  ]) {
    assert.throws(() => vault.assertSafePath(bad), /path/, `assertSafePath accepted ${JSON.stringify(bad)}`);
  }
});

test('the guard allows the shapes a project legitimately uses', () => {
  for (const ok of ['openapi.yaml', 'parts/pets.yaml', 'a/b/c/deep.yaml', 'mocks/getThing.js', 'dot.in.name.yaml']) {
    assert.doesNotThrow(() => vault.assertSafePath(ok), `assertSafePath rejected ${JSON.stringify(ok)}`);
  }
});

test('resolving a path never lands outside its own project', () => {
  // The second line of defence: even a relative path the first check let through has to resolve
  // inside the project, so one project can never address another's files.
  assert.throws(() => vault.fileAbsPath(projectId, `../${otherProjectId}/openapi.yaml`), /escapes|traversal/);
  const inside = vault.fileAbsPath(projectId, 'parts/pets.yaml');
  assert.ok(inside.startsWith(vault.projectDir(projectId) + path.sep));
});

test('the file API refuses a traversing path instead of reading through it', async () => {
  // Percent-encoded so the traversal survives the router and reaches the guard as `..`.
  for (const target of ['..%2Foutside.yaml', '..%2F..%2Foutside.yaml', `..%2F${otherProjectId}%2Fopenapi.yaml`]) {
    const read = await app.inject({ url: `/api/projects/${projectId}/files/${target}`, headers: h });
    assert.notEqual(read.statusCode, 200, `GET ${target} returned a file`);
    assert.doesNotMatch(read.body, /secret: yes/);

    const write = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/files/${target}`,
      headers: h,
      payload: { content: 'openapi: 3.1.0\n', baseVersion: 0 },
    });
    assert.notEqual(write.statusCode, 200, `PUT ${target} was accepted`);
  }
  assert.equal(fs.readFileSync(OUTSIDE, 'utf8'), 'secret: yes\n', 'a write escaped the vault');
});
