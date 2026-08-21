import { useEffect, useRef, useState } from 'react';
import { errorText } from '../lib/errors';

/**
 * The busy/error bookkeeping every modal form repeats.
 *
 * When `open` flips true: busy and error clear, then `reset` runs (the caller's field reset —
 * focus/select scheduling included). `submit(fn)` refuses re-entry while busy, funnels a rejection
 * into `error`, and always releases busy; closing on success is `fn`'s own job.
 */
export function useDialogForm(open: boolean, reset?: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept in a ref so the open effect below reads the latest closure without depending on it.
  const resetRef = useRef(reset);
  useEffect(() => {
    resetRef.current = reset;
  });

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setError(null);
    resetRef.current?.();
  }, [open]);

  const submit = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, setError, submit };
}
