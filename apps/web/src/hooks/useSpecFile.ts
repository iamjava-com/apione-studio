import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import YAML from 'yaml';
import { api, ApiError } from '../api';
import { errorText } from '../lib/errors';

/** Starter spec for a brand-new file, seeded with the project name as the API title. */
function starterSpec(title?: string): string {
  // YAML.stringify quotes the user-supplied title when needed, so it can't break the doc.
  const t = YAML.stringify(title?.trim() || 'New API').trim();
  return `openapi: 3.1.0
info:
  title: ${t}
  version: 1.0.0
paths:
  /hello:
    get:
      operationId: hello
      summary: Say hello
      responses:
        '200':
          description: ok
          content:
            application/json:
              example:
                message: hello world
`;
}

export type SaveStatus = 'idle' | 'saving' | 'saved';

/** Shared state for one spec file — the single source the Form and YAML views both edit. */
export interface SpecFile {
  content: string;
  setContent: (c: string) => void;
  version: number;
  isNew: boolean;
  dirty: boolean; // content differs from the last saved version (or the file is new)
  loaded: boolean;
  status: SaveStatus;
  conflict: number | null;
  error: string | null;
  syncRev: number; // bumps when content is replaced wholesale (load/reset) so the Form re-parses
  load: () => void;
  save: () => void;
  reset: () => void; // discard unsaved edits, back to the last saved content
  sync: () => void; // take in what the file became; unsaved edits are replayed on top of it
}

/**
 * State with a ref alongside it holding the same value. Two callers here run outside the render
 * that created them and cannot read the state: the save bar blurs the focused field and saves in
 * the same tick, before React has re-rendered, and the sync listeners were bound on an older one.
 */
function useMirrored<T>(initial: T): [T, RefObject<T>, (v: T) => void] {
  const [value, setValue] = useState(initial);
  const ref = useRef(initial);
  const put = useCallback((v: T) => {
    ref.current = v;
    setValue(v);
  }, []);
  return [value, ref, put];
}

export function useSpecFile(projectId: string, path: string, onSaved?: () => void, title?: string): SpecFile {
  const [content, contentRef, putContent] = useMirrored('');
  // Last persisted content; null until loaded or saved.
  const [savedContent, savedRef, putSaved] = useMirrored<string | null>(null);
  const [version, versionRef, putVersion] = useMirrored(0);
  const [loaded, loadedRef, putLoaded] = useMirrored(false);
  const [isNew, setIsNew] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [conflict, setConflict] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncRev, setSyncRev] = useState(0);

  const isDirty = useCallback(
    () => savedRef.current === null || contentRef.current !== savedRef.current,
    [savedRef, contentRef],
  );
  const setContent = useCallback(
    (c: string) => {
      putContent(c);
      setStatus((s) => (s === 'saved' ? 'idle' : s));
    },
    [putContent],
  );

  /**
   * Take a document from the server as the editor's ground truth. `saved` is what the file holds
   * there, which is not always what we now show: a merge hands back both sides at once. The Form
   * and YAML views keep their own parsed copy, so a text that moved has to bump `syncRev` or their
   * next edit writes the old one straight back out.
   */
  const adopt = useCallback(
    (next: string, saved: string | null, atVersion: number) => {
      if (next !== contentRef.current) setSyncRev((n) => n + 1);
      putContent(next);
      putSaved(saved);
      putVersion(atVersion);
    },
    [contentRef, putContent, putSaved, putVersion],
  );

  // Bumped on every load; a response whose ticket is no longer current belongs to a file the user
  // has already navigated away from, and applying it would show one file's text under another's
  // name and version — which the next save would then write.
  const loadTicket = useRef(0);
  const savingRef = useRef(false);

  // `quiet` keeps `loaded` true for the swap: the Form renders nothing while unloaded, so a
  // background reload would otherwise blank the editor out from under someone who is reading it.
  const runLoad = useCallback(
    (quiet: boolean) => {
      const ticket = ++loadTicket.current;
      const current = () => ticket === loadTicket.current;
      setError(null);
      setConflict(null);
      if (!quiet) putLoaded(false);
      api
        .readFile(projectId, path)
        .then((r) => {
          if (!current()) return;
          adopt(r.content, r.content, r.version);
          setIsNew(false);
          putLoaded(true);
        })
        .catch((e: unknown) => {
          if (!current()) return;
          if (e instanceof ApiError && e.status === 404) {
            adopt(starterSpec(title), null, 0); // never saved → dirty, so the starter can be created
            setIsNew(true);
            putLoaded(true);
          } else {
            setError(errorText(e));
          }
        });
    },
    [projectId, path, title, adopt, putLoaded],
  );
  const load = useCallback(() => runLoad(false), [runLoad]);

  useEffect(load, [load]);

  /**
   * A session that sits on a file goes stale the moment another author saves: the outline keeps
   * rendering operations that have since moved. Take in what the file became — unsaved edits are
   * replayed on top of it by the same merge a save runs, so they survive without being written.
   * The listing carries the current version, so the probe costs one small GET and pulls nothing
   * unless there is something to pull.
   */
  const sync = useCallback(() => {
    if (!loadedRef.current || savingRef.current) return; // whatever is in flight is the fresher read
    api
      .listFiles(projectId)
      .then((files) => {
        const meta = files.find((f) => f.path === path);
        if (!meta || meta.currentVersion <= versionRef.current) return;
        if (!isDirty()) return runLoad(true);
        const ticket = ++loadTicket.current;
        api
          .rebaseFile(projectId, path, contentRef.current, versionRef.current)
          .then((r) => {
            if (ticket !== loadTicket.current) return;
            adopt(r.content, r.head, r.version);
            setConflict(null);
          })
          .catch((e: unknown) => {
            if (ticket !== loadTicket.current) return;
            // Genuinely overlapping edits — the same 409 the save would hit, so raise the same
            // banner now rather than letting someone keep typing into a save that cannot land.
            if (e instanceof ApiError && e.status === 409) setConflict(meta.currentVersion);
          });
      })
      .catch(() => {}); // offline or no longer permitted; the next save reports it properly
  }, [projectId, path, runLoad, adopt, isDirty, contentRef, loadedRef, versionRef]);

  const save = useCallback(() => {
    setStatus('saving');
    setError(null);
    savingRef.current = true;
    ++loadTicket.current; // the write carries fresher state than any read already in flight
    api
      .writeFile(projectId, path, contentRef.current, version)
      .then((r) => {
        savingRef.current = false;
        // Not always what went out: a concurrent save is merged in server-side.
        adopt(r.content, r.content, r.version);
        setIsNew(false);
        setConflict(null);
        setStatus('saved');
        onSaved?.();
      })
      .catch((e: unknown) => {
        savingRef.current = false;
        setStatus('idle');
        if (e instanceof ApiError && e.status === 409) {
          setConflict((e.details as { currentVersion?: number } | undefined)?.currentVersion ?? version);
        } else {
          setError(errorText(e));
        }
      });
  }, [projectId, path, version, onSaved, adopt, contentRef]);

  const reset = useCallback(() => {
    if (savedContent === null) return; // nothing saved to revert to
    putContent(savedContent);
    setStatus('idle');
    setSyncRev((n) => n + 1); // external content swap → let the Form re-parse
  }, [savedContent, putContent]);

  const dirty = savedContent === null || content !== savedContent;

  return {
    content,
    setContent,
    version,
    isNew,
    dirty,
    loaded,
    status,
    conflict,
    error,
    syncRev,
    load,
    save,
    reset,
    sync,
  };
}
