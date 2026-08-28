import { useEffect, useState } from 'react';
import type { DiffHunk } from '../lib/anchored-diff';
import type { DiffRequest, DiffResponse } from '../workers/diff.worker';

export type LineDiff = { status: 'pending' } | { status: 'done'; hunks: DiffHunk[] } | { status: 'gaveUp' };

/**
 * `base` → `target` as unified-diff hunks, computed in a worker. A change of inputs terminates
 * the worker mid-computation and starts a fresh one, so picking another version never queues
 * behind a slow comparison. `gaveUp` when the worker hit its time limit (see diff.worker).
 */
export function useLineDiff(base: string, target: string, context: number): LineDiff {
  const [result, setResult] = useState<LineDiff>({ status: 'pending' });

  useEffect(() => {
    setResult({ status: 'pending' });
    const w = new Worker(new URL('../workers/diff.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<DiffResponse>) =>
      setResult(e.data.hunks ? { status: 'done', hunks: e.data.hunks } : { status: 'gaveUp' });
    w.postMessage({ id: 0, base, target, context } satisfies DiffRequest);
    return () => w.terminate();
  }, [base, target, context]);

  return result;
}
