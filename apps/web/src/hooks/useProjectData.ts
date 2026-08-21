import { useCallback, useEffect, useState } from 'react';
import { api, type FileMeta, type GraphResult, type LintResult, type MockCatalog, type Permission } from '../api';
import { keepOnly } from '../lib/utils';
import { useLatestOnly } from './useLatestOnly';

/**
 * Everything the workspace reads about a project but does not edit: its files, the caller's
 * permissions, and the derived views the server builds from the spec — schema graph, lint, mock
 * catalog. All of it goes out of date the moment the spec is written, so it is loaded together and
 * refreshed together.
 *
 * Mock drafts live here too, though they are edits: they are unsaved mock code, and the pruning
 * that follows a catalog read has to take them along or they outlive the operation they belong to.
 * Keeping them out of MockView is deliberate — switching modes unmounts that view, and an unsaved
 * mock must survive that.
 */
export interface ProjectData {
  files: FileMeta[];
  /** null until the first read; callers may answer optimistically while it is. */
  perms: Permission[] | null;
  roleLoaded: boolean;
  graph: GraphResult | null;
  lint: LintResult | null;
  mockCatalog: MockCatalog | null;
  mockDrafts: Record<string, string>;
  setMockDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  reloadMockCatalog: () => void;
  refresh: () => void;
}

export function useProjectData(projectId: string): ProjectData {
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [perms, setPerms] = useState<Permission[] | null>(null);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [graph, setGraph] = useState<GraphResult | null>(null);
  const [lint, setLint] = useState<LintResult | null>(null);
  const [mockCatalog, setMockCatalog] = useState<MockCatalog | null>(null);
  const [mockDrafts, setMockDrafts] = useState<Record<string, string>>({});

  const latestOnly = useLatestOnly();

  const reloadMockCatalog = useCallback(() => {
    latestOnly(
      'mock',
      api.mockCatalog(projectId),
      (c) => {
        setMockCatalog(c);
        // A draft is the unsaved half of a mock, so it goes wherever the server's pruning went.
        const live = new Set(c.operations.map((o) => o.opId));
        setMockDrafts((d) => keepOnly(d, live));
      },
      () => setMockCatalog(null), // no mock:read, or the spec won't bundle — nothing to reconcile
    );
  }, [projectId, latestOnly]);

  const refresh = useCallback(() => {
    reloadMockCatalog();
    latestOnly('files', api.listFiles(projectId), setFiles, () => setFiles([]));
    latestOnly('graph', api.graph(projectId), setGraph, () => setGraph(null));
    latestOnly('lint', api.lint(projectId), setLint, () => setLint(null));
    latestOnly(
      'project',
      api.getProject(projectId),
      (p) => {
        if (p.permissions) setPerms(p.permissions);
        setRoleLoaded(true);
      },
      () => setRoleLoaded(true),
    );
  }, [projectId, reloadMockCatalog, latestOnly]);
  useEffect(refresh, [refresh]);

  return {
    files,
    perms,
    roleLoaded,
    graph,
    lint,
    mockCatalog,
    mockDrafts,
    setMockDrafts,
    reloadMockCatalog,
    refresh,
  };
}
