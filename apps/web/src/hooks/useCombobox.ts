import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react';

/**
 * The state machine the combobox popups share (TagSelect, the member UserPicker): open/query/
 * active-row state, ↑↓/Enter/Escape on the search input, and close on a mousedown landing outside
 * every element in `refs`. Rendering — inline list vs portal, row content — stays with the caller.
 */
export function useCombobox(refs: RefObject<Element | null>[]) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const onDown = (e: MouseEvent) => {
      if (!refs.some((r) => r.current?.contains(e.target as Node))) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs is a fresh array each render; its targets are stable
  }, [open]);

  const onQueryChange = (v: string) => {
    setQuery(v);
    setActive(0);
  };

  /** Key handler for the search input: navigate `count` rows, Enter picks the active index. */
  const onKeyDown = (count: number, pick: (index: number) => void) => (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, count - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return { open, setOpen, query, active, setActive, onQueryChange, onKeyDown };
}
