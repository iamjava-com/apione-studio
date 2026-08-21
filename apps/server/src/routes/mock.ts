import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyCors from '@fastify/cors';
import * as mockSvc from '../services/mock-service.js';
import { ScriptedMockError } from '../services/mock-sandbox.js';
import { hasProjectPermission } from '../services/membership-service.js';
import { actorOf, requireAuth } from '../auth.js';

/** Opt-in marker the editor's debug panel sends; absent on ordinary traffic. */
const DEBUG_HEADER = 'x-apione-mock-debug';
const LOGS_HEADER = 'x-apione-mock-logs';

/**
 * Whether this caller may see a scripted mock's console output. Console lines can carry whatever
 * the author logged, so they are never part of a normal response — only an authenticated holder
 * of mock:write gets them, and only when they explicitly ask.
 */
async function wantsDebugLogs(req: FastifyRequest, projectId: string): Promise<boolean> {
  if (req.headers[DEBUG_HEADER] === undefined) return false;
  try {
    await requireAuth(req);
  } catch {
    return false; // an unauthenticated debug request is just ordinary traffic
  }
  return hasProjectPermission(actorOf(req), projectId, 'mock:write');
}

const encodeLogs = (logs: string[]): string => Buffer.from(JSON.stringify(logs), 'utf8').toString('base64');

/**
 * Serialize the body ourselves. Fastify only auto-serializes objects under a JSON content type,
 * and a spec is free to declare `text/plain` or `*&#47;*` for a structured schema — the generator
 * then produces an object the framework refuses to send. Returning the JSON text under the
 * declared type is the honest outcome: the caller gets the shape the spec described.
 */
function serialize(body: unknown, contentType: string | null): string | null {
  if (body === undefined || body === null) return null;
  if (contentType?.includes('json')) return JSON.stringify(body) ?? null;
  return typeof body === 'string' ? body : (JSON.stringify(body) ?? null);
}

/**
 * Response headers a mock may not set. `content-type` is `reply.type`'s job below. `set-cookie` is
 * the one header a later `reply.header` cannot take back — Fastify appends it instead of replacing
 * it — so a mock could otherwise plant a cookie on the app's own origin.
 */
const BLOCKED_RESPONSE_HEADERS = new Set(['content-type', 'set-cookie']);

/**
 * A mock's body and content type are authored by project members, and the gateway shares an origin
 * with the app, so a mock is free to claim `text/html`. `sandbox` is what keeps such a response
 * from running script there: it hands the document an opaque origin, out of reach of the session
 * token and of /api. CSP governs documents only — clients that `fetch()` a mock, which is what the
 * gateway is for, see no difference.
 */
function hardenAgainstScriptExecution(reply: FastifyReply): void {
  reply.header('content-security-policy', "sandbox; default-src 'none'; frame-ancestors 'none'");
  reply.header('x-content-type-options', 'nosniff');
  reply.header('x-frame-options', 'DENY');
}

/** Mock gateway: every project's mock served under one port at /mock/{projectId}/*.
 *  Deliberately unauthenticated — calling a mock is `mock:invoke`, a runtime capability open to
 *  everyone (QA, CI, anonymous), never a project membership right. */
export async function mockRoutes(app: FastifyInstance): Promise<void> {
  // Take any body rather than 415 on it. A mock stands in for a real API, and real APIs receive
  // form posts and untyped payloads — rejecting those is a failure the caller didn't cause.
  // Unrecognized types arrive as the raw string; only JSON is parsed for you. Scoped to this
  // plugin, so /api keeps its strict parsing.
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  // A mock stands in for an API a front end calls from its own origin, so without this every
  // browser caller is blocked while curl works — the confusing half of no CORS at all.
  //
  // Registered inside this plugin, never app-wide: /api holds credentials and stays same-origin.
  // `credentials: false` is the load-bearing half — reflecting an origin costs nothing on a
  // gateway that is unauthenticated by design, but reflecting one *with* credentials would let
  // any page drive this instance as the signed-in user.
  await app.register(fastifyCors, {
    origin: true,
    credentials: false,
    // Spelled out because the default list omits PUT/PATCH/DELETE, and a mock stands in for an API
    // that has those — a preflighted DELETE would be blocked while the same call from curl worked.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: [LOGS_HEADER], // else a cross-origin debug run can't read its own console output
    maxAge: 86400,
  });

  // Opt out of the app-wide headers: mock responses need the far stricter set below, and helmet's
  // would otherwise be applied over them.
  app.all('/:projectId/*', { helmet: false }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const rest = (req.params as { '*': string })['*'];
    const debug = await wantsDebugLogs(req, projectId);

    let result: mockSvc.MockResult;
    try {
      result = await mockSvc.mockRequest(projectId, req.method, `/${rest}`, {
        query: req.query as Record<string, unknown>,
        headers: req.headers as Record<string, string>,
        body: req.body,
      });
    } catch (e) {
      // A crashed mock still produced console output, and that is exactly when it matters most.
      if (debug && e instanceof ScriptedMockError && e.logs.length) reply.header(LOGS_HEADER, encodeLogs(e.logs));
      throw e;
    }

    reply.status(result.status);
    for (const [k, v] of Object.entries(result.headers ?? {})) {
      if (!BLOCKED_RESPONSE_HEADERS.has(k.toLowerCase())) reply.header(k, v);
    }
    // After the mock's own headers, so a mock cannot weaken these by declaring them itself.
    hardenAgainstScriptExecution(reply);
    if (debug && result.logs?.length) reply.header(LOGS_HEADER, encodeLogs(result.logs));
    if (result.contentType) reply.type(result.contentType);
    return serialize(result.body, result.contentType);
  });
}
