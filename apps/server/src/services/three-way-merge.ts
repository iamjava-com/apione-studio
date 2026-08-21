/**
 * Structural three-way merge for spec documents.
 *
 * Concurrency is per file, but authoring is per endpoint: two people who touched different
 * operations of the same document have not collided, and a whole-file version number cannot tell
 * the difference. Comparing the parsed trees can — so a stale baseVersion is a question, not a
 * verdict, and only an overlapping edit is a real conflict.
 *
 * Formatting and comments play no part: canonical-on-write already discards them, so the tree
 * carries everything the file does.
 */
import YAML from 'yaml';
import { canonicalizeTree } from '../storage/canonical.js';

/** Absent key. Distinct from `undefined`, which a document can legitimately hold. */
const MISSING = Symbol('missing');
const CONFLICT = Symbol('conflict');

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deep equality, deliberately order-sensitive for object keys: authors reorder endpoints and
 * fields on purpose, so a reorder is a change like any other and has to survive the merge.
 */
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && equal(a[k], b[k]));
  }
  return false;
}

function at(o: Record<string, unknown>, k: string): unknown {
  return k in o ? o[k] : MISSING;
}

/**
 * Key order for the merged object: whichever side reordered wins, head if both did. Order is
 * never worth a conflict — losing one author's ordering is recoverable, refusing the save is not.
 * Keys the winning side never saw are appended.
 */
function mergeKeyOrder(
  base: Record<string, unknown>,
  head: Record<string, unknown>,
  incoming: Record<string, unknown>,
  keys: Set<string>,
): string[] {
  const kept = (o: Record<string, unknown>, only: (k: string) => boolean) => Object.keys(o).filter(only);
  const headSeq = kept(head, (k) => keys.has(k));
  const incomingSeq = kept(incoming, (k) => keys.has(k));
  const headReordered = !equal(
    kept(base, (k) => headSeq.includes(k)),
    kept(head, (k) => k in base),
  );
  const [winner, loser] = headReordered ? [headSeq, incomingSeq] : [incomingSeq, headSeq];
  return [...winner, ...loser.filter((k) => !winner.includes(k))];
}

function mergeObject(
  base: Record<string, unknown>,
  head: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> | typeof CONFLICT {
  // Keys only base still has were dropped by both sides, so the other two are the candidates.
  const keys = new Set([...Object.keys(head), ...Object.keys(incoming)]);
  const out: Record<string, unknown> = {};
  for (const k of mergeKeyOrder(base, head, incoming, keys)) {
    const merged = mergeValue(at(base, k), at(head, k), at(incoming, k));
    if (merged === CONFLICT) return CONFLICT;
    if (merged !== MISSING) out[k] = merged;
  }
  return out;
}

function mergeValue(base: unknown, head: unknown, incoming: unknown): unknown {
  if (equal(head, incoming)) return head; // same landing spot, however they got there
  if (equal(base, head)) return incoming; // only incoming moved
  if (equal(base, incoming)) return head; // only head moved
  // Both moved: descend while all three are still objects, otherwise they overwrote each other.
  // Arrays stay atomic — merging them element-wise invents documents neither author wrote.
  if (isPlainObject(base) && isPlainObject(head) && isPlainObject(incoming)) return mergeObject(base, head, incoming);
  return CONFLICT;
}

/**
 * Merge `incoming` (written against `base`) into `head`, what the file became meanwhile.
 * Returns the merged document in canonical form, or null when the two sides really did edit the
 * same thing — including when any of the three does not parse.
 */
export function mergeDocuments(base: string, head: string, incoming: string): string | null {
  let trees: unknown[];
  try {
    trees = [base, head, incoming].map((s) => YAML.parse(s));
  } catch {
    return null;
  }
  if (trees.some((t) => t === null || t === undefined)) return null;
  const merged = mergeValue(trees[0], trees[1], trees[2]);
  return merged === CONFLICT ? null : canonicalizeTree(merged);
}
