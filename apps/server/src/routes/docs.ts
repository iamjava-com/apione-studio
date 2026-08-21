import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { FastifyInstance } from 'fastify';
import { renderHostedPage, standaloneScript } from '../engines/scalar.js';
import { TAG, anyObject } from './schemas.js';

const require = createRequire(import.meta.url);
/** Cache-busts the engine asset, which is served immutable. */
const SCRIPT_URL = `/docs/standalone.js?v=${require('../../package.json').version as string}`;

const here = path.dirname(fileURLToPath(import.meta.url));
/** Resolves to src/ai in dev and dist/ai in a build (see the server's build script). */
const aiDir = path.resolve(here, '..', 'ai');

/** Read once per process — these ship with the server and cannot change under a running one. */
const cache = new Map<string, string>();
function doc(name: string): string {
  let text = cache.get(name);
  if (text === undefined) {
    text = fs.readFileSync(path.join(aiDir, name), 'utf8');
    cache.set(name, text);
  }
  return text;
}

/**
 * How to use this instance: the generated spec and its reference page, plus the onboarding pair
 * an agent installs itself from. All of it is unauthenticated on purpose — whoever is about to
 * write a client, a CI job or a skill reads it *before* they have a credential, and it describes
 * how to ask, never what anyone has stored. `security: []` per route, because the document-wide
 * bearerAuth requirement would otherwise claim they need a token.
 */
export async function docsRoutes(app: FastifyInstance): Promise<void> {
  // No response schema on either: the bodies are HTML and JavaScript, and declaring one would
  // send them through the JSON serializer.
  app.get(
    '/',
    {
      schema: {
        tags: [TAG.meta],
        summary: 'This API as a reference page',
        description: 'Public. The rendered form of the document below, for a human about to write a client.',
        security: [],
      },
    },
    async (_req, reply) => {
      reply.type('text/html');
      return renderHostedPage({
        documentUrl: '/docs/openapi.json',
        scriptUrl: SCRIPT_URL,
        title: 'ApiOne Studio API',
      });
    },
  );

  // Untagged on purpose: an asset the page above pulls in, not part of the API.
  app.get('/standalone.js', async (_req, reply) => {
    reply.type('text/javascript; charset=utf-8');
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return standaloneScript();
  });

  app.get(
    '/openapi.json',
    {
      schema: {
        tags: [TAG.meta],
        summary: 'This API, described as OpenAPI 3.1 (JSON)',
        description: 'Same document as the YAML, for tools that would rather not parse YAML.',
        security: [],
        response: { 200: anyObject },
      },
    },
    async () => app.swagger(),
  );

  // No response schema: the body is a YAML document, and declaring one would send it through the
  // JSON serializer and hand back a quoted string.
  app.get(
    '/openapi.yaml',
    {
      schema: {
        tags: [TAG.meta],
        summary: 'This API, described as OpenAPI 3.1 (YAML)',
        description: 'Returns `application/yaml`. Start here to learn what this instance can do.',
        security: [],
      },
    },
    async (_req, reply) => {
      reply.header('content-type', 'application/yaml; charset=utf-8');
      return app.swagger({ yaml: true });
    },
  );

  const markdown = (name: string) => async (_req: unknown, reply: { header: (k: string, v: string) => void }) => {
    reply.header('content-type', 'text/markdown; charset=utf-8');
    return doc(name);
  };

  app.get(
    '/setup.md',
    {
      schema: {
        tags: [TAG.meta],
        summary: 'One-time install instructions, written for an AI agent to follow',
        description: 'Public. Paste its URL to an agent and it installs the skill below and verifies the connection.',
        security: [],
      },
    },
    markdown('setup.md'),
  );

  app.get(
    '/skill.md',
    {
      schema: {
        tags: [TAG.meta],
        summary: 'The agent skill: conventions and invariants for working with this instance',
        description:
          'Public. Carries no endpoint details on purpose — those come from /docs/openapi.yaml at the time of use, so a copied skill file cannot go stale.',
        security: [],
      },
    },
    markdown('skill.md'),
  );
}
