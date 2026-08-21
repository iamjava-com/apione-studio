import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Scalar's self-hosted browser bundle. Security rule: engine JS never loads from a CDN.
 * A build copies it into dist/assets (scripts/bundle-scalar.mjs) so the runtime image ships this
 * one file instead of the package's Vue UI tree; in dev and tests it comes from node_modules.
 */
function standalonePath(): string {
  const bundled = path.join(here, '..', 'assets', 'scalar-standalone.js');
  if (fs.existsSync(bundled)) return bundled;
  return path.join(path.dirname(require.resolve('@scalar/api-reference')), 'browser', 'standalone.js');
}

/**
 * The IIFE build, read once. It is ~3.5 MB but carries no dynamic imports — the ESM build is a
 * fifth of the size and would be the obvious pick, except it pulls chunks at runtime, which is
 * exactly what a file:// page cannot do.
 */
let script: string | null = null;
export function standaloneScript(): string {
  script ??= fs.readFileSync(standalonePath(), 'utf8');
  return script;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Scalar reads its config off an HTML attribute, so the quotes are entity-escaped. */
const attr = (config: object): string => JSON.stringify(config).replace(/"/g, '&quot;');

/** Escapes `<` so the document can never close the script element early (`</script>` inside a
 *  string value). `<` is valid JSON and parses back to `<`. */
const embedJson = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * Everything that reaches out of the page, off. A copy handed to someone outside the team must
 * not phone home when they open it, and must work with no network at all:
 *
 * - `withDefaultFonts` pulls webfonts from fonts.scalar.com. Left on, opening the file tells a
 *   third party that someone somewhere is reading this API — and offline it renders unstyled.
 * - `agent` and `mcp` reach an AI service; `showDeveloperTools` is not this audience's.
 * - The client and Test Request send live requests. From `file://` the origin is `null`, so CORS
 *   refuses them before they leave; the recipient is usually nowhere near the API anyway; and
 *   Scalar's fallback is to relay through its own proxy, which would put a reader's request —
 *   auth headers included — through a third party. The in-app docs keep try-it, where the mock
 *   server makes it work and nothing leaves the instance.
 * - `documentDownloadType: none` — the offer is the document this file was generated from, a
 *   route back to what the reader was handed a rendered page instead of. (`hideDownloadButton`
 *   does the same but is deprecated upstream.)
 */
const CONFIG = {
  withDefaultFonts: false,
  documentDownloadType: 'none',
  agent: { disabled: true },
  mcp: { disabled: true },
  showDeveloperTools: 'never',
  hideTestRequestButton: true,
  hideClientButton: true,
};

/** Latin first, then CJK system faces, matching the app's own stack — no bytes, no requests. */
const FONT_STACK =
  "'Hanken Grotesk Variable', ui-sans-serif, system-ui, 'PingFang SC', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans SC', sans-serif";

/**
 * One HTML file that renders the spec with no network at all — the engine and the document are
 * both inlined, so it opens from disk, survives being emailed, and works behind an air gap.
 *
 * No mock server is injected here, unlike the in-app docs: that server is a relative URL only the
 * running instance can answer, and a standalone file is read somewhere else by definition.
 */
export function renderStandalonePage(doc: unknown, title: string): string {
  const config = attr(CONFIG);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>body { font-family: ${FONT_STACK}; }</style>
  </head>
  <body>
    <script id="api-reference" type="application/json" data-configuration="${config}">${embedJson(doc)}</script>
    <script>${standaloneScript()}</script>
  </body>
</html>
`;
}

/**
 * The same reference, served by the running instance instead of handed out as a file. Nothing is
 * inlined — the app's CSP allows `script-src 'self'` only — so the engine and the document are
 * fetched from their own URLs, and the page always shows the document as it is now.
 *
 * `scriptUrl` should carry a version: {@link standaloneScript} is served immutable.
 */
export function renderHostedPage(opts: { documentUrl: string; scriptUrl: string; title: string }): string {
  // The document is reachable here, so the download offer has somewhere to point. The title is
  // what names the downloaded file — untitled sources fall back to their index, i.e. `api-1`.
  const config = attr({ ...CONFIG, documentDownloadType: 'both', title: opts.title });
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(opts.title)}</title>
    <style>body { font-family: ${FONT_STACK}; }</style>
  </head>
  <body>
    <script id="api-reference" data-url="${escapeHtml(opts.documentUrl)}" data-configuration="${config}"></script>
    <script src="${escapeHtml(opts.scriptUrl)}"></script>
  </body>
</html>
`;
}
