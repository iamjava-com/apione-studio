import { selectCls as baseSelect } from '../ui/select';

/** Form-editor selects render values (methods, types) monospaced. */
export const selectCls = `${baseSelect} font-mono`;

/** A field-level label (Summary / operationId / Request / Responses / Tags). All same-level
 *  labels share this exact font so they read uniformly — no mono/uppercase/weight tiers between
 *  peers. */
export const sectionLabelCls = 'text-[12px] text-muted';

/** Multi-line free text (API description, operation description) — same skin as `Input`. */
export const textareaCls =
  'w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-[14px] text-text outline-none placeholder:text-faint focus:border-brand';

/** The HTTP methods an operation can use, in canonical order. */
export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'];

/** The operation's identity, written inside the operation itself. Method+path is only where it
 *  currently answers; this is what anything keyed to an operation must hold. */
export const OP_ID_KEY = 'x-apione-id';

/** Media types suggested for a request/response body — free-text still allowed. */
export const CONTENT_TYPES = [
  'application/json',
  'application/xml',
  'text/plain',
  'text/html',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'application/octet-stream',
  '*/*',
];
