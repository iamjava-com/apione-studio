import type { FastifyInstance } from 'fastify';
import * as catalog from '../services/mock-catalog-service.js';
import * as mockSvc from '../services/mock-service.js';
import * as cfg from '../services/mock-config-service.js';
import type { Author } from '../services/file-service.js';
import { requirePermission } from '../auth.js';
import { TAG, errorResponse, mockCatalog, mockCode, projectIdParam } from './schemas.js';

const canRead = { preHandler: requirePermission('mock:read') };
const canWrite = { preHandler: requirePermission('mock:write') };

const readErrors = { 401: errorResponse, 404: errorResponse };
const writeErrors = { 401: errorResponse, 403: errorResponse, 404: errorResponse };
const opIdQuery = {
  type: 'object',
  required: ['opId'],
  properties: { opId: { type: 'string', description: "The operation's x-apione-id" } },
};

type ProjectParams = { projectId: string };

/** Mock authoring API. Serving mock traffic lives in routes/mock.ts and is unauthenticated;
 *  everything here changes what gets served, so it is gated on mock:read / mock:write. */
export async function mockAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/:projectId/mock',
    {
      ...canRead,
      schema: {
        tags: [TAG.mock],
        summary: 'Every operation and how it is currently mocked',
        params: projectIdParam,
        response: { 200: mockCatalog, ...readErrors },
      },
    },
    async (req) => {
      const { projectId } = req.params as ProjectParams;
      return catalog.getCatalog(projectId);
    },
  );

  // The schema auto mode answers from — shown on request, so it explains rather than clutters.
  // Addressed by method+path because it reads the spec, not a mock.
  app.get(
    '/:projectId/mock/schema',
    {
      ...canRead,
      schema: {
        tags: [TAG.mock],
        summary: 'The response schema auto mode generates from',
        description: 'Addressed by method + path because it reads the spec, not a stored mock.',
        params: projectIdParam,
        querystring: {
          type: 'object',
          required: ['method', 'path'],
          properties: { method: { type: 'string' }, path: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: true,
            properties: {
              status: { type: 'integer' },
              contentType: { type: ['string', 'null'] },
              schema: {},
            },
          },
          ...readErrors,
        },
      },
    },
    async (req) => {
      const { projectId } = req.params as ProjectParams;
      const { method, path } = req.query as { method: string; path: string };
      return mockSvc.responseSchema(projectId, method, path);
    },
  );

  app.get(
    '/:projectId/mock/code',
    {
      ...canRead,
      schema: {
        tags: [TAG.mock],
        summary: 'Read an operation’s scripted mock',
        description: '`version` is 0 when nothing is saved yet — that is the `baseVersion` a first write must send.',
        params: projectIdParam,
        querystring: opIdQuery,
        response: { 200: mockCode, ...readErrors },
      },
    },
    async (req) => {
      const { projectId } = req.params as ProjectParams;
      const { opId } = req.query as { opId: string };
      return catalog.readCode(projectId, opId);
    },
  );

  app.put(
    '/:projectId/mock/code',
    {
      ...canWrite,
      schema: {
        tags: [TAG.mock],
        summary: 'Write an operation’s scripted mock',
        description:
          'Same optimistic concurrency as a spec file: send the `version` you read as `baseVersion` (0 for a new mock), and expect 409 if it moved. The code runs in a sandbox with no filesystem, network, or timers.',
        params: projectIdParam,
        body: {
          type: 'object',
          required: ['opId', 'content', 'baseVersion'],
          properties: {
            opId: { type: 'string' },
            content: { type: 'string' },
            baseVersion: { type: 'integer', minimum: 0 },
          },
        },
        response: { 200: mockCode, ...writeErrors, 409: errorResponse },
      },
    },
    async (req) => {
      const { projectId } = req.params as ProjectParams;
      const body = req.body as { opId: string; content: string; baseVersion: number };
      const author: Author = { type: 'user', ref: req.user.username };
      return catalog.writeCode(projectId, body.opId, body.content, body.baseVersion, author);
    },
  );

  // auto | scripted, per operation.
  app.patch(
    '/:projectId/mock/mode',
    {
      ...canWrite,
      schema: {
        tags: [TAG.mock],
        summary: 'Switch an operation between auto and scripted',
        description: 'Switching back to auto keeps the code file — it is only stopped from running.',
        params: projectIdParam,
        body: {
          type: 'object',
          required: ['opId', 'mode'],
          properties: { opId: { type: 'string' }, mode: { type: 'string', enum: ['auto', 'scripted'] } },
        },
        response: {
          200: { type: 'object', properties: { opId: { type: 'string' }, mode: { type: 'string' } } },
          ...writeErrors,
        },
      },
    },
    async (req) => {
      const { projectId } = req.params as ProjectParams;
      const body = req.body as { opId: string; mode: cfg.MockMode };
      cfg.setMode(projectId, body.opId, body.mode);
      return { opId: body.opId, mode: body.mode };
    },
  );
}
