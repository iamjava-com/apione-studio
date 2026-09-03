import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { errorText } from '../lib/errors';
import { cn } from '../lib/utils';
import { Dialog } from './ui/dialog';
import { DialogFooter } from './ui/DialogFooter';
import { SkeletonRows } from './ui/skeleton';
import { ErrorText } from './ui/ErrorText';
import { selectCls } from './ui/select';
import { useDialogForm } from '../hooks/useDialogForm';
import { useResource } from '../hooks/useResource';

/**
 * Take another project's roster wholesale. Picking the project is the whole decision — everyone
 * on it comes over with the role they hold there, so the list below is a preview, not a chooser.
 * A one-off copy, not a link: the two rosters drift from here, which is the point. Sources are
 * limited by the server to projects the caller already manages members of.
 */
export function ImportMembersDialog({
  projectId,
  memberIds,
  open,
  onOpenChange,
  onImported,
}: {
  projectId: string;
  memberIds: Set<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const { t } = useTranslation();
  const [from, setFrom] = useState('');
  const sources = useResource(() => api.memberSources(projectId), [open, projectId], {
    enabled: open,
    keepPrevious: false,
  });
  // Another source's roster under this source's name would be worse than a blank, so no carry-over.
  const roster = useResource(() => api.listMembers(from), [from], { enabled: !!from, keepPrevious: false });
  const rosterList = from ? roster.data : [];

  const form = useDialogForm(open, () => setFrom(''));

  const incoming = (rosterList ?? []).filter((m) => !memberIds.has(m.userId));
  const readError = sources.error ?? (from ? roster.error : null);

  const submit = () => {
    if (incoming.length === 0) return;
    void form.submit(async () => {
      await api.copyMembers(
        projectId,
        from,
        incoming.map((m) => m.userId),
      );
      onOpenChange(false);
      onImported();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('importMembers')}>
      {sources.data === undefined ? (
        <SkeletonRows rows={2} height="h-8" />
      ) : sources.data.length === 0 ? (
        <p className="text-[13px] text-muted">{t('noCopySources')}</p>
      ) : (
        <>
          <select
            aria-label={t('selectProject')}
            className={cn(selectCls, 'w-full')}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            <option value="">{t('selectProject')}</option>
            {sources.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="mt-3 max-h-56 space-y-1 overflow-auto">
            {rosterList === undefined && <SkeletonRows rows={3} height="h-5" />}
            {(rosterList ?? []).map((m) => {
              const already = memberIds.has(m.userId);
              return (
                <div
                  key={m.userId}
                  className={cn('flex items-center gap-2 text-[13px]', already ? 'text-faint' : 'text-text')}
                >
                  <span className="font-mono">{m.username}</span>
                  <span className="text-[11px] text-faint">{t(`role_${m.role}`)}</span>
                  {already && <span className="text-[11px] text-faint">({t('alreadyMember')})</span>}
                </div>
              );
            })}
          </div>
        </>
      )}
      <ErrorText error={form.error ?? (readError ? errorText(readError) : null)} className="mt-2" />
      <DialogFooter
        onCancel={() => onOpenChange(false)}
        confirmLabel={t('import')}
        disabled={incoming.length === 0}
        busy={form.busy}
        onConfirm={submit}
      />
    </Dialog>
  );
}
