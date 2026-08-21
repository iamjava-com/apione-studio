import type { Doc } from './types';

/**
 * Helpers for reading/writing a schema's type across the OpenAPI 3.1 nullability form,
 * where a nullable value is a type union like `["string", "null"]` (3.0's `nullable: true`
 * no longer exists). The form editors show a single primary type + a "nullable" toggle.
 */

/** The primary (non-null) type, tolerating a 3.1 union like `["string","null"]`. */
export function primaryType(schema: Doc | undefined): string | undefined {
  const ty = schema?.type;
  if (Array.isArray(ty)) return ty.find((x: string) => x !== 'null') ?? undefined;
  return ty;
}

/** Nullable in 3.1 style: `"null"` present in the type union. */
export function isNullable(schema: Doc | undefined): boolean {
  return Array.isArray(schema?.type) && schema.type.includes('null');
}

/** Set/clear nullability in place, preserving the primary type (union form). No-op without a type. */
export function setNullable(n: Doc, on: boolean): void {
  const p = primaryType(n);
  if (p == null) return; // no scalar type to union with (e.g. $ref) — nothing to toggle here
  n.type = on ? [p, 'null'] : p;
}
