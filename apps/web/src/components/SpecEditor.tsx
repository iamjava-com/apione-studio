import { Suspense, lazy, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LintResult, Project } from '../api';
import type { SpecFile } from '../hooks/useSpecFile';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { FormView } from './FormView';
// Monaco is several megabytes and the form is the default view, so the login screen and the form
// should not carry it. It arrives when someone actually switches to YAML.
const YamlView = lazy(() => import('./YamlView').then((m) => ({ default: m.YamlView })));
import { LintStatus } from './LintStatus';
import { useConfirm } from './ConfirmProvider';
import type { Selection } from './form/types';
import { PendingEditsProvider } from './form/PendingEdits';

type View = 'form' | 'yaml';

/**
 * The editor surface: a shared save bar + Form/YAML toggle over one spec file.
 * The file lives in the parent (shared with the sidebar outline); `docRevision`
 * bumps when the sidebar edits the doc, so the Form view re-syncs. `selection`
 * drives the master-detail form.
 */
export function SpecEditor({
  project,
  file,
  lint,
  docRevision,
  selection,
  onSelect,
  onViewDiff,
}: {
  project: Project;
  file: SpecFile;
  lint: LintResult | null;
  docRevision?: number;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onViewDiff: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [view, setView] = useState<View>('form');
  const [pendingEdits, setPendingEdits] = useState(0);

  // Blurring commits whatever field has focus, and that commit reaches the file synchronously, so
  // a save started from the button carries text that was still being typed.
  const onSave = () => {
    (document.activeElement as HTMLElement | null)?.blur();
    file.save();
  };

  const onReset = async () => {
    if (!(await confirm({ message: t('resetConfirm'), confirmLabel: t('reset'), danger: true }))) return;
    file.reset();
  };

  const onReload = async () => {
    if (file.dirty && !(await confirm({ message: t('unsavedLeave'), confirmLabel: t('discard'), danger: true })))
      return;
    file.load();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 items-center gap-2 border-b border-border px-3">
        <span className="truncate text-[13px] text-muted">{project.name}</span>
        {!file.isNew && <span className="font-mono text-[12px] text-faint">v{file.version}</span>}
        {(file.dirty || pendingEdits > 0) && (
          <span aria-label="unsaved" className="text-[12px] text-brand">
            {t('unsavedTitle')}
          </span>
        )}
        <LintStatus lint={lint} />
        <div className="flex-1" />
        {file.dirty && !file.isNew && (
          <Button size="sm" className="border-delete text-delete hover:bg-delete/10" onClick={onReset}>
            {t('reset')}
          </Button>
        )}
        <div className="flex rounded-md border border-border p-0.5">
          {(['form', 'yaml'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'rounded px-2 py-0.5 text-[13px] transition-colors',
                view === v ? 'bg-raised text-text' : 'text-muted hover:text-text',
              )}
            >
              {v === 'form' ? t('form') : t('yaml')}
            </button>
          ))}
        </div>
        <Button
          variant="brand"
          size="sm"
          disabled={file.status === 'saving' || (!file.dirty && pendingEdits === 0)}
          // Hold the focus through mousedown: the browser's blur there commits mid-click, and the
          // label that clears moves the button out from under the pointer, so mouseup misses.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onSave}
        >
          {file.status === 'saving' ? t('saving') : t('save')}
        </Button>
        {file.status === 'saved' && (
          <span className="text-[13px] text-post">{t('saved', { version: file.version })}</span>
        )}
      </div>

      {file.isNew && (
        <div className="border-b border-brand/40 bg-brand/10 px-3 py-2 text-[13px] text-brand">{t('emptyProject')}</div>
      )}
      {file.conflict !== null && (
        <div className="flex items-center gap-3 border-b border-delete bg-delete/10 px-3 py-2 text-[13px] text-delete">
          <span>{t('conflict', { version: file.conflict })}</span>
          <Button variant="ghost" size="sm" onClick={onViewDiff}>
            {t('viewDiff')}
          </Button>
          <Button size="sm" onClick={onReload}>
            {t('reload')}
          </Button>
        </div>
      )}
      {file.error && (
        <div className="border-b border-delete bg-delete/10 px-3 py-2 text-[13px] text-delete">{file.error}</div>
      )}

      <div className="min-h-0 flex-1">
        {view === 'yaml' ? (
          <Suspense fallback={<div className="h-full" />}>
            <YamlView file={file} docRevision={docRevision} />
          </Suspense>
        ) : (
          <PendingEditsProvider onChange={(d) => setPendingEdits((n) => Math.max(0, n + d))}>
            <FormView file={file} docRevision={docRevision} selection={selection} onSelect={onSelect} />
          </PendingEditsProvider>
        )}
      </div>
    </div>
  );
}
