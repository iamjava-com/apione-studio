import { useEffect, useState, type ReactNode } from 'react';

/**
 * Render `children` only once `ms` have passed since mount. Wrap loading marks in it so a fast
 * response never flashes a spinner that is gone before the eye lands on it.
 */
export function Delayed({ ms = 200, children }: { ms?: number; children: ReactNode }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), ms);
    return () => window.clearTimeout(t);
  }, [ms]);
  return show ? <>{children}</> : null;
}
