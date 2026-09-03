import { Suspense, lazy, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LintResult, Project } from '../api';
import type { SpecFile } from '../hooks/useSpecFile';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { FormView } from './FormView';
// Monaco is several megabytes and the form is the default view, so the login screen and the form
// should not carry it. Pointing at the YAML toggle starts the fetch, so the click that follows
// rarely waits for the chunk.
const loadYamlView = () => import('./YamlView');
const YamlView = lazy(() => loadYamlView().then((m) => ({ default: m.YamlView })));
import { LintStatus } from './LintStatus';
import { EditorPlaceholder } from './ui/editor-placeholder';
import { PaneLoading } from './ui/pane-loading';
import { useConfirm } from './ConfirmProvider';
import type { Selection } from './form/types';
import { PendingEditsProvider } from './form/PendingEdits';

type View = 'form' | 'yaml';

/**
 * The editor surface: a shared save bar + Form/YAML toggle over one spec file. The file lives in
 * the parent (shared with the sidebar outline); the toggle switches its mode, so the form and the
 * YAML editor each work on the representation they own. `selection` drives the master-detail form.
 */
export function SpecEditor({
  project,
  file,
  lint,
  selection,
  onSelect,
  onViewDiff,
}: {
  project: Project;
  file: SpecFile;
  lint: LintResult | null;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onViewDiff: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [view, setView] = useState<View>('form');
  const [yamlOpened, setYamlOpened] = useState(false);
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
              onPointerEnter={v === 'yaml' ? () => void loadYamlView() : undefined}
              onFocus={v === 'yaml' ? () => void loadYamlView() : undefined}
              onClick={() => {
                // Form over text that does not parse stays in text mode and says so (FormView).
                file.switchMode(v === 'form' ? 'doc' : 'text');
                setView(v);
                if (v === 'yaml') setYamlOpened(true);
              }}
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
          disabled={!file.dirty && pendingEdits === 0}
          busy={file.status === 'saving'}
          // Hold the focus through mousedown: the browser's blur there commits mid-click, and the
          // label that clears moves the button out from under the pointer, so mouseup misses.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onSave}
        >
          {file.status === 'saving' ? t('saving') : t('save')}
        </Button>
        {file.status === 'saved' && (
          <span className="animate-linger text-[13px] text-post">{t('saved', { version: file.version })}</span>
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
        {view === 'form' &&
          (file.loaded ? (
            <PendingEditsProvider onChange={(d) => setPendingEdits((n) => Math.max(0, n + d))}>
              <FormView file={file} selection={selection} onSelect={onSelect} />
            </PendingEditsProvider>
          ) : (
            <PaneLoading />
          ))}
        {/* Once opened, the YAML editor stays mounted and is only hidden: building a Monaco model
            for a large document takes hundreds of milliseconds, and that is paid once. */}
        {yamlOpened && (
          <div className={cn('relative h-full', view !== 'yaml' && 'hidden')}>
            <Suspense fallback={<EditorPlaceholder />}>
              <YamlView file={file} />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}
