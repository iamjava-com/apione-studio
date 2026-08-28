import { structuredPatch } from 'diff';

export type DiffHunk = { oldStart: number; newStart: number; lines: string[] };

/** Lines of `text`; a trailing newline ends the last line rather than starting an empty one. */
function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Lines that occur exactly once in `lines`, mapped to their index. */
function uniqueLines(lines: string[]): Map<string, number> {
  const seen = new Map<string, number>();
  lines.forEach((l, i) => seen.set(l, seen.has(l) ? -1 : i));
  return seen;
}

/** Longest chain of `[a, b]` pairs increasing in both — the anchors that keep their order. */
function longestChain(pairs: [number, number][]): [number, number][] {
  const tails: number[] = [];
  const prev = new Array<number>(pairs.length);
  for (let k = 0; k < pairs.length; k++) {
    const v = pairs[k][1];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < v) lo = mid + 1;
      else hi = mid;
    }
    prev[k] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = k;
  }
  const chain: [number, number][] = [];
  for (let k = tails[tails.length - 1] ?? -1; k >= 0; k = prev[k]) chain.unshift(pairs[k]);
  return chain;
}

/**
 * Unified-diff hunks of `base` → `target`, in the style of git's patience diff: lines unique to
 * both sides and in the same order are anchors, and only the runs between anchors go through
 * Myers. Myers alone is O(N·D); two independently generated versions of a large spec (every key
 * in a different order) take it a minute, while the anchors — every path key — cut that to
 * segments of a few dozen lines. `timeoutMs` bounds the total; `null` when it ran out.
 */
export function anchoredDiff(base: string, target: string, context: number, timeoutMs: number): DiffHunk[] | null {
  const deadline = Date.now() + timeoutMs;
  const a = splitLines(base);
  const b = splitLines(target);
  const ub = uniqueLines(b);
  const pairs: [number, number][] = [];
  for (const [line, i] of uniqueLines(a)) {
    const j = ub.get(line);
    if (i >= 0 && j !== undefined && j >= 0) pairs.push([i, j]);
  }
  pairs.sort((x, y) => x[0] - y[0]);
  const anchors = longestChain(pairs);

  const hunks: DiffHunk[] = [];
  let ai = 0;
  let bi = 0;
  for (const [ea, eb] of [...anchors, [a.length, b.length] as [number, number]]) {
    if (ea > ai || eb > bi) {
      const left = Date.now();
      if (left >= deadline) return null;
      // Every line gets its newline back, or the last line of each segment diffs as "changed".
      const oldText = a
        .slice(ai, ea)
        .map((l) => l + '\n')
        .join('');
      const newText = b
        .slice(bi, eb)
        .map((l) => l + '\n')
        .join('');
      const patch = structuredPatch('a', 'b', oldText, newText, '', '', { context, timeout: deadline - left });
      if (!patch) return null;
      for (const h of patch.hunks) hunks.push({ oldStart: h.oldStart + ai, newStart: h.newStart + bi, lines: h.lines });
    }
    ai = ea + 1;
    bi = eb + 1;
  }
  return withContext(hunks, a, context);
}

/**
 * Segment hunks carry no context across an anchor (it was never part of the segment). Give each
 * up to `context` unchanged lines on either side, sharing the room between neighbours, and join
 * the ones that then touch — the same shape Myers gives a whole file, so a "···" gap only ever
 * stands for lines the reader is not shown.
 */
function withContext(hunks: DiffHunk[], a: string[], context: number): DiffHunk[] {
  const out: DiffHunk[] = [];
  let prevEnd = 1; // 1-based first old line not yet claimed by a previous hunk
  for (const [k, h] of hunks.entries()) {
    const end = h.oldStart + oldLength(h);
    const nextStart = hunks[k + 1]?.oldStart ?? a.length + 1;
    const pre = Math.min(context, h.oldStart - prevEnd);
    const post = Math.min(context, nextStart - end, a.length - end + 1);
    const lines = [
      ...a.slice(h.oldStart - 1 - pre, h.oldStart - 1).map((l) => ' ' + l),
      ...h.lines,
      ...a.slice(end - 1, end - 1 + post).map((l) => ' ' + l),
    ];
    prevEnd = end + post;
    const last = out[out.length - 1];
    if (last && last.oldStart + oldLength(last) === h.oldStart - pre) last.lines.push(...lines);
    else out.push({ oldStart: h.oldStart - pre, newStart: h.newStart - pre, lines });
  }
  return out;
}

function oldLength(h: DiffHunk): number {
  let n = 0;
  for (const l of h.lines) if (l[0] !== '+' && l[0] !== '\\') n++;
  return n;
}
