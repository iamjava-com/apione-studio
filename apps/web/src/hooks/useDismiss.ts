import { useEffect, type RefObject } from 'react';

/**
 * Closes an open popup the way every popup here closes: a mousedown landing outside every element
 * in `refs`, or Escape anywhere. The mousedown is not swallowed — it still lands where it was aimed.
 */
export function useDismiss(open: boolean, close: () => void, refs: RefObject<Element | null>[]) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!refs.some((r) => r.current?.contains(e.target as Node))) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs is a fresh array each render and close a fresh closure; their targets are stable
  }, [open]);
}
