import fs from 'node:fs';
import { getProject } from './project-service.js';
import * as fsvc from './file-service.js';
import * as vault from '../storage/vault.js';
import * as engine from '../engines/openapi-core.js';
import * as oasdiff from '../engines/oasdiff.js';
import { HTTP_METHODS } from './operations.js';
import { NotFoundError } from '../errors.js';

/** A project = one API = one root OpenAPI doc. Convention for the root file name. */
const ROOT_CANDIDATES = ['openapi.yaml', 'openapi.yml', 'openapi.json'] as const;

function rootFileName(projectId: string): string {
  const project = getProject(projectId);
  for (const name of ROOT_CANDIDATES) {
    if (fs.existsSync(vault.fileAbsPath(project.id, name))) return name;
  }
  throw new NotFoundError(`no root spec file (${ROOT_CANDIDATES.join(' / ')}) found in project`, 'spec_missing');
}

function rootFileAbs(projectId: string): string {
  const project = getProject(projectId);
  return vault.fileAbsPath(project.id, rootFileName(projectId));
}

export async function lintProject(projectId: string) {
  const problems = await engine.lintFile(rootFileAbs(projectId), vault.projectDir(projectId));
  return {
    errorCount: problems.filter((p) => p.severity === 'error').length,
    warnCount: problems.filter((p) => p.severity === 'warn').length,
    problems,
  };
}

/** mtime+size of each file a bundle was built from, as one comparable string. */
function stampOf(files: string[]): string {
  return files
    .map((f) => {
      try {
        const s = fs.statSync(f);
        return `${f}:${s.mtimeMs}:${s.size}`;
      } catch {
        return `${f}:gone`;
      }
    })
    .join('\n');
}

/**
 * Bundling parses every file in the project, and /mock does it on each request — anonymously. The
 * cache turns a repeated mock call into a handful of stat() calls.
 *
 * Keyed on what is on disk, not on the version ledger, because the disk is the source of truth: an
 * edit made outside the app has to show up in the mock exactly as one made through it.
 */
const bundleCache = new Map<string, { stamp: string; out: engine.BundleOutput }>();

/** Bounded so a long-lived process cannot accumulate parsed specs; least-recently-used goes first. */
const BUNDLE_CACHE_MAX = 32;

async function bundleShared(projectId: string): Promise<engine.BundleOutput> {
  const hit = bundleCache.get(projectId);
  if (hit && stampOf(hit.out.sourceFiles) === hit.stamp) {
    bundleCache.delete(projectId); // re-insert to mark it most recent (Map iterates in insertion order)
    bundleCache.set(projectId, hit);
    return hit.out;
  }

  const out = await engine.bundleFile(rootFileAbs(projectId), vault.projectDir(projectId));
  bundleCache.delete(projectId);
  bundleCache.set(projectId, { stamp: stampOf(out.sourceFiles), out });
  for (const oldest of bundleCache.keys()) {
    if (bundleCache.size <= BUNDLE_CACHE_MAX) break;
    bundleCache.delete(oldest);
  }
  return out;
}

/** The bundled project for reading. The object is the cached one, shared with every other caller
 *  — treat it as frozen; a caller that mutates it wants {@link bundleProjectMutable}. */
export function bundleProjectView(projectId: string): Promise<engine.BundleOutput> {
  return bundleShared(projectId);
}

/** A private copy of the bundle, the caller's to mutate in place (export filters, stripping). */
export async function bundleProjectMutable(projectId: string): Promise<engine.BundleOutput> {
  return structuredClone(await bundleShared(projectId));
}

/**
 * Strip every `x-` specification extension from a document, for an export meant to carry nothing
 * but the standard. That includes the author's own extensions, not just ours — "no vendor
 * extensions" is the whole point of asking. Mutates in place; callers pass a freshly-bundled
 * object that is theirs to consume.
 */
export function stripExtensions<T>(node: T): T {
  if (Array.isArray(node)) {
    node.forEach(stripExtensions);
    return node;
  }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      if (key.startsWith('x-')) delete (node as Record<string, unknown>)[key];
      else stripExtensions((node as Record<string, unknown>)[key]);
    }
  }
  return node;
}

export interface ChangeReport {
  available: boolean; // is the oasdiff engine installed?
  baseVersion: number | null; // null when base/target don't form a valid comparison
  targetVersion: number; // the version compared TO (defaults to the current head)
  errorCount: number;
  warnCount: number;
  changes: oasdiff.Change[];
}
export type BreakingReport = ChangeReport;

/**
 * Semantic diff of two saved versions of a spec file, base → target: breaking changes only, or
 * the full changelog. Defaults target to the current head and base to target-1 — the natural
 * "what did my last save change?" question, answered straight from the version history.
 */
async function changesForFile(
  projectId: string,
  filePath: string,
  kind: oasdiff.DiffKind,
  baseVersion?: number,
  targetVersion?: number,
): Promise<ChangeReport> {
  const current = fsvc.readFile(projectId, filePath);
  const target = targetVersion ?? current.version;
  const base = baseVersion ?? target - 1;
  const available = await oasdiff.isAvailable();

  if (base < 1 || base >= target || target < 1 || target > current.version) {
    return { available, baseVersion: null, targetVersion: target, errorCount: 0, warnCount: 0, changes: [] };
  }
  if (!available) {
    return { available, baseVersion: base, targetVersion: target, errorCount: 0, warnCount: 0, changes: [] };
  }

  const baseContent = fsvc.getVersionContent(projectId, filePath, base).content;
  const targetContent =
    target === current.version ? current.content : fsvc.getVersionContent(projectId, filePath, target).content;
  const changes = await oasdiff.diffChanges(kind, baseContent, targetContent);
  return {
    available,
    baseVersion: base,
    targetVersion: target,
    errorCount: changes.filter((c) => c.level === 'error').length,
    warnCount: changes.filter((c) => c.level === 'warning').length,
    changes,
  };
}

/** Breaking-change report for the project's root spec (base → target, both optional). */
export function breakingProject(
  projectId: string,
  baseVersion?: number,
  targetVersion?: number,
): Promise<ChangeReport> {
  return changesForFile(projectId, rootFileName(projectId), 'breaking', baseVersion, targetVersion);
}

/** Every semantic change to the project's root spec between two versions, info level included. */
export function changelogProject(
  projectId: string,
  baseVersion?: number,
  targetVersion?: number,
): Promise<ChangeReport> {
  return changesForFile(projectId, rootFileName(projectId), 'changelog', baseVersion, targetVersion);
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Collect every $ref string found anywhere in a JSON subtree. */
function collectRefs(node: any, acc: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collectRefs(n, acc);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === '$ref' && typeof v === 'string') acc.add(v);
    else collectRefs(v, acc);
  }
}

export interface GraphNode {
  id: string;
  type: 'schema' | 'operation';
  label: string;
}
export interface GraphEdge {
  from: string;
  to: string;
}

/**
 * The $ref dependency graph (the Obsidian-style signature feature): schema + operation
 * nodes, edges where one references another via $ref, plus orphan schemas (no inbound).
 */
export async function graphProject(projectId: string): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
  orphans: string[];
}> {
  const out = await bundleProjectView(projectId);
  const spec = out.parsed as any;
  const schemas = spec.components?.schemas ?? {};
  const nodes: GraphNode[] = [];
  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];

  const schemaIdFromRef = (ref: string): string | null => {
    const m = /#\/components\/schemas\/(.+)$/.exec(ref);
    return m ? `schema:${m[1]}` : null;
  };
  const addEdge = (from: string, to: string) => {
    const key = `${from}->${to}`;
    if (from !== to && !edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push({ from, to });
    }
  };

  for (const name of Object.keys(schemas)) {
    nodes.push({ id: `schema:${name}`, type: 'schema', label: name });
  }
  for (const name of Object.keys(schemas)) {
    const refs = new Set<string>();
    collectRefs(schemas[name], refs);
    for (const ref of refs) {
      const to = schemaIdFromRef(ref);
      if (to) addEdge(`schema:${name}`, to);
    }
  }

  for (const [p, item] of Object.entries<any>(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = item?.[method];
      if (!op) continue;
      const label = `${method.toUpperCase()} ${p}`;
      const id = `op:${op.operationId ?? label}`;
      nodes.push({ id, type: 'operation', label });
      const refs = new Set<string>();
      collectRefs(op, refs);
      for (const ref of refs) {
        const to = schemaIdFromRef(ref);
        if (to) addEdge(id, to);
      }
    }
  }

  const referenced = new Set(edges.map((e) => e.to));
  const orphans = nodes.filter((n) => n.type === 'schema' && !referenced.has(n.id)).map((n) => n.id);
  return { nodes, edges, orphans };
}
