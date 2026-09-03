import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, type ExportFormat, type Group, type Member, type Project } from '../api';
import { errorText } from '../lib/errors';
import { useConfirm } from './ConfirmProvider';
import { useBusy } from '../hooks/useBusy';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { ErrorText } from './ui/ErrorText';
import { Input } from './ui/input';
import { Dialog } from './ui/dialog';
import { selectCls } from './ui/select';
import { Members } from './Members';
import { SkeletonRows } from './ui/skeleton';

type Section = 'general' | 'members' | 'export' | 'replace' | 'danger';

const MIME: Record<ExportFormat, string> = {
  yaml: 'application/yaml',
  json: 'application/json',
  html: 'text/html',
};

/** Throws on failure — nothing visible happens when a download does not start, so the caller has
 *  to be the one to say so. */
async function download(project: Project, format: ExportFormat, opts: { stripExt?: boolean; releasedOnly?: boolean }) {
  const text = await api.exportSpec(project.id, format, opts);
  const blob = new Blob([text], { type: MIME[format] });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safe = project.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'spec';
  a.download = `${safe}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Project settings: members, export, replace-from-file, danger zone. Opened from the workspace. */
export function SettingsDialog({
  open,
  onOpenChange,
  project,
  meId,
  canWrite,
  canManage,
  canReadMembers,
  onReplaced,
  onRenamed,
  onDeleted,
  onLeft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  meId: string;
  canWrite: boolean;
  canManage: boolean;
  canReadMembers: boolean;
  onReplaced: () => void;
  onRenamed: () => void;
  onDeleted: () => void;
  onLeft: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [section, setSection] = useState<Section>('general');
  const [stripExt, setStripExt] = useState(false);
  const [releasedOnly, setReleasedOnly] = useState(false);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  // One action at a time across every section: a second click lands on a disabled button.
  const act = useBusy();
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [dangerError, setDangerError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  // Owned here rather than in the roster panel: it also decides whether the caller has an exit,
  // and two copies of one list are two chances to disagree.
  const [members, setMembers] = useState<Member[] | null>(null);
  // Distinct from an empty roster: an empty list reads as "nobody is on this project".
  const [membersDenied, setMembersDenied] = useState(false);
  const loadMembers = useCallback(() => {
    if (!canReadMembers) return;
    api
      .listMembers(project.id)
      .then((m) => {
        setMembers(m);
        setMembersDenied(false);
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 403) setMembersDenied(true);
        setMembers([]);
      });
  }, [project.id, canReadMembers]);
  useEffect(() => {
    if (open) loadMembers();
  }, [open, loadMembers]);
  // Optimistic so the select doesn't snap back while the project list re-reads.
  const [groupId, setGroupId] = useState<string | null>(project.groupId);
  useEffect(() => setGroupId(project.groupId), [project.groupId]);
  useEffect(() => {
    if (!open || !canManage) return;
    api
      .listGroups()
      .then(setGroups)
      .catch(() => {});
  }, [open, canManage]);
  const isMember = members !== null && members.some((m) => m.userId === meId);

  const sections: { id: Section; label: string }[] = [
    ...(canManage ? [{ id: 'general' as const, label: t('general') }] : []),
    ...(canReadMembers ? [{ id: 'members' as const, label: t('members') }] : []),
    { id: 'export' as const, label: t('export') },
    ...(canWrite ? [{ id: 'replace' as const, label: t('import') }] : []),
    // Danger zone hosts both exits: only owners/admin can delete, any member can leave.
    ...(isMember || canManage ? [{ id: 'danger' as const, label: t('dangerZone') }] : []),
  ];
  // Permissions can resolve after mount (`can` answers optimistically), so the chosen section may no
  // longer be visible — fall back to the first section the user can actually access.
  const active: Section = sections.some((s) => s.id === section) ? section : (sections[0]?.id ?? 'export');

  const runExport = (format: ExportFormat, strip: boolean) =>
    act.run(`export:${format}`, async () => {
      setExportError(null);
      try {
        await download(project, format, { stripExt: strip, releasedOnly });
      } catch (err) {
        setExportError(errorText(err));
      }
    });

  const saveName = () => {
    const name = nameDraft.trim();
    if (!name || name === project.name) return;
    void act.run('rename', async () => {
      setRenameError(null);
      try {
        await api.updateProject(project.id, { name });
        onRenamed();
      } catch (err) {
        setRenameError(errorText(err));
      }
    });
  };

  const moveToGroup = (groupId: string | null) =>
    act.run('group', async () => {
      setRenameError(null);
      try {
        await api.updateProject(project.id, { groupId });
        onRenamed(); // same refresh path — the list re-reads the project either way
      } catch (err) {
        setRenameError(errorText(err));
      }
    });

  const onReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!(await confirm({ message: t('replaceConfirm'), confirmLabel: t('overwriteImport'), danger: true }))) return;
    await act.run('replace', async () => {
      setReplaceError(null);
      try {
        await api.importSpec(project.id, await file.text());
        onReplaced();
        onOpenChange(false);
      } catch (err) {
        setReplaceError(errorText(err));
      }
    });
  };
  const remove = async () => {
    if (
      !(await confirm({
        message: t('confirmDeleteProject', { name: project.name }),
        confirmLabel: t('delete'),
        danger: true,
        requireText: project.name,
      }))
    )
      return;
    await act.run('delete', async () => {
      // Closing on failure would look exactly like success, and the project is still there.
      try {
        await api.deleteProject(project.id);
      } catch (err) {
        setDangerError(errorText(err));
        return;
      }
      onOpenChange(false);
      onDeleted();
    });
  };
  const leave = async () => {
    if (
      !(await confirm({
        message: t('confirmLeaveProject', { name: project.name }),
        confirmLabel: t('leave'),
        danger: true,
      }))
    )
      return;
    await act.run('leave', async () => {
      setLeaveError(null);
      try {
        await api.leaveProject(project.id);
        onOpenChange(false);
        onLeft();
      } catch (err) {
        // A sole owner can't leave — spell out the way out rather than the raw invariant.
        setLeaveError(err instanceof ApiError && err.code === 'last_owner' ? t('soleOwnerCantLeave') : errorText(err));
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('settings')} size="lg">
      <div className="flex min-h-[320px] gap-4">
        <div className="w-28 shrink-0 space-y-0.5 border-r border-border pr-2">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                'block w-full rounded px-2 py-1 text-left text-[14px]',
                active === s.id ? 'bg-raised text-text' : 'text-muted hover:text-text',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          {active === 'general' && (
            <div className="space-y-3 p-1">
              <label className="block text-[13px] text-muted">
                {t('projectName')}
                <div className="mt-1 flex gap-2">
                  <Input
                    aria-label="project-name"
                    className="flex-1"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveName()}
                  />
                  <Button
                    size="sm"
                    disabled={!nameDraft.trim() || nameDraft.trim() === project.name || act.locked}
                    busy={act.busy === 'rename'}
                    onClick={saveName}
                  >
                    {t('save')}
                  </Button>
                </div>
              </label>
              <label className="block text-[13px] text-muted">
                {t('projectGroup')}
                <select
                  aria-label="project-group"
                  className={cn(selectCls, 'mt-1 w-full')}
                  value={groupId ?? ''}
                  disabled={act.locked}
                  onChange={(e) => {
                    const next = e.target.value || null;
                    setGroupId(next);
                    void moveToGroup(next);
                  }}
                >
                  <option value="">{t('ungrouped')}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <ErrorText error={renameError} />
            </div>
          )}

          {active === 'members' &&
            (membersDenied ? (
              <p className="p-3 text-[14px] text-muted">{t('needOwner')}</p>
            ) : members === null ? (
              <SkeletonRows rows={3} className="p-1" />
            ) : (
              <Members
                projectId={project.id}
                meId={meId}
                canManage={canManage}
                members={members}
                reload={loadMembers}
              />
            ))}

          {active === 'export' && (
            <div className="space-y-3 p-1">
              <p className="text-[14px] text-muted">{t('exportHint')}</p>
              {/* Above the two buttons it qualifies — a choice you make before you act on it. The
                  rendered page below always keeps every extension, because they are what shapes it. */}
              <label className="flex w-fit items-center gap-1.5 text-[13px] text-muted">
                <input type="checkbox" checked={stripExt} onChange={(e) => setStripExt(e.target.checked)} />
                {t('exportStripExt')}
              </label>
              {/* Applies to the page below too, which is why it sits above both. */}
              <label className="flex w-fit items-center gap-1.5 text-[13px] text-muted">
                <input type="checkbox" checked={releasedOnly} onChange={(e) => setReleasedOnly(e.target.checked)} />
                {t('exportReleasedOnly')}
              </label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={act.locked}
                  busy={act.busy === 'export:yaml'}
                  onClick={() => void runExport('yaml', stripExt)}
                >
                  {t('export')} .yaml
                </Button>
                <Button
                  size="sm"
                  disabled={act.locked}
                  busy={act.busy === 'export:json'}
                  onClick={() => void runExport('json', stripExt)}
                >
                  {t('export')} .json
                </Button>
              </div>
              <div className="border-t border-border pt-3">
                <Button
                  size="sm"
                  disabled={act.locked}
                  busy={act.busy === 'export:html'}
                  onClick={() => void runExport('html', false)}
                >
                  {t('export')} .html
                </Button>
              </div>
              <ErrorText error={exportError} />
            </div>
          )}

          {active === 'replace' && (
            <div className="space-y-3 p-1">
              <p className="text-[14px] text-muted">{t('replaceHint')}</p>
              <input
                ref={replaceRef}
                type="file"
                accept=".json,.yaml,.yml,application/json,application/yaml"
                className="hidden"
                aria-label="replace-spec-file"
                onChange={onReplaceFile}
              />
              <Button
                size="sm"
                disabled={act.locked}
                busy={act.busy === 'replace'}
                onClick={() => replaceRef.current?.click()}
              >
                {t('overwriteImport')}
              </Button>
              <ErrorText error={replaceError} />
            </div>
          )}

          {active === 'danger' && (
            <div className="space-y-5 p-1">
              {canManage && (
                <div className="space-y-2">
                  <p className="text-[14px] text-muted">{t('dangerHint')}</p>
                  <Button
                    size="sm"
                    className="border-delete text-delete hover:bg-delete/10"
                    disabled={act.locked}
                    busy={act.busy === 'delete'}
                    onClick={remove}
                  >
                    {t('deleteProject')}
                  </Button>
                  <ErrorText error={dangerError} />
                </div>
              )}
              {isMember && (
                <div className="space-y-2">
                  <p className="text-[14px] text-muted">{t('leaveHint')}</p>
                  <Button
                    size="sm"
                    className="border-delete text-delete hover:bg-delete/10"
                    disabled={act.locked}
                    busy={act.busy === 'leave'}
                    onClick={leave}
                  >
                    {t('leaveProject')}
                  </Button>
                  <ErrorText error={leaveError} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
