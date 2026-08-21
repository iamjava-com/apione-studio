/**
 * Adapter over swagger2openapi — the Swagger 2 → OpenAPI 3 conversion engine. Import works
 * hub-and-spoke: every source format is converted to OpenAPI once, and the rest of the app never
 * imports the engine directly.
 *
 * Operates on dynamic JSON, so documents are intentionally `any`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { convertObj } from 'swagger2openapi';

/** Convert a parsed Swagger 2 document to OpenAPI 3. `patch` + `warnOnly` because an import should
 *  absorb a slightly-broken real-world export rather than refuse it. */
export async function swagger2ToOpenapi(doc: any): Promise<any> {
  const converted = await convertObj(doc, { patch: true, warnOnly: true });
  return converted.openapi;
}
