import { useCallback, useRef, useState } from 'react';

/**
 * One in-flight action at a time for a view with several triggers (a list of rows, a set of
 * buttons). `run(key, fn)` refuses re-entry while anything is in flight, so a second click
 * during the wait is dropped rather than sent twice. `busy` is the key of the running action,
 * for the trigger to show the mark on itself; `locked` is for the others to disable.
 * Rejections propagate.
 */
export function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  const running = useRef<string | null>(null);
  const run = useCallback(async <T>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (running.current) return undefined;
    running.current = key;
    setBusy(key);
    try {
      return await fn();
    } finally {
      running.current = null;
      setBusy(null);
    }
  }, []);
  return { busy, locked: busy !== null, run };
}
