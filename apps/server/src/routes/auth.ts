import type { FastifyInstance } from 'fastify';
import * as authSvc from '../services/auth-service.js';
import * as throttle from '../services/login-throttle.js';
import { requireAuth, signSession } from '../auth.js';
import { AppError } from '../errors.js';
import { TAG, errorResponse, user } from './schemas.js';

function publicUser(u: { id: string; username: string; role: string }) {
  return { id: u.id, username: u.username, role: u.role };
}

const credentials = {
  type: 'object',
  required: ['username', 'password'],
  properties: { username: { type: 'string' }, password: { type: 'string' } },
};
const session = { type: 'object', properties: { token: { type: 'string' }, user } };

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // First-run? (frontend shows "create admin" vs "log in".)
  app.get(
    '/status',
    {
      config: { auth: 'public' },
      schema: {
        tags: [TAG.auth],
        summary: 'Whether the instance still needs its first admin',
        response: { 200: { type: 'object', properties: { needsSetup: { type: 'boolean' } } } },
      },
    },
    async () => ({ needsSetup: authSvc.needsSetup() }),
  );

  // Bootstrap only: the very first registration creates the admin and auto-logs in. Once any
  // account exists, self-registration is closed — admins create accounts via POST /api/users.
  app.post(
    '/register',
    {
      config: { auth: 'public' },
      schema: {
        tags: [TAG.auth],
        summary: 'Create the first admin (first run only)',
        body: credentials,
        response: { 201: session, 400: errorResponse, 403: errorResponse },
      },
    },
    async (req, reply) => {
      if (!authSvc.needsSetup()) {
        throw new AppError(403, 'registration_closed', 'registration is closed; ask an admin to create your account');
      }
      const { username, password } = req.body as { username: string; password: string };
      const created = await authSvc.createUser(username, password, 'admin');
      const token = signSession(app, created);
      return reply.status(201).send({ user: publicUser(created), token });
    },
  );

  app.post(
    '/login',
    {
      config: { auth: 'public' },
      schema: {
        tags: [TAG.auth],
        summary: 'Exchange a password for a session token',
        body: credentials,
        response: { 200: session, 401: errorResponse, 403: errorResponse, 429: errorResponse },
      },
    },
    async (req) => {
      const { username, password } = req.body as { username: string; password: string };
      throttle.assertLoginAllowed(username); // brute-force guard: too many recent failures → 429
      const found = authSvc.findByUsername(username);
      if (!found || !(await authSvc.verifyPassword(password, found.passwordHash))) {
        throttle.recordLoginFailure(username);
        throw new AppError(401, 'invalid_credentials', 'invalid username or password');
      }
      throttle.clearLoginFailures(username); // valid credentials → reset the counter
      if (found.status === 'disabled') {
        throw new AppError(403, 'account_disabled', 'account disabled');
      }
      const token = signSession(app, found);
      return { token, user: publicUser(found) };
    },
  );

  app.get(
    '/me',
    {
      preHandler: requireAuth,
      schema: {
        tags: [TAG.auth],
        summary: 'Who the current credential belongs to',
        description: 'Answers identically for a session token and an API token — both are the same person.',
        response: { 200: { type: 'object', properties: { user } }, 401: errorResponse },
      },
    },
    async (req) => {
      return { user: { id: req.user.sub, username: req.user.username, role: req.user.role } };
    },
  );

  // Self-service password change — requires the current password (see auth-service.changePassword).
  app.post(
    '/change-password',
    {
      preHandler: requireAuth,
      schema: {
        tags: [TAG.auth],
        summary: 'Change your own password',
        description:
          'Signs out every other session on this account — that is the point of changing a password you think got away from you. The fresh token returned here keeps *this* session going; store it in place of the old one.',
        body: {
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string' } },
        },
        response: {
          200: { type: 'object', properties: { token: { type: 'string' } } },
          400: errorResponse,
          401: errorResponse,
        },
      },
    },
    async (req) => {
      const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
      await authSvc.changePassword(req.user.sub, currentPassword, newPassword);
      const fresh = authSvc.getUser(req.user.sub)!;
      return { token: signSession(app, fresh) };
    },
  );
}
