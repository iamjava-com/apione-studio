/**
 * Base paths declared by a document's `servers[]`.
 *
 * Deliberately a copy of the server's `services/spec-servers.ts`, not an import: the two packages
 * install separately and share no build. Keep the rules in step — the gateway routes by them, and
 * an address shown here that the gateway doesn't accept is worse than showing nothing.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Substitute `{var}` from `variables[var].default`; null if any variable can't be resolved. */
function substituteVariables(url: string, variables: any): string | null {
  if (!url.includes('{')) return url;
  let unresolved = false;
  const out = url.replace(/\{([^{}]*)\}/g, (_m, name: string) => {
    const def = variables?.[name]?.default;
    if (typeof def !== 'string') {
      unresolved = true;
      return '';
    }
    return def;
  });
  return unresolved ? null : out;
}

/**
 * Deduped, in declaration order. Never empty: `''` is a base like any other — a bare host, a `/`,
 * or a document that declares no servers at all all mean "no base path".
 */
export function serverBasePaths(servers: unknown): string[] {
  const declared = Array.isArray(servers) ? servers : [];
  const out = new Set<string>();
  for (const server of (declared.length ? declared : [{ url: '/' }]) as any[]) {
    if (typeof server?.url !== 'string') continue;
    const resolved = substituteVariables(server.url, server.variables);
    if (resolved === null) continue;
    let pathname: string;
    try {
      // A server url may be relative to wherever the document is served; the dummy base only lets
      // one parser handle both forms.
      pathname = new URL(resolved, 'http://spec.invalid').pathname;
    } catch {
      continue;
    }
    out.add(pathname.replace(/\/+$/, ''));
  }
  return out.size ? [...out] : [''];
}
