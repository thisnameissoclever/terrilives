import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OptionsMenu } from '../src/ui/options-menu.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

function menu() {
  const attributes = new Map<string, string>();
  const toggle = { setAttribute: (name: string, value: string) => attributes.set(name, value) };
  const panel = { hidden: false };
  return { options: new OptionsMenu(toggle, panel), panel, expanded: () => attributes.get('aria-expanded') };
}

/** The markup between two ids, for "this lives inside that" checks. */
function between(fromId: string, toId: string): string {
  const from = INDEX_HTML.indexOf(`id="${fromId}"`);
  const to = INDEX_HTML.indexOf(`id="${toId}"`);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return INDEX_HTML.slice(from, to);
}

/** The body of the first CSS rule for `selector`. */
function rule(selector: string): string {
  const at = INDEX_HTML.indexOf(`${selector} {`);
  expect(at).toBeGreaterThan(-1);
  return INDEX_HTML.slice(at, INDEX_HTML.indexOf('}', at));
}

// [OF2] in docs/specs/2026-09-22-options-flyout.md.
describe('OptionsMenu', () => {
  it('starts closed and says so to assistive technology', () => {
    const { options, panel, expanded } = menu();
    expect([options.isOpen(), panel.hidden, expanded()]).toEqual([false, true, 'false']);
  });

  it('opens and closes from the gear', () => {
    const { options, panel, expanded } = menu();
    expect(options.toggle()).toBe(true);
    expect([panel.hidden, expanded()]).toEqual([false, 'true']);
    expect(options.toggle()).toBe(false);
    expect([panel.hidden, expanded()]).toEqual([true, 'false']);
  });

  it('closes on Escape only when open, and reports whether it did', () => {
    const { options, panel } = menu();
    expect(options.handleKey('Escape')).toBe(false);
    options.open();
    expect(options.handleKey('Enter')).toBe(false);
    expect(panel.hidden).toBe(false);
    expect(options.handleKey('Escape')).toBe(true);
    expect(panel.hidden).toBe(true);
  });

  it('closes on a press outside and stays open for one inside', () => {
    const { options, panel } = menu();
    options.open();
    options.pointerDown(true);
    expect(panel.hidden).toBe(false);
    options.pointerDown(false);
    expect(panel.hidden).toBe(true);
  });

  it('reports whether a close did anything', () => {
    const { options } = menu();
    expect(options.close()).toBe(false);
    options.open();
    expect(options.close()).toBe(true);
  });
});

describe('the Options flyout in the page', () => {
  it('sits outside the sidebar, before the right-click flyout', () => {
    const hudEnd = INDEX_HTML.indexOf('<div id="builder-dock">');
    const options = INDEX_HTML.indexOf('<div id="options">');
    expect(options).toBeGreaterThan(hudEnd);
    expect(INDEX_HTML.indexOf('id="object-menu"')).toBeGreaterThan(options);
  });

  it.each(['lighting-mode', 'build-toggle', 'audio-controls', 'audio-mute', 'effects-volume',
    'game-actions', 'save-game', 'load-game', 'stop-orders', 'queue-mode', 'new-game', 'show-help'])(
    'holds #%s in the panel',
    (id) => {
      expect(INDEX_HTML.split(`id="${id}"`)).toHaveLength(2);
      expect(between('options-panel', 'object-menu')).toContain(`id="${id}"`);
    },
  );

  it.each(['save-status', 'command-feedback', 'keyboard-target'])(
    'keeps the live region #%s in the always-shown household status',
    (id) => {
      expect(between('household-summary', 'builder-desktop')).toContain(`id="${id}"`);
    },
  );

  it('names the gear, ties it to its panel, and starts the panel hidden', () => {
    const gear = INDEX_HTML.slice(INDEX_HTML.indexOf('id="options-toggle"'), INDEX_HTML.indexOf('<svg'));
    expect(gear).toContain('aria-label="Options"');
    expect(gear).toContain('aria-controls="options-panel"');
    expect(gear).toContain('aria-expanded="false"');
    expect(INDEX_HTML).toContain('<div id="options-panel" role="group" aria-label="Options" hidden>');
    expect(INDEX_HTML).toMatch(/<svg aria-hidden="true" focusable="false"/);
  });

  it('is fixed to the top right, inside the safe area, between the dock and the menus', () => {
    const body = rule('      #options');
    expect(body).toContain('position: fixed');
    expect(body).toContain('env(safe-area-inset-top)');
    expect(body).toContain('env(safe-area-inset-right)');
    const z = Number(/z-index:\s*(\d+)/.exec(body)?.[1]);
    expect(z).toBeGreaterThan(2);
    expect(z).toBeLessThan(9);
    expect(rule('      .options-toggle')).toContain('min-height: 44px');
    expect(INDEX_HTML).toMatch(/#options-panel\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
  });

  it('leaves no Light or Build row in any compact status strip', () => {
    const areas = [...INDEX_HTML.matchAll(/#household-summary \{[^}]*grid-template-areas:([^;]*);/g)]
      .map((match) => match[1]);
    expect(areas.length).toBeGreaterThanOrEqual(3);
    for (const area of areas) {
      expect(area).toMatch(/'status status( status)?'/);
      expect(area).not.toMatch(/lighting|build/);
    }
  });

  it('is wired: Escape goes to the panel before Build, and Build closes it', () => {
    expect(MAIN_TS).toContain('new OptionsMenu(optionsToggle, optionsPanel)');
    const options = MAIN_TS.indexOf('optionsMenu.handleKey(event.key)');
    const build = MAIN_TS.indexOf('routeBuildKey(event.key, buildTools, builder)');
    const objectMenu = MAIN_TS.indexOf('attachPointerInput(');
    expect(options).toBeGreaterThan(-1);
    expect(options).toBeLessThan(objectMenu);
    expect(options).toBeLessThan(build);
    expect(MAIN_TS).toContain('optionsMenu.pointerDown(');
    const enter = MAIN_TS.indexOf('    enter() {\n      optionsMenu.close();');
    expect(enter).toBeGreaterThan(-1);
  });
});
