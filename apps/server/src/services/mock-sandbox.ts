/**
 * Tier-"scripted" execution engine: runs a user-authored `(req) => res` inside QuickJS compiled
 * to WebAssembly.
 *
 * The security property is *absence*, not filtering: the guest is a WASM instance with no fs,
 * network, process or timer syscalls to reach for, and `console` is the only host binding.
 * Nothing here needs to blocklist anything, which is exactly why this beats an in-process V8
 * isolate. Mocks are stateless by design — a request is answered from `req` alone.
 *
 * Bounded on three axes so a hostile or buggy mock can't wedge the server: heap ceiling, an
 * interrupt handler that fires on a wall-clock deadline (catches `while(true)`), and an outer
 * race that also covers a promise which simply never settles.
 */
import { newQuickJSAsyncWASMModule, Scope, shouldInterruptAfterDeadline } from 'quickjs-emscripten';
import type { QuickJSAsyncContext, QuickJSHandle } from 'quickjs-emscripten';
import { AppError } from '../errors.js';

export interface MockRequestInput {
  method: string;
  /** Concrete request path, e.g. /users/42 */
  path: string;
  /** Values captured from the spec's templated segments, e.g. { id: '42' } */
  params: Record<string, string>;
  query: Record<string, unknown>;
  headers: Record<string, string>;
  body: unknown;
}

/** What the user's function is expected to return. Every field is optional. */
export interface ScriptedResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  /** Hold the response back this long. Host-side, so it costs the mock none of its run budget. */
  delayMs: number;
  /** Anything the mock passed to console.* — surfaced in the editor, never to the caller. */
  logs: string[];
}

export interface RunOptions {
  code: string;
  req: MockRequestInput;
  timeoutMs?: number;
  memoryLimitBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 1_000;
const DEFAULT_MEMORY_BYTES = 32 * 1024 * 1024;
const MAX_STACK_BYTES = 512 * 1024;
/** A slow endpoint is worth simulating; an endless one just holds a connection open. */
const MAX_DELAY_MS = 30_000;

/** The WASM module is expensive to build and safe to share; isolation lives at the context
 *  level, and every request gets a brand-new context (and thus fresh globals + heap). */
let modulePromise: ReturnType<typeof newQuickJSAsyncWASMModule> | null = null;
const getModule = () => (modulePromise ??= newQuickJSAsyncWASMModule());

/** Marshal a host value into the guest by round-tripping through the guest's own JSON.parse —
 *  values cross as data, never as references to host objects. */
function toGuest(ctx: QuickJSAsyncContext, parseJson: QuickJSHandle, value: unknown): QuickJSHandle {
  if (value === undefined) return ctx.undefined;
  const json = JSON.stringify(value);
  if (json === undefined) return ctx.undefined; // functions/symbols
  return Scope.withScope((scope) => {
    const str = scope.manage(ctx.newString(json));
    return ctx.unwrapResult(ctx.callFunction(parseJson, ctx.undefined, str));
  });
}

/** Read a guest value back to the host, again via JSON so no guest handle escapes. */
function fromGuest(ctx: QuickJSAsyncContext, handle: QuickJSHandle): unknown {
  return ctx.dump(handle);
}

function installConsole(ctx: QuickJSAsyncContext, scope: Scope, logs: string[]): void {
  const obj = scope.manage(ctx.newObject());
  const write = (...args: QuickJSHandle[]): QuickJSHandle => {
    if (logs.length < 100) {
      logs.push(args.map((a) => formatLogArg(ctx.dump(a))).join(' '));
    }
    return ctx.undefined;
  };
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const fn = scope.manage(ctx.newFunction(level, write));
    ctx.setProp(obj, level, fn);
  }
  ctx.setProp(ctx.global, 'console', obj);
}

const formatLogArg = (v: unknown): string => (typeof v === 'string' ? v : (JSON.stringify(v) ?? String(v)));

/**
 * A mock that throws, times out or returns nonsense. To a gateway caller this is a 500 — the
 * mock server genuinely failed to produce a response, and calling it 4xx would wrongly blame
 * their request. The authoring endpoint catches this instead and hands the message + logs back
 * as data, which is what the editor actually needs.
 */
export class ScriptedMockError extends AppError {
  constructor(
    message: string,
    public readonly logs: string[] = [],
  ) {
    super(500, 'mock_script_failed', message);
  }
}

export async function runScriptedMock(opts: RunOptions): Promise<ScriptedResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const module = await getModule();
  const ctx = module.newContext();
  const logs: string[] = [];

  ctx.runtime.setMemoryLimit(opts.memoryLimitBytes ?? DEFAULT_MEMORY_BYTES);
  ctx.runtime.setMaxStackSize(MAX_STACK_BYTES);
  ctx.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs));

  try {
    const result = await Promise.race([
      execute(ctx, opts, logs),
      // Backstop for the one case the interrupt handler can't see: code that is not running but
      // awaiting a promise nothing will ever settle.
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new ScriptedMockError(`mock timed out after ${timeoutMs}ms`, logs)), timeoutMs + 50),
      ),
    ]);
    return { ...result, logs };
  } catch (e) {
    if (e instanceof ScriptedMockError) throw e;
    throw new ScriptedMockError((e as Error).message || 'mock failed', logs);
  } finally {
    ctx.dispose();
  }
}

/** Settle a guest promise. The job queue only advances when the host drains it, so
 *  `resolvePromise` alone would wait forever — draining is what makes guest `await` progress. */
async function settle(ctx: QuickJSAsyncContext, handle: QuickJSHandle): Promise<QuickJSHandle> {
  const pending = ctx.resolvePromise(handle);
  ctx.runtime.executePendingJobs();
  return ctx.unwrapResult(await pending);
}

async function execute(
  ctx: QuickJSAsyncContext,
  opts: RunOptions,
  logs: string[],
): Promise<Omit<ScriptedResult, 'logs'>> {
  const scope = new Scope();
  try {
    const parseJson = scope.manage(ctx.unwrapResult(ctx.evalCode('JSON.parse', 'apione:boot')));
    installConsole(ctx, scope, logs);

    // Module scope, so the author writes `export default (req) => ...` and may use top-level await.
    const moduleNs = scope.manage(ctx.unwrapResult(await ctx.evalCodeAsync(opts.code, 'mock.js', { type: 'module' })));
    const exports = scope.manage(await settle(ctx, moduleNs));

    const handler = scope.manage(ctx.getProp(exports, 'default'));
    if (ctx.typeof(handler) !== 'function') {
      throw new ScriptedMockError('the mock must `export default` a function');
    }

    const reqHandle = scope.manage(toGuest(ctx, parseJson, opts.req));
    const called = scope.manage(ctx.unwrapResult(ctx.callFunction(handler, ctx.undefined, reqHandle)));
    // A sync handler returns the response directly; an async one returns a promise — settle covers both.
    const result = scope.manage(await settle(ctx, called));

    return normalizeResult(fromGuest(ctx, result));
  } finally {
    scope.dispose();
  }
}

/** Accept the shorthand `return {...}` (a bare body) as well as an explicit response envelope. */
function normalizeResult(raw: unknown): Omit<ScriptedResult, 'logs'> {
  if (raw === null || typeof raw !== 'object') {
    return { status: 200, headers: {}, body: raw, delayMs: 0 };
  }
  const obj = raw as Record<string, unknown>;
  // `status` alone isn't enough to mean "envelope" — plenty of payloads carry a status *field*
  // (`{ status: 'active' }`), and reading those as an envelope would silently drop the body.
  // Only a numeric status, an explicit body, a headers object or a numeric delay says so.
  const looksLikeEnvelope =
    typeof obj.status === 'number' ||
    'body' in obj ||
    typeof obj.delayMs === 'number' ||
    (typeof obj.headers === 'object' && obj.headers !== null);
  if (!looksLikeEnvelope) return { status: 200, headers: {}, body: raw, delayMs: 0 };

  const status = typeof obj.status === 'number' ? obj.status : 200;
  if (status < 100 || status > 599) throw new ScriptedMockError(`invalid status ${status}`);
  const headers: Record<string, string> = {};
  if (obj.headers && typeof obj.headers === 'object') {
    for (const [k, v] of Object.entries(obj.headers as Record<string, unknown>)) {
      if (v !== undefined && v !== null) headers[k] = String(v);
    }
  }
  const delayMs = typeof obj.delayMs === 'number' && obj.delayMs > 0 ? Math.min(obj.delayMs, MAX_DELAY_MS) : 0;
  return { status, headers, body: obj.body, delayMs };
}
