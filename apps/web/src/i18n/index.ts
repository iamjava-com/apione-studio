import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';
import { zh } from './zh';
import { ja } from './ja';

// i18n from day one (project rule): no hardcoded user-facing strings.
// LOCALES is the single source of truth for the language picker — add a language
// here and in resources, nowhere else. Ordered by language code, the usual convention
// for a picker whose labels span scripts and so cannot be sorted meaningfully.
export const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '简体中文' },
] as const;

const resources = {
  en: { translation: en },
  ja: { translation: ja },
  zh: { translation: zh },
};

export const STORAGE_KEY = 'apione-lang';

/** Stored choice, else the browser's preference, else English. */
function initialLang(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && LOCALES.some((l) => l.code === stored)) return stored;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.split('-')[0];
    if (LOCALES.some((l) => l.code === base)) return base!;
  }
  return 'en';
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLang(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// Keep <html lang> in step: it is what a screen reader picks a voice from and what the browser
// spell-checks against, and it was stuck on the build-time value until now.
const syncDocumentLang = (lng: string) => document.documentElement.setAttribute('lang', lng);
syncDocumentLang(i18n.language);
i18n.on('languageChanged', syncDocumentLang);

export default i18n;
