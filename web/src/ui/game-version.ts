/**
 * The game's version number, shown as plain text at the top of the Options
 * panel (issue 276).
 *
 * `web/package.json` is the one place the number is typed. Vite reads it
 * when it starts and replaces `__APP_VERSION__` with the quoted string, in
 * the dev server, the production build and the test run alike (see `define`
 * in `web/vite.config.ts`). The copies that tools or readers need elsewhere
 * must match it: the Rust workspace version in the root `Cargo.toml`, the
 * npm lockfile, `Cargo.lock` and the README's Version line.
 * `web/tests/game-version.test.ts` fails when any of them differs.
 */

declare const __APP_VERSION__: string;

/** The version from `web/package.json`, such as `1.0.0`. */
export const GAME_VERSION: string = __APP_VERSION__;

/** The line the Options panel shows: `Version 1.0.0`. */
export function versionLabel(version: string = GAME_VERSION): string {
  return `Version ${version}`;
}

/** The element that shows the line; only its text is written. */
export interface VersionLine {
  textContent: string | null;
}

/**
 * Writes the version line into the page. The markup leaves the element
 * empty, so no second copy of the number can go stale in `index.html`.
 */
export function showGameVersion(line: VersionLine, version: string = GAME_VERSION): void {
  line.textContent = versionLabel(version);
}
