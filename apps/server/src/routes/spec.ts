import type { FastifyInstance } from 'fastify';
import { canonicalizeTree } from '../storage/canonical.js';
import * as spec from '../services/spec-service.js';
import { keepReleased } from '../services/spec-export.js';
import { releasedOpIds } from '../services/operation-status-service.js';
import { importSpec, type ImportFormat } from '../services/import-service.js';
import { getProject } from '../services/project-service.js';
import { requirePermission } from '../auth.js';
import { renderStandalonePage } from '../engines/scalar.js';
import { TAG, anyObject, breakingReport, errorResponse, graphResult, lintResult, projectIdParam } from './schemas.js';

const canRead = { preHandler: requirePermission('spec:read') };
const canWrite = { preHandler: requirePermission('spec:write') };

const readErrors = { 401: errorResponse, 404: errorResponse };
const exportQuery = {
  type: 'object',
  properties: {
    strip: { type: 'string', enum: ['x'], description: 'Set to `x` to drop every x- extension' },
    stage: {
      type: 'string',
      enum: ['released'],
      description: 'Set to `released` to publish only the endpoints the team has released',
    },
  },
};

/** Project-level spec operations powered by the openapi-core engine + Scalar docs. */
export async function specRoutes(app: FastifyInstance): Promise<void> {
  // Import a spec (Swagger 2 → OAS3 conversion is the YApi migration path).
  app.post(
    '/:projectId/import',
    {
      ...canWrite,
      schema: {
        tags: [TAG.spec],
        summary: 'Replace the project spec by importing a document',
        description:
          'Overwrites the root spec and appends a version, so the previous content stays in history. Swagger 2 and Postman are converted to OpenAPI 3.1 on the way in.',
        params: projectIdParam,
        body: {
          type: 'object',
          required: ['content'],
          properties: {
            content: { type: 'string' },
            format: { type: 'string', enum: ['auto', 'oas3', 'swagger2', 'postman'], default: 'auto' },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: true,
            properties: { version: { type: 'integer' }, sourceFormat: { type: 'string' } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as { content: string; format?: ImportFormat };
      return importSpec(projectId, body.content, body.format ?? 'auto', req.user.username);
    },
  );

  // Bundled spec (multi-file $ref → one doc) — what Scalar and external tools consume.
  // The whole document by default, extensions included: it is the project's spec, not a
  // redaction of it. `?strip=x` drops every `x-` extension for a consumer that wants nothing
  // beyond the standard — including our own markers, so mock bindings won't survive a round trip
  // through that copy. `?stage=released` narrows it to what the team has released, components and
  // tags shaken down to match.
  //
  // Order matters: the filter reads `x-apione-id`, so it has to run before strip takes them away.
  const bundled = async (projectId: string, q: unknown) => {
    const { strip, stage } = q as { strip?: string; stage?: string };
    const out = await spec.bundleProjectMutable(projectId);
    const doc = stage === 'released' ? keepReleased(out.parsed, releasedOpIds(projectId)).doc : out.parsed;
    return strip === 'x' ? spec.stripExtensions(doc) : doc;
  };

  app.get(
    '/:projectId/spec.json',
    {
      ...canRead,
      schema: {
        tags: [TAG.spec],
        summary: 'The whole spec as one bundled OpenAPI document (JSON)',
        description: 'Multi-file `$ref`s are resolved into a single document. This is the contract itself.',
        params: projectIdParam,
        querystring: exportQuery,
        response: { 200: anyObject, ...readErrors },
      },
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      return bundled(projectId, req.query);
    },
  );

  // No response schema on purpose: the body is a YAML document, and declaring one would route it
  // through the JSON serializer and hand back a quoted string.
  app.get(
    '/:projectId/spec.yaml',
    {
      ...canRead,
      schema: {
        tags: [TAG.spec],
        summary: 'The same bundled document as YAML',
        description: 'Returns `application/yaml`, not JSON.',
        params: projectIdParam,
        querystring: exportQuery,
      },
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      reply.header('content-type', 'application/yaml; charset=utf-8');
      return canonicalizeTree(await bundled(projectId, req.query));
    },
  );

  // A reading copy: engine and document both inlined, so it opens from disk with no network.
  // No response schema — the body is HTML (see spec.yaml above).
  app.get(
    '/:projectId/spec.html',
    {
      ...canRead,
      schema: {
        tags: [TAG.spec],
        summary: 'The spec as a standalone documentation page',
        description:
          'Returns `text/html`: one self-contained file that renders the docs offline, for sending to someone who has no tooling. `x-` extensions are never stripped here — they drive how the page reads (`x-internal` hides operations, `x-tagGroups` and `x-displayName` shape the navigation), so dropping them would degrade it and expose what was meant to stay hidden. Use the json/yaml exports for a standard-only copy. `?stage=released` narrows it the same way they do.',
        params: projectIdParam,
        querystring: {
          type: 'object',
          properties: { stage: { ...exportQuery.properties.stage } },
        },
      },
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const doc = (await bundled(projectId, { stage: (req.query as { stage?: string }).stage })) as {
        info?: { title?: unknown };
      };
      const title = typeof doc.info?.title === 'string' ? doc.info.title : getProject(projectId).name;
      reply.type('text/html');
      return renderStandalonePage(doc, title);
    },
  );

  // $ref dependency graph (schemas + operations) — the Obsidian-style view.
  app.get(
    '/:projectId/graph',
    {
      ...canRead,
      schema: {
        tags: [TAG.spec],
        summary: '`$ref` dependency graph, including orphaned schemas',
        params: projectIdParam,
        response: { 200: graphResult, ...readErrors },
      },
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      return spec.graphProject(projectId);
    },
  );

  // Lint the project's root spec (structural validity; governance opt-in is P3).
  app.get(
    '/:projectId/lint',
    {
      ...canRead,
      schema: {
        tags: [TAG.spec],
        summary: 'Structural validity of the root spec',
        params: projectIdParam,
        response: { 200: lintResult, ...readErrors },
      },
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      return spec.lintProject(projectId);
    },
  );

  // Breaking-change report: semantically diff base → target versions (oasdiff engine).
  app.get(
    '/:projectId/breaking',
    {
      ...canRead,
      schema: {
        tags: [TAG.spec],
        summary: 'Breaking changes between two versions of the spec',
        description:
          'Defaults to the previous version against the current one. `available: false` means the oasdiff engine is not installed.',
        params: projectIdParam,
        querystring: {
          type: 'object',
          properties: { base: { type: 'integer', minimum: 1 }, target: { type: 'integer', minimum: 1 } },
        },
        response: { 200: breakingReport, ...readErrors },
      },
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const { base, target } = req.query as { base?: number; target?: number };
      return spec.breakingProject(projectId, base, target);
    },
  );
}
