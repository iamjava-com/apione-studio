import { useCallback, useMemo, useRef } from 'react';

/**
 * One ordering domain for the server state behind a key: a read applies only while it is the
 * newest thing to have touched its key, and a write orphans every read it overlaps — an
 * optimistic write must go through `write` with the key its reads use, or the race is back.
 *
 * Keys are per logical read; two keys never invalidate each other. The domain is this hook
 * instance: a read owned by another hook cannot be ordered from here.
 */
export function useLatestOnly() {
  const tickets = useRef<Record<string, number>>({});

  const read = useCallback(
    <T>(key: string, request: Promise<T>, apply: (value: T) => void, onError?: (e: unknown) => void) => {
      const ticket = (tickets.current[key] = (tickets.current[key] ?? 0) + 1);
      const current = () => ticket === tickets.current[key];
      request.then(
        (value) => current() && apply(value),
        (e: unknown) => current() && onError?.(e),
      );
    },
    [],
  );

  // Bumped on entry and exit — entry alone would let a read started mid-write apply pre-write state.
  const write = useCallback(async <T>(key: string, run: () => Promise<T>): Promise<T> => {
    tickets.current[key] = (tickets.current[key] ?? 0) + 1;
    try {
      return await run();
    } finally {
      tickets.current[key] = (tickets.current[key] ?? 0) + 1;
    }
  }, []);

  return useMemo(() => ({ read, write }), [read, write]);
}
