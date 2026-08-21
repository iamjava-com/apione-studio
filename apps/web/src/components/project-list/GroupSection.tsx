import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Group, Project } from '../../api';
import { cn } from '../../lib/utils';
import { ProjectCard } from './ProjectCard';

/**
 * One band of the project list: a header, then the project grid. The whole band is the drop
 * target — with no ordering to express, a drop means "file it here", so there is no insertion
 * point to aim at and none is drawn. A collapsed group is still its own target: the header alone
 * accepts the drop.
 *
 * `group === null` is the ungrouped band. It is headerless at rest — labelling the default state
 * is noise, and with no group at all the page reads as it did before grouping shipped — but it
 * grows a header while a drag is in flight, or a project filed away could never be filed back.
 */
export function GroupSection({
  group,
  projects,
  collapsed,
  dragging,
  isAdmin,
  duplicatingId,
  onOpen,
  onDuplicate,
  onNewProject,
  onToggleCollapse,
  onRename,
  onDelete,
}: {
  group: Group | null;
  projects: Project[];
  collapsed: boolean;
  dragging: boolean;
  isAdmin: boolean;
  duplicatingId: string | null;
  onOpen: (p: Project) => void;
  onDuplicate: (p: Project) => void;
  onNewProject: () => void;
  onToggleCollapse: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: group ? `group:${group.id}` : 'ungrouped' });
  const iconBtn = 'rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-text group-hover/head:opacity-100';

  return (
    <section
      ref={setNodeRef}
      // outline-offset rather than padding: the ring gets its breathing room without the band
      // changing size, so nothing on the page shifts the moment you drag over it.
      className={cn('mb-7 rounded-lg last:mb-0', isOver && 'outline-dashed outline-2 outline-offset-8 outline-brand')}
    >
      {group ? (
        <div className="group/head mb-2.5 flex items-center gap-1.5">
          <button
            aria-label={collapsed ? t('expandGroup', { name: group.name }) : t('collapseGroup', { name: group.name })}
            onClick={onToggleCollapse}
            className="flex min-w-0 items-center gap-1 rounded text-muted hover:text-text"
          >
            <ChevronRight
              size={12}
              className={cn('shrink-0 text-faint transition-transform', !collapsed && 'rotate-90')}
            />
            <span role="heading" aria-level={3} className="truncate text-[13px] font-semibold tracking-tight">
              {group.name}
            </span>
            {/* A chip, not a bare number: run straight on after the name it reads as part of it. */}
            <span className="shrink-0 rounded bg-raised px-1.5 font-mono text-[10px] tabular-nums text-faint">
              {projects.length}
            </span>
          </button>
          <button
            aria-label={`${t('newProjectHere')}: ${group.name}`}
            title={t('newProjectHere')}
            onClick={onNewProject}
            className={iconBtn}
          >
            <Plus size={14} />
          </button>
          {group.canManage && (
            <>
              <button
                aria-label={`${t('renameGroup')}: ${group.name}`}
                title={t('renameGroup')}
                onClick={onRename}
                className={iconBtn}
              >
                <Pencil size={13} />
              </button>
              <button
                aria-label={`${t('deleteGroup')}: ${group.name}`}
                title={t('deleteGroup')}
                onClick={onDelete}
                className={cn(iconBtn, 'hover:text-delete')}
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      ) : (
        dragging && <div className="mb-2.5 text-[13px] font-semibold tracking-tight text-muted">{t('ungrouped')}</div>
      )}

      {!collapsed && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              canMove={isAdmin || p.myRole === 'owner'}
              duplicating={duplicatingId === p.id}
              onOpen={onOpen}
              onDuplicate={onDuplicate}
            />
          ))}
          {projects.length === 0 && (
            <button
              onClick={onNewProject}
              className="flex min-h-[76px] items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-[13px] text-faint transition-colors hover:border-brand hover:text-text"
            >
              <Plus size={14} /> {t('newProjectHere')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
