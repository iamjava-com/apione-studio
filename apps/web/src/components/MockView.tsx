import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Group, Panel } from 'react-resizable-panels';
import { HelpCircle, WandSparkles } from 'lucide-react';
import Editor from '@monaco-editor/react';
import type { MockCatalog, MockMode, MockOperation } from '../api';
import '../monaco-setup'; // configures Monaco on import; this view is where that cost belongs
import { EDITOR_FONT } from '../lib/editor-font';
import { useTheme } from '../theme';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import { PaneLoading } from './ui/pane-loading';
import { EditorPlaceholder } from './ui/editor-placeholder';
import { MockDebugPanel } from './MockDebugPanel';
import { MockOperationList } from './MockOperationList';
import { MethodBadge } from './ui/method-badge';
import { ResizeHandle } from './ui/resize-handle';
import { MockHelpDialog } from './MockHelpDialog';
import { MockSchemaDialog } from './MockSchemaDialog';
import type { Selection } from '../lib/router';
import { useMockCode } from '../hooks/useMockCode';

/**
 * Mock mode — pick an operation, choose auto or scripted, and author the function that answers it.
 * Read-only without mock:write; the tab itself needs mock:read, which Viewer does not hold.
 */
export function MockView({
  projectId,
  canWrite,
  catalog,
  reloadCatalog,
  selection,
  onSelect,
  drafts,
  setDrafts,
  onEditSchema,
}: {
  projectId: string;
  canWrite: boolean;
  /** Which operations can hold a mock. Owned by the workspace, like the drafts below. */
  catalog: MockCatalog | null;
  /** Ask for a re-read after a write of our own; document writes the workspace handles itself. */
  reloadCatalog: () => void;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  /** Unsaved buffers keyed by operation id. Owned by the workspace, not this view: leaving Mock
   *  mode unmounts us, and an edit must survive that just as it survives switching endpoints. */
  drafts: Record<string, string>;
  setDrafts: (update: (d: Record<string, string>) => Record<string, string>) => void;
  /** Jump to the design canvas on this operation — where a schema is actually edited. */
  onEditSchema?: (op: { method: string; path: string }) => void;
}) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const [helpOpen, setHelpOpen] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const editorRef = useRef<{ getAction: (id: string) => { run: () => void } | null } | null>(null);

  // Design mode's selection carries over, so switching tabs lands on the same endpoint — but only
  // the catalog can say whether that endpoint can hold a mock. Anything it doesn't list (Info, a
  // schema, an operation added to the file outside the App and not saved since) shows the empty
  // state, and the selection is left alone so switching back hasn't moved it.
  const active: MockOperation | undefined = useMemo(
    () =>
      selection.kind === 'op'
        ? catalog?.operations.find((o) => o.method === selection.method && o.path === selection.path)
        : undefined,
    [catalog, selection],
  );
  const key = active?.opId ?? null;

  const {
    saving,
    switching,
    loaded,
    error,
    conflict,
    code,
    dirty,
    dirtyKeys,
    setCode,
    save,
    reloadCode,
    reset,
    changeMode,
  } = useMockCode({ projectId, key, catalog, reloadCatalog, drafts, setDrafts });

  const mode = active?.mode ?? 'auto';
  // Monaco keys the language service off the model URI, so it has to look like a real .js file.
  const modelPath = key ? `mocks/${key}.js` : 'mocks/none.js';
  const readOnly = !canWrite;

  return (
    <Group orientation="horizontal" className="h-full">
      <Panel defaultSize="22%" minSize="14%" collapsible collapsedSize="0%" className="bg-surface">
        <MockOperationList
          catalog={catalog}
          activeKey={key}
          dirtyKeys={dirtyKeys}
          onPick={(o) => onSelect({ kind: 'op', method: o.method, path: o.path })}
        />
      </Panel>
      <ResizeHandle />

      <Panel defaultSize="48%" minSize="30%">
        {!active ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-muted">
            {t('mockPickEndpoint')}
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex h-10 items-center gap-2 border-b border-border px-3">
              <MethodBadge method={active.method} className="shrink-0" />
              <span className="min-w-0 truncate font-mono text-[13px]">{active.path}</span>
              {mode === 'scripted' && readOnly && (
                <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[11px] text-muted">{t('readOnly')}</span>
              )}
              {dirty && (
                <span aria-label="unsaved" className="shrink-0 text-[12px] text-brand">
                  {t('unsavedTitle')}
                </span>
              )}
              <div className="flex-1" />
              {mode === 'scripted' && (
                <button
                  aria-label="mock-help"
                  title={t('mockHelpTitle')}
                  className="shrink-0 rounded p-1 text-faint hover:bg-raised hover:text-text"
                  onClick={() => setHelpOpen(true)}
                >
                  <HelpCircle size={14} />
                </button>
              )}
              {mode === 'scripted' && canWrite && (
                <button
                  aria-label="mock-format"
                  title={t('formatCode')}
                  className="shrink-0 rounded p-1 text-faint hover:bg-raised hover:text-text"
                  onClick={() => editorRef.current?.getAction('editor.action.formatDocument')?.run()}
                >
                  <WandSparkles size={14} />
                </button>
              )}
              {mode === 'scripted' && canWrite && dirty && (
                <Button
                  size="sm"
                  className="shrink-0 border-delete text-delete hover:bg-delete/10"
                  onClick={() => void reset()}
                >
                  {t('reset')}
                </Button>
              )}
              <ModeToggle mode={mode} pending={switching} disabled={!canWrite} onChange={(m) => void changeMode(m)} />
              {mode === 'scripted' && canWrite && (
                <Button
                  variant="brand"
                  size="sm"
                  className="shrink-0"
                  disabled={!dirty}
                  busy={saving}
                  onClick={() => void save()}
                >
                  {saving ? t('saving') : t('save')}
                </Button>
              )}
            </div>

            {/* Its own row, like the design canvas: the toolbar is full of controls, and a message
                squeezed in between them is a message nobody can read. */}
            {conflict && (
              <div
                aria-label="mock-conflict"
                className="flex items-center gap-3 border-b border-delete bg-delete/10 px-3 py-2 text-[13px] text-delete"
              >
                <span className="min-w-0 flex-1">{t('mockConflict')}</span>
                <Button size="sm" className="shrink-0" onClick={() => void reloadCode()}>
                  {t('reload')}
                </Button>
              </div>
            )}
            {error && (
              <div
                aria-label="mock-error"
                className="border-b border-delete bg-delete/10 px-3 py-2 text-[13px] text-delete"
              >
                {error}
              </div>
            )}

            {mode === 'auto' ? (
              // Auto has nothing to author: say what's happening and offer the two moves that
              // matter. The saved code, if any, is one toggle away — no need to preview it here.
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-[13px] text-text">{t('mockAutoActive')}</p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button size="sm" onClick={() => setSchemaOpen(true)}>
                    {t('mockViewSchema')}
                  </Button>
                  {canWrite && (
                    <Button
                      size="sm"
                      variant="brand"
                      busy={switching === 'scripted'}
                      onClick={() => void changeMode('scripted')}
                    >
                      {t('mockEnableCustom')}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className={cn('relative min-h-0 flex-1', readOnly && 'opacity-70')}>
                <Editor
                  height="100%"
                  loading={<PaneLoading />}
                  theme={`apione-${theme}`}
                  language="javascript"
                  // A .js path is what makes the TS language service claim the model — without it
                  // there are no completions and no formatter, only highlighting.
                  path={modelPath}
                  value={code}
                  onChange={(v) => setCode(v ?? '')}
                  onMount={(ed) => (editorRef.current = ed)}
                  options={{
                    readOnly,
                    // Without this the textarea still takes input and only rejects it on keypress,
                    // which is how read-only mode ends up feeling broken rather than disabled.
                    domReadOnly: readOnly,
                    minimap: { enabled: false },
                    fontSize: 13,
                    tabSize: 2,
                    fontFamily: EDITOR_FONT,
                  }}
                />
                {!loaded && <EditorPlaceholder />}
              </div>
            )}
          </div>
        )}
      </Panel>
      <ResizeHandle />

      <MockHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      {active && (
        <MockSchemaDialog
          open={schemaOpen}
          onOpenChange={setSchemaOpen}
          projectId={projectId}
          method={active.method}
          path={active.path}
          // Mock and Design share the selection, so "edit it" is a mode switch, not a search.
          onEditInDesign={onEditSchema ? () => onEditSchema(active) : undefined}
        />
      )}

      <Panel defaultSize="30%" minSize="18%" collapsible collapsedSize="0%" className="bg-surface">
        <MockDebugPanel
          projectId={projectId}
          basePaths={catalog?.basePaths ?? ['']}
          method={active?.method ?? null}
          template={active?.path ?? null}
          dirty={dirty}
          onSaveBeforeRun={save}
        />
      </Panel>
    </Group>
  );
}

function ModeToggle({
  mode,
  pending,
  disabled,
  onChange,
}: {
  mode: MockMode;
  /** The mode a switch is in flight to; both buttons wait for it. */
  pending: MockMode | null;
  disabled: boolean;
  onChange: (m: MockMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 rounded-md border border-border p-0.5">
      {(['auto', 'scripted'] as const).map((m) => (
        <button
          key={m}
          disabled={disabled || pending !== null}
          aria-busy={pending === m || undefined}
          onClick={() => onChange(m)}
          className={cn(
            'flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-[12px] disabled:opacity-50',
            mode === m ? 'bg-raised text-text' : 'text-muted hover:text-text',
            pending === m && 'disabled:opacity-100',
          )}
        >
          {pending === m && <Spinner size={12} />}
          {t(m === 'auto' ? 'mockModeAuto' : 'mockModeScripted')}
        </button>
      ))}
    </div>
  );
}
