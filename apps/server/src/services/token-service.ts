import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { apiTokens, type ApiTokenRow } from '../db/schema.js';
import { NotFoundError, ValidationError } from '../errors.js';

/** Marks a bearer credential as an API token rather than a JWT, so the auth path can tell them
 *  apart without trying to verify one as the other (and so secret scanners have something to
 *  match on). */
export const TOKEN_PREFIX = 'apione_';

const NAME_MAX = 60;

function hash(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

/** What a listing exposes — everything except the one thing we cannot show again. */
export interface TokenSummary {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

const summary = (r: ApiTokenRow): TokenSummary => ({
  id: r.id,
  name: r.name,
  createdAt: r.createdAt,
  lastUsedAt: r.lastUsedAt,
});

export function listTokens(userId: string): TokenSummary[] {
  return db.select().from(apiTokens).where(eq(apiTokens.userId, userId)).all().map(summary);
}

/** Mints a token. The plaintext is returned here and nowhere else, ever — only its hash is kept. */
export function createToken(userId: string, name: unknown): { token: TokenSummary; plaintext: string } {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) throw new ValidationError('token name is required', 'token_name_required');
  if (trimmed.length > NAME_MAX) {
    throw new ValidationError(`token name too long (max ${NAME_MAX})`, 'token_name_too_long');
  }
  const plaintext = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const row: ApiTokenRow = {
    id: randomUUID(),
    userId,
    name: trimmed,
    tokenHash: hash(plaintext),
    createdAt: Date.now(),
    lastUsedAt: null,
  };
  db.insert(apiTokens).values(row).run();
  return { token: summary(row), plaintext };
}

/** Revocation is a delete: a revoked token has no remaining use, and keeping the row would only
 *  grow a list of things the owner has to mentally filter out. */
export function revokeToken(userId: string, id: string): void {
  const res = db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
    .run();
  if (res.changes === 0) throw new NotFoundError('token not found', 'token_not_found');
}

/** How stale `lastUsedAt` may get. It answers "is this still in use?" for the revoke decision, so
 *  hourly resolution is plenty — and it keeps a DB write out of the hot auth path. */
const LAST_USED_INTERVAL_MS = 60 * 60 * 1000;

/** Resolves a presented token to its owner's id, or undefined. Callers must still check that the
 *  user exists and is active — this function only answers "is this credential genuine?".
 *
 *  The lookup is by sha256 of the secret, so no timing-safe compare is needed: what a timing
 *  difference could leak is whether some *digest* exists, and producing a chosen digest already
 *  requires knowing the token. */
export function resolveToken(plaintext: string): string | undefined {
  const row = db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hash(plaintext)))
    .get();
  if (!row) return undefined;
  const now = Date.now();
  if (!row.lastUsedAt || now - row.lastUsedAt > LAST_USED_INTERVAL_MS) {
    db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.id)).run();
  }
  return row.userId;
}
