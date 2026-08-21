import { createRequire } from 'node:module';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import fastifyHelmet from '@fastify/helmet';
import { config } from './config.js';
import { AppError } from './errors.js';
import { annotateGuards, assertApiRoutesGuarded, registerJwt, requireAuth } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { tokenRoutes } from './routes/tokens.js';
import { groupRoutes } from './routes/groups.js';
import { projectRoutes } from './routes/projects.js';
import { fileRoutes } from './routes/files.js';
import { specRoutes } from './routes/spec.js';
import { mockRoutes } from './routes/mock.js';
import { mockAdminRoutes } from './routes/mock-admin.js';
import { docsRoutes } from './routes/docs.js';
import { operationRoutes } from './routes/operations.js';
import { TAG } from './routes/schemas.js';

const require = createRequire(import.meta.url);

/**
 * Derive the published OpenAPI document from the route schemas. Must run before any route is
 * registered — the plugin collects them as they are added.
 *
 * `hideUntagged` is what keeps the document honest about its own scope: only routes that opted in
 * with a tag appear, so the mock gateway, /health and the static assets stay out of it.
 */
function registerSelfDescription(app: FastifyInstance): void {
  app.register(fastifySwagger, {
    hideUntagged: true,
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'ApiOne Studio API',
        version: require('../package.json').version as string,
        description: [
          'The management API of a self-hosted ApiOne Studio instance.',
          '',
          'Three things govern nearly every call here:',
          '',
          '- **Files are the truth.** A project is a directory of OpenAPI documents on disk; this API edits those files. The database is an index, never the source.',
          '- **Writes are optimistically concurrent.** Send the `version` you last read as `baseVersion`. A mismatch is refused with 409 and `details.currentVersion` says where the file actually is — read it again and reapply rather than retrying the same body.',
          '- **Content is canonicalized on write.** Formatting and comments are not round-tripped; the same document always serializes identically.',
          '',
          'Authenticate with `Authorization: Bearer <token>`, using an API token created under Account → API tokens. A token acts as the person who created it.',
        ].join('\n'),
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: 'An API token, or a session token from /api/auth/login.',
          },
          // Same header, different credential: the operations carrying this one refuse API tokens.
          passwordSession: {
            type: 'http',
            scheme: 'bearer',
            description:
              'A session token from /api/auth/login. An API token is refused with 403 `session_required` — these operations either mint a credential or destroy version history, and both stay with a person who typed a password.',
          },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: TAG.meta, description: 'This document.' },
        { name: TAG.auth, description: 'Sessions and identity.' },
        { name: TAG.tokens, description: 'Your own API tokens. Managing them needs a password session, not a token.' },
        { name: TAG.users, description: 'Instance accounts (admin only, apart from the directory listing).' },
        { name: TAG.groups, description: 'Folders for projects. Organisation only — they grant no permissions.' },
        { name: TAG.projects, description: 'A project is one API: one root OpenAPI document plus its fragments.' },
        { name: TAG.members, description: 'Who can do what on a project.' },
        { name: TAG.spec, description: 'Reading, importing and checking the spec itself.' },
        { name: TAG.files, description: 'The individual documents in a project vault.' },
        { name: TAG.history, description: 'Every version ever written, and restoring one.' },
        {
          name: TAG.mock,
          description:
            'How each operation is mocked. Serving mock traffic is /mock/{projectId}/*, which needs no auth.',
        },
      ],
    },
  });
}

/**
 * Baseline security headers for everything the instance serves.
 *
 * The directives are spelled out rather than layered on helmet's defaults, because two of the
 * defaults are wrong here: `upgrade-insecure-requests` breaks a self-hosted instance reached over
 * plain http on a LAN, and a restrictive `connect-src` breaks Scalar's "try it" button, which by
 * design sends the request to whatever server the spec declares.
 *
 * `style-src` needs 'unsafe-inline': Monaco and Scalar both build stylesheets at runtime and
 * support no nonce. Scripts do not — the bundle contains no eval or Function constructor — so the
 * loosening stays with styles, where it costs least.
 *
 * /mock overrides this with something far stricter; see routes/mock.ts.
 */
function registerSecurityHeaders(app: FastifyInstance): void {
  app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:', 'https:'], // a spec may point its logo anywhere
        'font-src': ["'self'", 'data:'],
        'worker-src': ["'self'", 'blob:'], // Monaco's language workers
        'connect-src': ['*', 'data:', 'blob:'], // Scalar "try it" targets the spec's own servers
        'object-src': ["'none'"],
        'base-uri': ["'none'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
      },
    },
    // Would make the app's own assets require CORP headers for no gain on a single origin.
    crossOriginEmbedderPolicy: false,
  });
}

/**
 * Fastify's default body limit is 1 MiB, which a real-world OpenAPI document clears easily —
 * anything exported from a mature API is routinely larger, and rejecting it reads as the import
 * being broken rather than a limit being met.
 */
const BODY_LIMIT_BYTES = 32 * 1024 * 1024;

export function buildApp(opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: BODY_LIMIT_BYTES });

  // Both walk preHandler chains, so both must be in place before any route is registered.
  assertApiRoutesGuarded(app);
  annotateGuards(app);
  registerJwt(app);
  registerSelfDescription(app);
  registerSecurityHeaders(app);

  // Second layer under each route's own guard, for all /api reads+writes.
  // (/mock and /docs stay open — /docs is how to use this instance, read before anyone
  // has a credential to read it with.)
  //
  // Keyed on the *matched route pattern*, never on req.url: the router strips an absolute-form
  // request target and percent-decodes the path before matching, so a prefix test on the raw
  // string lets `http://host/api/…` and `/%61pi/…` through while the router still routes them.
  app.addHook('onRequest', async (req) => {
    if (!req.routeOptions.url?.startsWith('/api/')) return;
    if (req.routeOptions.config?.auth === 'public') return;
    await requireAuth(req);
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    // Fastify's own validation/parse errors carry a statusCode too.
    if (typeof err.statusCode === 'number' && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: 'bad_request', message: err.message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'internal server error' });
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.register(docsRoutes, { prefix: '/docs' });
  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(userRoutes, { prefix: '/api/users' });
  app.register(tokenRoutes, { prefix: '/api/tokens' });
  app.register(groupRoutes, { prefix: '/api/groups' });
  app.register(projectRoutes, { prefix: '/api/projects' });
  app.register(fileRoutes, { prefix: '/api/projects' });
  app.register(specRoutes, { prefix: '/api/projects' });
  app.register(operationRoutes, { prefix: '/api/projects' });
  app.register(mockAdminRoutes, { prefix: '/api/projects' });
  app.register(mockRoutes, { prefix: '/mock' });

  // Single-container mode: serve the built web SPA + fallback to index.html.
  if (config.webDist) {
    app.register(fastifyStatic, { root: config.webDist, prefix: '/', decorateReply: true });
    app.setNotFoundHandler((req, reply) => {
      // Same reason as the auth gate above: an absolute-form target would make every prefix here
      // read false and hand back index.html for an unmatched /api call.
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const isApp = req.method === 'GET' && !['/api', '/docs', '/mock', '/health'].some((p) => pathname.startsWith(p));
      if (isApp) return reply.sendFile('index.html');
      return reply.status(404).send({ error: 'not_found', message: 'not found' });
    });
  }

  return app;
}
