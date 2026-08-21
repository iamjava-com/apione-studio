import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, type MockCatalog, type MockMode } from '../api';
import { errorText } from '../lib/errors';
import { keepOnly } from '../lib/utils';
import { useConfirm } from '../components/ConfirmProvider';
import { useRevisit } from './useRevisit';
import { useLatestOnly } from './useLatestOnly';

// The JSDoc is what binds the ambient types to this code: without it `req` is untyped and the
// returned object gets no field completion. It describes the envelope form used here — someone
// switching to the bare-body shorthand can drop the @returns line.
const STARTER = `/**
 * @param {MockRequest} req
 * @returns {MockResponse}
 */
export default (req) => ({
  status: 200,
  body: { id: req.params.id },
});
`;

interface SavedCode {
  content: string;
  version: number;
}

const dropDraft = (d: Record<string, string>, k: string): Record<string, string> => {
  const rest = { ...d };
  delete rest[k];
  return rest;
};

/**
 * The saved/draft/conflict state machine behind the Mock editor: per-endpoint saved code,
 * the draft layer, optimistic-version saves, conflict reporting, and mode switches.
 * `key` is the selected operation's id (null with nothing selected); `drafts` live in the
 * workspace so an unsaved edit survives leaving Mock mode.
 */
export function useMockCode({
  projectId,
  key,
  catalog,
  reloadCatalog,
  drafts,
  setDrafts,
}: {
  projectId: string;
  key: string | null;
  catalog: MockCatalog | null;
  reloadCatalog: () => void;
  drafts: Record<string, string>;
  setDrafts: (update: (d: Record<string, string>) => Record<string, string>) => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  // Server-side content per endpoint; `drafts` layers the unsaved edit on top.
  const [saved, setSaved] = useState<Record<string, SavedCode>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Someone else has written this mock since we read it.
  const [conflict, setConflict] = useState(false);

  // An op id can come back without its code — restoring an old version brings the operations back,
  // but the server deleted their code when they went. A stale entry would save against a dead version.
  useEffect(() => {
    if (!catalog) return;
    const live = new Set(catalog.operations.map((o) => o.opId));
    setSaved((s) => keepOnly(s, live));
  }, [catalog]);

  const latestOnly = useLatestOnly();
  const loadCode = useCallback(
    (k: string) => {
      latestOnly(
        k,
        api.readMockCode(projectId, k),
        (c) => setSaved((s) => ({ ...s, [k]: { content: c.content, version: c.version } })),
        // Without the saved version a later save would send baseVersion 0 and overwrite whatever is
        // there, so say so rather than let the editor look empty and ready.
        (err) => setError(errorText(err)),
      );
    },
    [projectId, latestOnly],
  );

  // Fetch a given operation's saved code once; drafts layer on top of it.
  useEffect(() => {
    setError(null);
    setConflict(false); // both belong to the endpoint that was on screen, not to this one
    if (!key || saved[key]) return;
    loadCode(key);
  }, [key, saved, loadCode]);

  /**
   * A mock is server state that leaves no trace in the document, so the workspace's version probe
   * never speaks for it: another author's mode switch or code edit would sit unseen until a page
   * reload. The catalog is cheap to re-read; the code is cached per operation, so the one on screen
   * has to be asked for by name.
   *
   * Never under an unsaved draft. That draft was written against the version in `saved`, and taking
   * a newer one on would turn the 409 it has coming into a silent overwrite of the other author's
   * code — a sidecar has no structure to merge on.
   */
  const revisit = useCallback(() => {
    if (saving) return;
    reloadCatalog();
    // Uncached is the effect above's job; asking here too would only fetch it twice.
    if (key && saved[key] && drafts[key] === undefined) loadCode(key);
  }, [saving, reloadCatalog, key, saved, drafts, loadCode]);
  useRevisit(revisit);

  const savedCode = key ? (saved[key]?.content ?? '') : '';
  const code = key && drafts[key] !== undefined ? drafts[key]! : savedCode;
  // A draft only exists while it differs from what's saved (see setCode), so its mere presence
  // is the dirty signal — no comparison needed by anyone reading this from outside.
  const dirty = key !== null && drafts[key] !== undefined;
  const dirtyKeys = useMemo(() => new Set(Object.keys(drafts)), [drafts]);

  const setCode = (v: string) => {
    if (!key) return;
    setDrafts((d) => {
      // typed back to the saved text — no longer a pending edit
      if (v === savedCode) return dropDraft(d, key);
      return { ...d, [key]: v };
    });
  };

  /** A stale base means someone else wrote this mock meanwhile. Code has no structure to merge on,
   *  so — unlike the spec — there is nothing to do but say so and let the author choose. */
  const report = (e: unknown): void => {
    if (e instanceof ApiError && e.status === 409) setConflict(true);
    else setError(errorText(e));
  };

  const save = async (): Promise<boolean> => {
    if (!key) return false;
    setSaving(true);
    setError(null);
    setConflict(false);
    try {
      const res = await api.writeMockCode(projectId, key, code, saved[key]?.version ?? 0);
      setSaved((s) => ({ ...s, [key]: { content: res.content, version: res.version } }));
      setDrafts((d) => dropDraft(d, key)); // saved — the draft is no longer a pending edit
      reloadCatalog();
      return true;
    } catch (e) {
      report(e);
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** Take their version, dropping ours — the way out of a conflict, and the same trade the design
   *  canvas offers under the same banner. */
  const reloadCode = async () => {
    if (!key) return;
    if (dirty && !(await confirm({ message: t('unsavedLeave'), confirmLabel: t('discard'), danger: true }))) return;
    setDrafts((d) => dropDraft(d, key));
    setConflict(false);
    loadCode(key);
  };

  /** Throw away the unsaved edit — same action, wording and confirmation as the design canvas. */
  const reset = async () => {
    if (!key) return;
    if (!(await confirm({ message: t('resetConfirm'), confirmLabel: t('reset'), danger: true }))) return;
    setDrafts((d) => dropDraft(d, key));
  };

  const changeMode = async (next: MockMode) => {
    if (!key) return;
    // Switching to scripted with nothing written would leave the endpoint claiming "custom" while
    // still falling through to auto. Save the starter so the choice takes effect immediately —
    // and so the editor opens clean, rather than pre-dirtied by a template the user never typed.
    if (next === 'scripted' && !savedCode.trim() && drafts[key] === undefined) {
      try {
        const res = await api.writeMockCode(projectId, key, STARTER, 0);
        setSaved((s) => ({ ...s, [key]: { content: res.content, version: res.version } }));
      } catch (e) {
        report(e);
        return;
      }
    }
    try {
      await api.setMockMode(projectId, key, next);
    } catch (e) {
      report(e);
      return;
    }
    reloadCatalog();
  };

  return { saving, error, conflict, code, dirty, dirtyKeys, setCode, save, reloadCode, reset, changeMode };
}
