import type { FastifyInstance } from 'fastify';
import * as svc from '../services/project-service.js';
import * as members from '../services/membership-service.js';
import * as groups from '../services/group-service.js';
import { importAsNewProject, previewImport, type ImportFormat } from '../services/import-service.js';
import { findByUsername } from '../services/auth-service.js';
import { actorOf, requireAuth, requirePermission, requirePasswordSession } from '../auth.js';
import { NotFoundError } from '../errors.js';
import {
  TAG,
  errorResponse,
  member,
  project,
  projectIdParam,
  projectWithPermissions,
  projectWithRole,
} from './schemas.js';

const formatEnum = { type: 'string', enum: ['auto', 'oas3', 'swagger2', 'postman'], default: 'auto' };
const roleEnum = { type: 'string', enum: ['owner', 'editor', 'tester', 'viewer'] };
const memberParams = {
  type: 'object',
  required: ['projectId', 'userId'],
  properties: { projectId: { type: 'string' }, userId: { type: 'string' } },
};

const readErrors = { 401: errorResponse, 404: errorResponse };
const manageErrors = { 401: errorResponse, 403: errorResponse, 404: errorResponse };

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  // Create — the creator becomes the project owner. `groupId` is optional (null = ungrouped).
  app.post(
    '/',
    {
      preHandler: requireAuth,
      schema: {
        tags: [TAG.projects],
        summary: 'Create an empty project',
        description: 'You become its owner. A project is one API: one root OpenAPI document plus any `$ref` fragments.',
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' }, groupId: { type: ['string', 'null'] } },
        },
        response: { 201: project, 400: errorResponse, 401: errorResponse },
      },
    },
    async (req, reply) => {
      const { name, groupId } = req.body as { name: string; groupId?: string | null };
      if (groupId) groups.assertVisible(actorOf(req), groupId);
      const created = svc.createProject(name, groupId ?? null);
      members.addMembership(req.user.sub, created.id, 'owner');
      return reply.status(201).send(created);
    },
  );

  // Dry-run for the new-project dialog: validate + detect the spec and echo its title, without
  // creating anything. Static path, so it never collides with GET /:projectId.
  app.post(
    '/import/preview',
    {
      preHandler: requireAuth,
      schema: {
        tags: [TAG.projects],
        summary: 'Validate a spec and read its title without creating anything',
        body: {
          type: 'object',
          required: ['content'],
          properties: { content: { type: 'string' }, format: formatEnum },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: true,
            properties: { title: { type: ['string', 'null'] }, sourceFormat: { type: 'string' } },
          },
          400: errorResponse,
          401: errorResponse,
        },
      },
    },
    async (req) => {
      const { content, format } = req.body as { content: string; format?: ImportFormat };
      return previewImport(content, format);
    },
  );

  // Create-from-spec — atomic: an invalid spec is rejected before any project exists.
  app.post(
    '/import',
    {
      preHandler: requireAuth,
      schema: {
        tags: [TAG.projects],
        summary: 'Create a project from an existing spec',
        description:
          'Atomic: an invalid document is rejected before any project exists, so a failure leaves no orphan.',
        body: {
          type: 'object',
          required: ['content'],
          properties: {
            content: { type: 'string' },
            name: { type: 'string' },
            format: formatEnum,
            groupId: { type: ['string', 'null'] },
          },
        },
        response: { 201: project, 400: errorResponse, 401: errorResponse },
      },
    },
    async (req, reply) => {
      const { content, name, format, groupId } = req.body as {
        content: string;
        name?: string;
        format?: ImportFormat;
        groupId?: string | null;
      };
      if (groupId) groups.assertVisible(actorOf(req), groupId);
      const created = await importAsNewProject(name, content, format, req.user.username, groupId ?? null);
      members.addMembership(req.user.sub, created.id, 'owner');
      return reply.status(201).send(created);
    },
  );

  // Strict visibility: only projects the caller belongs to (admin sees all).
  app.get(
    '/',
    {
      preHandler: requireAuth,
      schema: {
        tags: [TAG.projects],
        summary: 'List the projects you belong to',
        description: 'Admins see every project; `myRole` is then null for the ones they are not a member of.',
        response: { 200: { type: 'array', items: projectWithRole }, 401: errorResponse },
      },
    },
    async (req) => members.listProjectsForActor(actorOf(req)),
  );

  app.get(
    '/:projectId',
    {
      preHandler: requirePermission('project:read'),
      schema: {
        tags: [TAG.projects],
        summary: 'One project, with your membership and permissions',
        description:
          'A project you cannot read answers 404 rather than 403, so its existence stays hidden. `permissions` is the authoritative capability list — the role→permission map is server-side only. `myRole` is the membership row, null for an admin who is not a member; it says nothing about what the caller may do.',
        params: projectIdParam,
        response: { 200: projectWithPermissions, ...readErrors },
      },
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const found = svc.getProject(projectId);
      // caller's effective role + the permissions it grants — drive the UI's role-adaptive
      // rendering. Permissions ship from here so the map stays defined server-side only.
      const actor = actorOf(req);
      // The membership row, never an effective role — `permissions` is what the caller may do.
      const myRole = members.getMembership(req.user.sub, projectId)?.role ?? null;
      return { ...found, myRole, permissions: members.permissionsForActor(actor, projectId) };
    },
  );

  // Rename and/or re-file. The id stays fixed; `groupId: null` means ungrouped. Owner/admin —
  // filing needs no say from the target group, which grants nothing to anyone.
  app.patch(
    '/:projectId',
    {
      preHandler: requirePermission('project:admin'),
      schema: {
        tags: [TAG.projects],
        summary: 'Rename a project or move it between groups',
        description:
          'The id never changes — it is the vault directory name and the mock key. `groupId: null` ungroups.',
        params: projectIdParam,
        body: { type: 'object', properties: { name: { type: 'string' }, groupId: { type: ['string', 'null'] } } },
        response: { 200: project, 400: errorResponse, ...manageErrors },
      },
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as { name?: string; groupId?: string | null };
      let updated = svc.getProject(projectId);
      if (body.name !== undefined) updated = svc.renameProject(projectId, body.name);
      if (body.groupId !== undefined) {
        if (body.groupId) groups.assertVisible(actorOf(req), body.groupId);
        updated = svc.moveProject(projectId, body.groupId);
      }
      return updated;
    },
  );

  app.delete(
    '/:projectId',
    {
      // Permission first, so a caller without it learns nothing about the credential rule.
      preHandler: [requirePermission('project:admin'), requirePasswordSession],
      schema: {
        tags: [TAG.projects],
        summary: 'Delete a project',
        description:
          'Removes its vault directory and all history. Not recoverable, and therefore refused to an API token — sign in with a password to do it.',
        params: projectIdParam,
        response: { 204: { type: 'null' }, ...manageErrors },
      },
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      svc.deleteProject(projectId);
      return reply.status(204).send();
    },
  );

  // Self-service: any member can leave on their own. The last-owner guard blocks orphaning
  // the project, so a sole owner must transfer ownership or delete it instead.
  app.post(
    '/:projectId/leave',
    {
      preHandler: requirePermission('project:read'),
      schema: {
        tags: [TAG.members],
        summary: 'Leave a project',
        description: 'A sole owner cannot leave — transfer ownership or delete the project instead.',
        params: projectIdParam,
        response: { 204: { type: 'null' }, 409: errorResponse, ...readErrors },
      },
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      members.removeMembership(req.user.sub, projectId);
      return reply.status(204).send();
    },
  );

  // Reading the roster is every member's; changing it is the owner's (or admin's).
  app.get(
    '/:projectId/members',
    {
      preHandler: requirePermission('members:read'),
      schema: {
        tags: [TAG.members],
        summary: "A project's members and their roles",
        params: projectIdParam,
        response: { 200: { type: 'array', items: member }, ...readErrors },
      },
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      return members.listMembers(projectId);
    },
  );

  // Projects the caller could copy a roster from. Only ones they already manage members of, so
  // the picker can't be used to discover other projects or read their rosters.
  app.get(
    '/:projectId/members/sources',
    {
      preHandler: requirePermission('members:manage'),
      schema: {
        tags: [TAG.members],
        summary: 'Projects whose roster you may copy from',
        description: 'Only projects you already manage members of, so this cannot be used to discover others.',
        params: projectIdParam,
        response: {
          200: {
            type: 'array',
            items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
          },
          ...manageErrors,
        },
      },
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const actor = actorOf(req);
      return members
        .listProjectsForActor(actor)
        .filter((p) => p.id !== projectId && members.hasProjectPermission(actor, p.id, 'members:manage'))
        .map((p) => ({ id: p.id, name: p.name }));
    },
  );

  app.post(
    '/:projectId/members/copy',
    {
      preHandler: requirePermission('members:manage'),
      schema: {
        tags: [TAG.members],
        summary: 'Copy members in from another project',
        description:
          'A snapshot, not a link — later changes to the source do not propagate. Existing members are skipped, never re-roled.',
        params: projectIdParam,
        body: {
          type: 'object',
          required: ['fromProjectId', 'userIds'],
          properties: { fromProjectId: { type: 'string' }, userIds: { type: 'array', items: { type: 'string' } } },
        },
        response: {
          200: { type: 'object', properties: { added: { type: 'integer' } } },
          400: errorResponse,
          ...manageErrors,
        },
      },
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const { fromProjectId, userIds } = req.body as { fromProjectId: string; userIds: string[] };
      // 404 rather than 403: a project the caller can't manage members of isn't a source they are
      // allowed to learn exists.
      if (!members.hasProjectPermission(actorOf(req), fromProjectId, 'members:manage'))
        throw new NotFoundError(`project not found: ${fromProjectId}`);
      return { added: members.copyMemberships(fromProjectId, projectId, userIds) };
    },
  );

  app.post(
    '/:projectId/members',
    {
      preHandler: requirePermission('members:manage'),
      schema: {
        tags: [TAG.members],
        summary: 'Add a member by username',
        params: projectIdParam,
        body: {
          type: 'object',
          required: ['username', 'role'],
          properties: { username: { type: 'string' }, role: roleEnum },
        },
        response: { 204: { type: 'null' }, 400: errorResponse, ...manageErrors },
      },
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const { username, role } = req.body as { username: string; role: members.ProjectRole };
      const found = findByUsername(username);
      if (!found) throw new NotFoundError(`user not found: ${username}`, 'user_not_found', { username });
      members.addMembership(found.id, projectId, role);
      return reply.status(204).send();
    },
  );

  app.patch(
    '/:projectId/members/:userId',
    {
      preHandler: requirePermission('members:manage'),
      schema: {
        tags: [TAG.members],
        summary: "Change a member's role",
        params: memberParams,
        body: { type: 'object', required: ['role'], properties: { role: roleEnum } },
        response: { 204: { type: 'null' }, 400: errorResponse, 409: errorResponse, ...manageErrors },
      },
    },
    async (req, reply) => {
      const { projectId, userId } = req.params as { projectId: string; userId: string };
      const { role } = req.body as { role: members.ProjectRole };
      members.setMemberRole(userId, projectId, role);
      return reply.status(204).send();
    },
  );

  app.delete(
    '/:projectId/members/:userId',
    {
      preHandler: requirePermission('members:manage'),
      schema: {
        tags: [TAG.members],
        summary: 'Remove a member',
        params: memberParams,
        response: { 204: { type: 'null' }, 409: errorResponse, ...manageErrors },
      },
    },
    async (req, reply) => {
      const { projectId, userId } = req.params as { projectId: string; userId: string };
      members.removeMembership(userId, projectId);
      return reply.status(204).send();
    },
  );
}
