import { bundleProjectView } from './spec-service.js';
import { operationIds, operations, OP_ID_KEY } from './operations.js';
import { inlineRefs } from './mock-generator.js';
import { DEFAULT_STAGE, stageMap, type Stage } from './operation-status-service.js';
import { NotFoundError } from '../errors.js';

/**
 * Reading a spec a slice at a time.
 *
 * The whole point is what these do NOT return: a mid-sized spec is tens of thousands of tokens,
 * so an agent that must read the entire document to touch one endpoint spends its context on
 * everything it isn't changing. Search narrows to a shortlist of summaries; getOperation then
 * returns one operation whole.
 */

export interface OperationSummary {
  /** The operation's identity (`x-apione-id`) — survives renaming, unlike method+path. */
  opId: string;
  method: string;
  path: string;
  summary?: string;
  operationId?: string;
  tags?: string[];
  deprecated?: boolean;
  /** Workflow stage. Always present — an operation nobody has staged reads as the default. */
  stage: Stage;
}

export interface OperationSearchResult {
  operations: OperationSummary[];
  /** How many matched before `limit` was applied. */
  total: number;
  /** True when matches were dropped — never let a caller mistake a page for the whole answer. */
  truncated: boolean;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function summarize(
  method: string,
  path: string,
  op: Record<string, unknown>,
  stages: Map<string, Stage>,
): OperationSummary | null {
  const opId = op[OP_ID_KEY];
  // No id means the operation was added outside the App and never saved since; it has no stable
  // handle to hand back, so it isn't listed (same rule as the mock catalog).
  if (typeof opId !== 'string' || !opId) return null;
  const tags = Array.isArray(op.tags) ? op.tags.filter((t): t is string => typeof t === 'string') : undefined;
  return {
    opId,
    method,
    path,
    summary: typeof op.summary === 'string' ? op.summary : undefined,
    operationId: typeof op.operationId === 'string' ? op.operationId : undefined,
    tags: tags?.length ? tags : undefined,
    deprecated: op.deprecated === true ? true : undefined,
    stage: stages.get(opId) ?? DEFAULT_STAGE,
  };
}

/** Matched against address, summary, operationId and tags — not `description`, whose prose would
 *  produce hits the caller can't account for. */
function haystack(s: OperationSummary): string {
  return [s.method, s.path, s.summary ?? '', s.operationId ?? '', ...(s.tags ?? [])].join(' ').toLowerCase();
}

export async function searchOperations(
  projectId: string,
  query?: string,
  limit = DEFAULT_LIMIT,
): Promise<OperationSearchResult> {
  const spec = (await bundleProjectView(projectId)).parsed as Record<string, unknown>;
  const stages = stageMap(projectId);
  const needle = query?.trim().toLowerCase() ?? '';
  const matched: OperationSummary[] = [];
  for (const { method, path, op } of operations(spec)) {
    const s = summarize(method, path, op, stages);
    if (!s) continue;
    if (!needle || haystack(s).includes(needle)) matched.push(s);
  }
  const capped = Math.min(Math.max(limit, 1), MAX_LIMIT);
  return { operations: matched.slice(0, capped), total: matched.length, truncated: matched.length > capped };
}

/** Every identified operation in the project, in document order — what "all of them" means to a
 *  bulk stage change. */
export async function listOperationIds(projectId: string): Promise<string[]> {
  const spec = (await bundleProjectView(projectId)).parsed as Record<string, unknown>;
  return [...operationIds(spec)];
}

export interface OperationDetail extends OperationSummary {
  /** The operation object with `$ref`s inlined, so it reads without fetching the whole spec. */
  operation: unknown;
}

export async function getOperation(projectId: string, opId: string): Promise<OperationDetail> {
  const spec = (await bundleProjectView(projectId)).parsed as Record<string, unknown>;
  const stages = stageMap(projectId);
  for (const { method, path, op } of operations(spec)) {
    if (op[OP_ID_KEY] !== opId) continue;
    const s = summarize(method, path, op, stages)!;
    return { ...s, operation: inlineRefs(op, spec) };
  }
  throw new NotFoundError(`operation not found: ${opId}`, 'operation_not_found', { opId });
}
