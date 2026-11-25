/**
 * The installed game's connection to its app, and the only way the page
 * tells the two versions apart.
 *
 * The app's preload script exposes one global, `naturalCausesDesktop`. The
 * website never has it. Nothing reads the address or the user agent. The
 * bridge exists only on the page's main thread, not in workers, so the
 * installed game's save logic runs on the main thread behind the same
 * serialized store and controller boundary as the website's.
 */

/** Save files in the app's saves folder, named by the shared slot rules. */
export interface DesktopSaveFiles {
  read(name: string): Promise<Uint8Array | null>;
  write(name: string, bytes: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
}

export interface DesktopBridge {
  readonly saves: DesktopSaveFiles;
  /**
   * Registers the page's answer to the app asking for a save, before the
   * window closes or when it is minimized. The app waits for the returned
   * promise when closing, for up to ten seconds.
   */
  onSaveRequested(handler: () => Promise<unknown>): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The app's bridge, or null on the website or when its shape is wrong. */
export function desktopBridge(scope: object = globalThis): DesktopBridge | null {
  const candidate = (scope as { naturalCausesDesktop?: unknown }).naturalCausesDesktop;
  if (!isRecord(candidate) || typeof candidate.onSaveRequested !== 'function') return null;
  const saves = candidate.saves;
  if (!isRecord(saves)) return null;
  if (typeof saves.read !== 'function' || typeof saves.write !== 'function' || typeof saves.remove !== 'function') {
    return null;
  }
  return candidate as unknown as DesktopBridge;
}

/**
 * Answers the app's save requests with an automatic save. It first waits for
 * any Save, Load, import or clear already running, because an automatic save
 * is skipped while one runs and the window may close right after this answer.
 * Starting a new game skips the save, as the website's hide save does, so a
 * request cannot write the old household back while New game is clearing it.
 */
export function registerDesktopSaveRequests(
  bridge: DesktopBridge,
  save: () => Promise<unknown>,
  isStartingNewGame: () => boolean,
  whenIdle: () => Promise<void> = () => Promise.resolve(),
): void {
  bridge.onSaveRequested(async () => {
    await whenIdle();
    if (isStartingNewGame()) return;
    await save();
  });
}
