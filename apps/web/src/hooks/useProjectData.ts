import { useCallback, useEffect, useState } from 'react';
import { api, type FileMeta, type GraphResult, type LintResult, type MockCatalog, type Permission } from '../api';
import { keepOnly } from '../lib/utils';
import { useResource } from './useResource';

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
  /** True once the project has answered, well or badly: the gate on what the canvas shows. */
  roleLoaded: boolean;
  graph: GraphResult | null;
  lint: LintResult | null;
  mockCatalog: MockCatalog | null;
  /** The catalog read failed (no mock:read, or the spec will not bundle) — as opposed to still out. */
  mockCatalogFailed: boolean;
  mockDrafts: Record<string, string>;
  setMockDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  reloadMockCatalog: () => void;
  refresh: () => void;
}

export function useProjectData(projectId: string): ProjectData {
  const project = useResource(() => api.getProject(projectId), [projectId]);
  const files = useResource(() => api.listFiles(projectId), [projectId]);
  const graph = useResource(() => api.graph(projectId), [projectId]);
  const lint = useResource(() => api.lint(projectId), [projectId]);
  const catalog = useResource(() => api.mockCatalog(projectId), [projectId]);
  const [mockDrafts, setMockDrafts] = useState<Record<string, string>>({});

  // A draft is the unsaved half of a mock, so it goes wherever the server's pruning went. Only an
  // answer prunes: a failed read is not a verdict on which operations still exist.
  useEffect(() => {
    if (!catalog.data) return;
    const live = new Set(catalog.data.operations.map((o) => o.opId));
    setMockDrafts((d) => keepOnly(d, live));
  }, [catalog.data]);

  const { reload: reloadProject } = project;
  const { reload: reloadFiles } = files;
  const { reload: reloadGraph } = graph;
  const { reload: reloadLint } = lint;
  const { reload: reloadCatalog } = catalog;
  const refresh = useCallback(() => {
    reloadProject();
    reloadFiles();
    reloadGraph();
    reloadLint();
    reloadCatalog();
  }, [reloadProject, reloadFiles, reloadGraph, reloadLint, reloadCatalog]);

  // A derived view that failed to build shows as absent, not as the last one that did.
  const answered = <T>(r: { status: string; data: T | undefined }) => (r.status === 'error' ? undefined : r.data);

  return {
    files: answered(files) ?? [],
    perms: project.data?.permissions ?? null,
    roleLoaded: project.data !== undefined || project.status === 'error',
    graph: answered(graph) ?? null,
    lint: answered(lint) ?? null,
    mockCatalog: answered(catalog) ?? null,
    mockCatalogFailed: catalog.status === 'error',
    mockDrafts,
    setMockDrafts,
    reloadMockCatalog: reloadCatalog,
    refresh,
  };
}
