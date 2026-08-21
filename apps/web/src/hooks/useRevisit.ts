import { useEffect } from 'react';
import { useLocation } from '../lib/router';

/**
 * Run `onRevisit` whenever the user's attention comes back to what is on screen: they picked
 * another item (the URL owns the selection, so any navigation counts) or they returned to the tab.
 *
 * These are the moments a co-author's work is worth taking in, and they are the same for every
 * kind of shared state — the spec file and the workflow stages both hang off this, so there is one
 * answer to "when do we look again" rather than one per feature.
 *
 * `onRevisit` must be stable (useCallback), or every render re-subscribes and re-fires.
 */
export function useRevisit(onRevisit: () => void): void {
  const loc = useLocation();
  useEffect(onRevisit, [onRevisit, loc]);
  useEffect(() => {
    window.addEventListener('focus', onRevisit);
    return () => window.removeEventListener('focus', onRevisit);
  }, [onRevisit]);
}
