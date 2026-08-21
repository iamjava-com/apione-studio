import type { CSSProperties, ReactNode } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

/**
 * Thin wrapper over @dnd-kit: vertical sortable list with a dedicated drag handle
 * (so inputs stay clickable and only the grip drags). Render-prop exposes the node
 * ref, style, and handle props so it fits both inline rows and full cards.
 */
export function SortableList({
  ids,
  onReorder,
  children,
}: {
  ids: string[];
  onReorder: (activeId: string, overId: string) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function Sortable({
  id,
  children,
}: {
  id: string;
  children: (p: {
    setNodeRef: (el: HTMLElement | null) => void;
    style: CSSProperties;
    handleProps: object;
  }) => ReactNode;
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    // Translate only — CSS.Transform also emits scaleX/scaleY, which stretches/squashes the
    // dragged block when rows differ in height.
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
    position: 'relative',
  };
  return <>{children({ setNodeRef, style, handleProps: { ...attributes, ...listeners } })}</>;
}

/** Familiar grip affordance — spread the sortable handle props onto it. */
export function DragHandle(props: object) {
  return (
    <button
      type="button"
      aria-label="drag-handle"
      className="cursor-grab touch-none text-faint hover:text-text active:cursor-grabbing"
      {...props}
    >
      <GripVertical size={14} />
    </button>
  );
}
