import { useEffect, useMemo, useRef } from 'react';
import { useBusy } from './useBusy';

/**
 * A modal form's one action, on top of `useBusy`: when `open` flips true the error clears and
 * `reset` runs (the caller's field reset — focus/select scheduling included). `submit(fn)`
 * refuses re-entry while busy and funnels a rejection into `error`; closing on success is `fn`'s
 * own job.
 */
export function useDialogForm(open: boolean, reset?: () => void) {
  const act = useBusy();
  // Kept in a ref so the open effect below reads the latest closure without depending on it.
  const resetRef = useRef(reset);
  useEffect(() => {
    resetRef.current = reset;
  });

  const { clearError } = act;
  useEffect(() => {
    if (!open) return;
    clearError();
    resetRef.current?.();
  }, [open, clearError]);

  return useMemo(
    () => ({
      busy: act.locked,
      error: act.error?.text ?? null,
      setError: (text: string | null) => (text === null ? act.clearError() : act.fail('form', text)),
      submit: (fn: () => Promise<void>) => act.run('form', fn),
    }),
    [act],
  );
}
