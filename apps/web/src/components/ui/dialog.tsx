import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

/** Minimal centered modal on the design tokens; focus-trapped + escape-to-close via Radix.
 *  Stacked (nested) dialogs layer by DOM order — a later one dims the one below.
 *  `onCloseAutoFocus` is exposed so a nested dialog can suppress the focus-return that would
 *  otherwise dismiss its parent. */
export function Dialog({
  open,
  onOpenChange,
  title,
  headerRight,
  size = 'sm',
  dismissOnOutside = true,
  onCloseAutoFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Sits on the title's own line, right-aligned — for a secondary way out of the dialog
   *  (a link to related reading), never for an action on what the dialog manages. */
  headerRight?: ReactNode;
  size?: 'sm' | 'lg';
  /** Set false while the dialog shows something unrecoverable (a secret displayed once), so a
   *  stray click on the backdrop can't discard it. Escape and the buttons still close. */
  dismissOnOutside?: boolean;
  onCloseAutoFocus?: (e: Event) => void;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* One wrapper, one portal: Radix portals each child of <Portal> separately, and each
            portal appends to <body> when its own layout effect fires — so overlay and content
            can land in either order and the overlay may end up painting over the dialog. Keeping
            them in one node with `isolate` makes the pair a self-contained stacking context. */}
        <div className="pointer-events-none fixed inset-0 z-50 isolate">
          <DialogPrimitive.Overlay className="pointer-events-auto absolute inset-0 animate-fade-in bg-black/40" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onCloseAutoFocus={onCloseAutoFocus}
            // An interaction inside another dialog (e.g. a confirm on top) must not dismiss this one.
            onInteractOutside={(e) => {
              if (!dismissOnOutside || (e.target as Element | null)?.closest?.('[role="dialog"]')) e.preventDefault();
            }}
            className={`pointer-events-auto absolute left-1/2 top-1/2 z-10 w-full ${size === 'lg' ? 'max-w-2xl' : 'max-w-sm'} -translate-x-1/2 -translate-y-1/2 animate-settle-in rounded-xl border border-border bg-surface p-5 shadow-2xl focus:outline-none`}
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <DialogPrimitive.Title className="text-[15px] font-semibold text-text">{title}</DialogPrimitive.Title>
              {headerRight}
            </div>
            {children}
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
