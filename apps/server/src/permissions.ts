/**
 * Atomic project permissions — a role is a set of these, not a rung on a ladder.
 * Route guards ask for a permission, never for a role, so adding a role (e.g. Tester) or moving
 * a capability between roles touches only the map below and no call site.
 *
 * `mock:invoke` (calling /mock/{id}/*) is deliberately absent: it is a runtime capability open to
 * everyone including non-members and anonymous callers, so it is never role-granted.
 */
import type { ProjectRole } from './services/membership-service.js';

export type Permission =
  | 'project:read'
  | 'project:admin'
  | 'members:read'
  | 'members:manage'
  | 'spec:read'
  | 'spec:write'
  | 'history:read'
  | 'history:restore'
  | 'mock:read'
  | 'mock:write';

/** Viewer reads the contract, not how it is being faked: a mock is scratch work — half-written
 *  code, hardcoded fixtures — and someone given read-only access to the API is being shown the
 *  API.
 *
 *  `members:read` is every member's, not the owner's alone: the roster is the who-do-I-ask list
 *  (who reviews, who grants write), and it hides nothing — the user directory behind the member
 *  picker is already open to any authed caller. Reading the roster of a project you are *not* on
 *  stays shut, which is what the copy-source restriction guards. */
const VIEWER = ['project:read', 'spec:read', 'members:read'] satisfies Permission[];
/** Tester (QA): shapes mock responses without touching the contract. Safe to hand out because
 *  scripted code runs in a no-fs/no-network sandbox, so its blast radius is far below spec:write. */
const TESTER = [...VIEWER, 'mock:read', 'mock:write'] satisfies Permission[];
/** History pairs with spec:write, not with spec:read: the version log is the authoring trail —
 *  who broke what, which draft to roll back to — and it is read only through the design canvas,
 *  which is itself gated on write. Granting it below this tier bought an endpoint no UI reaches. */
const EDITOR = [...TESTER, 'spec:write', 'history:read', 'history:restore'] satisfies Permission[];
const OWNER = [...EDITOR, 'project:admin', 'members:manage'] satisfies Permission[];

export const ROLE_PERMISSIONS: Record<ProjectRole, ReadonlySet<Permission>> = {
  viewer: new Set(VIEWER),
  tester: new Set(TESTER),
  editor: new Set(EDITOR),
  owner: new Set(OWNER),
};

/** Every permission — what a system admin effectively holds on every project. */
export const ALL_PERMISSIONS: readonly Permission[] = OWNER;

/** Permissions whose absence must not reveal that the project exists: failing one yields 404,
 *  not 403, so a non-member can't probe which projects are there.
 *
 *  Listed outright rather than read off the viewer role. Which capabilities a viewer happens to
 *  hold is a product call that moves; hiding existence is a security rule that must not move
 *  with it — dropping `mock:read` from Viewer would otherwise have started answering non-members
 *  with 403, which is itself the answer they were fishing for. */
const EXISTENCE_HIDING = new Set<Permission>([
  'project:read',
  'spec:read',
  'history:read',
  'mock:read',
  'members:read',
]);

export function isReadPermission(perm: Permission): boolean {
  return EXISTENCE_HIDING.has(perm);
}
