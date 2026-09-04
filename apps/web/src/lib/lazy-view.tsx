import { lazy, useState, type ComponentProps, type ComponentType, type LazyExoticComponent } from 'react';

/** A view's chunk did not arrive — offline, a flaky link. `cause` is the loader's rejection. */
export class ChunkLoadError extends Error {
  constructor(cause: unknown) {
    super('view chunk failed to load', { cause });
    this.name = 'ChunkLoadError';
  }
}

/**
 * `React.lazy` for a view whose chunk may fail to arrive. The failure reaches the nearest
 * ErrorBoundary as a ChunkLoadError, and a mount after a failure starts a fresh `lazy` — plain
 * `lazy` caches its rejection, so a later visit to the view would re-throw the same failure
 * without asking the network again. Once loaded, every later mount reuses the resolved component.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the props type is T's own; `any` only lets T be any component
export function lazyView<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): ComponentType<ComponentProps<T>> {
  let ready: LazyExoticComponent<T> | null = null;
  const attempt = () => {
    const L = lazy(() =>
      load().then(
        (m) => {
          ready = L;
          return m;
        },
        (e: unknown) => {
          throw new ChunkLoadError(e);
        },
      ),
    );
    return L;
  };
  return function LazyView(props: ComponentProps<T>) {
    const [L] = useState(() => ready ?? attempt());
    return <L {...props} />;
  };
}
