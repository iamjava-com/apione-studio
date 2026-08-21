import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Group, Panel } from 'react-resizable-panels';
import YAML from 'yaml';
import { Clock, Settings, X } from 'lucide-react';
import { api, type Permission, type Project } from '../api';
import { useSpecFile } from '../hooks/useSpecFile';
import { useProjectData } from '../hooks/useProjectData';
import { useRevisit } from '../hooks/useRevisit';
import { useDebounced } from '../hooks/useDebounced';
import { cn } from '../lib/utils';
import { errorText } from '../lib/errors';
import { SpecEditor } from './SpecEditor';
import { OutlinePanel } from './OutlinePanel';
import { OperationStagesProvider } from './OperationStages';
import { History } from './History';
import { SettingsDialog } from './SettingsDialog';
import { navigate, parseWorkspace, routes, useLocation, type Mode, type Selection } from '../lib/router';
import { useRegisterCommands } from '../lib/command-registry';
import type { Command } from './CommandPalette';
import { setUnsaved } from '../lib/unsaved';
import { useConfirm } from './ConfirmProvider';
import { Button } from './ui/button';
import { ResizeHandle } from './ui/resize-handle';
import { ErrorBoundary } from './ErrorBoundary';
import { HTTP_METHODS } from './form/constants';

// Both pull a heavy engine — Scalar its own renderer, MockView the Monaco editor — and neither is
// on the path to the project someone just opened.
const ScalarDocs = lazy(() => import('./ScalarDocs').then((m) => ({ default: m.ScalarDocs })));
const MockView = lazy(() => import('./MockView').then((m) => ({ default: m.MockView })));

type Tool = 'history';
type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function ProjectView({
  project,
  meId,
  onExit,
  onProjectChanged,
}: {
  project: Project;
  meId: string;
  onExit: () => void;
  onProjectChanged: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const loc = useLocation();
  // URL is the source of truth for mode + which item is selected (master-detail focus).
  const { mode, sel: selection } = useMemo(() => parseWorkspace(loc), [loc]);
  const setMode = (m: Mode) => navigate(routes.project(project.id, m, selection));
  const [activePath, setActivePath] = useState('openapi.yaml');
  // Bumped on every server-side write; Scalar takes the spec at mount only, so remount it.
  const [specRev, setSpecRev] = useState(0);
  const [docRevision, setDocRevision] = useState(0); // bumped when the sidebar edits the live doc
  const [tool, setTool] = useState<Tool | null>(null); // right inspect panel; null = collapsed
  const [historyFocus, setHistoryFocus] = useState<{ base: number; target: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const { files, perms, roleLoaded, graph, lint, mockCatalog, mockDrafts, setMockDrafts, reloadMockCatalog, refresh } =
    useProjectData(project.id);
  const mockDirty = Object.keys(mockDrafts).length > 0;

  const onSaved = () => {
    refresh();
    setSpecRev((k) => k + 1);
  };

  // The one live spec file, shared by the editor and the sidebar outline.
  const file = useSpecFile(project.id, activePath, onSaved, project.name);
  // Everything derived from `doc` (outline, palette entries) is too expensive per keystroke, so it
  // trails the editor by a beat. The editor and the save path read file.content directly.
  const debouncedContent = useDebounced(file.content, 200);
  const doc = useMemo<Doc | null>(() => {
    try {
      return (YAML.parse(debouncedContent) as Doc) ?? {};
    } catch {
      return null;
    }
  }, [debouncedContent]);

  useRevisit(file.sync);

  // `can` answers optimistically while the role is unknown, so an owner's controls don't flicker
  // in — but the design canvas waits for roleLoaded, else a viewer flashes the editable canvas
  // before redirecting to docs.
  const can = (p: Permission) => perms === null || perms.includes(p);
  const canWrite = can('spec:write');
  const canManage = can('members:manage');
  const canReadMembers = can('members:read');
  const canMockRead = can('mock:read');
  const canMockWrite = can('mock:write');

  // Feed the ⌘K palette this project's endpoints + schemas. Design-only (picking one jumps
  // to the design view and reveals it), so viewers — who have no design canvas — add nothing.
  const searchCommands = useMemo<Command[]>(() => {
    if (!doc || !canWrite) return [];
    const goto = (sel: Selection) => {
      navigate(routes.project(project.id, 'design', sel));
      window.dispatchEvent(new CustomEvent('apione-reveal', { detail: sel }));
    };
    const cmds: Command[] = [];
    for (const [p, item] of Object.entries<Doc>(doc.paths ?? {})) {
      for (const m of HTTP_METHODS) {
        const op = item?.[m];
        if (!op) continue;
        const summary = typeof op.summary === 'string' ? op.summary : '';
        cmds.push({
          id: `find-op-${m}-${p}`,
          group: t('operations'),
          label: summary || `${m.toUpperCase()} ${p}`,
          hint: summary ? `${m.toUpperCase()} ${p}` : undefined,
          searchOnly: true,
          run: () => goto({ kind: 'op', method: m, path: p }),
        });
      }
    }
    for (const name of Object.keys(doc.components?.schemas ?? {})) {
      cmds.push({
        id: `find-schema-${name}`,
        group: t('schemas'),
        label: name,
        searchOnly: true,
        run: () => goto({ kind: 'schema', name }),
      });
    }
    return cmds;
  }, [doc, canWrite, project.id, t]);
  useRegisterCommands(searchCommands);
  // A tab you can't use isn't shown, and a deep-link to it falls back to Docs — which is where
  // a read-only visitor belongs anyway.
  useEffect(() => {
    if (!roleLoaded) return;
    if (!canWrite && mode === 'design') setMode('docs');
    if (!canMockRead && mode === 'mock') setMode('docs');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setMode is recreated each render; guard keys off role/mode only
  }, [roleLoaded, canWrite, canMockRead, mode]);

  const openTool = (id: Tool) => setTool(tool === id ? null : id);

  // Publish unsaved state so App can confirm before navigating away. Mock drafts count too —
  // losing unsaved mock code on a stray Back is the same loss as losing spec edits.
  useEffect(() => {
    setUnsaved(file.dirty || mockDirty);
    return () => setUnsaved(false);
  }, [file.dirty, mockDirty]);

  const confirmDiscard = () => confirm({ message: t('unsavedLeave'), confirmLabel: t('discard'), danger: true });

  // Switching files drops the current file's in-memory edits — confirm first when dirty.
  const switchFile = async (path: string) => {
    if (file.dirty && !(await confirmDiscard())) return;
    setActivePath(path);
    select({ kind: 'info' }); // reset focus for the new file
  };

  // Conflict banner → open History showing "your version → the server's latest".
  const viewConflictDiff = () => {
    setHistoryFocus({ base: file.version, target: file.conflict ?? file.version });
    setTool('history');
  };
  useEffect(() => {
    if (tool !== 'history') setHistoryFocus(null); // a stale focus mustn't re-apply on reopen
  }, [tool]);

  // Outline → editor: focus an item (master-detail), reflected in the URL. Picking a concrete
  // item is a navigation the user expects Back to undo, so push; an info reset (file switch,
  // deselect) is bookkeeping, so replace to keep history clean. For op/schema also fire a reveal
  // event so the YAML view jumps to that key (the form just renders the selected item).
  const select = useCallback(
    (sel: Selection) => {
      navigate(routes.project(project.id, mode, sel), { replace: sel.kind === 'info' });
      if (sel.kind !== 'info') window.dispatchEvent(new CustomEvent('apione-reveal', { detail: sel }));
    },
    [project.id, mode],
  );
  const removeFile = async (path: string) => {
    if (!(await confirm({ message: t('confirmDeleteFile', { path }), confirmLabel: t('delete'), danger: true })))
      return;
    setFileError(null);
    try {
      await api.deleteFile(project.id, path);
    } catch (err) {
      setFileError(errorText(err));
      return;
    }
    if (activePath === path) setActivePath('openapi.yaml');
    refresh();
  };

  // Sidebar edits the live doc (unsaved, like the form); bump docRevision so the form re-syncs.
  // Parses file.content afresh — the shared `doc` trails the editor, and mutating a stale clone
  // would silently revert the last keystrokes.
  const updateDoc = (mutator: (d: Doc) => void) => {
    let next: Doc;
    try {
      next = (YAML.parse(file.content) as Doc) ?? {};
    } catch {
      return;
    }
    mutator(next);
    file.setContent(YAML.stringify(next));
    setDocRevision((r) => r + 1);
  };

  // Design and Mock share the operation selection, so they sit next to each other; Docs renders
  // the whole spec and takes no selection, which makes it the natural end of the row.
  const modes: { id: Mode; label: string }[] = [
    ...(canWrite ? [{ id: 'design' as const, label: t('design') }] : []),
    ...(canMockRead ? [{ id: 'mock' as const, label: t('mock') }] : []),
    { id: 'docs', label: t('docs') },
  ];
  const tools: { id: Tool; icon: typeof Clock; label: string }[] = [
    { id: 'history', icon: Clock, label: t('history') },
  ];
  const toolLabel = tools.find((x) => x.id === tool)?.label ?? '';

  return (
    <div className="flex h-[calc(100%-44px)] flex-col">
      {/* mode switch — each mode owns the full canvas */}
      <div className="flex h-9 items-center gap-1 border-b border-border bg-surface px-2">
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={cn(
              'cursor-pointer rounded px-2.5 py-1 text-[14px] transition-colors',
              mode === m.id ? 'bg-raised text-text' : 'text-muted hover:text-text',
            )}
          >
            {m.label}
          </button>
        ))}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setSettingsOpen(true)}>
          <Settings size={14} className="mr-1" />
          {t('settings')}
        </Button>
      </div>

      {fileError && (
        <div className="border-b border-delete bg-delete/10 px-3 py-2 text-[13px] text-delete">{fileError}</div>
      )}
      {/* Keyed on mode so switching tabs is itself a way out — the header above stays usable,
          which is what lets someone reach the YAML view and see what the document actually says. */}
      <ErrorBoundary key={mode}>
        <div className="min-h-0 flex-1">
          {/* Only the design canvas shows stages, so the one read they need is scoped to it. */}
          {mode === 'design' && roleLoaded && canWrite && (
            <OperationStagesProvider projectId={project.id}>
              <div className="flex h-full">
                <div className="min-w-0 flex-1">
                  <Group key={tool ? 'open' : 'closed'} orientation="horizontal" className="h-full">
                    <Panel defaultSize="20%" minSize="12%" collapsible collapsedSize="0%" className="bg-surface">
                      <OutlinePanel
                        doc={doc}
                        selection={selection}
                        onSelect={select}
                        updateDoc={updateDoc}
                        graph={graph}
                        files={files}
                        activePath={activePath}
                        onSelectFile={(path) => void switchFile(path)}
                        onDeleteFile={(path) => void removeFile(path)}
                      />
                    </Panel>
                    <ResizeHandle />

                    <Panel defaultSize={tool ? '52%' : '80%'} minSize="30%">
                      <div className="flex h-full flex-col bg-bg">
                        <SpecEditor
                          project={project}
                          file={file}
                          lint={lint}
                          docRevision={docRevision}
                          selection={selection}
                          onSelect={select}
                          onViewDiff={viewConflictDiff}
                        />
                      </div>
                    </Panel>

                    {tool && (
                      <>
                        <ResizeHandle />
                        <Panel defaultSize="28%" minSize="16%" className="bg-surface">
                          <div className="flex h-full flex-col">
                            <div className="flex h-9 items-center border-b border-border px-3 text-[13px] text-muted">
                              <span>{toolLabel}</span>
                              <div className="flex-1" />
                              <button
                                aria-label="close-tool"
                                className="text-faint hover:text-text"
                                onClick={() => setTool(null)}
                              >
                                <X size={14} />
                              </button>
                            </div>
                            <div className="min-h-0 flex-1 overflow-auto">
                              {tool === 'history' && (
                                <History
                                  projectId={project.id}
                                  path={activePath}
                                  dirty={file.dirty}
                                  editorVersion={file.version}
                                  focus={historyFocus}
                                  onRestored={() => {
                                    file.load();
                                    onSaved(); // a restore rewrites the document, mocks included
                                  }}
                                />
                              )}
                            </div>
                          </div>
                        </Panel>
                      </>
                    )}
                  </Group>
                </div>

                {/* activity bar — always visible, opens/collapses the inspect panel */}
                <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-l border-border bg-surface py-2">
                  {tools.map(({ id, icon: Icon, label }) => (
                    <button
                      key={id}
                      title={label}
                      aria-label={`tool-${id}`}
                      onClick={() => openTool(id)}
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-md',
                        tool === id ? 'bg-raised text-text' : 'text-muted hover:text-text',
                      )}
                    >
                      <Icon size={16} />
                    </button>
                  ))}
                </div>
              </div>
            </OperationStagesProvider>
          )}

          {mode === 'mock' && (
            <Suspense fallback={<div className="h-full" />}>
              <MockView
                projectId={project.id}
                canWrite={canMockWrite}
                catalog={mockCatalog}
                reloadCatalog={reloadMockCatalog}
                selection={selection}
                onSelect={select}
                drafts={mockDrafts}
                setDrafts={setMockDrafts}
                onEditSchema={
                  canWrite
                    ? (op) =>
                        navigate(routes.project(project.id, 'design', { kind: 'op', method: op.method, path: op.path }))
                    : undefined
                }
              />
            </Suspense>
          )}

          {mode === 'docs' && (
            <Suspense fallback={<div className="h-full" />}>
              <ScalarDocs key={specRev} projectId={project.id} />
            </Suspense>
          )}
        </div>
      </ErrorBoundary>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        project={project}
        meId={meId}
        canWrite={canWrite}
        canManage={canManage}
        canReadMembers={canReadMembers}
        onReplaced={() => {
          setActivePath('openapi.yaml');
          select({ kind: 'info' });
          file.load();
          onSaved();
        }}
        onRenamed={onProjectChanged}
        onDeleted={onExit}
        onLeft={onExit}
      />
    </div>
  );
}
