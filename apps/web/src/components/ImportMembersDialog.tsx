import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type Member } from '../api';
import { errorText } from '../lib/errors';
import { cn } from '../lib/utils';
import { Dialog } from './ui/dialog';
import { DialogFooter } from './ui/DialogFooter';
import { ErrorText } from './ui/ErrorText';
import { selectCls } from './ui/select';
import { useDialogForm } from '../hooks/useDialogForm';

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
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);
  const [from, setFrom] = useState('');
  const [roster, setRoster] = useState<Member[]>([]);

  const form = useDialogForm(open, () => {
    setFrom('');
    setRoster([]);
  });

  useEffect(() => {
    if (!open) return;
    api
      .memberSources(projectId)
      .then(setSources)
      .catch((e: unknown) => form.setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- form.setError is stable
  }, [open, projectId]);

  useEffect(() => {
    if (!from) return setRoster([]);
    api
      .listMembers(from)
      .then(setRoster)
      .catch((e: unknown) => form.setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- form.setError is stable
  }, [from]);

  const incoming = roster.filter((m) => !memberIds.has(m.userId));

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
      {sources.length === 0 ? (
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
            {sources.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="mt-3 max-h-56 space-y-1 overflow-auto">
            {roster.map((m) => {
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
      <ErrorText error={form.error} className="mt-2" />
      <DialogFooter
        onCancel={() => onOpenChange(false)}
        confirmLabel={t('import')}
        disabled={form.busy || incoming.length === 0}
        onConfirm={submit}
      />
    </Dialog>
  );
}
