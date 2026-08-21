import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronRight, Copy, GripVertical, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { DragHandle } from '../form/Sortable';
import { pathRuns, type Op } from '../../hooks/useOpsDnd';
import type { Selection } from '../../lib/router';
import { MethodBadge } from '../ui/method-badge';
import { StageDot } from '../ui/stage-dot';
import { useStages } from '../OperationStages';
import { NavItem, RowActions } from './nav';

/** What a row can do to the operation it shows. The panel owns all three. */
export type RowHandlers = {
  onSelectOp: (op: Op) => void;
  onDuplicateOp: (op: Op) => void;
  onDeleteOp: (op: Op) => void;
};

const isActive = (selection: Selection, op: Op) =>
  selection.kind === 'op' && selection.path === op.p && selection.method === op.m;

function RowBody({ op, on }: { op: Op; on: RowHandlers }) {
  const stages = useStages();
  return (
    <>
      <div
        aria-label={`open-op-${op.m}-${op.p}`}
        className={cn('flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5', op.deprecated && 'opacity-60')}
        onClick={() => on.onSelectOp(op)}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {stages?.loaded && <StageDot stage={stages.stageOf(op.opId)} />}
          <MethodBadge method={op.m} />
          {/* summary is the friendly name (like the docs); fall back to the path */}
          <span
            className={cn(
              'truncate text-[13px]',
              op.summary ? 'text-text' : 'font-mono text-muted',
              op.deprecated && 'line-through decoration-from-font',
            )}
          >
            {op.summary || op.p}
          </span>
        </div>
        {op.summary && (
          <span className={cn('truncate pl-1 font-mono text-[12px] text-faint', op.deprecated && 'line-through')}>
            {op.p}
          </span>
        )}
      </div>
      <RowActions>
        <button aria-label="duplicate-op" className="text-faint hover:text-text" onClick={() => on.onDuplicateOp(op)}>
          <Copy size={14} />
        </button>
        <button aria-label="delete-op" className="text-faint hover:text-delete" onClick={() => on.onDeleteOp(op)}>
          <Trash2 size={14} />
        </button>
      </RowActions>
    </>
  );
}

/**
 * One path, its methods as ordinary rows. `paths` keys the whole run, so the path — not the row —
 * is the sortable: whichever handle you grab, every method under it moves and lands together.
 */
function PathBlock({ ops, selection, on }: { ops: Op[]; selection: Selection; on: RowHandlers }) {
  const head = ops[0]!;
  // No layout animation: the drop writes the document immediately, so an animation only leaves the
  // rows where they no longer are, and a drag started during it grabs nothing.
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id: `${head.m} ${head.p}`,
    transition: null,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
    position: 'relative',
  };
  const handle = { ...attributes, ...listeners };
  return (
    <div ref={setNodeRef} style={style} role="group" aria-label={`path-${head.p}`} className="group/path relative">
      {ops.map((op) => (
        <NavItem key={`${op.m} ${op.p}`} active={isActive(selection, op)}>
          <DragHandle {...handle} />
          <RowBody op={op} on={on} />
        </NavItem>
      ))}
      {ops.length > 1 && (
        // The capsule drags too: a row handle only covers its own row, and the gap between two of
        // them is exactly where this grip lands when the path has an even number of methods.
        <span
          {...listeners}
          aria-hidden
          className="absolute bottom-1.5 left-4 top-1.5 z-20 flex w-[6px] cursor-grab touch-none items-center justify-center rounded-full bg-border-strong opacity-0 transition-opacity active:cursor-grabbing group-hover/path:opacity-100"
        >
          <GripVertical size={14} className="shrink-0 text-text" />
        </span>
      )}
    </div>
  );
}

export function OpRows({ ops, selection, on }: { ops: Op[]; selection: Selection; on: RowHandlers }) {
  const runs = pathRuns(ops, (o) => `${o.m} ${o.p}`);
  return (
    <SortableContext items={runs.map((r) => `${r[0]!.m} ${r[0]!.p}`)} strategy={verticalListSortingStrategy}>
      {runs.map((run) => (
        <PathBlock key={`${run[0]!.m} ${run[0]!.p}`} ops={run} selection={selection} on={on} />
      ))}
    </SortableContext>
  );
}

/** A collapsible tag group. The header is also a drop target so an op can be dropped into an
 *  otherwise-empty group (a transient state while dragging the last op out of a group). */
export function OpGroup({
  group,
  collapsed,
  onToggle,
  selection,
  untaggedLabel,
  on,
}: {
  group: { tag: string; ops: Op[] };
  collapsed: boolean;
  onToggle: () => void;
  selection: Selection;
  untaggedLabel: string;
  on: RowHandlers;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `group:${group.tag}` });
  return (
    <div className="py-0.5">
      <button
        ref={setNodeRef}
        onClick={onToggle}
        aria-label={`group-${group.tag || 'untagged'}`}
        className={cn(
          'flex w-full items-center gap-1 rounded px-3 py-0.5 text-left hover:bg-raised',
          isOver && 'bg-raised ring-1 ring-brand',
        )}
      >
        <ChevronRight size={11} className={cn('shrink-0 text-faint transition-transform', !collapsed && 'rotate-90')} />
        <span className="truncate font-mono text-[12px] uppercase tracking-wider text-faint">
          {group.tag || untaggedLabel}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-faint">{group.ops.length}</span>
      </button>
      {!collapsed && <OpRows ops={group.ops} selection={selection} on={on} />}
    </div>
  );
}
