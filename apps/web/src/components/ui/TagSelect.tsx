import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Plus, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useCombobox } from '../../hooks/useCombobox';

type Item = { kind: 'clear' } | { kind: 'option'; value: string } | { kind: 'create'; value: string };

/**
 * A themed single-select combobox: click to open the full list, type to filter, pick an option,
 * clear the value, or create a new one (an explicit "+ create X" row makes that obvious). Unlike
 * a native <select> its popup is styled, and unlike a datalist input the whole list shows on open.
 *
 * The popup is portaled to <body> and fixed-positioned from the button's rect, so it escapes any
 * `overflow`/clipping ancestor (e.g. the schema tree's horizontal scroll container).
 */
export function TagSelect({
  value,
  options,
  onChange,
  placeholder,
  clearLabel,
  createLabel,
  allowClear = true,
  'aria-label': ariaLabel,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  clearLabel: string;
  createLabel: (query: string) => string;
  allowClear?: boolean;
  'aria-label'?: string;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const { open, setOpen, query, active, setActive, onQueryChange, onKeyDown } = useCombobox([btnRef, popupRef]);

  useEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    const measure = () => setRect(btnRef.current?.getBoundingClientRect() ?? null);
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = options.filter((o) => o.toLowerCase().includes(q));
  const canCreate = q.length > 0 && !options.some((o) => o.toLowerCase() === q);
  const items: Item[] = [
    ...(value && allowClear ? [{ kind: 'clear' } as const] : []),
    ...filtered.map((o) => ({ kind: 'option', value: o }) as const),
    ...(canCreate ? [{ kind: 'create', value: query.trim() } as const] : []),
  ];

  const choose = (item: Item) => {
    onChange(item.kind === 'clear' ? '' : item.value);
    setOpen(false);
  };

  // Fixed-position the popup below the button, flipping above when the viewport bottom is tight.
  let popupStyle: CSSProperties = {};
  if (rect) {
    const below = window.innerHeight - rect.bottom;
    const openUp = below < 288 && rect.top > below;
    const maxHeight = Math.max(120, Math.min(256, (openUp ? rect.top : below) - 12));
    popupStyle = {
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      maxHeight,
      ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    };
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center gap-1.5 rounded-md border border-border bg-bg px-2 text-left text-[13px] outline-none focus:border-brand"
      >
        <span className={cn('flex-1 truncate', value ? 'text-text' : 'text-faint')}>{value || placeholder}</span>
        <ChevronDown size={14} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={popupRef}
            style={popupStyle}
            className="z-50 min-w-44 overflow-auto rounded-md border border-border bg-surface p-1 shadow-lg"
          >
            <input
              autoFocus
              aria-label={ariaLabel ? `${ariaLabel}-search` : undefined}
              className="mb-1 w-full rounded bg-bg px-2 py-1 text-[13px] text-text outline-none placeholder:text-faint"
              placeholder={placeholder}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={onKeyDown(items.length, (i) => items[i] && choose(items[i]))}
            />
            {items.length === 0 && <div className="px-2 py-1 text-[12px] text-faint">—</div>}
            {items.map((item, i) => (
              <button
                key={`${item.kind}:${item.kind === 'clear' ? '' : item.value}`}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[13px]',
                  i === active ? 'bg-raised text-text' : 'text-muted',
                )}
              >
                {item.kind === 'clear' && (
                  <>
                    <X size={13} className="text-faint" />
                    {clearLabel}
                  </>
                )}
                {item.kind === 'option' && (
                  <>
                    <span className="flex-1 truncate">{item.value}</span>
                    {item.value === value && <Check size={13} className="text-brand" />}
                  </>
                )}
                {item.kind === 'create' && (
                  <>
                    <Plus size={13} className="text-post" />
                    {createLabel(item.value)}
                  </>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
