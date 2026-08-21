import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, KeyRound, Trash2, Ban, Check } from 'lucide-react';
import { api, type AdminUser } from '../api';
import { errorText } from '../lib/errors';
import { formatDate } from '../lib/format';
import { cn } from '../lib/utils';
import { useConfirm } from './ConfirmProvider';
import { useDialogForm } from '../hooks/useDialogForm';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog } from './ui/dialog';
import { CopyButton } from './ui/CopyButton';
import { DialogFooter } from './ui/DialogFooter';
import { ErrorText } from './ui/ErrorText';
import { selectCls as baseSelect } from './ui/select';

const selectCls = cn(baseSelect, 'h-7'); // compact for table rows

/** Admin-only console: provision accounts, change global role, enable/disable, reset password,
 *  delete. Self-targeting controls are disabled — the server enforces the same, plus the
 *  last-active-admin invariant. `meId` is the current admin, used to mark and lock their own row. */
export function AdminUsers({ meId }: { meId: string }) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);

  const refresh = () => {
    api
      .listUsers<AdminUser>()
      .then(setUsers)
      .catch((e: unknown) => setError(errorText(e)));
  };
  useEffect(refresh, []);

  // Any mutation shares one error surface; refresh on success.
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const setRole = (u: AdminUser, role: 'admin' | 'member') => run(() => api.adminUpdateUser(u.id, { role }));

  // Disabling signs the user out immediately, so confirm it; enabling is harmless and stays instant.
  const toggleStatus = async (u: AdminUser) => {
    if (
      u.status === 'active' &&
      !(await confirm({ message: t('confirmDisableUser', { name: u.username }), confirmLabel: t('disable') }))
    )
      return;
    void run(() => api.adminUpdateUser(u.id, { status: u.status === 'active' ? 'disabled' : 'active' }));
  };

  const resetPw = async (u: AdminUser) => {
    if (
      !(await confirm({
        message: t('confirmResetPassword', { name: u.username }),
        confirmLabel: t('issueNewPassword'),
      }))
    )
      return;
    setError(null);
    try {
      const { password } = await api.adminResetPassword(u.id);
      setIssued({ username: u.username, password });
    } catch (e) {
      setError(errorText(e));
    }
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
    void run(() => api.adminDeleteUser(u.id));
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
      <ErrorText error={error} className="mb-3 text-[14px]" />

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
            {users.map((u) => {
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
                      disabled={isSelf}
                      onChange={(e) => setRole(u, e.target.value as 'admin' | 'member')}
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
                        className="rounded p-1 text-faint transition-colors hover:bg-raised hover:text-text"
                      >
                        <KeyRound size={14} />
                      </button>
                      <button
                        aria-label={`${disabled ? 'enable' : 'disable'}-${u.username}`}
                        title={disabled ? t('enable') : t('disable')}
                        disabled={isSelf}
                        onClick={() => toggleStatus(u)}
                        className="rounded p-1 text-faint transition-colors hover:bg-raised hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        {disabled ? <Check size={14} /> : <Ban size={14} />}
                      </button>
                      <button
                        aria-label={`delete-${u.username}`}
                        title={t('delete')}
                        disabled={isSelf}
                        onClick={() => remove(u)}
                        className="rounded p-1 text-faint transition-colors hover:text-delete disabled:opacity-30 disabled:hover:text-faint"
                      >
                        <Trash2 size={14} />
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
          refresh();
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
        disabled={!username.trim() || form.busy}
        onConfirm={submit}
      />
    </Dialog>
  );
}
