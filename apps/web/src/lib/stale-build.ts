let stale = false;

/** Whether a chunk from a replaced build has failed to load in this page. */
export const sawStaleBuild = (): boolean => stale;

/** A deploy replaces the hashed chunks a loaded page names; Vite reports the miss here. */
export function watchForStaleBuild(): void {
  window.addEventListener('vite:preloadError', () => {
    stale = true;
  });
}
