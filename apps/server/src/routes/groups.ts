import type { FastifyInstance } from 'fastify';
import { actorOf, requireAuth } from '../auth.js';
import * as svc from '../services/group-service.js';
import type { GroupRow } from '../db/schema.js';
import type { Actor } from '../services/membership-service.js';
import { TAG, errorResponse, group, groupIdParam } from './schemas.js';

const nameBody = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } };

/** Groups organise projects and nothing else — no members, no permissions, so these
 *  routes carry no `requirePermission`; being signed in is the whole gate. */
export async function groupRoutes(app: FastifyInstance): Promise<void> {
  const signedIn = { preHandler: requireAuth };
  // canManage rides along so the list page can hide rename/delete without a second round trip.
  const shape = (actor: Actor, g: GroupRow) => ({ ...g, canManage: svc.canManage(actor, g) });

  app.get(
    '/',
    {
      ...signedIn,
      schema: {
        tags: [TAG.groups],
        summary: 'List the groups you can see',
        description: 'Groups containing a project you can reach, plus empty ones you created. Admins see all.',
        response: { 200: { type: 'array', items: group } },
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return svc.listGroupsForActor(actor).map((g) => shape(actor, g));
    },
  );

  app.post(
    '/',
    {
      ...signedIn,
      schema: {
        tags: [TAG.groups],
        summary: 'Create a group',
        body: nameBody,
        response: { 201: group, 400: errorResponse },
      },
    },
    async (req, reply) => {
      const actor = actorOf(req);
      const { name } = req.body as { name: string };
      return reply.status(201).send(shape(actor, svc.createGroup(actor, name)));
    },
  );

  app.patch(
    '/:groupId',
    {
      ...signedIn,
      schema: {
        tags: [TAG.groups],
        summary: 'Rename a group',
        params: groupIdParam,
        body: nameBody,
        response: { 200: group, 400: errorResponse, 403: errorResponse, 404: errorResponse },
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const { groupId } = req.params as { groupId: string };
      const { name } = req.body as { name: string };
      return shape(actor, svc.renameGroup(actor, groupId, name));
    },
  );

  app.delete(
    '/:groupId',
    {
      ...signedIn,
      schema: {
        tags: [TAG.groups],
        summary: 'Delete a group',
        description: 'Its projects fall back to ungrouped — deleting a folder never deletes what is filed in it.',
        params: groupIdParam,
        response: { 204: { type: 'null' }, 403: errorResponse, 404: errorResponse },
      },
    },
    async (req, reply) => {
      const { groupId } = req.params as { groupId: string };
      svc.deleteGroup(actorOf(req), groupId);
      return reply.status(204).send();
    },
  );
}
