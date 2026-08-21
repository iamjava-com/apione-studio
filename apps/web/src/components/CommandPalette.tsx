import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as DialogPrimitive from '@radix-ui/react-dialog';

export interface Command {
  id: string;
  label: string;
  group: string;
  /** Secondary muted text shown after the label (e.g. an op's `GET /users`); also matched. */
  hint?: string;
  /** Surfaces only once the user types — kept out of the idle list (e.g. endpoints/schemas). */
  searchOnly?: boolean;
  run: () => void;
}

/**
 * ⌘K / Ctrl-K palette: keyboard-first navigation over app actions + a live project
 * search. Self-contained (no cmdk dep) so it stays on our design tokens and theme.
 */
export function CommandPalette({ commands }: { commands: Command[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // Capture-phase + stopImmediate so ⌘K is ours app-wide: pre-empt Scalar's
        // docs-search hotkey (a window-bubble listener we can't disable via config).
        e.stopImmediatePropagation();
        setOpen((o) => !o);
      }
      // Escape is left to Radix's topmost DismissableLayer so one press closes only
      // the palette, not the dialog beneath it.
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('apione-open-command-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('apione-open-command-palette', onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      // focus after paint
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Idle list stays lean — endpoints/schemas appear only once you start typing.
    if (!q) return commands.filter((c) => !c.searchOnly);
    return commands.filter((c) => `${c.label} ${c.hint ?? ''} ${c.group}`.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    if (cursor >= filtered.length) setCursor(Math.max(0, filtered.length - 1));
  }, [filtered.length, cursor]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    setOpen(false);
    c.run();
  };

  const onListKey = (e: React.KeyboardEvent) => {
    // Enter that commits an IME candidate must not also run a command.
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(filtered[cursor]);
    }
  };

  // preserve group order as first-seen in the commands array
  const groups: string[] = [];
  for (const c of filtered) if (!groups.includes(c.group)) groups.push(c.group);

  // Advertise endpoint/schema search only where it's available (inside a project).
  const placeholder = commands.some((c) => c.searchOnly) ? t('cmdkPlaceholderInProject') : t('cmdkPlaceholder');

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        {/* One wrapper, one portal — see ui/dialog.tsx for why the pair must not be split. */}
        <div className="pointer-events-none fixed inset-0 z-[100000] isolate">
          <DialogPrimitive.Overlay className="pointer-events-auto absolute inset-0 bg-black/40" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            // Radix would focus the panel itself; keep focus on the search input instead.
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              inputRef.current?.focus();
            }}
            className="pointer-events-auto absolute left-1/2 top-[12vh] z-10 w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-surface shadow-2xl focus:outline-none"
          >
            <DialogPrimitive.Title className="sr-only">{t('cmdkPlaceholder')}</DialogPrimitive.Title>
            <input
              ref={inputRef}
              aria-label="command-palette-input"
              type="text"
              // Keep password managers (1Password/LastPass/browser) out of this search box.
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
              className="w-full border-b border-border bg-transparent px-4 py-3 text-[15px] text-text outline-none placeholder:text-faint"
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onListKey}
            />
            <div className="max-h-80 overflow-auto py-1">
              {filtered.length === 0 && <div className="px-4 py-3 text-[14px] text-muted">{t('cmdkEmpty')}</div>}
              {groups.map((g) => (
                <div key={g}>
                  <div className="px-4 pb-1 pt-2 font-mono text-[11px] uppercase tracking-wider text-faint">{g}</div>
                  {filtered
                    .map((c, idx) => ({ c, idx })) // cursor indexes into `filtered`, so carry it through the group filter
                    .filter(({ c }) => c.group === g)
                    .map(({ c, idx }) => (
                      <div
                        key={c.id}
                        onMouseEnter={() => setCursor(idx)}
                        onClick={() => run(c)}
                        className={`flex cursor-pointer items-center gap-2 px-4 py-2 text-[14px] ${idx === cursor ? 'bg-raised text-text' : 'text-muted'}`}
                      >
                        <span className="truncate">{c.label}</span>
                        {c.hint && <span className="truncate pl-1 font-mono text-[12px] text-faint">{c.hint}</span>}
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
