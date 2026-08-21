import type { FastifyInstance } from 'fastify';
import * as fsvc from '../services/file-service.js';
import { restoreSpecVersion, saveSpecFile } from '../services/spec-write-service.js';
import { isMockPath } from '../services/mock-catalog-service.js';
import { requirePermission, requirePasswordSession } from '../auth.js';
import { ValidationError } from '../errors.js';
import {
  TAG,
  errorResponse,
  fileContent,
  fileMeta,
  filePathParam,
  projectIdParam,
  rebaseResult,
  versionContent,
  versionList,
} from './schemas.js';

type ProjectParams = { projectId: string };
type WildcardParams = ProjectParams & { '*': string };

const canRead = requirePermission('spec:read');
const canWrite = requirePermission('spec:write');
const canReadHistory = requirePermission('history:read');
const canRestore = requirePermission('history:restore');

/** Every read gate answers 404 rather than 403 for a non-member, so listing them is deliberate. */
const readErrors = { 401: errorResponse, 404: errorResponse };
const writeErrors = { 401: errorResponse, 403: errorResponse, 404: errorResponse };

const pathQuery = {
  type: 'object',
  required: ['path'],
  properties: { path: { type: 'string', description: 'Project-relative file path' } },
};

/**
 * These routes own spec files; `mocks/` is mock storage and belongs to the mock API.
 *
 * The vault holds both because scripted mocks reuse the single write path (canonicalization
 * exempted) to get concurrency and a version ledger for free — an internal arrangement that must
 * not become an external one. Without this guard the spec API hands out mock source as if it were
 * a fragment, accepts junk into `mocks/`, and — worst — deletes someone's mock through a route
 * whose contract says nothing about mocks. The frontend filtered `mocks/` out of its own file tree
 * from the start; a rule only the client enforces is not a rule.
 *
 * A named code rather than 404: the path is real, it is just not this API's to touch, and a caller
 * told "not found" would reasonably retry with a different spelling.
 */
function assertSpecPath(filePath: string): void {
  if (isMockPath(filePath)) {
    throw new ValidationError(`mocks/ is mock storage, not a spec file: ${filePath}`, 'mock_path_reserved');
  }
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/:projectId/files',
    {
      preHandler: canRead,
      schema: {
        tags: [TAG.files],
        summary: "List a project's spec files",
        description:
          'Scripted mock sources also live in the vault but are not listed here — they belong to the mock API.',
        params: projectIdParam,
        response: { 200: { type: 'array', items: fileMeta }, ...readErrors },
      },
    },
    async (req) => {
      const { projectId } = req.params as ProjectParams;
      return fsvc.listFiles(projectId).filter((f) => !isMockPath(f.path));
    },
  );

  app.get(
    '/:projectId/files/*',
    {
      preHandler: canRead,
      schema: {
        tags: [TAG.files],
        summary: 'Read one file',
        description: 'The returned `version` is what a subsequent write must send as `baseVersion`.',
        params: filePathParam,
        response: { 200: fileContent, ...readErrors, 400: errorResponse },
      },
    },
    async (req) => {
      const { projectId } = req.params as WildcardParams;
      const filePath = (req.params as WildcardParams)['*'];
      assertSpecPath(filePath);
      return fsvc.readFile(projectId, filePath);
    },
  );

  app.delete(
    '/:projectId/files/*',
    {
      preHandler: [canWrite, requirePasswordSession],
      schema: {
        tags: [TAG.files],
        summary: 'Delete a file',
        description:
          'Destroys the file and its whole version history — nothing to roll back to afterwards, so an API token is refused; sign in with a password.',
        params: filePathParam,
        response: { 204: { type: 'null' }, ...writeErrors, 400: errorResponse },
      },
    },
    async (req, reply) => {
      const { projectId } = req.params as WildcardParams;
      const filePath = (req.params as WildcardParams)['*'];
      assertSpecPath(filePath);
      fsvc.deleteFile(projectId, filePath);
      return reply.status(204).send();
    },
  );

  app.put(
    '/:projectId/files/*',
    {
      preHandler: canWrite,
      schema: {
        tags: [TAG.files],
        summary: 'Write a file (optimistic concurrency)',
        description:
          'Send the `version` you last read as `baseVersion`; use 0 for a file that does not exist yet. If it no longer matches, the write is refused with 409 and `details.currentVersion` says where the file actually is — read it again and reapply your change rather than retrying the same body. Content is canonicalized on write, so formatting and comments are not preserved verbatim.',
        params: filePathParam,
        body: {
          type: 'object',
          required: ['content', 'baseVersion'],
          properties: { content: { type: 'string' }, baseVersion: { type: 'integer', minimum: 0 } },
        },
        response: { 200: fileContent, ...writeErrors, 409: errorResponse },
      },
    },
    async (req) => {
      const { projectId } = req.params as WildcardParams;
      const filePath = (req.params as WildcardParams)['*'];
      assertSpecPath(filePath);
      const body = req.body as { content: string; baseVersion: number };
      const author: fsvc.Author = { type: 'user', ref: req.user.username };
      return saveSpecFile(projectId, filePath, body.content, body.baseVersion, author);
    },
  );

  // Not a write, so it needs no password session and mints no version — but only someone who could
  // save this file has any use for it, and the answer contains their unsaved draft merged in.
  app.post(
    '/:projectId/rebase',
    {
      preHandler: canWrite,
      schema: {
        tags: [TAG.files],
        summary: 'Replay an unsaved document onto the current version, without saving',
        description:
          'For an editor that has been open while someone else saved: send what you are holding and the `baseVersion` you read it at, and get it back replayed on top of the current file. Nothing is written and no version is minted — `version` is what a later write should send as `baseVersion`, and `head` is the file as it now stands. 409 when the two edits really do overlap.',
        params: projectIdParam,
        body: {
          type: 'object',
          required: ['path', 'content', 'baseVersion'],
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
            baseVersion: { type: 'integer', minimum: 0 },
          },
        },
        response: { 200: rebaseResult, ...writeErrors, 400: errorResponse, 409: errorResponse },
      },
    },
    async (req) => {
      const { projectId } = req.params as ProjectParams;
      const body = req.body as { path: string; content: string; baseVersion: number };
      assertSpecPath(body.path);
      return fsvc.rebaseFile(projectId, body.path, body.content, body.baseVersion);
    },
  );

  app.get(
    '/:projectId/versions',
    {
      preHandler: canReadHistory,
      schema: {
        tags: [TAG.history],
        summary: "List a file's versions, newest first",
        params: projectIdParam,
        querystring: pathQuery,
        response: { 200: versionList, ...readErrors, 400: errorResponse },
      },
    },
    async (req) => {
      const { projectId } = req.params as ProjectParams;
      const { path } = req.query as { path: string };
      assertSpecPath(path);
      return fsvc.listVersions(projectId, path);
    },
  );

  app.get(
    '/:projectId/versions/:versionNo',
    {
      preHandler: canReadHistory,
      schema: {
        tags: [TAG.history],
        summary: 'Read the full content of one version',
        params: {
          type: 'object',
          required: ['projectId', 'versionNo'],
          properties: { projectId: { type: 'string' }, versionNo: { type: 'integer', minimum: 1 } },
        },
        querystring: pathQuery,
        response: { 200: versionContent, ...readErrors, 400: errorResponse },
      },
    },
    async (req) => {
      const { projectId, versionNo } = req.params as ProjectParams & { versionNo: number };
      const { path } = req.query as { path: string };
      assertSpecPath(path);
      return fsvc.getVersionContent(projectId, path, Number(versionNo));
    },
  );

  // Restore rewrites the spec like any other save, so mocks land back on the operations the
  // restored version had — it carries the same markers.
  app.post(
    '/:projectId/restore',
    {
      preHandler: canRestore,
      schema: {
        tags: [TAG.history],
        summary: 'Restore a file to an earlier version',
        description: 'Append-only: the restored content becomes a new version on top, so history is never destroyed.',
        params: projectIdParam,
        body: {
          type: 'object',
          required: ['path', 'versionNo'],
          properties: { path: { type: 'string' }, versionNo: { type: 'integer', minimum: 1 } },
        },
        response: { 200: fileContent, ...writeErrors },
      },
    },
    async (req) => {
      const { projectId } = req.params as ProjectParams;
      const body = req.body as { path: string; versionNo: number };
      assertSpecPath(body.path);
      const author: fsvc.Author = { type: 'restore', ref: req.user.username };
      return restoreSpecVersion(projectId, body.path, Number(body.versionNo), author);
    },
  );
}
