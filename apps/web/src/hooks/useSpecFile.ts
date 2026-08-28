import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import YAML from 'yaml';
import { freeze, produce } from 'immer';
import { api, ApiError } from '../api';
import { errorText } from '../lib/errors';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Doc = any;

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
export type SpecMode = 'doc' | 'text';

/**
 * One spec file, shared by the form, the outline and the YAML view. It has two modes, and the
 * truth lives in exactly one of them:
 *
 * - `doc`: the parsed document, edited through `update` with structural sharing (immer). The form
 *   and the outline read `doc` directly; nothing is serialized per keystroke. Text is derived on
 *   demand by `serialize()` — on save, on a rebase, and when switching to `text`.
 * - `text`: the raw YAML, owned by the editor via `setText`. `doc` is null; the outline parses the
 *   text on its own. Switching back to `doc` parses once and fails (returns false) on bad YAML.
 *
 * `doc` is frozen: mutate it only through `update`, or immer throws.
 */
export interface SpecFile {
  mode: SpecMode;
  doc: Doc | null;
  /** The text in `text` mode; in `doc` mode the last text adopted from the server (stale). */
  text: string;
  /** Bumps on every `update` in doc mode — memo key for anything derived from `doc`. */
  docRev: number;
  /** Bumps whenever `text` is replaced by something other than `setText` (load, reset, rebase,
   * outline edits while in text mode) so the YAML editor reconciles its model. */
  syncRev: number;
  version: number;
  isNew: boolean;
  dirty: boolean; // differs from the last saved version (or the file is new)
  loaded: boolean;
  status: SaveStatus;
  conflict: number | null;
  error: string | null;
  update: (mutate: (d: Doc) => void) => void;
  setText: (t: string) => void;
  /** Convert between modes. `false` when the text does not parse: the mode stays `text`. */
  switchMode: (m: SpecMode) => boolean;
  serialize: () => string;
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

type DocState = { doc: Doc | null; rev: number };

export function useSpecFile(projectId: string, path: string, onSaved?: () => void, title?: string): SpecFile {
  const [mode, modeRef, putMode] = useMirrored<SpecMode>('doc');
  const [text, textRef, putText] = useMirrored('');
  const [docState, docRef, putDoc] = useMirrored<DocState>({ doc: null, rev: 0 });
  // Last persisted content; null until loaded or saved. In doc mode, the doc revision that
  // matched it (-1 = none, the doc is dirty).
  const [savedContent, savedRef, putSaved] = useMirrored<string | null>(null);
  const [savedRev, savedRevRef, putSavedRev] = useMirrored(-1);
  const [version, versionRef, putVersion] = useMirrored(0);
  const [loaded, loadedRef, putLoaded] = useMirrored(false);
  const [isNew, setIsNew] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [conflict, setConflict] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncRev, setSyncRev] = useState(0);

  const isDirty = useCallback(() => {
    if (savedRef.current === null) return true;
    return modeRef.current === 'doc'
      ? docRef.current.rev !== savedRevRef.current
      : textRef.current !== savedRef.current;
  }, [savedRef, modeRef, docRef, savedRevRef, textRef]);

  const serialize = useCallback(
    () => (modeRef.current === 'doc' && docRef.current.doc ? YAML.stringify(docRef.current.doc) : textRef.current),
    [modeRef, docRef, textRef],
  );

  // Replace the doc with a parse of `next`; `saved` says whether that parse is the saved state.
  // Unparseable text (never from the server; a starter or a merge could not produce it either)
  // falls back to text mode so the YAML view can show what there is.
  const adoptDoc = useCallback(
    (next: string, saved: boolean) => {
      let doc: Doc | null;
      try {
        doc = freeze(YAML.parse(next) ?? {}, true); // frozen, like every doc `update` yields
      } catch {
        doc = null;
      }
      if (doc === null) {
        putMode('text');
        putDoc({ doc: null, rev: docRef.current.rev + 1 });
        return;
      }
      const rev = docRef.current.rev + 1;
      putDoc({ doc, rev });
      putSavedRev(saved ? rev : -1);
    },
    [putMode, putDoc, docRef, putSavedRev],
  );

  /**
   * Take a document from the server as the editor's ground truth. `saved` is what the file holds
   * there, which is not always what we now show: a merge hands back both sides at once. Bumps
   * `syncRev` when the text moved, so the YAML editor replaces its model.
   */
  const adopt = useCallback(
    (next: string, saved: string | null, atVersion: number) => {
      if (next !== textRef.current) setSyncRev((n) => n + 1);
      putText(next);
      putSaved(saved);
      putVersion(atVersion);
      if (modeRef.current === 'doc') adoptDoc(next, next === saved);
    },
    [textRef, putText, putSaved, putVersion, modeRef, adoptDoc],
  );

  const update = useCallback(
    (mutate: (d: Doc) => void) => {
      if (modeRef.current === 'doc') {
        const prev = docRef.current;
        if (!prev.doc) return;
        const doc = produce(prev.doc, (d: Doc) => void mutate(d)); // mutators may return their assignment
        if (doc === prev.doc) return;
        putDoc({ doc, rev: prev.rev + 1 });
      } else {
        // The YAML editor owns the text; an outline edit goes through the text and back.
        let doc: Doc;
        try {
          doc = YAML.parse(textRef.current) ?? {};
        } catch {
          return;
        }
        const next = produce(doc, (d: Doc) => void mutate(d));
        if (next === doc) return;
        putText(YAML.stringify(next));
        setSyncRev((n) => n + 1);
      }
      setStatus((s) => (s === 'saved' ? 'idle' : s));
    },
    [modeRef, docRef, putDoc, textRef, putText],
  );

  const setText = useCallback(
    (t: string) => {
      putText(t);
      setStatus((s) => (s === 'saved' ? 'idle' : s));
    },
    [putText],
  );

  const switchMode = useCallback(
    (m: SpecMode): boolean => {
      if (m === modeRef.current) return true;
      if (m === 'text') {
        const t = serialize();
        if (t !== textRef.current) setSyncRev((n) => n + 1);
        putText(t);
        putMode('text');
        putDoc({ doc: null, rev: docRef.current.rev + 1 });
        return true;
      }
      try {
        YAML.parse(textRef.current);
      } catch {
        return false;
      }
      putMode('doc');
      adoptDoc(textRef.current, textRef.current === savedRef.current);
      return true;
    },
    [modeRef, serialize, textRef, putText, putMode, putDoc, docRef, adoptDoc, savedRef],
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
          .rebaseFile(projectId, path, serialize(), versionRef.current)
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
  }, [projectId, path, runLoad, adopt, isDirty, serialize, loadedRef, versionRef]);

  const save = useCallback(() => {
    setStatus('saving');
    setError(null);
    savingRef.current = true;
    ++loadTicket.current; // the write carries fresher state than any read already in flight
    const sent = serialize();
    const sentRev = docRef.current.rev;
    api
      .writeFile(projectId, path, sent, version)
      .then((r) => {
        savingRef.current = false;
        // Not always what went out: a concurrent save is merged in server-side, and new
        // operations come back stamped with ids. When the bytes are ours, keep the doc — edits
        // made while the request was out stay, and the doc is not parsed again for nothing.
        if (modeRef.current === 'doc' && r.content === sent) {
          putText(r.content);
          putSaved(r.content);
          putVersion(r.version);
          putSavedRev(sentRev);
        } else adopt(r.content, r.content, r.version);
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
  }, [
    projectId,
    path,
    version,
    onSaved,
    adopt,
    serialize,
    docRef,
    modeRef,
    putText,
    putSaved,
    putVersion,
    putSavedRev,
  ]);

  const reset = useCallback(() => {
    if (savedContent === null) return; // nothing saved to revert to
    adopt(savedContent, savedContent, versionRef.current);
    setSyncRev((n) => n + 1); // even when the text is already equal: the YAML view may hold an unsaved edit
    setStatus('idle');
  }, [savedContent, adopt, versionRef]);

  const dirty = savedContent === null || (mode === 'doc' ? docState.rev !== savedRev : text !== savedContent);

  return {
    mode,
    doc: mode === 'doc' ? docState.doc : null,
    text,
    docRev: docState.rev,
    syncRev,
    version,
    isNew,
    dirty,
    loaded,
    status,
    conflict,
    error,
    update,
    setText,
    switchMode,
    serialize,
    load,
    save,
    reset,
    sync,
  };
}
