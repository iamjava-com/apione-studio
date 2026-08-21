import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, WandSparkles } from 'lucide-react';
import { token } from '../api';
import { Button } from './ui/button';
import { CopyButton } from './ui/CopyButton';
import { Input } from './ui/input';

const inputCls = 'h-7 w-full font-mono text-[12px]';
const labelCls = 'mb-1 block text-[12px] text-muted';
const areaCls =
  'w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-[12px] text-text outline-none focus:border-brand';

/** Methods that conventionally carry a body — the field is noise for the others. */
const BODY_METHODS = new Set(['post', 'put', 'patch', 'delete']);

/** Asks the gateway to return the mock's console output; honoured only for a mock:write holder. */
const DEBUG_HEADER = 'x-apione-mock-debug';
const LOGS_HEADER = 'x-apione-mock-logs';

const parseQuery = (raw: string): string => raw.trim().replace(/^\?/, '');

/** `Name: value` per line — the shape people paste out of curl or devtools. */
const parseHeaders = (raw: string): Record<string, string> =>
  Object.fromEntries(
    raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const i = l.indexOf(':');
        return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );

function decodeLogs(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(atob(raw)) as string[];
  } catch {
    return [];
  }
}

interface RunResult {
  status: number;
  bodyText: string;
  logs: string[];
  ms: number;
}

/**
 * Sends a real request to the project's mock URL and shows the response.
 *
 * It deliberately goes through the gateway rather than executing the sandbox out of band: what
 * you see here is then, by construction, exactly what any caller gets — including auto-mode
 * endpoints, the master switch being off, and fall-through. The one thing a plain caller doesn't
 * get is the mock's console output, which the gateway attaches only for an authorized debugger.
 *
 * It can only exercise what's on disk, so an unsaved edit is saved on the way in — the button
 * says so rather than leaving you to wonder why nothing changed.
 */
export function MockDebugPanel({
  projectId,
  basePaths,
  method,
  template,
  dirty,
  onSaveBeforeRun,
}: {
  projectId: string;
  /** Base paths from the document's `servers`, in declaration order. The gateway serves an endpoint
   *  behind these and nowhere else. Must not be empty — `['']` is how "at the root" is said. */
  basePaths: string[];
  method: string | null;
  /** The spec path template of the selected operation, e.g. /users/{id}. */
  template: string | null;
  /** The editor has unsaved edits. Running hits the gateway, which only knows the saved mock —
   *  so instead of warning about it, Run saves first. */
  dirty: boolean;
  onSaveBeforeRun: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState('');
  const [query, setQuery] = useState('');
  const [headers, setHeaders] = useState('');
  const [body, setBody] = useState('');
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // A fresh endpoint gets a fresh request: the template is the starting point, with `{id}` left
  // in place so it's obvious what has to be filled in.
  useEffect(() => {
    setPath(template ?? '');
    setQuery('');
    setHeaders('');
    setBody('');
    setResult(null);
    setError(null);
  }, [template, method]);

  /**
   * Every address this operation answers at — one per declared base path, so more than one only
   * when the document declares more than one, and then each is equally real.
   *
   * A base already typed into the field is not prepended again: `/v1/users` is the address as it
   * stands, and `/v1/v1/users` would be a 404 sitting in a list of working addresses.
   */
  const urls = useMemo(() => {
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    const qs = parseQuery(query);
    const carried = (b: string) => !b || path === b || path.startsWith(`${b}/`);
    return [
      ...new Set(basePaths.map((b) => `${origin}/mock/${projectId}${carried(b) ? '' : b}${path}${qs ? `?${qs}` : ''}`)),
    ];
  }, [projectId, basePaths, path, query]);
  const url = urls[0]!;

  const showBody = method ? BODY_METHODS.has(method.toLowerCase()) : false;

  const run = async () => {
    if (!method) return;
    setRunning(true);
    setError(null);
    setResult(null); // the previous run's output must not read as this one's
    // The gateway can only serve what's on disk, so an unsaved edit has to land first.
    if (dirty && !(await onSaveBeforeRun())) {
      setRunning(false);
      return;
    }
    const started = performance.now();
    try {
      const tok = token.get();
      const sent = parseHeaders(headers);
      // Default to JSON, but never override a Content-Type the author typed themselves.
      const hasType = Object.keys(sent).some((k) => k.toLowerCase() === 'content-type');
      const res = await fetch(url, {
        method: method.toUpperCase(),
        headers: {
          ...(showBody && body.trim() && !hasType ? { 'Content-Type': 'application/json' } : {}),
          ...sent,
          [DEBUG_HEADER]: '1',
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: showBody && body.trim() ? body : undefined,
      });
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* not JSON — show it raw */
      }
      setResult({
        status: res.status,
        bodyText: pretty,
        logs: decodeLogs(res.headers.get(LOGS_HEADER)),
        ms: Math.round(performance.now() - started),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-[13px] text-muted">
        <span>{t('mockDebug')}</span>
        <div className="flex-1" />
        <Button size="sm" disabled={!method || running} onClick={() => void run()}>
          <Play size={13} />
          {dirty ? t('mockSaveAndRun') : t('mockRun')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!method || !template ? (
          <p className="text-[12px] text-faint">{t('mockPickEndpoint')}</p>
        ) : (
          <>
            <label className={labelCls}>
              {t('mockReqPath')}
              <Input
                aria-label="mock-path"
                className={inputCls}
                value={path}
                onChange={(e) => setPath(e.target.value)}
              />
            </label>
            <label className={labelCls}>
              {t('mockReqQuery')}
              <Input
                aria-label="mock-query"
                className={inputCls}
                placeholder="page=2&size=10"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className={labelCls}>
              {t('mockReqHeaders')}
              <textarea
                aria-label="mock-headers"
                rows={3}
                className={areaCls}
                placeholder={'X-Token: abc\nAccept-Language: zh'}
                value={headers}
                onChange={(e) => setHeaders(e.target.value)}
              />
            </label>
            {showBody && (
              <label className={labelCls}>
                <span className="flex items-center gap-2">
                  {t('mockReqBody')}
                  <button
                    aria-label="format-body"
                    title={t('formatCode')}
                    className="text-faint hover:text-text"
                    onClick={(e) => {
                      e.preventDefault();
                      try {
                        setBody(JSON.stringify(JSON.parse(body), null, 2));
                      } catch {
                        // Nothing to say: the body is right there, and it visibly didn't change.
                      }
                    }}
                  >
                    <WandSparkles size={12} />
                  </button>
                </span>
                <textarea
                  aria-label="mock-body"
                  rows={3}
                  className={areaCls}
                  placeholder='{"name": "a"}'
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>
            )}

            <div className="mt-3 border-t border-border pt-2">
              <div className="mb-1 flex items-baseline gap-2 text-[12px] text-muted">
                <span>{t('mockUrl')}</span>
                {/* Where the prefix in these addresses came from — the document, not this panel.
                    Nothing to attribute when every declared server sits at the root. */}
                {basePaths.some(Boolean) && <span className="text-[11px] text-faint">{t('mockUrlFromServers')}</span>}
              </div>
              <ul aria-label="mock-urls" className="space-y-1">
                {urls.map((u) => (
                  <li key={u} className="flex items-start gap-1">
                    <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-faint">
                      {method.toUpperCase()} {u}
                    </code>
                    <CopyButton
                      className="shrink-0 text-faint hover:text-text"
                      title={t('copy')}
                      text={u}
                      iconSize={12}
                      resetMs={1200}
                    />
                  </li>
                ))}
              </ul>
            </div>

            {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}
            {result && <Result result={result} />}
          </>
        )}
      </div>
    </div>
  );
}

function Result({ result }: { result: RunResult }) {
  const { t } = useTranslation();
  const bad = result.status >= 400;
  return (
    <div className="mt-3 border-t border-border pt-2 text-[12px]">
      <div className={`mb-1 font-mono ${bad ? 'text-danger' : 'text-muted'}`}>
        {result.status} · {result.ms}ms
      </div>
      <pre className="whitespace-pre-wrap break-all font-mono text-text">{result.bodyText}</pre>
      {result.logs.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="pb-1 text-faint">{t('mockLogs')}</div>
          {result.logs.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap break-all font-mono text-muted">
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
