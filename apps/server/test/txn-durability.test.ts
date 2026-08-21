import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bootData } from './helpers.js';

let tmp: string;
let projectSvc: typeof import('../src/services/project-service.js');
let fileSvc: typeof import('../src/services/file-service.js');
let txn: typeof import('../src/db/txn.js');
let vault: typeof import('../src/storage/vault.js');

before(async () => {
  tmp = await bootData('apione-txn-');
  projectSvc = await import('../src/services/project-service.js');
  fileSvc = await import('../src/services/file-service.js');
  txn = await import('../src/db/txn.js');
  vault = await import('../src/storage/vault.js');
});

const SPEC = 'openapi: 3.1.0\ninfo: { title: T, version: 1.0.0 }\npaths: {}\n';

test('a delete inside a transaction that rolls back leaves the file alone', () => {
  // This is the shape that matters: pruning a retired mock happens inside the spec save that
  // retired it, so an unlink there would outlive a rollback and strand the row it belongs to.
  const p = projectSvc.createProject('Rollback');
  const written = fileSvc.writeFile(p.id, 'openapi.yaml', SPEC, 0);
  const abs = path.join(tmp, 'projects', p.id, 'openapi.yaml');
  assert.ok(fs.existsSync(abs));

  assert.throws(() =>
    txn.transact(() => {
      fileSvc.deleteFile(p.id, 'openapi.yaml');
      throw new Error('the enclosing work failed');
    }),
  );

  assert.ok(fs.existsSync(abs), 'the file was removed by a transaction that did not commit');
  assert.equal(fileSvc.readFile(p.id, 'openapi.yaml').content, written.content, 'and its row still resolves');
});

// The committed-delete and project-delete paths are covered in delete.test.ts — this file keeps
// only what is unique to the transaction machinery: rollback and temp-file hygiene.

test('a write leaves no temp file behind, whether it succeeds or fails', () => {
  const p = projectSvc.createProject('Temp files');
  fileSvc.writeFile(p.id, 'openapi.yaml', SPEC, 0);
  const dir = path.join(tmp, 'projects', p.id);
  assert.deepEqual(fs.readdirSync(dir), ['openapi.yaml']);

  // A directory where the file should go: the write cannot finish, and must still clean up.
  const blocked = path.join(dir, 'blocked.yaml');
  fs.mkdirSync(blocked);
  assert.throws(() => vault.writeFileAtomic(blocked, 'x'));
  assert.deepEqual(
    fs.readdirSync(dir).filter((n) => n.includes('.tmp-')),
    [],
    'a failed write left its temp file in the vault',
  );
});
