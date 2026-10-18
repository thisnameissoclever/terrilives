import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GAME_VERSION, showGameVersion, versionLabel } from '../src/ui/game-version.js';

// Issue 276: one version number, typed once in web/package.json.
const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const PACKAGE = JSON.parse(read('../package.json')) as { version?: string };
const LOCK = JSON.parse(read('../package-lock.json')) as {
  version?: string;
  packages: Record<string, { version?: string }>;
};
const CARGO_TOML = read('../../Cargo.toml');
const CARGO_LOCK = read('../../Cargo.lock');
const INDEX_HTML = read('../index.html');
const MAIN_TS = read('../src/main.ts');
const README = read('../../README.md');

/** The member paths under `[workspace] members` in the root Cargo.toml, so a new crate is checked too. */
function workspaceMembers(): string[] {
  const list = /^\[workspace\]\s*$[\s\S]*?^members\s*=\s*\[([\s\S]*?)\]/m.exec(CARGO_TOML)?.[1] ?? '';
  return [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}
const MEMBERS = workspaceMembers();

/** A member manifest line that inherits the workspace version, in either form Cargo accepts. */
const INHERITS_WORKSPACE_VERSION = /^version(?:\s*\.\s*workspace\s*=\s*true|\s*=\s*\{\s*workspace\s*=\s*true\s*\})\s*$/m;

/** The `[package] name` in one member's Cargo.toml. */
function packageName(manifest: string): string | undefined {
  return /^\[package\]\s*$[\s\S]*?^name\s*=\s*"([^"]+)"/m.exec(manifest)?.[1];
}

/** The `version` in the root Cargo.toml's `[workspace.package]` table. */
function cargoWorkspaceVersion(): string | undefined {
  const table = /^\[workspace\.package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(CARGO_TOML)?.[1] ?? '';
  return /^version\s*=\s*"([^"]+)"\s*$/m.exec(table)?.[1];
}

/** The version Cargo.lock records for one workspace crate. */
function lockedCrateVersion(name: string): string | undefined {
  const entry = new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = "([^"]+)"`).exec(CARGO_LOCK);
  return entry?.[1];
}

describe('the game version', () => {
  const version = PACKAGE.version;

  it('is typed in web/package.json as major.minor.patch', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('reaches the bundle from web/package.json through the Vite define', () => {
    expect(GAME_VERSION).toBe(version);
  });

  it('matches the npm lockfile, which npm keeps in step with package.json', () => {
    expect(LOCK.version).toBe(version);
    expect(LOCK.packages['']?.version).toBe(version);
  });

  it('matches the Rust workspace version in the root Cargo.toml', () => {
    expect(cargoWorkspaceVersion()).toBe(version);
  });

  it('matches the Version line in README.md', () => {
    expect(/^Version (\S+?)\. /m.exec(README)?.[1]).toBe(version);
  });

  it('finds the workspace members in Cargo.toml', () => {
    expect(MEMBERS.length).toBeGreaterThan(0);
  });

  it.each(MEMBERS)('is inherited by %s from the workspace and recorded in Cargo.lock', (member) => {
    const manifest = read(`../../${member}/Cargo.toml`);
    // Cargo accepts both `version.workspace = true` and `version = { workspace = true }`.
    expect(manifest).toMatch(INHERITS_WORKSPACE_VERSION);
    const name = packageName(manifest);
    expect(name).toBeDefined();
    expect(lockedCrateVersion(name!)).toBe(version);
  });
});

describe('the version line in Options', () => {
  it('reads "Version" and the number from package.json', () => {
    const line = { textContent: null as string | null };
    showGameVersion(line);
    expect(line.textContent).toBe(`Version ${PACKAGE.version}`);
  });

  it('writes whatever version it is given, so the label is not tied to one number', () => {
    const line = { textContent: 'stale' as string | null };
    showGameVersion(line, '2.3.4');
    expect(line.textContent).toBe('Version 2.3.4');
    expect(versionLabel('0.0.1')).toBe('Version 0.0.1');
  });

  it('is the first thing in the Options panel, as plain text with no hand-typed number', () => {
    const panel = '<div id="options-panel" role="group" aria-label="Options" hidden>';
    const start = INDEX_HTML.indexOf(panel);
    expect(start).toBeGreaterThan(-1);
    // Skip the comment that names the source, then expect the line before Close Options.
    const body = INDEX_HTML.slice(start + panel.length).replace(/^\s*<!--[\s\S]*?-->/, '');
    expect(body).toMatch(/^\s*<p id="game-version" class="options-version"><\/p>\s*<button\b[^>]*\bid="options-close"/);
    expect(INDEX_HTML.split('id="game-version"')).toHaveLength(2);
  });

  it('is small, muted text that takes no focus', () => {
    const at = INDEX_HTML.indexOf('.options-version {');
    expect(at).toBeGreaterThan(-1);
    const rule = INDEX_HTML.slice(at, INDEX_HTML.indexOf('}', at));
    expect(rule).toContain('font-size: 12px');
    expect(rule).toContain('color: var(--hud-muted)');
    const tag = /<p id="game-version"[^>]*>/.exec(INDEX_HTML)?.[0] ?? '';
    expect(tag).not.toMatch(/tabindex|role=|aria-live|aria-hidden/);
  });

  it('is filled by main.ts from the game-version element', () => {
    expect(MAIN_TS).toContain("import { showGameVersion } from './ui/game-version.js';");
    expect(MAIN_TS).toMatch(/const gameVersion = document\.getElementById\('game-version'\);[\s\S]{0,120}showGameVersion\(gameVersion\);/);
  });
});
