import { useEffect, useRef, useState } from 'react';

/**
 * The given value, collapsed to at most one update per `ms` — for derivations too expensive per
 * keystroke. Leading edge: the first change after a quiet spell applies immediately, so a single
 * discrete edit (a drag commit, a paste) is not made to wait; only a burst trails.
 */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  const lastChange = useRef(0);
  useEffect(() => {
    const now = Date.now();
    const quiet = now - lastChange.current >= ms;
    lastChange.current = now;
    if (quiet) {
      setV(value);
      return;
    }
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
