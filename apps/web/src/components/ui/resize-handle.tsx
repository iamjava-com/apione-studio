import { Separator } from 'react-resizable-panels';

/** The divider between workspace panes. A hairline to look at, but the `after` pseudo-element
 *  widens the grab area to 9px so it can actually be caught with a mouse. */
export function ResizeHandle() {
  return (
    <Separator className="relative w-px cursor-col-resize bg-border transition-colors after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-[''] hover:bg-brand" />
  );
}
