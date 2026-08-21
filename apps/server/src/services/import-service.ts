import YAML from 'yaml';
import { createProject, deleteProject, getProject } from './project-service.js';
import { readFile, type WriteResult } from './file-service.js';
import { saveSpecFile } from './spec-write-service.js';
import { adoptOperationIds } from './operations.js';
import { parseOrNull } from '../storage/canonical.js';
import { isPostman, postmanToOpenapi } from '../engines/postman.js';
import { swagger2ToOpenapi } from '../engines/swagger2.js';
import { NotFoundError, ValidationError } from '../errors.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

type SourceFormat = 'oas3' | 'swagger2' | 'postman';
export type ImportFormat = 'auto' | SourceFormat;
const ROOT = 'openapi.yaml';

/** YApi/mock-tool cruft that swagger2openapi passes through verbatim — never valid OpenAPI. */
const JUNK_KEYS = new Set(['$$ref', 'mock', 'enumDesc']);

/** `nullable: true` (3.0) → a `"null"` member in the type union (3.1); on a bare $ref, wrap in anyOf. */
function upgradeNullable(node: any): void {
  const nullable = node.nullable === true;
  delete node.nullable;
  if (!nullable) return; // false/undefined → 3.1 default (non-nullable)
  if (typeof node.type === 'string') node.type = [node.type, 'null'];
  else if (Array.isArray(node.type)) {
    if (!node.type.includes('null')) node.type.push('null');
  } else if (typeof node.$ref === 'string') {
    const ref = node.$ref;
    delete node.$ref;
    node.anyOf = [{ $ref: ref }, { type: 'null' }];
  }
  // else: no type/$ref to attach null to (rare) → nullability dropped rather than corrupt the schema
}

/** `exclusiveMinimum: true` + `minimum: n` (draft-04) → `exclusiveMinimum: n` (2020-12 / 3.1). */
function upgradeExclusive(node: any, key: 'exclusiveMinimum' | 'exclusiveMaximum'): void {
  const bound = key === 'exclusiveMinimum' ? 'minimum' : 'maximum';
  if (node[key] === true && typeof node[bound] === 'number') {
    node[key] = node[bound];
    delete node[bound];
  } else {
    delete node[key]; // false (the default) or no numeric bound → just drop the boolean
  }
}

/**
 * Normalize a converted doc to canonical OpenAPI 3.1 (the project is 3.1-native): strip
 * non-standard cruft and lift 3.0-isms to their 3.1 form. Idempotent — an already-clean
 * 3.1 doc is untouched. `$schema` and array-form `examples` are 3.1-valid, so kept.
 */
function normalizeTo31(node: any): void {
  if (Array.isArray(node)) {
    node.forEach(normalizeTo31);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    if (key.startsWith('x-')) continue; // leave vendor extensions alone
    if (JUNK_KEYS.has(key)) {
      delete node[key];
      continue;
    }
    if (key === 'nullable') {
      upgradeNullable(node);
      continue;
    }
    if ((key === 'exclusiveMinimum' || key === 'exclusiveMaximum') && typeof node[key] === 'boolean') {
      upgradeExclusive(node, key);
      continue;
    }
    normalizeTo31(node[key]);
  }
}

/** The spec's own info.title, for prefilling a project name. */
function titleOf(oas: any): string | null {
  const t = oas?.info?.title;
  return typeof t === 'string' && t.trim() ? t.trim() : null;
}

function detect(doc: any): SourceFormat {
  if (typeof doc?.openapi === 'string' && doc.openapi.startsWith('3')) return 'oas3';
  if (typeof doc?.swagger === 'string' && doc.swagger.startsWith('2')) return 'swagger2';
  if (isPostman(doc)) return 'postman';
  throw new ValidationError(
    'unrecognized spec: expected OpenAPI 3, Swagger 2, or a Postman collection',
    'invalid_spec',
  );
}

/** Parse + detect + convert to OpenAPI 3. Throws (ValidationError) on anything unrecognized —
 *  callers rely on this validating before they persist anything. */
async function toCanonical(content: string, format: ImportFormat): Promise<{ oas: any; sourceFormat: SourceFormat }> {
  let doc: any;
  try {
    doc = YAML.parse(content); // handles both YAML and JSON
  } catch (e) {
    throw new ValidationError(`invalid YAML/JSON: ${(e as Error).message}`, 'invalid_spec');
  }
  if (!doc || typeof doc !== 'object') throw new ValidationError('empty or invalid document', 'invalid_spec');

  const sourceFormat = format === 'auto' ? detect(doc) : format;
  let oas = doc;
  if (sourceFormat === 'swagger2') {
    oas = await swagger2ToOpenapi(doc);
  } else if (sourceFormat === 'postman') {
    oas = postmanToOpenapi(doc);
  }
  // Canonicalize every import to 3.1: strip cruft, lift 3.0-isms, stamp the version.
  normalizeTo31(oas);
  if (oas && typeof oas === 'object') oas.openapi = '3.1.0';
  return { oas, sourceFormat };
}

export interface ImportResult extends WriteResult {
  sourceFormat: SourceFormat;
}

export interface ImportPreview {
  title: string | null; // the spec's info.title, for prefilling the project name
  sourceFormat: SourceFormat;
}

/** Dry-run of import-as-new: parse + detect + convert to validate the spec WITHOUT persisting
 *  anything, so the new-project dialog can confirm it parses and prefill the name from info.title
 *  before the user commits. Throws the same ValidationError as a real import on a bad spec. */
export async function previewImport(content: string, format: ImportFormat = 'auto'): Promise<ImportPreview> {
  const { oas, sourceFormat } = await toCanonical(content, format);
  return { title: titleOf(oas), sourceFormat };
}

/**
 * Import a spec into a project's root file. Swagger 2 is converted to OpenAPI 3
 * (the migration path off YApi, which exports Swagger 2). Writes via the single write
 * path (canonical-on-write, author=import); re-importing bumps the version.
 */
export async function importSpec(
  projectId: string,
  content: string,
  format: ImportFormat = 'auto',
  authorRef?: string,
): Promise<ImportResult> {
  getProject(projectId); // 404 cleanly if the project doesn't exist
  const { oas, sourceFormat } = await toCanonical(content, format);

  // The root as it stands (absent until the project has a spec): its version is what the write
  // goes out against, and its operation ids are what the incoming document inherits by address.
  let base = 0;
  try {
    const current = readFile(projectId, ROOT);
    base = current.version;
    adoptOperationIds(parseOrNull(current.content), oas);
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
  }

  // Through the same write path as an ordinary save: an import replaces the document wholesale,
  // so it is exactly when operations move and disappear, and the mocks have to keep up.
  const written = saveSpecFile(projectId, ROOT, JSON.stringify(oas), base, {
    type: 'import',
    ref: authorRef ?? null,
  });
  return { ...written, sourceFormat };
}

/**
 * Atomic import-as-new: validate + convert the spec FIRST, and only then create the project and
 * write it. An unrecognized/invalid spec throws before anything is created — no orphan project.
 * Name precedence: caller-supplied > the spec's own info.title > a generic fallback.
 */
export async function importAsNewProject(
  name: string | undefined,
  content: string,
  format: ImportFormat = 'auto',
  authorRef?: string,
  groupId?: string | null,
) {
  const { oas } = await toCanonical(content, format);
  const project = createProject(name?.trim() || titleOf(oas) || 'Imported API', groupId ?? null);
  try {
    saveSpecFile(project.id, ROOT, JSON.stringify(oas), 0, { type: 'import', ref: authorRef ?? null });
  } catch (e) {
    deleteProject(project.id); // roll back the empty shell if the write somehow fails
    throw e;
  }
  return project;
}
