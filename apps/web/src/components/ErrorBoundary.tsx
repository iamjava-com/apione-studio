import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { sawStaleBuild } from '../lib/stale-build';
import { isUnsaved, setUnsaved } from '../lib/unsaved';
import { useConfirm } from './ConfirmProvider';
import { ChunkLoadError } from '../lib/lazy-view';

/**
 * Keeps one bad document from taking the window with it.
 *
 * The editors walk whatever the spec happens to contain, and a spec is a file someone can write by
 * hand or import from anywhere — `paths` as a string, a schema where an object was assumed. Without
 * this the render throws, React unmounts the tree, and the blank page also takes the unsaved draft
 * that caused it. Resetting re-mounts the children, which is enough whenever the trigger was the
 * view rather than the file.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; onReset?: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The console is the only place this can go — there is no server-side error sink, and the
    // stack is what someone filing an issue needs.
    console.error('Unhandled error in a view:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Fallback
        error={this.state.error}
        onReset={() => {
          this.setState({ error: null });
          this.props.onReset?.();
        }}
      />
    );
  }
}

function Fallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  // Neither a replaced build nor a chunk that never arrived can be fixed by re-mounting: the old
  // chunk is gone, and Chrome keeps a failed module fetch for the page's lifetime. Only a reload asks again.
  const stale = sawStaleBuild();
  const unloaded = !stale && error instanceof ChunkLoadError;
  const reloads = stale || unloaded;
  const kind = stale ? 'newBuild' : unloaded ? 'viewUnloaded' : 'viewCrashed';
  // The edits live above this boundary and are still here; a reload is where they would go.
  // Ask in the app's own words, then drop the browser's prompt — a choice made once is made.
  const reload = async () => {
    if (isUnsaved() && !(await confirm({ message: t('unsavedLeave'), confirmLabel: t('discard'), danger: true })))
      return;
    setUnsaved(false);
    window.location.reload();
  };
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div className="max-w-md space-y-3">
        <p className="text-[16px] text-text">{t(`${kind}Title`)}</p>
        <p className="text-[14px] text-muted">{t(`${kind}Hint`)}</p>
        {!reloads && (
          <pre className="max-h-40 overflow-auto rounded border border-line bg-surface p-2 text-left text-[12px] text-muted">
            {error.message}
          </pre>
        )}
        <Button size="sm" onClick={reloads ? () => void reload() : onReset}>
          {t(reloads ? 'reload' : 'retry')}
        </Button>
      </div>
    </div>
  );
}
