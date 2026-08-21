import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** The outline's chrome — a labelled section, a row inside it, and a row's hover actions. Shared
 *  by the files, operations and schemas sections so all three sit on one grid. */

export function NavGroup({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="py-1">
      <div className="flex items-center px-3 py-1">
        <span className="font-mono text-[12px] uppercase tracking-wider text-faint">{label}</span>
        <div className="flex-1" />
        {action}
      </div>
      {children}
    </div>
  );
}

export function NavItem({
  active,
  dragRef,
  dragStyle,
  children,
}: {
  active?: boolean;
  dragRef?: (el: HTMLElement | null) => void;
  dragStyle?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      ref={dragRef}
      style={dragStyle}
      className={cn(
        'group relative mx-1 flex items-center gap-1.5 overflow-hidden rounded px-2 py-1 hover:bg-raised',
        active && 'bg-raised',
      )}
    >
      {children}
    </div>
  );
}

/** Hover-revealed action buttons pinned to the row's right edge. A gradient fades the text
 *  underneath so it never collides — and nothing is reserved at rest (no dead whitespace). */
export function RowActions({ children }: { children: ReactNode }) {
  return (
    <>
      {/* frosted patch behind the buttons: just a soft-masked backdrop-blur, no colour band */}
      <div className="pointer-events-none absolute inset-y-0 right-0 w-20 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 [mask-image:linear-gradient(to_left,black_60%,transparent)] [-webkit-mask-image:linear-gradient(to_left,black_60%,transparent)]" />
      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        {children}
      </div>
    </>
  );
}
