import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import { ProjectList } from './components/ProjectList';
import { ProjectView } from './components/ProjectView';
import { AdminUsers } from './components/AdminUsers';
import { CommandPalette, type Command } from './components/CommandPalette';
import { AuthScreen } from './components/AuthScreen';
import { ChangePasswordDialog } from './components/ChangePasswordDialog';
import { ApiTokensDialog } from './components/ApiTokensDialog';
import { useConfirm } from './components/ConfirmProvider';
import { LocaleThemeControls } from './components/LocaleThemeControls';
import { Logo } from './components/Logo';
import { useTheme } from './theme';
import { api, token, type AuthUser, type Project } from './api';
import { isUnsaved } from './lib/unsaved';
import { navigate, routes, projectIdOf, isAdminRoute, useLocation, setBeforeLeave } from './lib/router';
import { RegisterCommandsContext } from './lib/command-registry';
import { PaneLoading } from './components/ui/pane-loading';

export function App() {
  const { t } = useTranslation();
  const { toggle } = useTheme();
  const confirm = useConfirm();
  const loc = useLocation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [ready, setReady] = useState(false);
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);
  // Commands contributed by the open project (its endpoints + schemas); cleared on exit.
  const [viewCommands, setViewCommands] = useState<Command[]>([]);
  const registerCommands = useCallback((cmds: Command[]) => setViewCommands(cmds), []);

  // The URL is the source of truth for which project is open.
  const activeId = projectIdOf(loc);
  const active = activeId ? (projects.find((p) => p.id === activeId) ?? null) : null;
  // Leaving the open project drops its in-memory draft — confirm first when it's dirty.
  const guardLeave = async (): Promise<boolean> =>
    !isUnsaved() || confirm({ message: t('unsavedLeave'), confirmLabel: t('discard'), danger: true });
  const leaveTo = async (to: string) => {
    if (await guardLeave()) navigate(to);
  };

  // The browser back/forward button bypasses the in-app leave buttons, so guard
  // popstate too — but only when it abandons the open project (a same-project
  // selection/mode change keeps ProjectView mounted, so its draft is safe).
  const guardLeaveRef = useRef(guardLeave);
  useEffect(() => {
    guardLeaveRef.current = guardLeave;
  });
  useEffect(() => {
    setBeforeLeave((from, to) => {
      const pid = projectIdOf(from);
      if (pid && pid === projectIdOf(to)) return true;
      return guardLeaveRef.current();
    });
    return () => setBeforeLeave(null);
  }, []);

  const openProject = async (p: Project) => {
    if (!(await guardLeave())) return;
    setProjects((prev) => (prev.some((x) => x.id === p.id) ? prev : [p, ...prev])); // resolvable immediately
    navigate(routes.project(p.id));
  };

  // Resolve auth on load: is setup needed, and is the stored token still valid?
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await api.authStatus();
        if (!cancelled) setNeedsSetup(s.needsSetup);
      } catch {
        /* ignore */
      }
      if (token.get()) {
        try {
          const r = await api.me();
          if (!cancelled) setUser(r.user);
        } catch {
          token.clear();
        }
      }
      if (!cancelled) setReady(true);
    })();
    const onUnauthorized = () => setUser(null); // any 401 drops back to the gate
    window.addEventListener('apione-unauthorized', onUnauthorized);
    return () => {
      cancelled = true;
      window.removeEventListener('apione-unauthorized', onUnauthorized);
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setProjects([]);
      setProjectsLoaded(false);
      return;
    }
    api
      .listProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setProjectsLoaded(true));
  }, [activeId, user]);

  // Deep-linked to an id that doesn't exist (or no longer does) → back to the list.
  useEffect(() => {
    if (user && projectsLoaded && activeId && !active) navigate(routes.home(), { replace: true });
  }, [user, projectsLoaded, activeId, active]);

  // /admin/users is admin-only — a non-admin who deep-links there is bounced home.
  const onAdmin = isAdminRoute(loc);
  useEffect(() => {
    if (user && onAdmin && user.role !== 'admin') navigate(routes.home(), { replace: true });
  }, [user, onAdmin]);

  const logout = async () => {
    if (!(await guardLeave())) return;
    token.clear();
    navigate(routes.home());
    setUser(null);
  };

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = [
      { id: 'nav-home', group: t('navGroup'), label: `/${t('navHome')}`, run: () => void leaveTo(routes.home()) },
      { id: 'act-theme', group: t('navGroup'), label: `/${t('cmdTheme')}`, run: toggle },
    ];
    const projectCmds: Command[] = projects
      .filter((p) => p.id !== activeId) // the one you're already in isn't a place to navigate
      .map((p) => ({
        id: `proj-${p.id}`,
        group: t('projects'),
        label: p.name,
        run: () => openProject(p),
      }));
    return [...nav, ...projectCmds];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, activeId, t]);
  const allCommands = useMemo(() => [...commands, ...viewCommands], [commands, viewCommands]);

  if (!ready) return <PaneLoading className="h-full bg-bg" />;
  if (!user)
    return (
      <AuthScreen
        needsSetup={needsSetup}
        onAuthed={(u) => {
          setUser(u);
          setNeedsSetup(false); // authed ⇒ setup done, so a later logout shows login not "create admin"
        }}
      />
    );

  return (
    <RegisterCommandsContext.Provider value={registerCommands}>
      <div className="h-full bg-bg text-text">
        <header className="flex h-11 items-center gap-3 border-b border-border bg-surface px-4">
          {/* app name → home */}
          <button
            aria-label={t('navHome')}
            onClick={() => leaveTo(routes.home())}
            className="flex items-center gap-2 transition-opacity hover:opacity-80"
          >
            <Logo className="h-4 w-4 text-logo" />
            <span className="text-[15px] font-semibold tracking-tight">
              ApiOne <span className="font-normal text-muted">Studio</span>
            </span>
          </button>
          {(active || onAdmin) && (
            <>
              <span className="text-faint">/</span>
              <span className="text-[14px]">{onAdmin ? t('adminUsers') : active?.name}</span>
            </>
          )}
          <div className="flex-1" />
          {user.role === 'admin' && (
            <button
              aria-label={t('manageUsers')}
              onClick={() => leaveTo(routes.admin())}
              className={`hidden items-center gap-1 rounded px-2 py-1 text-[13px] transition-colors hover:bg-raised hover:text-text sm:flex ${
                onAdmin ? 'text-text' : 'text-muted'
              }`}
            >
              <Users size={15} /> {t('adminUsers')}
            </button>
          )}
          <button
            aria-label="open-command-palette"
            onClick={() => window.dispatchEvent(new Event('apione-open-command-palette'))}
            className="hidden items-center gap-1 rounded border border-border px-2 py-1 font-mono text-[12px] text-faint hover:text-text sm:flex"
          >
            ⌘K
          </button>
          <LocaleThemeControls />
          {/* Opens on hover or on focus. focus-within is what makes it reachable by keyboard and by
              tap at all: until then the items are hidden, and hidden means out of the tab order. */}
          <div className="group relative">
            <button className="flex items-center gap-1 text-[13px] text-muted hover:text-text">
              @{user.username}
              {user.role === 'admin' && <span className="text-brand">{t('roleAdmin')}</span>}
            </button>
            <div className="invisible absolute right-0 top-full z-30 min-w-28 -translate-y-1 rounded-md border border-border bg-surface p-1 opacity-0 shadow-lg transition-[opacity,translate,visibility] duration-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
              <button
                onClick={() => setTokensOpen(true)}
                className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-[14px] text-muted hover:bg-raised hover:text-text"
              >
                {t('apiTokens')}
              </button>
              <button
                onClick={() => setChangePwOpen(true)}
                className="block w-full rounded px-2 py-1 text-left text-[14px] text-muted hover:bg-raised hover:text-text"
              >
                {t('changePassword')}
              </button>
              <button
                onClick={logout}
                className="block w-full rounded px-2 py-1 text-left text-[14px] text-muted hover:bg-raised hover:text-text"
              >
                {t('logout')}
              </button>
            </div>
          </div>
        </header>
        {onAdmin && user.role === 'admin' ? (
          <AdminUsers meId={user.id} />
        ) : activeId ? (
          active ? (
            <ProjectView
              // Keyed so switching projects is a fresh mount: everything inside is scoped to one
              // project, most of all the permissions the tabs are gated on, and a reused instance
              // holds the previous project's state until each request comes back to replace it.
              key={active.id}
              project={active}
              meId={user.id}
              onExit={() => navigate(routes.home())}
              onProjectChanged={() =>
                api
                  .listProjects()
                  .then(setProjects)
                  .catch(() => {})
              }
            />
          ) : (
            <div className="h-full bg-bg" /> // resolving the id (or gone → redirect effect fires)
          )
        ) : (
          <ProjectList onOpen={openProject} isAdmin={user.role === 'admin'} />
        )}
        <CommandPalette commands={allCommands} />
        <ChangePasswordDialog open={changePwOpen} onOpenChange={setChangePwOpen} />
        <ApiTokensDialog open={tokensOpen} onOpenChange={setTokensOpen} />
      </div>
    </RegisterCommandsContext.Provider>
  );
}
