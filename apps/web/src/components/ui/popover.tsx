import { useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { useDismiss } from '../../hooks/useDismiss';

/**
 * A panel that drops in under its trigger and is dismissed like every popup here (useDismiss).
 * `trigger` gets the toggle; `panel` positions and sizes the panel
 * (`left-0 w-80`, `max-h-56`…) relative to the trigger's box.
 */
export function Popover({
  trigger,
  panel,
  children,
}: {
  trigger: (toggle: () => void) => ReactNode;
  panel?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [root]);

  return (
    <div ref={root} className="relative">
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div
          className={cn(
            'absolute top-full z-20 mt-1 animate-drop-in space-y-1.5 overflow-auto rounded-md border border-border bg-surface p-2 shadow-lg',
            panel,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
