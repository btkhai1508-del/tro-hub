const RELOAD_KEY = 'trohub_chunk_reload_at';
const RELOAD_WINDOW = 30000;

/** A file of an older build is gone after a deploy, or the network dropped while loading it. */
export function isChunkLoadError(error: unknown): boolean {
  const text = String((error as Error)?.message || error || '');
  return /dynamically imported module|Importing a module script failed|error loading dynamically|Unable to preload CSS|ChunkLoadError|Failed to load module script/i.test(text);
}

/** Reloads to pick up the current build, but only once so a real outage cannot loop forever. */
export function reloadOnceForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_WINDOW) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
