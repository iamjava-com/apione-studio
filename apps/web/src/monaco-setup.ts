// Self-host Monaco (security rule: never load the editor from a CDN).
// @monaco-editor/react defaults to a CDN loader; point it at the bundled package
// and wire the editor web worker via Vite's `?worker` import.
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
// The JS language service is its own module in Monaco 0.56 — it is no longer reachable through
// monaco.languages, and importing it is what makes the contribution available at all.
import { javascriptDefaults, ModuleKind, ScriptTarget } from 'monaco-editor/languages/features/typescript/register';
// Paths go through the package's export map ("./*" → "./esm/vs/*.js"), so no esm/vs prefix here.
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
// The JS language service (completions, formatting) lives in its own worker. Bundled locally and
// loaded on demand, so only opening a mock editor pays for it.
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: (_id: string, label: string) =>
    label === 'typescript' || label === 'javascript' ? new TsWorker() : new EditorWorker(),
};

loader.config({ monaco });

/** The scripted-mock contract, as ambient types — so `req.` completes and the shape is
 *  discoverable in the editor rather than only in the help dialog. */
const MOCK_TYPES = `
interface MockRequest {
  /** Upper-case HTTP method, e.g. 'GET'. */
  method: string;
  /** Concrete request path, e.g. '/users/42'. */
  path: string;
  /** Values captured from the path template, e.g. { id: '42' } for /users/{id}. */
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  /** Parsed JSON body, or undefined. */
  body: any;
}
/** The response envelope. Returning anything else is taken as the body, with status 200. */
interface MockResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: any;
  /** Wait this long before responding, to imitate a slow endpoint. Capped at 30000. */
  delayMs?: number;
}
`;

javascriptDefaults.setCompilerOptions({
  target: ScriptTarget.ES2020,
  module: ModuleKind.ESNext,
  allowNonTsExtensions: true,
});
// Syntax errors are real and worth flagging. Semantic and suggestion diagnostics are not: they
// report things that don't apply here — unresolved modules, and "implicitly has an 'any' type"
// on a `req` that is untyped by design unless the author opts into the JSDoc annotation.
javascriptDefaults.setDiagnosticsOptions({
  noSyntaxValidation: false,
  noSemanticValidation: true,
  noSuggestionDiagnostics: true,
});
javascriptDefaults.addExtraLib(MOCK_TYPES, 'apione:mock-types.d.ts');

// Editor themes derived from our tokens (Monaco needs hex, not CSS vars).
monaco.editor.defineTheme('apione-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: { 'editor.background': '#0E1116', 'editorGutter.background': '#0E1116' },
});
monaco.editor.defineTheme('apione-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: { 'editor.background': '#F6F7F9', 'editorGutter.background': '#F6F7F9' },
});
