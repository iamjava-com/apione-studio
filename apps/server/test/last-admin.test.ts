import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { bootData } from './helpers.js';

// The last-active-admin invariant can't be reached over HTTP (removing the last admin would require
// the actor to BE that admin, which the self-guard blocks first) — so it's asserted at the service
// layer, where an arbitrary actor id can drive the exact edge the invariant defends.
let authSvc: typeof import('../src/services/auth-service.js');
let soloId: string;
let memberId: string;

before(async () => {
  await bootData('apione-lastadmin-');
  authSvc = await import('../src/services/auth-service.js');
  soloId = (await authSvc.createUser('solo', 'secret12', 'admin')).id; // the only admin
  memberId = (await authSvc.createUser('member', 'secret12', 'member')).id;
});

const isConflict = (fn: () => void) => {
  try {
    fn();
    return false;
  } catch (e) {
    return (e as { statusCode?: number }).statusCode === 409;
  }
};

test('the last active admin cannot be demoted, disabled, or deleted', () => {
  const other = 'someone-else';
  assert.ok(
    isConflict(() => authSvc.setUserRole(soloId, 'member', other)),
    'demote blocked',
  );
  assert.ok(
    isConflict(() => authSvc.setUserStatus(soloId, 'disabled', other)),
    'disable blocked',
  );
  assert.ok(
    isConflict(() => authSvc.deleteUser(soloId, other)),
    'delete blocked',
  );
});

test('a second admin lifts the invariant; then it re-arms on the remaining one', () => {
  authSvc.setUserRole(memberId, 'admin', soloId); // now two admins
  // With two admins, demoting solo is fine.
  authSvc.setUserRole(soloId, 'member', 'someone-else');
  // member is the last admin again — now protected.
  assert.ok(isConflict(() => authSvc.setUserStatus(memberId, 'disabled', 'someone-else')));
});
