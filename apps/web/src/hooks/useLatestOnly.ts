import { useCallback, useRef } from 'react';

/**
 * Let only the newest request per key write state.
 *
 * Reads are fired from several places now — mount, a save, and every time the user's attention
 * returns to the view — so two are often in flight at once, and nothing says they come back in
 * order. An older answer landing last would put back exactly what the newer one had just dropped:
 * an operation someone deleted reappears in a list, a stage reverts. Which one is stale is knowable
 * here and nowhere else, so it is settled here.
 *
 * Keys are per logical read (one per endpoint, or per resource id where they are independent) —
 * two different reads must not invalidate each other.
 */
export function useLatestOnly() {
  const tickets = useRef<Record<string, number>>({});
  return useCallback(
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
}
