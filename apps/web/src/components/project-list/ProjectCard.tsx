import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { Copy, UserKey } from 'lucide-react';
import type { Project } from '../../api';
import { formatDate } from '../../lib/format';
import { cn } from '../../lib/utils';

/**
 * One project tile. Draggable only when the caller could actually re-file it — a card that lifts
 * and then snaps back with a 403 is worse than one that never lifts. The drag itself is safe to
 * get wrong: groups grant nothing, so a misdrop changes nobody's access and undoing it is a drag
 * back.
 */
export function ProjectCard({
  project,
  canMove,
  duplicating,
  onOpen,
  onDuplicate,
}: {
  project: Project;
  canMove: boolean;
  duplicating: boolean;
  onOpen: (p: Project) => void;
  onDuplicate: (p: Project) => void;
}) {
  const { t, i18n } = useTranslation();
  // `attributes` is deliberately not spread: it carries `aria-disabled` for a card that can't be
  // dragged, and a card you can't drag is still one you open — announcing it as a disabled button
  // is simply false. Activation is gated in dnd-kit's own registry, not by those attributes.
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: project.id, disabled: !canMove });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(project)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(project)}
      className={cn(
        'group relative cursor-pointer rounded-xl border border-border bg-surface p-4 transition-colors hover:border-brand',
        isDragging && 'opacity-40',
      )}
    >
      <div className="truncate pr-6 text-[15px] font-medium text-text">{project.name}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[12px] text-faint">
        <span>{formatDate(project.updatedAt, i18n.language)}</span>
        {/* Tells apart the projects you answer for from the ones you were invited into. Pinned to
            the right edge, so the marks line up down the grid whatever width the locale's date
            takes; the word stays in the label — the glyph alone isn't self-evident. */}
        {project.myRole === 'owner' && (
          <span role="img" aria-label={t('role_owner')} title={t('role_owner')} className="ml-auto shrink-0 text-brand">
            <UserKey size={13} />
          </span>
        )}
      </div>
      <button
        aria-label={t('duplicate')}
        title={t('duplicate')}
        disabled={duplicating}
        // Stop the pointer here, or pressing Duplicate would start dragging the card instead.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate(project);
        }}
        className="absolute right-2.5 top-2.5 rounded p-1 text-faint opacity-0 transition-opacity hover:text-text disabled:opacity-100 group-hover:opacity-100"
      >
        <Copy size={14} />
      </button>
    </div>
  );
}
