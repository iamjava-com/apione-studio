import { useState } from 'react';

/**
 * Stable dnd row ids for an array whose items have no key of their own (parameters, servers —
 * a url or name is edited character by character and is routinely blank or a duplicate).
 *
 * Reconciles ids with the array length: a structural change (add/remove/item switch) re-seeds
 * fresh ids for this render and schedules the state update; `reorder` preserves length and
 * shuffles ids in step, so the moved row keeps its id — otherwise the dragged row inherits an id
 * that now belongs to its neighbour and animates back to it.
 */
export function useRowIds(length: number, prefix: string) {
  const [idState, setIdState] = useState<{ ids: string[]; seq: number }>({ ids: [], seq: 0 });
  let ids = idState.ids;
  if (ids.length !== length) {
    let s = idState.seq;
    ids = Array.from({ length }, () => `${prefix}-${s++}`);
    setIdState({ ids, seq: s });
  }

  /** Resolve a drag to array indices, shuffling ids in step; null when either id is unknown. */
  const reorder = (activeId: string, overId: string): { from: number; to: number } | null => {
    const from = ids.indexOf(activeId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0) return null;
    setIdState((st) => {
      const next = st.ids.slice();
      next.splice(to, 0, next.splice(from, 1)[0]!);
      return { ...st, ids: next };
    });
    return { from, to };
  };

  return { ids, reorder };
}
