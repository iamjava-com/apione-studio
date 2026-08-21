import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireAuth, requirePasswordSession } from '../auth.js';
import * as authSvc from '../services/auth-service.js';
import { ValidationError } from '../errors.js';
import { TAG, adminUser, errorResponse, idParam, issuedPassword } from './schemas.js';

const detail = (u: { id: string; username: string; role: string; status: string; createdAt: number }) => ({
  id: u.id,
  username: u.username,
  role: u.role,
  status: u.status,
  createdAt: u.createdAt,
});

const roleEnum = { type: 'string', enum: ['admin', 'member'] };

/** Account management is admin-only *and* off-limits to API tokens — issuing a password mints a
 *  credential, which is rule 1 of requirePasswordSession. Reading the directory is not: it names
 *  people, it does not create them. */
const humanOnly = { preHandler: [requireAdmin, requirePasswordSession] };

/** User directory (any authed caller, for member-pickers) + admin-only user management. */
export async function userRoutes(app: FastifyInstance): Promise<void> {
  // Shaped by role: admins get the full console listing; everyone else a lightweight directory.
  app.get(
    '/',
    {
      preHandler: requireAuth,
      schema: {
        tags: [TAG.users],
        summary: 'List users',
        description:
          'Admins get status and createdAt as well; everyone else gets the id/username/role directory, so those two fields are absent.',
        response: { 200: { type: 'array', items: adminUser } },
      },
    },
    async (req) => (req.user.role === 'admin' ? authSvc.listUsersDetailed() : authSvc.listUsers()),
  );

  app.post(
    '/',
    {
      ...humanOnly,
      schema: {
        tags: [TAG.users],
        summary: 'Create a user account',
        description:
          'The password is issued by the server and returned once, here — it is never stored in readable form, so hand it to its owner now. They change it themselves from the account menu.',
        body: {
          type: 'object',
          required: ['username'],
          properties: { username: { type: 'string' }, role: roleEnum },
        },
        response: {
          201: { ...adminUser, properties: { ...adminUser.properties, ...issuedPassword.properties } },
          400: errorResponse,
          403: errorResponse,
          409: errorResponse,
        },
      },
    },
    async (req, reply) => {
      const { username, role } = req.body as { username: string; role?: authSvc.Role };
      const password = authSvc.generatePassword();
      const created = await authSvc.createUser(username, password, role ?? 'member');
      return reply.status(201).send({ ...detail(created), password });
    },
  );

  app.patch(
    '/:id',
    {
      ...humanOnly,
      schema: {
        tags: [TAG.users],
        summary: "Change a user's global role or status",
        params: idParam,
        body: {
          type: 'object',
          properties: { role: roleEnum, status: { type: 'string', enum: ['active', 'disabled'] } },
        },
        response: { 200: adminUser, 400: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { role, status } = req.body as { role?: authSvc.Role; status?: authSvc.Status };
      if (role === undefined && status === undefined)
        throw new ValidationError('nothing to update', 'nothing_to_update');
      return detail(authSvc.updateUser(id, { role, status }, req.user.sub));
    },
  );

  app.post(
    '/:id/password',
    {
      ...humanOnly,
      schema: {
        tags: [TAG.users],
        summary: "Reset a user's password",
        description:
          'Issues a new one and returns it once, here. Signs out their existing sessions, since a reset is how an account is taken back; their API tokens keep working and are revoked one by one.',
        params: idParam,
        response: { 200: issuedPassword, 400: errorResponse, 403: errorResponse, 404: errorResponse },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const password = authSvc.generatePassword();
      await authSvc.resetPassword(id, password);
      return { password };
    },
  );

  app.delete(
    '/:id',
    {
      ...humanOnly,
      schema: {
        tags: [TAG.users],
        summary: 'Delete a user account',
        description: 'A hard delete: their memberships go with them, and version history keeps its author ref.',
        params: idParam,
        response: {
          204: { type: 'null' },
          400: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      authSvc.deleteUser(id, req.user.sub);
      return reply.status(204).send();
    },
  );
}
