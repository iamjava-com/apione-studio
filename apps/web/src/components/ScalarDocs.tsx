import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';
import { api } from '../api';
import { serverBasePaths } from '../lib/base-path';
import { useTheme } from '../theme';
import { PaneLoading } from './ui/pane-loading';

/** Scalar docs rendered INLINE (no iframe): shares our DOM, fonts, and theme. */
export function ScalarDocs({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  // Fetch the bundled spec ourselves (with the auth token) and hand it to Scalar as
  // `content` — Scalar's own fetch wouldn't carry our JWT, so the gated URL would 401.
  // Also gives a clean empty state when the project has no spec yet.
  const [state, setState] = useState<'loading' | 'ready' | 'empty'>('loading');
  const [spec, setSpec] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    api
      .exportSpec(projectId, 'json')
      .then((text) => {
        if (cancelled) return;
        setSpec(text);
        setState('ready');
      })
      .catch(() => !cancelled && setState('empty'));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Scalar resolves the color mode once, at mount: body.dark-mode/.light-mode carries every
  // --scalar-* var, and a config update never re-applies it. Drive the class ourselves so a
  // theme toggle repaints the docs in place instead of needing a remount.
  useEffect(() => {
    const { classList } = document.body;
    classList.toggle('dark-mode', theme === 'dark');
    classList.toggle('light-mode', theme !== 'dark');
  }, [theme]);

  // Our Mock first so "Send" always has a live target, then the real servers the author declared —
  // a reader needs to see where the API actually answers. Runtime-only: never written to the
  // spec/export.
  //
  // One Mock entry per distinct base path, in declaration order. Per *base*, not per server:
  // prod and staging routinely differ only in host, and two entries with the same URL would be a
  // choice with no difference. The base has to be there at all because the gateway serves an
  // endpoint behind it and nowhere else — a bare /mock/{id} would make every "Send" a 404.
  const servers = useMemo(() => {
    let declared: unknown[] = [];
    try {
      const parsed = spec ? JSON.parse(spec) : null;
      if (Array.isArray(parsed?.servers)) declared = parsed.servers;
    } catch {
      /* spec not JSON-parseable — Mock alone is a fine fallback */
    }
    const mocks = serverBasePaths(declared).map((base) => ({
      url: `/mock/${projectId}${base}`,
      description: t('docsMockServer'),
    }));
    return [...mocks, ...declared];
  }, [spec, projectId, t]);

  if (state === 'empty') {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div className="max-w-sm space-y-2">
          <p className="text-[16px] text-text">{t('docsEmptyTitle')}</p>
          <p className="text-[14px] text-muted">{t('docsEmptyHint')}</p>
        </div>
      </div>
    );
  }
  if (state === 'loading') return <PaneLoading />;

  return (
    <div className="scalar-docs h-full overflow-auto">
      <ApiReferenceReact
        configuration={{
          content: spec ?? undefined, // pre-fetched with auth; avoids Scalar's unauthenticated fetch
          servers, // Mock first (default-selected) + author's real servers; not persisted
          darkMode: theme === 'dark', // sync to our single theme source
          forceDarkModeState: theme,
          hideDarkModeToggle: true, // we own the toggle globally
          withDefaultFonts: false, // use our fonts (brand + CJK fallback)
          agent: { disabled: true }, // drop Scalar's "Ask AI" / "Ask AI Agent" (localhost-default-on)
          showDeveloperTools: 'never', // hide Scalar's dev toolbar; keep the UI ours
          documentDownloadType: 'none', // download lives in Settings → Export (single, on-brand path)
        }}
      />
    </div>
  );
}
