import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Users } from 'lucide-react';
import { api, type AuthUser, type Member } from '../api';
import { errorText } from '../lib/errors';
import { useConfirm } from './ConfirmProvider';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { ErrorText } from './ui/ErrorText';
import { selectCls } from './ui/select';
import { useCombobox } from '../hooks/useCombobox';
import { useBusy } from '../hooks/useBusy';
import { ImportMembersDialog } from './ImportMembersDialog';

const ROLES = ['owner', 'editor', 'tester', 'viewer'];
const rowSelectCls = cn(selectCls, 'h-7'); // compact for member rows

/**
 * Combobox to pick a user from the directory: open to see everyone, type to filter, pick one.
 * Users already on the project stay visible but are shown disabled with an "added" tag — so the
 * roster is legible — and only addable users are keyboard-selectable. No free-text: pick from list.
 */
function UserPicker({
  users,
  memberIds,
  value,
  onSelect,
}: {
  users: AuthUser[];
  memberIds: Set<string>;
  value: AuthUser | null;
  onSelect: (u: AuthUser) => void;
}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { open, setOpen, query, active, setActive, onQueryChange, onKeyDown } = useCombobox([rootRef]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const q = query.trim().toLowerCase();
  const matched = users.filter((u) => u.username.toLowerCase().includes(q));
  const addable = matched.filter((u) => !memberIds.has(u.id));
  const added = matched.filter((u) => memberIds.has(u.id));

  const choose = (u: AuthUser) => {
    onSelect(u);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative flex-1">
      <button
        type="button"
        aria-label={t('selectUser')}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center gap-1.5 rounded-md border border-border bg-bg px-2 text-left text-[13px] outline-none focus:border-brand"
      >
        <span className={cn('flex-1 truncate', value ? 'text-text' : 'text-faint')}>
          {value ? value.username : t('selectUser')}
        </span>
        <ChevronDown size={14} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 max-h-64 w-full min-w-44 overflow-auto rounded-md border border-border bg-surface p-1 shadow-lg">
          <input
            ref={inputRef}
            aria-label={`${t('selectUser')}-search`}
            className="mb-1 w-full rounded bg-bg px-2 py-1 text-[13px] text-text outline-none placeholder:text-faint"
            placeholder={t('selectUser')}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown(addable.length, (i) => addable[i] && choose(addable[i]))}
          />
          {matched.length === 0 && <div className="px-2 py-1 text-[12px] text-faint">—</div>}
          {addable.map((u, i) => (
            <button
              key={u.id}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(u)}
              className={cn(
                'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[13px]',
                i === active ? 'bg-raised text-text' : 'text-muted',
              )}
            >
              <span className="flex-1 truncate">{u.username}</span>
            </button>
          ))}
          {added.map((u) => (
            <div
              key={u.id}
              className="flex w-full cursor-not-allowed items-center gap-1.5 rounded px-2 py-1 text-[13px] text-faint"
            >
              <span className="flex-1 truncate">{u.username}</span>
              <span className="text-[11px]">{t('alreadyMember')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Project roster. Every member sees it — knowing who owns the project is how you know who to ask
 * for review or for write access. `canManage` (owner/admin) turns it into an editor: without it
 * the list is names and roles, and the server refuses the mutations regardless.
 */
export function Members({
  projectId,
  meId,
  canManage,
  members,
  reload,
}: {
  projectId: string;
  meId: string;
  canManage: boolean;
  members: Member[];
  reload: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [selected, setSelected] = useState<AuthUser | null>(null);
  const [role, setRole] = useState('viewer');
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const act = useBusy();

  useEffect(() => {
    if (!canManage) return; // the directory only feeds the add-member picker
    api
      .listUsers()
      .then(setUsers)
      .catch(() => {});
  }, [canManage]);

  const memberIds = new Set(members.map((m) => m.userId));

  const add = () => {
    if (!selected) return;
    void act.run('add', async () => {
      setError(null);
      try {
        await api.addMember(projectId, selected.username, role);
        setSelected(null);
        reload();
      } catch (e) {
        setError(errorText(e));
      }
    });
  };
  const changeRole = (m: Member, next: string) =>
    act.run(`role:${m.userId}`, async () => {
      setError(null);
      try {
        await api.updateMemberRole(projectId, m.userId, next);
      } catch (e) {
        setError(errorText(e));
      }
      reload(); // the server's answer either way — success or the value it kept
    });
  const remove = async (m: Member) => {
    if (
      !(await confirm({
        message: t('confirmRemoveMember', { name: m.username }),
        confirmLabel: t('remove'),
        danger: true,
      }))
    )
      return;
    await act.run(`rm:${m.userId}`, async () => {
      setError(null);
      try {
        await api.removeMember(projectId, m.userId);
        reload();
      } catch (e) {
        setError(errorText(e));
      }
    });
  };
  const owners = members.filter((m) => m.role === 'owner').length;

  return (
    <div className="space-y-2 p-3">
      {canManage && (
        <>
          <div className="flex gap-1.5">
            <UserPicker users={users} memberIds={memberIds} value={selected} onSelect={setSelected} />
            <select
              aria-label={t('roleCol')}
              className={selectCls}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`role_${r}`)}
                </option>
              ))}
            </select>
            <Button size="sm" disabled={!selected || act.locked} busy={act.busy === 'add'} onClick={add}>
              {t('addMember')}
            </Button>
          </div>
          <Button size="sm" className="w-full justify-center gap-1.5" onClick={() => setCopying(true)}>
            <Users size={14} /> {t('importMembers')}
          </Button>
        </>
      )}
      <ErrorText error={error} />
      {members.length === 0 && <p className="text-[14px] text-muted">—</p>}
      {members.map((m) => {
        const disabled = m.status === 'disabled';
        const isSelf = m.userId === meId;
        const lastOwner = m.role === 'owner' && owners === 1;
        // A project must keep an owner, and you shouldn't lock yourself out — the server enforces
        // both, but disabling here makes the reason legible instead of surfacing a 409.
        const locked = isSelf || lastOwner;
        return (
          <div key={m.userId} className="flex items-center gap-2 text-[13px]">
            <span className={cn('font-mono', disabled && 'text-faint')}>{m.username}</span>
            {isSelf && <span className="text-[11px] text-brand">({t('selfTag')})</span>}
            {disabled && <span className="text-[11px] text-delete">{t('statusDisabled')}</span>}
            <div className="flex-1" />
            {canManage ? (
              <>
                <select
                  aria-label={`role-${m.username}`}
                  className={rowSelectCls}
                  value={m.role}
                  disabled={locked || act.locked}
                  title={lastOwner ? t('lastOwnerHint') : undefined}
                  onChange={(e) => void changeRole(m, e.target.value)}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`role_${r}`)}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`remove-${m.username}`}
                  disabled={locked || act.locked}
                  busy={act.busy === `rm:${m.userId}`}
                  title={lastOwner ? t('lastOwnerHint') : undefined}
                  onClick={() => remove(m)}
                >
                  ✕
                </Button>
              </>
            ) : (
              <span className="text-[12px] text-muted">{t(`role_${m.role}`)}</span>
            )}
          </div>
        );
      })}
      {canManage && (
        <ImportMembersDialog
          projectId={projectId}
          memberIds={memberIds}
          open={copying}
          onOpenChange={setCopying}
          onImported={reload}
        />
      )}
    </div>
  );
}
