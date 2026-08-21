import fs from 'node:fs';
import path from 'node:path';
import {
  createConfig,
  bundle,
  lint,
  BaseResolver,
  ResolveError,
  type Config,
  type Source,
} from '@redocly/openapi-core';

/**
 * Adapter over @redocly/openapi-core — the one core OpenAPI engine (parse/bundle/lint).
 * Everything sits behind this thin module so the engine stays swappable; the rest of
 * the app never imports openapi-core directly.
 */

const REMOTE_REF = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Resolve symlinks, tolerating a path that does not exist yet — its parent usually does. */
function realPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    try {
      return path.join(fs.realpathSync(path.dirname(p)), path.basename(p));
    } catch {
      return path.resolve(p);
    }
  }
}

/**
 * Confines every `$ref` the engine follows to one project's vault directory.
 *
 * The vault's own path guard only vets the entry file; from there the engine follows `$ref`s on its
 * own, and an unconfined one reads any file the process can (`/etc/passwd`, another project's spec,
 * the JWT secret) or fetches a URL, since the engine inlines whatever it loads into the bundle that
 * /spec.json, the docs page and the anonymous mock gateway all hand back.
 *
 * Refusing inside `loadExternalRef` — the engine's own load step, in the engine's own error type —
 * is deliberate: a rejected ref then surfaces as an ordinary unresolved-$ref lint problem the
 * author can act on, where throwing any earlier escapes `bundle()` as a 500.
 */
class JailedResolver extends BaseResolver {
  readonly #jail: string;

  constructor(jailDir: string, config: Config['resolve']) {
    super(config);
    this.#jail = realPath(jailDir);
  }

  override async loadExternalRef(absoluteRef: string): Promise<Source> {
    if (REMOTE_REF.test(absoluteRef)) {
      throw new ResolveError(new Error('remote $ref is not allowed'));
    }
    // Symlinks are resolved first: a prefix test on the literal path is escapable through one.
    const target = realPath(path.resolve(absoluteRef));
    if (target !== this.#jail && !target.startsWith(this.#jail + path.sep)) {
      throw new ResolveError(new Error('$ref escapes the project directory'));
    }
    return super.loadExternalRef(absoluteRef);
  }
}

let configPromise: Promise<Config> | null = null;

/**
 * Default ruleset = structural validity only: `struct` (the spec conforms to the
 * OpenAPI schema) + `no-unresolved-refs` (every $ref resolves). Both errors — the
 * "can this spec even be rendered/mocked/bundled" gate, with ~zero false positives.
 * Redocly's `minimal` preset is deliberately NOT used: it layers ~15 governance warns
 * (missing summary/operationId/tag-description, unused components, …) that flood every
 * freshly-imported spec. Those opinionated rules are opt-in per-project — a P3 feature,
 * not a default that nags every valid spec.
 */
function getConfig(): Promise<Config> {
  configPromise ??= createConfig({ rules: { struct: 'error', 'no-unresolved-refs': 'error' } });
  return configPromise;
}

export interface LintProblem {
  ruleId: string;
  severity: 'error' | 'warn';
  message: string;
  location: string | null;
}

function toLintProblem(p: {
  ruleId: string;
  severity: 'error' | 'warn';
  message: string;
  location: Array<{ pointer?: string }>;
}): LintProblem {
  return {
    ruleId: p.ruleId,
    severity: p.severity,
    message: p.message,
    location: p.location[0]?.pointer ?? null,
  };
}

/**
 * Lint a spec file (resolves $refs from disk). Returns normalized problems.
 *
 * @param jailDir Directory every `$ref` must stay inside — the project's vault dir, never the vault
 * root, or one project's spec could read another's.
 */
export async function lintFile(absPath: string, jailDir: string): Promise<LintProblem[]> {
  const config = await getConfig();
  const problems = await lint({
    ref: absPath,
    config,
    externalRefResolver: new JailedResolver(jailDir, config.resolve),
  });
  return problems.map(toLintProblem);
}

export interface BundleOutput {
  /** The bundled spec as a plain JS object (multi-file $refs pulled into one document). */
  parsed: unknown;
  problems: LintProblem[];
  /** Every file that was read to produce this — the root plus whatever its `$ref`s reached. */
  sourceFiles: string[];
}

/**
 * Bundle a multi-file spec (following $refs) into a single document.
 *
 * @param jailDir Directory every `$ref` must stay inside — see {@link lintFile}.
 */
export async function bundleFile(absPath: string, jailDir: string): Promise<BundleOutput> {
  const config = await getConfig();
  const result = await bundle({
    ref: absPath,
    config,
    externalRefResolver: new JailedResolver(jailDir, config.resolve),
  });
  return {
    parsed: result.bundle.parsed,
    problems: result.problems.map(toLintProblem),
    sourceFiles: [...result.fileDependencies],
  };
}
