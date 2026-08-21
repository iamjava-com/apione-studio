import { createContext, useCallback, useContext, useEffect, useRef } from 'react';

/**
 * How many commit-on-blur fields (see `CommitInput`) are holding text the document has not seen.
 * Without it the save bar would call that "no unsaved changes" and disable the very button that
 * would commit it — saving blurs the focused field first, which is what makes the text land.
 */
const PendingEditsContext = createContext<((delta: number) => void) | null>(null);

/** @param onChange called with +1 / -1 as fields take and release pending text. */
export function PendingEditsProvider({
  onChange,
  children,
}: {
  onChange: (delta: number) => void;
  children: React.ReactNode;
}) {
  // The identity has to hold still: it is an effect dependency in every registered field, and a
  // new one each render would unregister and re-register them on every keystroke.
  const ref = useRef(onChange);
  useEffect(() => {
    ref.current = onChange;
  });
  const notify = useCallback((d: number) => ref.current(d), []);
  return <PendingEditsContext.Provider value={notify}>{children}</PendingEditsContext.Provider>;
}

/** Count this field as pending for as long as `pending` holds. */
export function usePendingEdit(pending: boolean): void {
  const notify = useContext(PendingEditsContext);
  useEffect(() => {
    if (!notify || !pending) return;
    notify(1);
    return () => notify(-1);
  }, [notify, pending]);
}
