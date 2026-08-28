import { anchoredDiff, type DiffHunk } from '../lib/anchored-diff';

/** Line diff off the main thread; `hunks: null` when it ran past `DIFF_TIMEOUT_MS`. */
export type DiffRequest = { id: number; base: string; target: string; context: number };
export type DiffResponse = { id: number; hunks: DiffHunk[] | null };

export const DIFF_TIMEOUT_MS = 60_000;

addEventListener('message', (e: MessageEvent<DiffRequest>) => {
  const { id, base, target, context } = e.data;
  postMessage({ id, hunks: anchoredDiff(base, target, context, DIFF_TIMEOUT_MS) } satisfies DiffResponse);
});
