import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { bootData } from './helpers.js';

let authSvc: typeof import('../src/services/auth-service.js');
let db: typeof import('../src/db/client.js').db;
let users: typeof import('../src/db/schema.js').users;

before(async () => {
  await bootData('apione-pw-');
  authSvc = await import('../src/services/auth-service.js');
  ({ db } = await import('../src/db/client.js'));
  ({ users } = await import('../src/db/schema.js'));
});

const hashOf = (id: string) => db.select().from(users).where(eq(users.id, id)).get()!.passwordHash;

test('passwords are stored as salted argon2id hashes — never reversible plaintext', async () => {
  const alice = await authSvc.createUser('alice', 'secret12', 'admin');
  const bob = await authSvc.createUser('bob', 'secret12', 'member'); // same password on purpose
  const ha = hashOf(alice.id);

  assert.match(ha, /^\$argon2id\$v=\d+\$m=\d+,t=\d+,p=\d+\$/); // standard argon2id PHC string
  assert.ok(!ha.includes('secret12')); // no plaintext
  assert.notEqual(ha, hashOf(bob.id)); // per-hash salt: same password → different hash

  assert.equal(await authSvc.verifyPassword('secret12', ha), true);
  assert.equal(await authSvc.verifyPassword('wrong', ha), false);
  assert.equal(await authSvc.verifyPassword('secret12', 'garbage'), false); // malformed → no match, no throw
});

test('password policy: length 8–128 enforced on create + reset, with distinct codes', async () => {
  await assert.rejects(authSvc.createUser('shorty', 'secret1'), { code: 'password_too_short' }); // 7 chars
  await assert.rejects(authSvc.createUser('longy', 'x'.repeat(129)), { code: 'password_too_long' });

  const ok = await authSvc.createUser('carol', 'exactly8'); // 8 chars → allowed
  await assert.rejects(authSvc.resetPassword(ok.id, 'short7!'), { code: 'password_too_short' });
  await authSvc.resetPassword(ok.id, 'x'.repeat(128)); // 128 → allowed (boundary)
});
