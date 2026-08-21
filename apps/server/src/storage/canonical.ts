import YAML from 'yaml';
import { ValidationError } from '../errors.js';

/**
 * canonical-on-write: parse YAML/JSON → re-serialize deterministically (fixed indent).
 * Static formatting is normalized so diffs are clean by construction.
 * Trade-off: strips comments (accepted in the App-owned model).
 *
 * Key order is PRESERVED, not sorted: object key order is semantically insignificant
 * in OpenAPI, but it is meaningful to authors (drag-to-reorder endpoints/schemas/
 * fields), so canonical form keeps the order the author chose. Determinism still holds
 * — the same doc always serializes byte-identically; only differently-ordered docs differ.
 *
 * Discipline: pin the `yaml` version; treat any output-format change as a deliberate migration.
 */
/**
 * Which files canonical-on-write applies to. Round-trip fidelity is a *spec* concern — code
 * sidecars (scripted mocks) are stored verbatim, since reformatting someone's JavaScript would
 * destroy comments and intent. Their only normalization is newline endings.
 */
export function isCanonicalizable(filePath: string): boolean {
  return !/\.(js|mjs|cjs|ts)$/i.test(filePath);
}

/** Verbatim storage for code sidecars: normalize CRLF and guarantee a trailing newline. */
export function normalizeCode(raw: string): string {
  const text = raw.replace(/\r\n?/g, '\n');
  return text.endsWith('\n') || text === '' ? text : `${text}\n`;
}

/** The canonical form of an already-parsed document. Serialization options live here only. */
export function canonicalizeTree(doc: unknown): string {
  return YAML.stringify(doc, { indent: 2 });
}

/** Lenient parse (YAML or JSON) for content that may be anything by now: null instead of a throw. */
export function parseOrNull(content: string): unknown {
  try {
    return YAML.parse(content) ?? null;
  } catch {
    return null;
  }
}

export function canonicalize(raw: string): string {
  let doc: unknown;
  try {
    doc = YAML.parse(raw);
  } catch (e) {
    throw new ValidationError(`invalid YAML/JSON: ${(e as Error).message}`);
  }
  if (doc === undefined || doc === null) {
    throw new ValidationError('content is empty');
  }
  return canonicalizeTree(doc);
}
