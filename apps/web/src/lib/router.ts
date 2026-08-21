import { useSyncExternalStore } from 'react';

/**
 * Minimal History-API router — the app is a single workspace, so a full router
 * library would be over-engineering (YAGNI). The URL is the single source of
 * truth for which project / mode / selected item is open, so refresh and the
 * browser back button just work.
 */
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const current = () => window.location.pathname + window.location.search;

// Injected by App to gate a browser back/forward that leaves the current view
// (e.g. confirm unsaved edits) — returns true to allow. Only same-document nav
// can be intercepted; reload/close fall to the `beforeunload` in useSpecFile.
type BeforeLeave = (from: string, to: string) => boolean | Promise<boolean>;
let beforeLeave: BeforeLeave | null = null;
export const setBeforeLeave = (fn: BeforeLeave | null): void => {
  beforeLeave = fn;
};

// The URL we last committed to; on a blocked back we restore to it without
// emitting, so the dirty view stays mounted and its draft survives.
let lastUrl = typeof window !== 'undefined' ? current() : '/';

async function onPopState() {
  const to = current();
  if (beforeLeave && !(await beforeLeave(lastUrl, to))) {
    window.history.pushState(null, '', lastUrl);
    return;
  }
  lastUrl = to;
  emit();
}

if (typeof window !== 'undefined') window.addEventListener('popstate', onPopState);

export function navigate(url: string, opts?: { replace?: boolean }) {
  if (url === current()) return;
  if (opts?.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  lastUrl = url;
  emit();
}

export function useLocation(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    current,
    () => '/',
  );
}

// ── app URL scheme ──────────────────────────────────────────────────────────
//   /                        project list
//   /p/{id}                  project · design mode · Info
//   /p/{id}/mock             project · mock mode
//   /p/{id}/docs             project · docs mode
//   ?sel=op:{method}:{path}  selected operation (design mode)
//   ?sel=schema:{name}       selected schema (design mode)

export type Mode = 'design' | 'mock' | 'docs';
export type Selection =
  { kind: 'info' } | { kind: 'op'; method: string; path: string } | { kind: 'schema'; name: string };

export const routes = {
  home: () => '/',
  admin: () => '/admin/users',
  project: (id: string, mode: Mode = 'design', sel: Selection = { kind: 'info' }) => {
    let path = `/p/${encodeURIComponent(id)}`;
    if (mode !== 'design') path += `/${mode}`;
    let q = '';
    if (sel.kind === 'op') q = `?sel=op:${sel.method}:${encodeURIComponent(sel.path)}`;
    else if (sel.kind === 'schema') q = `?sel=schema:${encodeURIComponent(sel.name)}`;
    return path + q;
  },
};

/** Id of the open project, or null on the project list. */
export function projectIdOf(loc: string): string | null {
  const m = loc.match(/^\/p\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Whether the URL is the admin console. */
export function isAdminRoute(loc: string): boolean {
  return loc.split('?')[0].replace(/\/$/, '') === '/admin/users';
}

/** Mode + selection for the project workspace, parsed from the URL. */
export function parseWorkspace(loc: string): { mode: Mode; sel: Selection } {
  const [path, query = ''] = loc.split('?');
  const seg = path.split('/')[3];
  const mode: Mode = seg === 'docs' || seg === 'mock' ? seg : 'design';

  let sel: Selection = { kind: 'info' };
  const raw = new URLSearchParams(query).get('sel');
  if (raw?.startsWith('op:')) {
    const rest = raw.slice(3);
    const i = rest.indexOf(':');
    if (i > 0) sel = { kind: 'op', method: rest.slice(0, i), path: decodeURIComponent(rest.slice(i + 1)) };
  } else if (raw?.startsWith('schema:')) {
    sel = { kind: 'schema', name: decodeURIComponent(raw.slice(7)) };
  }
  return { mode, sel };
}
