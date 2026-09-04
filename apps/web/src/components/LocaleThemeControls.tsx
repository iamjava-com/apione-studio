import { useTranslation } from 'react-i18next';
import { Check, Globe, Moon, Sun } from 'lucide-react';
import { useTheme } from '../theme';
import { LOCALES, STORAGE_KEY } from '../i18n';
import { Button } from './ui/button';

/** Theme toggle + language picker — shared by the app header and the auth gate so both are
 *  reachable before and after login. */
export function LocaleThemeControls() {
  const { i18n } = useTranslation();
  const { theme, toggle } = useTheme();

  const setLang = (code: string) => {
    void i18n.changeLanguage(code);
    localStorage.setItem(STORAGE_KEY, code);
  };

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" aria-label="toggle theme" onClick={toggle}>
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </Button>
      {/* Hover or focus reveals the locale list (room to grow); focus is what keyboard and touch
          have, and switching language must not be reserved for a mouse. */}
      <div className="group relative">
        <Button variant="ghost" size="icon" aria-label="switch-language">
          <Globe size={15} />
        </Button>
        <div className="invisible absolute right-0 top-full z-30 min-w-28 -translate-y-1 rounded-md border border-border bg-surface p-1 opacity-0 shadow-lg transition-[opacity,translate,visibility] duration-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
          {LOCALES.map((l) => (
            <button
              key={l.code}
              onClick={() => setLang(l.code)}
              className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-[14px] hover:bg-raised ${
                i18n.language === l.code ? 'text-text' : 'text-muted'
              }`}
            >
              {l.label}
              {i18n.language === l.code && <Check size={13} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
