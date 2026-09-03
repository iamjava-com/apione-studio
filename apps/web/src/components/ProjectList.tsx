import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Plus, Upload, FolderPlus } from 'lucide-react';
import { api, type Group, type Project, ApiError } from '../api';
import { errorText } from '../lib/errors';
import { toggleInSet } from '../lib/utils';
import { useConfirm } from './ConfirmProvider';
import { useDialogForm } from '../hooks/useDialogForm';
import { useBusy } from '../hooks/useBusy';
import { Input } from './ui/input';
import { Dialog } from './ui/dialog';
import { DialogFooter } from './ui/DialogFooter';
import { ErrorText } from './ui/ErrorText';
import { Delayed } from './ui/delayed';
import { Skeleton } from './ui/skeleton';
import { GroupSection } from './project-list/GroupSection';
import { NewProjectDialog } from './project-list/NewProjectDialog';

const COLLAPSED_KEY = 'apione-collapsed-groups';

/** Which groups are folded, remembered across visits — a fold that resets every time is a fold
 *  nobody uses. A view preference, so localStorage: it is per-browser and never shared state. */
function loadCollapsed(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? (raw as string[]) : []);
  } catch {
    return new Set();
  }
}

export function ProjectList({ onOpen, isAdmin }: { onOpen: (p: Project) => void; isAdmin: boolean }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [projects, setProjects] = useState<Project[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const act = useBusy();
  const [fileOver, setFileOver] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [movingId, setMovingId] = useState<string | null>(null); // project being dragged between groups
  // The new-project dialog remembers which section it was opened from, and may carry a
  // page-dropped file straight through to its own staging.
  const [creating, setCreating] = useState(false);
  const [createIn, setCreateIn] = useState<string | null>(null);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  // Rename and create share one dialog: `editing` is the group being renamed, or 'new'.
  const [editing, setEditing] = useState<Group | 'new' | null>(null);
  const dragDepth = useRef(0); // dragenter/leave fire per child; count so the hint doesn't flicker

  const refresh = () => {
    Promise.all([api.listProjects(), api.listGroups()])
      .then(([ps, gs]) => {
        setProjects(ps);
        setGroups(gs);
        setLoaded(true);
      })
      .catch((e: unknown) => {
        setError(errorText(e));
        setLoaded(true);
      });
  };
  useEffect(refresh, []);

  const openCreate = (groupId: string | null, file: File | null = null) => {
    setCreateIn(groupId);
    setDroppedFile(file);
    setCreating(true);
  };

  const toggleCollapse = (groupId: string) =>
    setCollapsed((prev) => {
      const next = toggleInSet(prev, groupId);
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      return next;
    });

  // A click must still open the project, so a drag only begins past a few pixels of travel.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  // Whole bands are the targets, so aim by pointer; fall back to overlap when the pointer sits in
  // the gutter between two bands.
  const collisionDetection: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    return hits.length ? hits : rectIntersection(args);
  };

  const onProjectDropped = async ({ active, over }: DragEndEvent) => {
    setMovingId(null);
    if (!over) return;
    const id = String(active.id);
    const overId = String(over.id);
    const groupId = overId === 'ungrouped' ? null : overId.slice('group:'.length);
    const project = projects.find((p) => p.id === id);
    if (!project || project.groupId === groupId) return;
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, groupId } : p))); // optimistic
    setError(null);
    try {
      await api.updateProject(id, { groupId });
    } catch (e) {
      setError(errorText(e));
      refresh(); // back to the server's truth
    }
  };

  // Page-wide drop (convenience): open the dialog and stage the dropped spec so the name can be
  // confirmed before import. One project at a time — extra files are ignored.
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setFileOver(false);
    if (creating) return; // dialog is open — its own dropzone owns the drop
    const file = e.dataTransfer.files[0];
    if (!file) return;
    setError(null);
    openCreate(null, file);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault();
  };
  const onDragEnter = (e: React.DragEvent) => {
    if (creating || !e.dataTransfer.types.includes('Files')) return;
    dragDepth.current += 1;
    setFileOver(true);
  };
  const onDragLeave = () => {
    if (--dragDepth.current <= 0) setFileOver(false);
  };

  const duplicate = (p: Project) =>
    act.run(`dup:${p.id}`, async () => {
      setError(null);
      try {
        const text = await api.exportSpec(p.id, 'yaml').catch((e) => {
          if (e instanceof ApiError && e.status === 404) return null; // never-saved project → empty copy
          throw e;
        });
        const copy = await api.createProject(t('copyOfName', { name: p.name }), p.groupId);
        if (text) await api.importSpec(copy.id, text);
        refresh();
      } catch (e) {
        setError(errorText(e));
      }
    });

  const removeGroup = async (g: Group) => {
    if (
      !(await confirm({ message: t('confirmDeleteGroup', { name: g.name }), confirmLabel: t('delete'), danger: true }))
    )
      return;
    await act.run(`del:${g.id}`, async () => {
      setError(null);
      try {
        await api.deleteGroup(g.id);
        refresh();
      } catch (e) {
        setError(errorText(e));
      }
    });
  };

  // Ungrouped first, then groups in server order (newest first).
  const sections: { group: Group | null; projects: Project[] }[] = [
    { group: null, projects: projects.filter((p) => p.groupId === null) },
    ...groups.map((g) => ({ group: g, projects: projects.filter((p) => p.groupId === g.id) })),
  ];
  // Nothing at all to show — not even an empty group to file into.
  const blank = loaded && projects.length === 0 && groups.length === 0 && !error;

  return (
    <div
      className="relative min-h-[calc(100vh-2.75rem)] px-6 py-10"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
    >
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-1">
          <h2 className="mr-1 text-[16px] font-semibold tracking-tight">{t('projects')}</h2>
          <button
            aria-label={t('newGroup')}
            title={t('newGroup')}
            onClick={() => setEditing('new')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-text"
          >
            <FolderPlus size={15} />
          </button>
          <button
            aria-label={t('newProject')}
            title={t('newProject')}
            onClick={() => openCreate(null)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-text"
          >
            <Plus size={16} />
          </button>
        </div>
        <ErrorText error={error} className="mb-3 text-[14px]" />

        {!loaded ? (
          <Delayed>
            <div aria-busy className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[76px] rounded-xl" />
              ))}
            </div>
          </Delayed>
        ) : blank ? (
          <button
            onClick={() => openCreate(null)}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-muted transition-colors hover:border-brand hover:text-text"
          >
            <Plus size={20} />
            <span className="text-[14px]">{t('createFirstProject')}</span>
          </button>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={(e) => setMovingId(String(e.active.id))}
            onDragEnd={(e) => void onProjectDropped(e)}
            onDragCancel={() => setMovingId(null)}
          >
            {sections
              // A group keeps its band even when empty (it's a place to file things into). The
              // headerless ungrouped band would just be a stray tile, so it goes when empty —
              // except mid-drag, when it is the only way back out of a group.
              .filter((s) => s.group !== null || s.projects.length > 0 || !!movingId)
              .map((s) => (
                <GroupSection
                  key={s.group?.id ?? 'ungrouped'}
                  group={s.group}
                  projects={s.projects}
                  collapsed={!!s.group && collapsed.has(s.group.id)}
                  dragging={!!movingId}
                  isAdmin={isAdmin}
                  busy={act.busy}
                  onOpen={onOpen}
                  onDuplicate={(p) => void duplicate(p)}
                  onNewProject={() => openCreate(s.group?.id ?? null)}
                  onToggleCollapse={() => s.group && toggleCollapse(s.group.id)}
                  onRename={() => s.group && setEditing(s.group)}
                  onDelete={() => s.group && void removeGroup(s.group)}
                />
              ))}
            <DragOverlay>
              {movingId && (
                <div className="cursor-grabbing rounded-xl border border-brand bg-surface p-4 text-[15px] font-medium text-text shadow-lg">
                  {projects.find((p) => p.id === movingId)?.name}
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {fileOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="flex w-full max-w-sm flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-brand bg-surface/95 px-6 py-8 shadow-xl">
            <Upload size={26} className="text-brand" />
            <span className="text-[14px] font-medium text-text">{t('dropToImport')}</span>
            <span className="text-[12px] text-faint">{t('importFormats')}</span>
          </div>
        </div>
      )}

      <NewProjectDialog
        open={creating}
        onOpenChange={setCreating}
        groups={groups}
        defaultGroupId={createIn}
        initialFile={droppedFile}
        onCreated={onOpen}
      />
      <GroupDialog target={editing} onClose={() => setEditing(null)} onSaved={refresh} />
    </div>
  );
}

/** Create or rename a group — one field, so one dialog serves both. */
function GroupDialog({
  target,
  onClose,
  onSaved,
}: {
  target: Group | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isNew = target === 'new';

  const form = useDialogForm(!!target, () => {
    setName(isNew ? '' : (target as Group).name);
    requestAnimationFrame(() => inputRef.current?.select());
  });

  const submit = () => {
    if (!target || !name.trim()) return;
    void form.submit(async () => {
      if (isNew) await api.createGroup(name.trim());
      else await api.renameGroup(target.id, name.trim());
      onClose();
      onSaved();
    });
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()} title={isNew ? t('newGroup') : t('renameGroup')}>
      <Input
        ref={inputRef}
        aria-label="group-name"
        placeholder={t('groupNamePlaceholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <ErrorText error={form.error} className="mt-2" />
      <DialogFooter
        onCancel={onClose}
        confirmLabel={isNew ? t('create') : t('save')}
        disabled={!name.trim()}
        busy={form.busy}
        onConfirm={submit}
      />
    </Dialog>
  );
}
