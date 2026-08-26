import { Separator } from 'react-resizable-panels';
import { cn } from '../../lib/utils';

/** The divider between workspace panes. A hairline to look at, but the `after` pseudo-element
 *  widens the grab area to 9px so it can actually be caught with a mouse.
 *  `hidden`: the neighbouring panel is at zero width — stay mounted, but neither seen nor draggable. */
export function ResizeHandle({ hidden = false }: { hidden?: boolean }) {
  return (
    <Separator
      disabled={hidden}
      className={cn(
        "relative w-px cursor-col-resize bg-border transition-colors after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-[''] hover:bg-brand",
        hidden && 'pointer-events-none w-0 opacity-0',
      )}
    />
  );
}
