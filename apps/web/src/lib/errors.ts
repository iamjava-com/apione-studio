import i18n from '../i18n';
import { ApiError } from '../api';

/** Localized text for a caught error. An ApiError's stable `code` maps to `err_<code>` (with any
 *  `details` as interpolation params); unmapped codes fall back to the server's English message. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const params = e.details && typeof e.details === 'object' ? (e.details as Record<string, unknown>) : {};
    return i18n.t(`err_${e.code ?? ''}`, { defaultValue: e.message, ...params });
  }
  return e instanceof Error ? e.message : String(e);
}
