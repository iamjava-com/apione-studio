import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { and, count, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { transact } from '../db/txn.js';
import { memberships, users, type UserRow } from '../db/schema.js';
import { config } from '../config.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';

export type Role = 'admin' | 'member';
export type Status = 'active' | 'disabled';

// argon2id — OWASP's first-choice password hash. Its own defaults are strong; we pin OWASP's
// baseline (19 MiB, 2 iterations, 1 lane) for a snappy interactive login. Every parameter is
// encoded into the returned `$argon2id$v=19$m=..,t=..,p=..$salt$hash` string, so verify reads
// them back from the hash itself.
const ARGON2 = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

function hashPassword(pw: string): Promise<string> {
  return argon2.hash(pw, ARGON2);
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  try {
    return await argon2.verify(stored, pw);
  } catch {
    return false; // malformed stored hash → treat as a mismatch, never throw into the caller
  }
}

export function countUsers(): number {
  return db.select({ n: count() }).from(users).get()?.n ?? 0;
}

/**
 * First-run setup: true until the admin account exists. Auth is ALWAYS enforced —
 * this only tells the frontend to show "create admin" instead of "log in".
 */
export function needsSetup(): boolean {
  return countUsers() === 0;
}

export function findByUsername(username: string): UserRow | undefined {
  return db.select().from(users).where(eq(users.username, username)).get();
}

export function getUser(id: string): UserRow | undefined {
  return db.select().from(users).where(eq(users.id, id)).get();
}

/** Admins first, then oldest account first — the order every user listing is read in. */
const userOrder = [sql`case ${users.role} when 'admin' then 0 else 1 end`, users.createdAt] as const;

/** Lightweight directory for member-pickers (any authed caller): just id/username/role. */
export function listUsers() {
  return db
    .select({ id: users.id, username: users.username, role: users.role })
    .from(users)
    .orderBy(...userOrder)
    .all();
}

/** Full listing for the admin console: adds status + createdAt. Admin-only at the route. */
export function listUsersDetailed() {
  return db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(...userOrder)
    .all();
}

/** Active admins are the ones who can actually still log in — the count that must never hit 0. */
function countActiveAdmins(): number {
  return (
    db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.status, 'active')))
      .get()?.n ?? 0
  );
}

/** True if changing/removing this user would drop the last account able to administer. */
function isLastActiveAdmin(u: UserRow): boolean {
  return u.role === 'admin' && u.status === 'active' && countActiveAdmins() === 1;
}

function getUserOrThrow(id: string): UserRow {
  const u = getUser(id);
  if (!u) throw new NotFoundError(`user not found: ${id}`);
  return u;
}

export function setUserRole(id: string, role: Role, actorId: string): UserRow {
  if (role !== 'admin' && role !== 'member') throw new ValidationError('role must be admin or member', 'role_invalid');
  if (id === actorId) throw new ValidationError('you cannot change your own role', 'self_target');
  const u = getUserOrThrow(id);
  if (role !== 'admin' && isLastActiveAdmin(u)) throw new ConflictError('cannot demote the last admin', 'last_admin');
  db.update(users).set({ role }).where(eq(users.id, id)).run();
  return getUser(id)!;
}

export function setUserStatus(id: string, status: Status, actorId: string): UserRow {
  if (status !== 'active' && status !== 'disabled')
    throw new ValidationError('status must be active or disabled', 'status_invalid');
  if (id === actorId) throw new ValidationError('you cannot disable your own account', 'self_target');
  const u = getUserOrThrow(id);
  if (status === 'disabled' && isLastActiveAdmin(u))
    throw new ConflictError('cannot disable the last admin', 'last_admin');
  db.update(users).set({ status }).where(eq(users.id, id)).run();
  return getUser(id)!;
}

/** Apply a role and/or status change as one transaction, so the pair can never half-apply. */
export function updateUser(id: string, changes: { role?: Role; status?: Status }, actorId: string): UserRow {
  return transact(() => {
    if (changes.role !== undefined) setUserRole(id, changes.role, actorId);
    if (changes.status !== undefined) setUserStatus(id, changes.status, actorId);
    return getUserOrThrow(id);
  });
}

const PW_MIN = 8;
const PW_MAX = 128; // upper bound guards against a multi-MB password DoS'ing the argon2 hash

/** The one password policy, shared by create + reset. Length is the lever; no composition rules
 *  (NIST 800-63B advises against them). Throws a coded ValidationError the frontend localizes. */
function assertPasswordPolicy(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < PW_MIN) {
    throw new ValidationError(`password too short (min ${PW_MIN})`, 'password_too_short');
  }
  if (password.length > PW_MAX) {
    throw new ValidationError(`password too long (max ${PW_MAX})`, 'password_too_long');
  }
}

/** Alphabet without the characters that get misread when a password is dictated or retyped
 *  (0/O, 1/l/I). */
const PW_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*';

/**
 * The one-time password handed over when an account is provisioned or reset. Issued here rather
 * than chosen by the caller, so the web console and an API client (an agent) hand over the same
 * kind of credential — and nobody can provision an account with a password they picked in
 * advance. `randomInt` is rejection-sampled by Node, so no modulo bias.
 */
export function generatePassword(len = 10): string {
  let out = '';
  for (let i = 0; i < len; i++) out += PW_ALPHABET[randomInt(PW_ALPHABET.length)];
  return out;
}

export async function resetPassword(id: string, password: string): Promise<void> {
  assertPasswordPolicy(password);
  const user = getUserOrThrow(id);
  const passwordHash = await hashPassword(password);
  // A reset is how an account is taken back — from whoever prompted it, quite possibly. Leaving
  // the old sessions signed in would hand the account back to its owner without taking it from
  // anyone else.
  db.update(users)
    .set({ passwordHash, sessionEpoch: user.sessionEpoch + 1 })
    .where(eq(users.id, id))
    .run();
}

/** Self-service: the user proves they know the current password before setting a new one.
 *  (Admin reset skips this — an admin acts on the user's behalf.) */
export async function changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = getUserOrThrow(id);
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new ValidationError('current password is incorrect', 'wrong_password');
  }
  assertPasswordPolicy(newPassword);
  const passwordHash = await hashPassword(newPassword);
  // "Change my password" is what someone does when they think a session got away from them, so it
  // has to end the other sessions too — including, if this is a fresh login, the caller's own.
  db.update(users)
    .set({ passwordHash, sessionEpoch: user.sessionEpoch + 1 })
    .where(eq(users.id, id))
    .run();
}

/** Hard delete. Removes the user's project memberships in the same transaction; version history
 *  keeps its author ref (a plain string, not an FK) so the audit trail survives. */
export function deleteUser(id: string, actorId: string): void {
  if (id === actorId) throw new ValidationError('you cannot delete your own account', 'self_target');
  const u = getUserOrThrow(id);
  if (isLastActiveAdmin(u)) throw new ConflictError('cannot delete the last admin', 'last_admin');
  transact(() => {
    db.delete(memberships).where(eq(memberships.userId, id)).run();
    db.delete(users).where(eq(users.id, id)).run();
  });
}

const USERNAME = /^[a-zA-Z0-9_.@-]{2,40}$/;

export async function createUser(username: string, password: string, role?: Role): Promise<UserRow> {
  if (typeof username !== 'string' || !USERNAME.test(username)) {
    throw new ValidationError('username must be 2-40 chars of [a-zA-Z0-9_.@-]', 'username_invalid');
  }
  assertPasswordPolicy(password);
  if (findByUsername(username)) throw new ConflictError(`username taken: ${username}`, 'username_taken', { username });
  const firstUser = countUsers() === 0;
  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  db.insert(users)
    .values({
      id,
      username,
      passwordHash,
      role: role ?? (firstUser ? 'admin' : 'member'),
      createdAt: Date.now(),
    })
    .run();
  return getUser(id)!;
}

/** JWT secret: env, else a random one persisted in the data dir (stable across restarts). */
export function jwtSecret(): string {
  if (process.env.APIONE_JWT_SECRET) return process.env.APIONE_JWT_SECRET;
  const p = path.join(config.dataDir, '.jwt-secret');
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    // Only a missing file means "not set up yet". Anything else — a permission problem, bad media —
    // must not be answered by minting a replacement: that would sign out every session on the
    // instance and look like an outage nobody can explain.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    const s = randomBytes(32).toString('hex');
    // Owner-only: anyone who reads this file can mint a session for any account on the instance.
    fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(p, s, { encoding: 'utf8', mode: 0o600 });
    return s;
  }
}
