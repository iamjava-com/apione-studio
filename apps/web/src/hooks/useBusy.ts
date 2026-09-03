import { useCallback, useMemo, useRef, useState } from 'react';
import { errorText } from '../lib/errors';

interface BusyError {
  key: string;
  text: string;
}

/**
 * The actions a view can fire, one in flight at a time. `run(key, fn)` refuses re-entry while
 * anything is running, so a second click during the wait is dropped rather than sent twice; a
 * rejection becomes `error` (localized) and `run` resolves false. `busy` is the running key, for
 * the trigger to show the mark on itself; `locked` is for its siblings to disable.
 *
 * Confirm first, then `run`: the modal already blocks a second click, and a mark under a
 * confirm dialog would say the request is out when it is not.
 */
export function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<BusyError | null>(null);
  const running = useRef<string | null>(null);

  const run = useCallback(async (key: string, fn: () => Promise<void>): Promise<boolean> => {
    if (running.current) return false;
    running.current = key;
    setBusy(key);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError({ key, text: errorText(e) });
      return false;
    } finally {
      running.current = null;
      setBusy(null);
    }
  }, []);

  /** Report a failure from outside `run` (a field check, an optimistic write) under `key`. */
  const fail = useCallback((key: string, text: string) => setError({ key, text }), []);
  const clearError = useCallback(() => setError(null), []);

  return useMemo(() => {
    /** The error text for `key` — or for any `key:…` sub-action — else null. */
    const errorFor = (key: string) =>
      error && (error.key === key || error.key.startsWith(`${key}:`)) ? error.text : null;
    return { busy, locked: busy !== null, error, errorFor, run, fail, clearError };
  }, [busy, error, run, fail, clearError]);
}
