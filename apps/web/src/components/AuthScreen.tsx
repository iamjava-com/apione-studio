import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, token, type AuthUser } from '../api';
import { errorText } from '../lib/errors';
import { LocaleThemeControls } from './LocaleThemeControls';
import { Logo } from './Logo';
import { Button } from './ui/button';
import { ErrorText } from './ui/ErrorText';
import { Input } from './ui/input';

/**
 * The gate: on first run (no admin yet) it creates the admin; otherwise it logs in.
 * There is no open mode — the app is unreachable until you're authenticated.
 */
export function AuthScreen({ needsSetup, onAuthed }: { needsSetup: boolean; onAuthed: (user: AuthUser) => void }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const userRef = useRef<HTMLInputElement>(null);

  useEffect(() => userRef.current?.focus(), []);

  const submit = async () => {
    if (!username.trim() || !password || busy) return;
    setError(null);
    setBusy(true);
    try {
      const r = needsSetup ? await api.register(username.trim(), password) : await api.login(username.trim(), password);
      if (r.token) token.set(r.token);
      onAuthed(r.user);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-full items-center justify-center bg-bg px-6">
      <div className="absolute right-4 top-4">
        <LocaleThemeControls />
      </div>
      <div className="w-full max-w-xs">
        <div className="mb-6 flex items-center gap-2">
          <Logo className="h-4 w-4 text-logo" />
          <span className="text-[16px] font-semibold tracking-tight">
            ApiOne <span className="font-normal text-muted">Studio</span>
          </span>
        </div>
        <h1 className="text-[16px] font-semibold text-text">{needsSetup ? t('setupTitle') : t('login')}</h1>
        {!needsSetup && <p className="mt-1 text-[13px] text-muted">{t('loginHint')}</p>}

        <div className="mt-4 space-y-2">
          <Input
            ref={userRef}
            aria-label="auth-username"
            className="w-full"
            placeholder={t('username')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <Input
            aria-label="auth-password"
            type="password"
            className="w-full"
            placeholder={t('password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <ErrorText error={error} />
          <Button
            aria-label="auth-submit"
            variant="brand"
            className="w-full"
            disabled={!username.trim() || !password}
            busy={busy}
            onClick={submit}
          >
            {needsSetup ? t('setupAdmin') : t('login')}
          </Button>
        </div>
      </div>
    </div>
  );
}
