import { AppError } from '../errors.js';

/**
 * Per-username throttle for FAILED logins — protects a targeted account from brute force.
 * Only failures count and a success clears the slate, so a legitimate user re-logging in is
 * never throttled. Complements (doesn't replace) an edge/infra per-IP limit: volumetric and
 * multi-instance defense belong there; this catches account-targeted guessing the edge can't
 * see (it can't read the username or tell a 401 from a 200). In-memory / single-process on
 * purpose — that's the boundary this layer owns.
 */
const WINDOW_MS = 10 * 60_000; // 10 min: long enough to deter guessing, short enough to auto-recover
const MAX_FAILURES = 5;
const MAX_TRACKED = 10_000; // memory bound under username-spray; edge layer stops the volumetric case

interface Attempts {
  failures: number;
  resetAt: number;
}
const byUser = new Map<string, Attempts>();

/** Return the live record, dropping it if its window has elapsed. */
function live(username: string, now: number): Attempts | undefined {
  const rec = byUser.get(username);
  if (rec && now >= rec.resetAt) {
    byUser.delete(username);
    return undefined;
  }
  return rec;
}

/** Throws 429 if this username has hit the failed-attempt ceiling for the current window. */
export function assertLoginAllowed(username: string, now: number = Date.now()): void {
  const rec = live(username, now);
  if (rec && rec.failures >= MAX_FAILURES) {
    throw new AppError(429, 'too_many_requests', 'too many failed login attempts; try again later');
  }
}

/** Count one failed attempt; opens or extends this username's window. */
export function recordLoginFailure(username: string, now: number = Date.now()): void {
  const rec = live(username, now);
  if (rec) {
    rec.failures += 1;
  } else {
    if (byUser.size >= MAX_TRACKED) for (const [k, v] of byUser) if (now >= v.resetAt) byUser.delete(k);
    byUser.set(username, { failures: 1, resetAt: now + WINDOW_MS });
  }
}

/** A successful login clears the slate for that username. */
export function clearLoginFailures(username: string): void {
  byUser.delete(username);
}
