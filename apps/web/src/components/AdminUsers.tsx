import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, KeyRound, Trash2, Ban, Check } from 'lucide-react';
import { api, type AdminUser } from '../api';
import { errorText } from '../lib/errors';
import { formatDate } from '../lib/format';
import { cn } from '../lib/utils';
import { useConfirm } from './ConfirmProvider';
import { useDialogForm } from '../hooks/useDialogForm';
import { useBusy } from '../hooks/useBusy';
import { useResource } from '../hooks/useResource';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog } from './ui/dialog';
import { CopyButton } from './ui/CopyButton';
import { DialogFooter } from './ui/DialogFooter';
import { ErrorText } from './ui/ErrorText';
import { Spinner } from './ui/spinner';
import { SkeletonRows } from './ui/skeleton';
import { selectCls as baseSelect } from './ui/select';

const selectCls = cn(baseSelect, 'h-7'); // compact for table rows

/** Admin-only console: provision accounts, change global role, enable/disable, reset password,
 *  delete. Self-targeting controls are disabled — the server enforces the same, plus the
 *  last-active-admin invariant. `meId` is the current admin, used to mark and lock their own row. */
export function AdminUsers({ meId }: { meId: string }) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const users = useResource(() => api.listUsers<AdminUser>(), []);
  const act = useBusy();

  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);

  // Every mutation re-reads the table on success; failures share the one error line.
  const mutate = (key: string, fn: () => Promise<unknown>) =>
    act.run(key, async () => {
      await fn();
      users.reload();
    });

  const setRole = (u: AdminUser, role: 'admin' | 'member') =>
    mutate(`role:${u.id}`, () => api.adminUpdateUser(u.id, { role }));

  // Disabling signs the user out immediately, so confirm it; enabling is harmless and stays instant.
  const toggleStatus = async (u: AdminUser) => {
    if (
      u.status === 'active' &&
      !(await confirm({ message: t('confirmDisableUser', { name: u.username }), confirmLabel: t('disable') }))
    )
      return;
    void mutate(`status:${u.id}`, () =>
      api.adminUpdateUser(u.id, { status: u.status === 'active' ? 'disabled' : 'active' }),
    );
  };

  const resetPw = async (u: AdminUser) => {
    if (
      !(await confirm({
        message: t('confirmResetPassword', { name: u.username }),
        confirmLabel: t('issueNewPassword'),
      }))
    )
      return;
    await act.run(`reset:${u.id}`, async () => {
      const { password } = await api.adminResetPassword(u.id);
      setIssued({ username: u.username, password });
    });
  };

  const remove = async (u: AdminUser) => {
    if (
      !(await confirm({
        message: t('confirmDeleteUser', { name: u.username }),
        confirmLabel: t('delete'),
        danger: true,
      }))
    )
      return;
    void mutate(`del:${u.id}`, () => api.adminDeleteUser(u.id));
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center gap-2">
        <h2 className="text-[16px] font-semibold tracking-tight">{t('adminUsers')}</h2>
        <button
          aria-label={t('newUser')}
          onClick={() => setCreating(true)}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-text"
        >
          <Plus size={16} />
        </button>
      </div>
      <ErrorText
        error={act.error?.text ?? (users.error ? errorText(users.error) : null)}
        className="mb-3 text-[14px]"
      />

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-[12px] text-faint">
              <th className="px-3 py-2 font-medium">{t('username')}</th>
              <th className="px-3 py-2 font-medium">{t('roleCol')}</th>
              <th className="px-3 py-2 font-medium">{t('statusCol')}</th>
              <th className="px-3 py-2 font-medium">{t('createdCol')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.data === undefined && (
              <tr>
                <td colSpan={5} className="px-3 py-2">
                  <SkeletonRows rows={3} height="h-7" />
                </td>
              </tr>
            )}
            {(users.data ?? []).map((u) => {
              const isSelf = u.id === meId;
              const disabled = u.status === 'disabled';
              return (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <span className={disabled ? 'font-mono text-faint' : 'font-mono text-text'}>{u.username}</span>
                    {isSelf && <span className="ml-1.5 text-[11px] text-brand">({t('selfTag')})</span>}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      aria-label={`role-${u.username}`}
                      className={selectCls}
                      value={u.role}
                      disabled={isSelf || act.locked}
                      onChange={(e) => void setRole(u, e.target.value as 'admin' | 'member')}
                    >
                      <option value="admin">{t('roleAdmin')}</option>
                      <option value="member">{t('roleMember')}</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <span className={disabled ? 'text-delete' : 'text-muted'}>
                      {disabled ? t('statusDisabled') : t('statusActive')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-faint">{formatDate(u.createdAt, i18n.language)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        aria-label={`reset-${u.username}`}
                        title={t('resetPassword')}
                        onClick={() => resetPw(u)}
                        disabled={act.locked}
                        aria-busy={act.busy === `reset:${u.id}` || undefined}
                        className="rounded p-1 text-faint transition-colors hover:bg-raised hover:text-text disabled:pointer-events-none"
                      >
                        {act.busy === `reset:${u.id}` ? <Spinner /> : <KeyRound size={14} />}
                      </button>
                      <button
                        aria-label={`${disabled ? 'enable' : 'disable'}-${u.username}`}
                        title={disabled ? t('enable') : t('disable')}
                        disabled={isSelf || act.locked}
                        aria-busy={act.busy === `status:${u.id}` || undefined}
                        onClick={() => toggleStatus(u)}
                        className={cn(
                          'rounded p-1 text-faint transition-colors hover:bg-raised hover:text-text disabled:opacity-30 disabled:hover:bg-transparent',
                          act.busy === `status:${u.id}` && 'disabled:opacity-100',
                        )}
                      >
                        {act.busy === `status:${u.id}` ? (
                          <Spinner />
                        ) : disabled ? (
                          <Check size={14} />
                        ) : (
                          <Ban size={14} />
                        )}
                      </button>
                      <button
                        aria-label={`delete-${u.username}`}
                        title={t('delete')}
                        disabled={isSelf || act.locked}
                        aria-busy={act.busy === `del:${u.id}` || undefined}
                        onClick={() => remove(u)}
                        className={cn(
                          'rounded p-1 text-faint transition-colors hover:text-delete disabled:opacity-30 disabled:hover:text-faint',
                          act.busy === `del:${u.id}` && 'disabled:opacity-100',
                        )}
                      >
                        {act.busy === `del:${u.id}` ? <Spinner /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <CreateUserDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(cred) => {
          setCreating(false);
          setIssued(cred);
          users.reload();
        }}
      />
      <CredentialsDialog cred={issued} onClose={() => setIssued(null)} />
    </div>
  );
}

/** Copy-friendly handoff block shown once a password is issued: login URL + username + password.
 *  We never store the plaintext, so this is the admin's only chance to capture it. */
function CredentialsPanel({ username, password }: { username: string; password: string }) {
  const { t } = useTranslation();
  const url = window.location.origin;
  const rows: [string, string][] = [
    [t('loginUrl'), url],
    [t('username'), username],
    [t('password'), password],
  ];

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">{t('credentialsOnce')}</p>
      <div className="space-y-1.5 rounded-lg border border-border bg-surface p-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-3 text-[13px]">
            <span className="w-16 shrink-0 text-faint">{label}</span>
            <span
              aria-label={label === t('password') ? 'issued-password' : undefined}
              className="break-all font-mono text-text"
            >
              {value}
            </span>
          </div>
        ))}
      </div>
      <CopyButton
        aria-label="copy-credentials"
        text={rows.map(([l, v]) => `${l}: ${v}`).join('\n')}
        withLabel
        className="flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-text"
      />
    </div>
  );
}

/** Shared handoff dialog: shown after a create or reset issues a password. */
function CredentialsDialog({
  cred,
  onClose,
}: {
  cred: { username: string; password: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={!!cred}
      onOpenChange={(o) => !o && onClose()}
      title={t('credentialsTitle')}
      // The password exists only here — a stray backdrop click would cost the admin a re-issue.
      dismissOnOutside={false}
    >
      {cred && <CredentialsPanel username={cred.username} password={cred.password} />}
      <div className="mt-4 flex justify-end">
        <Button size="sm" onClick={onClose}>
          {t('done')}
        </Button>
      </div>
    </Dialog>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (cred: { username: string; password: string }) => void;
}) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const firstRef = useRef<HTMLInputElement>(null);
  const form = useDialogForm(open, () => {
    setUsername('');
    setRole('member');
    requestAnimationFrame(() => firstRef.current?.focus());
  });

  const submit = () => {
    if (!username.trim()) return;
    void form.submit(async () => {
      const { password } = await api.adminCreateUser(username.trim(), role);
      onCreated({ username: username.trim(), password });
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('newUser')}>
      <div className="space-y-2">
        <Input
          ref={firstRef}
          aria-label="new-user-username"
          placeholder={t('username')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <select
          aria-label="new-user-role"
          className={cn(selectCls, 'w-full')}
          value={role}
          onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
        >
          <option value="member">{t('roleMember')}</option>
          <option value="admin">{t('roleAdmin')}</option>
        </select>
      </div>
      <ErrorText error={form.error} className="mt-2" />
      <DialogFooter
        onCancel={() => onOpenChange(false)}
        confirmLabel={t('create')}
        disabled={!username.trim()}
        busy={form.busy}
        onConfirm={submit}
      />
    </Dialog>
  );
}
