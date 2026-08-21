import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Trash2 } from 'lucide-react';
import { api, type ApiToken, type CreatedApiToken } from '../api';
import { errorText } from '../lib/errors';
import { formatDate } from '../lib/format';
import { useConfirm } from './ConfirmProvider';
import { useDialogForm } from '../hooks/useDialogForm';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog } from './ui/dialog';
import { CopyButton } from './ui/CopyButton';
import { ErrorText } from './ui/ErrorText';

/** The caller's own API tokens: a second way for programs (CI, an AI agent) to sign in as them.
 *  Managing tokens needs the password session, so this is reachable only from the account menu. */
export function ApiTokensDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [name, setName] = useState('');
  const [issued, setIssued] = useState<CreatedApiToken | null>(null);

  const form = useDialogForm(open, () => {
    setName('');
    setIssued(null);
    void refresh();
  });

  function refresh() {
    return api
      .listApiTokens()
      .then(setTokens)
      .catch((e: unknown) => form.setError(errorText(e)));
  }

  const create = () => {
    if (!name.trim()) return;
    void form.submit(async () => {
      setIssued(await api.createApiToken(name.trim()));
      setName('');
      await refresh();
    });
  };

  const revoke = async (tok: ApiToken) => {
    if (
      !(await confirm({
        message: t('confirmRevokeToken', { name: tok.name }),
        confirmLabel: t('revoke'),
        danger: true,
      }))
    )
      return;
    form.setError(null);
    try {
      await api.revokeApiToken(tok.id);
      if (issued?.id === tok.id) setIssued(null);
      await refresh();
    } catch (e) {
      form.setError(errorText(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('apiTokens')}
      headerRight={
        <a
          href="/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-text"
        >
          {t('apiReference')}
          <ExternalLink size={13} />
        </a>
      }
      size="lg"
      // Only while the plaintext is on screen — losing it to a stray backdrop click means minting a new one.
      dismissOnOutside={!issued}
    >
      {issued && <IssuedToken token={issued} />}

      <div className="flex gap-2">
        <Input
          aria-label="token-name"
          placeholder={t('apiTokenNamePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <Button variant="brand" size="sm" disabled={!name.trim() || form.busy} onClick={create}>
          {t('createApiToken')}
        </Button>
      </div>

      <ErrorText error={form.error} className="mt-2" />

      {tokens.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
          {tokens.map((tok) => (
            <li key={tok.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-text">{tok.name}</span>
              <span className="shrink-0 text-[12px] text-faint">
                {tok.lastUsedAt
                  ? t('tokenLastUsed', { date: formatDate(tok.lastUsedAt, i18n.language) })
                  : t('tokenNeverUsed')}
              </span>
              <span className="shrink-0 text-[12px] text-faint">{formatDate(tok.createdAt, i18n.language)}</span>
              <button
                aria-label={`revoke-${tok.name}`}
                title={t('revoke')}
                onClick={() => revoke(tok)}
                className="rounded p-1 text-faint transition-colors hover:text-delete"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <InstallSkill />

      <div className="mt-4 flex justify-end">
        <Button size="sm" onClick={() => onOpenChange(false)}>
          {t('done')}
        </Button>
      </div>
    </Dialog>
  );
}

/** Below the tokens, and titled: at the top it read as an explanation of the list under it, and
 *  nothing said the line was for installing anything. */
function InstallSkill() {
  const { t } = useTranslation();
  const instruction = t('installSkillInstruction', { url: window.location.origin });

  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="text-[13px] font-medium text-text">{t('installSkill')}</p>
      <p className="mt-1 text-[13px] text-muted">{t('installSkillHint')}</p>
      <p aria-label="skill-instruction" className="mt-2 break-all font-mono text-[13px] text-text">
        {instruction}
      </p>
      <CopyButton
        aria-label="copy-instruction"
        text={instruction}
        withLabel
        className="mt-2 flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-text"
      />

      {/* What it is about to do on their machine, before they hand it a credential. */}
      <p className="mt-3 text-[13px] text-muted">{t('installSkillStepsTitle')}</p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[13px] text-faint">
        <li>{t('installSkillStep1')}</li>
        <li>{t('installSkillStep2')}</li>
        <li>{t('installSkillStep3')}</li>
      </ol>
    </div>
  );
}

/** The one and only sighting of the plaintext — the server keeps a hash and cannot show it again.
 *  It stays up until the dialog closes; the backdrop is inert meanwhile (see dismissOnOutside). */
function IssuedToken({ token }: { token: CreatedApiToken }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 rounded-lg border border-brand/40 bg-surface p-3">
      <p className="text-[13px] text-muted">{t('apiTokenOnce')}</p>
      <p aria-label="issued-token" className="mt-2 break-all font-mono text-[13px] text-text">
        {token.plaintext}
      </p>
      <CopyButton
        aria-label="copy-token"
        text={token.plaintext}
        withLabel
        className="mt-2 flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-text"
      />
    </div>
  );
}
