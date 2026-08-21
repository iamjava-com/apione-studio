/**
 * A tiny bridge so App-level navigation (back / home / switch project / logout) can tell
 * whether the open project has unsaved edits — the dirty state lives inside ProjectView,
 * out of App's reach. ProjectView publishes it here; App reads it to confirm before leaving.
 *
 * The browser's own leave prompt hangs off the same flag rather than off any one editor, because a
 * project can be dirty in more than one place at once — an unsaved mock draft is as easy to lose to
 * a refresh as an unsaved spec, and a guard that only knew about the spec let the other one go.
 */

let unsaved = false;

const warnBeforeUnload = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = '';
};

export const setUnsaved = (v: boolean): void => {
  if (v === unsaved) return;
  unsaved = v;
  if (v) window.addEventListener('beforeunload', warnBeforeUnload);
  else window.removeEventListener('beforeunload', warnBeforeUnload);
};

export const isUnsaved = (): boolean => unsaved;
