import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';

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
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div className="max-w-md space-y-3">
        <p className="text-[16px] text-text">{t('viewCrashedTitle')}</p>
        <p className="text-[14px] text-muted">{t('viewCrashedHint')}</p>
        <pre className="max-h-40 overflow-auto rounded border border-line bg-surface p-2 text-left text-[12px] text-muted">
          {error.message}
        </pre>
        <Button size="sm" onClick={onReset}>
          {t('retry')}
        </Button>
      </div>
    </div>
  );
}
