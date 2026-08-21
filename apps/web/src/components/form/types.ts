/* Form sections operate on dynamic OpenAPI JSON, so the doc is intentionally `any`. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Doc = any;
export type UpdateFn = (mutate: (d: Doc) => void) => void;
export interface SectionProps {
  doc: Doc;
  update: UpdateFn;
}

/** What the master-detail editor is currently focused on (chosen in the outline). */
export type { Selection } from '../../lib/router';
