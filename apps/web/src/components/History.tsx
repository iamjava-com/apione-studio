import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type BreakingReport, type VersionMeta } from '../api';
import { errorText } from '../lib/errors';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { useConfirm } from './ConfirmProvider';
import { DiffPane } from './DiffPane';

/** A version's author → a friendly label: who (@username) + how (imported / restored / external). */
function authorLabel(v: VersionMeta, t: (k: string, o?: Record<string, unknown>) => string): string {
  const who = v.authorRef ? `@${v.authorRef}` : '';
  const tag = (s: string) => (who ? `${who} · ${s}` : s);
  switch (v.authorType) {
    case 'import':
      return tag(t('authorImport'));
    case 'restore':
      return tag(t('authorRestore', { v: v.sourceVersion ?? '?' }));
    case 'external':
      return t('authorExternal');
    case 'system':
      return t('authorSystem');
    default:
      return who || v.authorType;
  }
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];
function relTime(ts: number, lang: string): string {
  const diff = ts - Date.now(); // negative = past
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  for (const [unit, ms] of UNITS) if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  return rtf.format(0, 'second');
}

/** Version history: pick two versions, see the text diff + a breaking-change summary, and restore. */
export function History({
  projectId,
  path,
  dirty,
  editorVersion,
  focus,
  onRestored,
}: {
  projectId: string;
  path: string;
  dirty: boolean;
  editorVersion: number; // the version the editor is on → marked "current" (may lag the server head)
  focus: { base: number; target: number } | null; // jump to a specific comparison (e.g. from a conflict)
  onRestored: () => void;
}) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const focusApplied = useRef(false);
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [head, setHead] = useState(0); // the current version number
  const [target, setTarget] = useState<number | null>(null); // version being inspected (right side)
  const [base, setBase] = useState<number | 'prev'>('prev'); // compare against (left side)
  const [baseText, setBaseText] = useState<string | null>(null);
  const [targetText, setTargetText] = useState<string | null>(null);
  const [breaking, setBreaking] = useState<BreakingReport | null>(null);
  const [expandAll, setExpandAll] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [showBreakList, setShowBreakList] = useState(false);

  const baseNo = target != null ? (base === 'prev' ? target - 1 : base) : 0;
  const hasBase = target != null && baseNo >= 1;

  const load = useCallback(() => {
    api
      .listVersions(projectId, path)
      .then((r) => {
        setVersions(r.versions);
        setHead(r.currentVersion);
        if (!focusApplied.current) {
          setTarget(r.currentVersion || null); // default: inspect the latest save
          setBase('prev');
        }
      })
      .catch(() => {
        setVersions([]);
        if (!focusApplied.current) setTarget(null);
      });
  }, [projectId, path]);
  useEffect(load, [load]);

  // A new file resets the "did an external request set the comparison?" latch.
  useEffect(() => {
    focusApplied.current = false;
  }, [projectId, path]);

  // Conflict "view diff" (or any external request) forces a specific base → target.
  useEffect(() => {
    if (!focus) return;
    focusApplied.current = true;
    setBase(focus.base);
    setTarget(focus.target);
  }, [focus]);

  // Fetch both sides + the breaking summary whenever the base→target selection changes.
  useEffect(() => {
    if (target == null || !hasBase) {
      setBaseText(null);
      setTargetText(null);
      setBreaking(null);
      return;
    }
    let live = true;
    setShowBreakList(false);
    Promise.all([api.getVersionContent(projectId, path, baseNo), api.getVersionContent(projectId, path, target)])
      .then(([b, tg]) => {
        if (!live) return;
        setBaseText(b.content);
        setTargetText(tg.content);
      })
      .catch(() => {
        if (!live) return;
        setBaseText(null);
        setTargetText(null);
      });
    api
      .breaking(projectId, baseNo, target)
      .then((r) => live && setBreaking(r))
      .catch(() => live && setBreaking(null));
    return () => {
      live = false;
    };
  }, [projectId, path, target, baseNo, hasBase]);

  const restore = async (n: number) => {
    const message = dirty ? t('restoreConfirmDirty') : '';
    if (!(await confirm({ title: t('restoreConfirmTitle', { v: n }), message, confirmLabel: t('restore') }))) return;
    // Reloading the editor on a failed restore would show the file unchanged and call it done.
    setRestoreError(null);
    try {
      await api.restoreVersion(projectId, path, n);
    } catch (err) {
      setRestoreError(errorText(err));
      return;
    }
    onRestored();
    load();
  };

  const olderThanTarget = versions.filter((v) => target != null && v.versionNo < target);

  return (
    <div className="flex h-full flex-col">
      {restoreError && (
        <div className="border-b border-delete bg-delete/10 px-3 py-2 text-[13px] text-delete">{restoreError}</div>
      )}
      {/* version list (spine) — click a row to inspect it */}
      <div className="max-h-44 overflow-auto border-b border-border">
        {versions.length === 0 && <p className="p-3 text-[14px] text-muted">—</p>}
        {versions.map((v) => (
          <button
            key={v.versionNo}
            onClick={() => {
              setTarget(v.versionNo);
              setBase('prev');
            }}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-raised',
              target === v.versionNo && 'bg-raised',
            )}
          >
            <span className="w-8 shrink-0 font-mono text-text">v{v.versionNo}</span>
            <span className="truncate text-muted">{authorLabel(v, t)}</span>
            {v.versionNo === editorVersion && (
              <span className="shrink-0 rounded-full bg-border px-1.5 py-0.5 text-[10px] text-muted">
                {t('current')}
              </span>
            )}
            <span className="ml-auto shrink-0 whitespace-nowrap text-faint">{relTime(v.createdAt, i18n.language)}</span>
          </button>
        ))}
      </div>

      {target == null ? null : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* compare controls */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <span className="text-[12px] text-muted">{t('compareBase')}</span>
            <select
              aria-label="compare-base"
              className="h-7 rounded-md border border-border bg-bg px-1.5 text-[12px] text-text outline-none focus:border-brand"
              value={base}
              onChange={(e) => setBase(e.target.value === 'prev' ? 'prev' : Number(e.target.value))}
            >
              <option value="prev">{t('comparePrev')}</option>
              {olderThanTarget.map((v) => (
                <option key={v.versionNo} value={v.versionNo}>
                  v{v.versionNo}
                </option>
              ))}
            </select>
            <span className="font-mono text-[12px] text-faint">
              {hasBase ? `v${baseNo}` : '—'} → v{target}
            </span>
            <button
              className="text-[12px] text-muted underline-offset-2 hover:text-text hover:underline"
              onClick={() => setExpandAll((x) => !x)}
            >
              {expandAll ? t('diffOnlyChanged') : t('diffAll')}
            </button>
            <div className="flex-1" />
            {target < head && (
              <Button size="sm" onClick={() => void restore(target)}>
                {t('restoreTo', { v: target })}
              </Button>
            )}
          </div>

          {/* breaking-change summary for the same base → target */}
          {hasBase && breaking && (
            <div className="border-b border-border px-3 py-1.5 text-[12px]">
              {!breaking.available ? (
                <span className="text-faint">{t('oasdiffMissing')}</span>
              ) : breaking.changes.length === 0 ? (
                <span className="text-post">✓ {t('breakingNone')}</span>
              ) : (
                <button className="text-put hover:underline" onClick={() => setShowBreakList((s) => !s)}>
                  ⚠ {t('errors', { count: breaking.errorCount })} · {t('warnings', { count: breaking.warnCount })}
                </button>
              )}
              {showBreakList && breaking.available && (
                <div className="mt-1.5 space-y-1.5">
                  {breaking.changes.map((c, i) => (
                    <div
                      key={i}
                      className="rounded border-l-2 py-1 pl-2"
                      style={{ borderColor: c.level === 'error' ? 'var(--color-delete)' : 'var(--color-put)' }}
                    >
                      <div className="text-text">{c.text}</div>
                      <div className="font-mono text-[11px] text-faint">
                        {c.operation ? `${c.operation} · ` : ''}
                        {c.id}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!hasBase ? (
            <p className="px-3 py-2 text-[12px] text-faint">{t('diffNoBase')}</p>
          ) : baseText == null || targetText == null ? null : (
            <DiffPane base={baseText} target={targetText} expandAll={expandAll} />
          )}
        </div>
      )}
    </div>
  );
}
