import type { FastifyInstance } from 'fastify';
import * as ops from '../services/operation-service.js';
import * as status from '../services/operation-status-service.js';
import { requirePermission } from '../auth.js';
import { TAG, errorResponse, operationSummary, projectIdParam } from './schemas.js';

const canRead = { preHandler: requirePermission('spec:read') };
// A stage is not spec content, but `released` decides what a filtered export publishes, so setting
// one is a decision about the contract's audience — editor and up, same as writing the spec.
const canWrite = { preHandler: requirePermission('spec:write') };
const readErrors = { 401: errorResponse, 404: errorResponse };
const writeErrors = { 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse };

const stageEnum = { type: 'string', enum: [...status.STAGES] };
const stageResult = {
  type: 'object',
  additionalProperties: true,
  properties: { stage: stageEnum, updated: { type: 'integer' } },
};

/** The endpoints that make a spec readable a slice at a time — see operation-service. */
export async function operationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/:projectId/operations',
    {
      ...canRead,
      schema: {
        tags: [TAG.spec],
        summary: 'Search the endpoints of a project',
        description:
          'Returns summaries only. Use this instead of fetching the whole spec when you need to find an endpoint — matching is a case-insensitive substring of method, path, summary, operationId or tags. Omit `q` to list everything. `truncated: true` means matches were dropped past `limit`.',
        params: projectIdParam,
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', description: 'Substring to match; omit to list all' },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: true,
            properties: {
              operations: { type: 'array', items: operationSummary },
              total: { type: 'integer', description: 'Matches before limit was applied' },
              truncated: { type: 'boolean' },
            },
          },
          ...readErrors,
        },
      },
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const { q, limit } = req.query as { q?: string; limit?: number };
      return ops.searchOperations(projectId, q, limit);
    },
  );

  app.get(
    '/:projectId/operations/:opId',
    {
      ...canRead,
      schema: {
        tags: [TAG.spec],
        summary: 'One endpoint in full, with `$ref`s inlined',
        description:
          'Addressed by `opId` (the `x-apione-id` search returns), not by method+path, so it keeps working after the endpoint is moved or renamed. The operation reads on its own — referenced schemas are inlined rather than left as `$ref`.',
        params: {
          type: 'object',
          required: ['projectId', 'opId'],
          properties: { projectId: { type: 'string' }, opId: { type: 'string' } },
        },
        response: {
          200: { ...operationSummary, properties: { ...operationSummary.properties, operation: {} } },
          ...readErrors,
        },
      },
    },
    async (req) => {
      const { projectId, opId } = req.params as { projectId: string; opId: string };
      return ops.getOperation(projectId, opId);
    },
  );

  // Every stage in the project, in one small read. Search returns a stage per operation too, but
  // it is capped and it bundles the whole spec — the outline needs all of them and needs them on
  // every render of a project it has already loaded.
  app.get(
    '/:projectId/operations/status',
    {
      ...canRead,
      schema: {
        tags: [TAG.spec],
        summary: 'The workflow stage of every staged endpoint',
        description:
          'Only endpoints somebody has staged are listed. An endpoint that is absent is at the default stage (`design`), which is why an untouched project answers with an empty list.',
        params: projectIdParam,
        response: {
          200: {
            type: 'object',
            additionalProperties: true,
            properties: {
              statuses: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: true,
                  properties: { opId: { type: 'string' }, stage: stageEnum },
                },
              },
            },
          },
          ...readErrors,
        },
      },
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const statuses = [...status.stageMap(projectId)].map(([opId, stage]) => ({ opId, stage }));
      return { statuses };
    },
  );

  // Stages live outside the document on purpose: setting one writes no file and appends no
  // version, so moving a whole project through a release leaves the contract's history alone.
  app.patch(
    '/:projectId/operations/status',
    {
      ...canWrite,
      schema: {
        tags: [TAG.spec],
        summary: 'Set the workflow stage of many endpoints at once',
        description:
          'Omit `opIds` to stage every endpoint in the project — how a spec imported from a tool that had no stages gets marked live in one call. Unknown ids are accepted and then dropped the next time the spec is saved.',
        params: projectIdParam,
        body: {
          type: 'object',
          required: ['stage'],
          properties: {
            stage: stageEnum,
            opIds: { type: 'array', items: { type: 'string' }, description: 'Omit for every endpoint' },
          },
        },
        response: { 200: stageResult, ...writeErrors },
      },
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const { stage, opIds } = req.body as { stage: string; opIds?: string[] };
      const targets = opIds ?? (await ops.listOperationIds(projectId));
      const updated = status.setStages(projectId, targets, stage, req.user.sub);
      return { stage, updated };
    },
  );

  app.patch(
    '/:projectId/operations/:opId/status',
    {
      ...canWrite,
      schema: {
        tags: [TAG.spec],
        summary: 'Set one endpoint’s workflow stage',
        description:
          'Nothing enforces an order: a stage records where the team says the endpoint is, and any of them can follow any other. Only `released` means anything to the App — it is what a filtered export keeps. An id the saved spec does not declare yet is accepted: an endpoint can be staged while it is still being written, and a stage left pointing at nothing is dropped the next time the spec is saved.',
        params: {
          type: 'object',
          required: ['projectId', 'opId'],
          properties: { projectId: { type: 'string' }, opId: { type: 'string' } },
        },
        body: { type: 'object', required: ['stage'], properties: { stage: stageEnum } },
        response: {
          200: {
            type: 'object',
            additionalProperties: true,
            properties: { opId: { type: 'string' }, stage: stageEnum },
          },
          ...writeErrors,
        },
      },
    },
    async (req) => {
      const { projectId, opId } = req.params as { projectId: string; opId: string };
      const { stage } = req.body as { stage: string };
      return { opId, stage: status.setStage(projectId, opId, stage, req.user.sub) };
    },
  );
}
