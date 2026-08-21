import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, isCanonicalizable, normalizeCode } from '../src/storage/canonical.js';

/**
 * The serializer's output is a storage format, so a change to it rewrites every file on next save
 * and makes two saves of the same document differ. `yaml` is pinned to an exact version for that
 * reason; this locks the bytes so an upgrade cannot slip the format past review.
 *
 * If this fails after bumping `yaml`, that is the check working. Read the diff, decide whether the
 * new form is what the vault should hold from now on, and update the expectation deliberately.
 */
const MESSY = `openapi: "3.1.0"
info:
    title:    'Spaced   Out'
    version: 1.0.0
    description: >
      folded
      text
paths:
  /things/{id}:
    get:
      operationId: getThing
      tags: [ a, b ]
      parameters:
        - {name: id, in: path, required: true, schema: {type: string}}
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                nullable: ~
                properties:
                  count: {type: integer, default: 0}
                  ratio: {type: number, example: 1.50}
                  label: {type: string, example: "has: colon, and #hash"}
                  multi: {type: string, example: "line one\\nline two"}
components: {}
`;

const CANONICAL = `openapi: 3.1.0
info:
  title: Spaced   Out
  version: 1.0.0
  description: |
    folded text
paths:
  /things/{id}:
    get:
      operationId: getThing
      tags:
        - a
        - b
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                nullable: null
                properties:
                  count:
                    type: integer
                    default: 0
                  ratio:
                    type: number
                    example: 1.5
                  label:
                    type: string
                    example: "has: colon, and #hash"
                  multi:
                    type: string
                    example: |-
                      line one
                      line two
components: {}
`;

test('canonical output is byte-for-byte what the vault expects', () => {
  assert.equal(canonicalize(MESSY), CANONICAL);
});

test('canonicalizing is idempotent', () => {
  // Anything else means a saved file is not already in canonical form, and reading then writing it
  // back unchanged would mint a version.
  assert.equal(canonicalize(CANONICAL), CANONICAL);
});

test('JSON input lands on the same bytes as the equivalent YAML', () => {
  const asJson = JSON.stringify({ openapi: '3.1.0', info: { title: 'T', version: '1.0.0' } });
  const asYaml = 'openapi: 3.1.0\ninfo:\n  title: T\n  version: 1.0.0\n';
  assert.equal(canonicalize(asJson), canonicalize(asYaml));
});

test('empty or non-document content is refused rather than stored', () => {
  assert.throws(() => canonicalize(''), /empty/);
  assert.throws(() => canonicalize('null'), /empty/);
  assert.throws(() => canonicalize('{ unclosed'), /invalid YAML/);
});

test('code sidecars are stored verbatim apart from line endings', () => {
  assert.equal(isCanonicalizable('openapi.yaml'), true);
  assert.equal(isCanonicalizable('mocks/getThing.js'), false);
  // Comments and spacing in someone's JavaScript survive; only newlines are normalized.
  assert.equal(normalizeCode('const a = 1;\r\n\r\n// keep   me\r\n'), 'const a = 1;\n\n// keep   me\n');
  assert.equal(normalizeCode('no trailing newline'), 'no trailing newline\n');
  assert.equal(normalizeCode(''), '');
});
