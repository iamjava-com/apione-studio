import type { FastifyInstance } from 'fastify';
import { requireAuth, requirePasswordSession } from '../auth.js';
import * as tokenSvc from '../services/token-service.js';
import { TAG, apiToken, errorResponse, idParam } from './schemas.js';

/** A caller's own API tokens. Managing them takes a password session, never a token itself —
 *  see requirePasswordSession. */
export async function tokenRoutes(app: FastifyInstance): Promise<void> {
  // requireAuth first, and per route rather than as a plugin hook: requirePasswordSession reads
  // what requireAuth sets, so on its own it waves through anyone who never reached requireAuth —
  // and a plugin-level hook is invisible to the boot-time check that would catch that.
  const ownTokens = { preHandler: [requireAuth, requirePasswordSession] };

  app.get(
    '/',
    {
      ...ownTokens,
      schema: {
        tags: [TAG.tokens],
        summary: 'List your API tokens',
        response: { 200: { type: 'array', items: apiToken }, 403: errorResponse },
      },
    },
    async (req) => tokenSvc.listTokens(req.user.sub),
  );

  app.post(
    '/',
    {
      ...ownTokens,
      schema: {
        tags: [TAG.tokens],
        summary: 'Create an API token',
        description:
          'The 201 response is the only time `plaintext` exists — only its hash is stored, so it cannot be shown again.',
        body: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 60 } } },
        response: {
          201: { ...apiToken, properties: { ...apiToken.properties, plaintext: { type: 'string' } } },
          400: errorResponse,
          403: errorResponse,
        },
      },
    },
    async (req, reply) => {
      const { name } = req.body as { name: string };
      const { token, plaintext } = tokenSvc.createToken(req.user.sub, name);
      return reply.status(201).send({ ...token, plaintext });
    },
  );

  app.delete(
    '/:id',
    {
      ...ownTokens,
      schema: {
        tags: [TAG.tokens],
        summary: 'Revoke an API token',
        params: idParam,
        response: { 204: { type: 'null' }, 403: errorResponse, 404: errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      tokenSvc.revokeToken(req.user.sub, id);
      return reply.status(204).send();
    },
  );
}
