/**
 * The base paths a document declares, read off `servers[].url`.
 *
 * In OpenAPI the full address of an endpoint is `server.url` + the `paths` key, so a base path
 * like `/v1` belongs to the server, never repeated across every path. The mock gateway uses this
 * to accept both forms of an address; the editor uses it to show them.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Substitute `{var}` from `variables[var].default`; null if any variable can't be resolved.
 *  Enums are deliberately not expanded — one prefix per server keeps the accepted set predictable. */
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
 * Declared base paths, deduped, **in declaration order** — this is the list people are shown, and
 * the author's order is the one they recognise. Callers that strip prefixes must sort by length
 * themselves (see `sortByStripOrder`).
 *
 * `''` is a base like any other, and the common one: `https://api.example.com` and the `/` that a
 * document without `servers` defaults to both say "no base path". So the result is never empty —
 * a document that declares nothing yields `['']`, and the whole model stays "try each base".
 *
 * A server whose url can't be resolved (an undeclared variable, or not a url at all) is skipped
 * rather than guessed at — the gateway will not answer for it either.
 */
export function serverBasePaths(spec: any): string[] {
  const declared = Array.isArray(spec?.servers) ? spec.servers : [];
  const servers = declared.length ? declared : [{ url: '/' }]; // the spec's own default
  const out = new Set<string>();
  for (const server of servers) {
    if (typeof server?.url !== 'string') continue;
    const resolved = substituteVariables(server.url, server.variables);
    if (resolved === null) continue;
    let pathname: string;
    try {
      // A base is a URL relative to wherever the document is served, which the spec explicitly
      // allows — the dummy base is only there to let one parser handle both forms.
      pathname = new URL(resolved, 'http://spec.invalid').pathname;
    } catch {
      continue; // not a URL at all — nothing to take a prefix from
    }
    out.add(pathname.replace(/\/+$/, ''));
  }
  // Every server was unresolvable: fall back to the bare path rather than serving nothing at all.
  return out.size ? [...out] : [''];
}

/** Longest first, so `/v1/beta` is stripped before the `/v1` it starts with. */
export const sortByStripOrder = (bases: string[]): string[] => [...bases].sort((a, b) => b.length - a.length);

/**
 * `reqPath` with `base` removed, or null if it doesn't carry that base. An empty base is the
 * document's root, so it takes nothing off.
 *
 * The boundary check is the point: without it `/v1beta/users` would count as carrying `/v1` and
 * the leftover `beta/users` would go on to match the template `/beta/users`.
 */
export function stripBasePath(reqPath: string, base: string): string | null {
  if (!base) return reqPath;
  if (reqPath === base) return '/';
  return reqPath.startsWith(`${base}/`) ? reqPath.slice(base.length) : null;
}
