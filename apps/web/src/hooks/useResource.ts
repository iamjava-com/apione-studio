import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface Resource<T> {
  /** 'loading' until the first answer and again on every re-run; `data` says whether there is a
   *  previous answer to keep showing meanwhile. */
  status: 'loading' | 'ready' | 'error';
  data: T | undefined;
  /** The raw rejection (an ApiError from the server), for the caller to map — a 403 or a 404 is
   *  often a state of its own, not a failure. */
  error: unknown;
  reload: () => void;
}

/**
 * One server read: runs on mount and whenever `deps` change, drops answers that land out of
 * order, and says where it stands.
 *
 * `keepPrevious` (default true) leaves the last answer in `data` while a re-run is out, so a
 * list does not blank on every refresh; pass false where a stale answer is worse than none (one
 * item's detail shown under another item's name). `enabled: false` skips the fetch and leaves
 * the state as it is.
 *
 * Deliberately neither refetches on focus nor normalizes a failure into empty data. The reads
 * that re-check on revisit each carry their own rule (useSpecFile.sync, useMockCode,
 * OperationStages), and what a failed read means — denied, not yet saved, nothing to show — is
 * the caller's to decide.
 */
export function useResource<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList,
  { keepPrevious = true, enabled = true }: { keepPrevious?: boolean; enabled?: boolean } = {},
): Resource<T> {
  const [state, setState] = useState<Omit<Resource<T>, 'reload'>>({ status: 'loading', data: undefined, error: null });
  const [round, setRound] = useState(0);
  const ticket = useRef(0);
  // Read at fetch time, so an inline fetcher does not have to be in `deps`.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (!enabled) return;
    const mine = ++ticket.current;
    setState((s) => ({ status: 'loading', data: keepPrevious ? s.data : undefined, error: null }));
    fetcherRef.current().then(
      (data) => mine === ticket.current && setState({ status: 'ready', data, error: null }),
      (error: unknown) =>
        mine === ticket.current &&
        setState((s) => ({ status: 'error', data: keepPrevious ? s.data : undefined, error })),
    );
    return () => {
      ticket.current += 1; // an answer to a superseded run must not land
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` is the caller's list
  }, [...deps, round, enabled, keepPrevious]);

  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { ...state, reload };
}
