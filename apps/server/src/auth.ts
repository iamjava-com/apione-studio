import type { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import * as authSvc from './services/auth-service.js';
import { hasProjectPermission, type Actor } from './services/membership-service.js';
import { resolveToken, TOKEN_PREFIX } from './services/token-service.js';
import { isReadPermission, type Permission } from './permissions.js';
import { AppError } from './errors.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; username: string; role: string; epoch: number };
    user: { sub: string; username: string; role: string; epoch?: number };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Which credential got the caller in. Permission checks and the audit trail deliberately
     *  ignore this; the only reader is requirePasswordSession. */
    viaApiToken?: boolean;
  }
  interface FastifyContextConfig {
    /** Declares an /api route reachable without a credential. The three first-run/login endpoints
     *  are the whole list; anything else needs a guard instead. See assertApiRoutesGuarded. */
    auth?: 'public';
  }
}

/**
 * How long a session token stays valid. Long enough that a working day never ends in a surprise
 * logout, short enough that a token lifted off a shared machine stops working on its own. There is
 * no refresh flow: expiry surfaces as a 401, which the web app already treats as "sign in again".
 */
const SESSION_TTL = '30d';

/** Issue a session token. The epoch is what makes it revocable — see users.sessionEpoch. */
export function signSession(
  app: FastifyInstance,
  user: { id: string; username: string; role: string; sessionEpoch: number },
): string {
  return app.jwt.sign(
    { sub: user.id, username: user.username, role: user.role, epoch: user.sessionEpoch },
    { expiresIn: SESSION_TTL },
  );
}

export function registerJwt(app: FastifyInstance): void {
  app.register(fastifyJwt, { secret: authSvc.jwtSecret() });
}

/** The raw `Authorization: Bearer <…>` value, if the header is well-formed. */
function bearer(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim();
}

/** Requests requireAuth has fully verified. The global /api hook and the route's own guard both
 *  run it, and the credential cannot change mid-request, so the second run reuses the first's
 *  result instead of repeating the jwt/token check and the user lookup. Failure is never cached —
 *  a throw ends the request as a 401 anyway. */
const verifiedRequests = new WeakSet<FastifyRequest>();

/**
 * Require a valid credential. Auth is always enforced (first-run setup creates the admin).
 *
 * Two credentials resolve to the same thing: an API token is its owner's second way of proving
 * who they are, so past this point `req.user` is identical either way and nothing downstream —
 * no route, no permission gate, no audit trail — can tell them apart. The lone exception is the
 * handful of actions that demand a human be present; see requirePasswordSession.
 */
export async function requireAuth(req: FastifyRequest): Promise<void> {
  if (verifiedRequests.has(req)) return;
  const presented = bearer(req);
  let sub: string | undefined;
  let epoch: number | undefined;
  req.viaApiToken = presented?.startsWith(TOKEN_PREFIX) ?? false;
  if (req.viaApiToken) {
    sub = resolveToken(presented!);
  } else {
    try {
      await req.jwtVerify();
      sub = req.user.sub;
      epoch = req.user.epoch;
    } catch {
      sub = undefined;
    }
  }
  if (!sub) throw new AppError(401, 'unauthorized', 'authentication required');
  // Trust the DB, not the credential: a user disabled/deleted or role-changed after it was issued
  // must lose (or gain) access on the very next request. This per-request lookup — cheap on local
  // SQLite — is what makes revocation immediate rather than a matter of waiting out an expiry.
  const live = authSvc.getUser(sub);
  if (!live || live.status === 'disabled') {
    throw new AppError(401, 'unauthorized', 'authentication required');
  }
  // A session signed before the account's current epoch was cut loose by a password change; a
  // token issued before the column existed carries no epoch and is likewise not current.
  if (!req.viaApiToken && epoch !== live.sessionEpoch) {
    throw new AppError(401, 'unauthorized', 'authentication required');
  }
  req.user = { sub: live.id, username: live.username, role: live.role };
  verifiedRequests.add(req);
}

/** The authenticated caller as the identity permission checks and the audit trail key on.
 *  Only meaningful after an authenticating guard has run. */
export function actorOf(req: FastifyRequest): Actor {
  return { sub: req.user.sub, role: req.user.role };
}

/**
 * Refuse API tokens; the caller must have signed in with a password. Not a permission difference
 * — the same person holds both credentials — but a demand that they be present for it. Two kinds
 * of action qualify, and nothing else should be added without fitting one:
 *
 *  1. **Minting credentials** — managing tokens, and managing accounts (create one, reset a
 *     password, change a role). Otherwise one leaked token mints replacements faster than its
 *     owner can revoke them, and revocation becomes whack-a-mole. (Cf. needing the current
 *     password to set a new one.) Account management belongs here because an issued password *is*
 *     a minted credential: it buys a password session, which lifts both of these restrictions. The
 *     rule has to cover every path to a credential, not just the last step of the obvious one.
 *  2. **Destroying the ledger.** Everything an agent does is safe to hand it precisely because
 *     every write lands in the version table and can be diffed and rolled back. The few
 *     operations that delete that history — a project, a file, an account — leave nothing to roll
 *     back to, so they stay with the human. Overwriting, importing and restoring all append, and
 *     are therefore fine.
 */
export async function requirePasswordSession(req: FastifyRequest): Promise<void> {
  if (req.viaApiToken) {
    throw new AppError(403, 'session_required', 'this action requires signing in with a password');
  }
}

export async function requireAdmin(req: FastifyRequest): Promise<void> {
  await requireAuth(req);
  if (req.user?.role !== 'admin') {
    throw new AppError(403, 'forbidden', 'admin privilege required');
  }
}

/**
 * The guards that establish `req.user`. requirePasswordSession is deliberately absent: it narrows
 * an already-authenticated caller and passes anyone it cannot classify, so counting it as auth is
 * exactly the mistake this set exists to catch.
 */
const AUTHENTICATING_GUARDS = new WeakSet<object>([requireAuth, requireAdmin]);

/** Which permission a requirePermission guard enforces, so the document can say so. */
const PERMISSION_OF = new WeakMap<object, Permission>();

/** Guard a project route by an atomic permission (admin bypasses). Roles are permission sets,
 *  so a capability can move between roles without touching any route. */
export function requirePermission(perm: Permission) {
  const guard = async (req: FastifyRequest): Promise<void> => {
    await requireAuth(req);
    const projectId = (req.params as { projectId?: string }).projectId;
    if (!projectId) throw new AppError(400, 'bad_request', 'missing project id');
    if (!hasProjectPermission(actorOf(req), projectId, perm)) {
      // hide existence from users without even read access
      if (isReadPermission(perm)) throw new AppError(404, 'not_found', 'project not found');
      // Name what was missing: a caller that cannot read the document mid-call still learns why.
      throw new AppError(403, 'forbidden', 'insufficient project role', { requiredPermission: perm });
    }
  };
  AUTHENTICATING_GUARDS.add(guard);
  PERMISSION_OF.set(guard, perm);
  return guard;
}

/**
 * Publish what each route's guards demand, from the guards themselves — a note hand-written beside
 * 61 routes drifts, and the rule that matters most (an API token refused outright) is invisible
 * until the caller has already been refused.
 *
 * Two axes, two places. **Which credential** is what `security` is for, and a password session is
 * a different credential from an API token even though both ride the same header. **Which
 * permission** has no native slot — scopes exist only under oauth2/openIdConnect — so it goes in a
 * badge, not a second tag: an operation carrying two tags is listed under both, and the navigation
 * is by subject, not by role.
 *
 * Must run before any route is registered — onRoute only sees later ones.
 */
export function annotateGuards(app: FastifyInstance): void {
  app.addHook('onRoute', (route) => {
    const schema = route.schema as (Record<string, unknown> & { security?: unknown[] }) | undefined;
    if (!route.url.startsWith('/api/') || !schema) return;
    const chain: unknown[] = [route.preHandler ?? []].flat();

    const perm = chain.map((fn) => PERMISSION_OF.get(fn as object)).find(Boolean);
    const badge = perm ?? (chain.includes(requireAdmin) ? 'admin' : undefined);
    if (badge) schema['x-badges'] = [{ name: badge }];

    if (chain.includes(requirePasswordSession)) schema.security = [{ passwordSession: [] }];
  });
}

/**
 * Default-deny for /api, enforced at boot: every route either carries an authenticating guard in
 * its own preHandler or declares `config.auth = 'public'`.
 *
 * The gate below in app.ts is a second layer, not the contract — a route that reaches a handler
 * with no `req.user` is only safe by accident (whether the handler happens to dereference it), and
 * that accident has to be caught when the route is written, not when someone finds it.
 *
 * Only route-level preHandlers count: a plugin-level `addHook` is invisible to onRoute, and a
 * guard this check cannot see is a guard it cannot vouch for.
 */
export function assertApiRoutesGuarded(app: FastifyInstance): void {
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api/')) return;
    if (route.config?.auth === 'public') return;
    const chain: unknown[] = [route.preHandler ?? []].flat();
    if (!chain.some((fn) => typeof fn === 'function' && AUTHENTICATING_GUARDS.has(fn))) {
      throw new Error(
        `/api route with no auth guard: ${String(route.method)} ${route.url} — add one to preHandler, ` +
          `or declare config: { auth: 'public' } if it is meant to be reachable without a credential`,
      );
    }
  });
}
