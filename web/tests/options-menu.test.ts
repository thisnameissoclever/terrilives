import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OptionsMenu, attachOptionsMenu } from '../src/ui/options-menu.js';

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

/** A document, a flyout wrapper and a gear that record what the listeners do. */
function page() {
  const inside = new Set<unknown>(['gear', 'light']);
  const docListeners = new Map<string, { listener: (event: never) => void; capture: boolean }>();
  const doc = {
    activeElement: 'canvas' as unknown,
    addEventListener(type: string, listener: (event: never) => void, capture = false) {
      docListeners.set(type, { listener, capture });
    },
  };
  let gearClick = () => {};
  let focused = 0;
  const gear = {
    addEventListener: (_type: 'click', listener: () => void) => { gearClick = listener; },
    focus: () => { focused += 1; },
  };
  const { options, panel } = menu();
  attachOptionsMenu(doc, { contains: (node) => inside.has(node) }, gear, options,
    (target) => target === 'in-a-dialog');
  const key = (keyName: string, target: unknown = 'canvas', already = false) => {
    const event = {
      key: keyName, target, defaultPrevented: already, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
    };
    docListeners.get('keydown')!.listener(event as unknown as never);
    return event;
  };
  const press = (target: unknown) => docListeners.get('pointerdown')!.listener({ target } as never);
  return { doc, options, panel, docListeners, key, press, click: () => gearClick(), focused: () => focused };
}

describe('attachOptionsMenu', () => {
  it('toggles from the gear and closes on a press outside, not inside', () => {
    const { panel, click, press } = page();
    click();
    expect(panel.hidden).toBe(false);
    press('light');
    expect(panel.hidden).toBe(false);
    press('floor');
    expect(panel.hidden).toBe(true);
  });

  it('catches Escape on the way down and stops it, so nothing else acts on it', () => {
    const { docListeners, options, key, focused, doc } = page();
    expect(docListeners.get('keydown')!.capture).toBe(true);
    options.open();
    const event = key('Escape');
    expect([options.isOpen(), event.defaultPrevented, event.stopped, focused()]).toEqual([false, true, true, 0]);
    // A closed panel leaves Escape to the rest of the page.
    const next = key('Escape');
    expect([next.defaultPrevented, next.stopped]).toEqual([false, false]);
    // Focus inside the panel goes back to the gear.
    options.open();
    doc.activeElement = 'light';
    key('Escape');
    expect(focused()).toBe(1);
  });

  it('leaves a dialog key, an already-handled key and any other key alone', () => {
    const { options, key } = page();
    options.open();
    expect(key('Escape', 'in-a-dialog').stopped).toBe(false);
    expect(key('Escape', 'canvas', true).stopped).toBe(false);
    expect(key('Enter').defaultPrevented).toBe(false);
    expect(options.isOpen()).toBe(true);
  });
});

describe('the Options flyout in the page', () => {
  it('comes first in the page, outside the sidebar, before the right-click flyout', () => {
    const options = INDEX_HTML.indexOf('<div id="options">');
    expect(options).toBeGreaterThan(-1);
    expect(INDEX_HTML.indexOf('<div id="hud" ')).toBeGreaterThan(options);
    expect(INDEX_HTML.indexOf('id="object-menu"')).toBeGreaterThan(options);
  });

  it.each(['lighting-mode', 'build-toggle', 'audio-controls', 'audio-mute', 'effects-volume',
    'game-actions', 'save-game', 'load-game', 'stop-orders', 'queue-mode', 'new-game', 'show-help'])(
    'holds #%s in the panel',
    (id) => {
      expect(INDEX_HTML.split(`id="${id}"`)).toHaveLength(2);
      expect(between('options-panel', 'hud')).toContain(`id="${id}"`);
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

  it('keeps the phone sidebar and the debug overlay clear of the gear, and fits 320 pixels', () => {
    expect(INDEX_HTML).toContain('right: calc(max(8px, env(safe-area-inset-right)) + 52px);');
    expect(INDEX_HTML).toContain('top: calc(max(8px, env(safe-area-inset-top)) + 52px);');
    expect(INDEX_HTML).toContain('minmax(0, 2fr) minmax(0, 1fr) minmax(64px, auto);');
    expect(INDEX_HTML).not.toContain('minmax(125px, 2fr)');
  });

  it('keeps an empty status line in the page, at no height', () => {
    expect(INDEX_HTML).toMatch(/#keyboard-target:empty \{\s*min-height: 0;\s*\}/);
    expect(INDEX_HTML).not.toMatch(/#(command-feedback|keyboard-target):empty[^{]*\{\s*display: none/);
  });
});

describe('the Options flyout wired into main.ts', () => {
  /** The source of the handler that starts with `opening`, up to its close. */
  const handler = (opening: string) => {
    const at = MAIN_TS.indexOf(opening);
    expect(at, opening).toBeGreaterThan(-1);
    return MAIN_TS.slice(at, MAIN_TS.indexOf('\n  });', at));
  };

  it('attaches its listeners through attachOptionsMenu, with dialogs excluded', () => {
    expect(MAIN_TS).toContain('new OptionsMenu(optionsToggle, optionsPanel)');
    expect(MAIN_TS).toContain("target.closest('dialog') !== null");
    expect(MAIN_TS.indexOf('attachOptionsMenu(')).toBeGreaterThan(-1);
    expect(MAIN_TS.indexOf('attachOptionsMenu(')).toBeLessThan(MAIN_TS.indexOf('attachPointerInput('));
  });

  it.each([
    "loadButton.addEventListener('click', () => {",
    "newGameButton.addEventListener('click', () => {",
    "helpButton.addEventListener('click', () => {",
  ])('closes the panel before the dialog opens: %s', (opening) => {
    expect(handler(opening)).toMatch(/^[^\n]*\n\s*optionsMenu\.close\(\);/);
  });

  it('closes the panel when Build starts and when it ends, then focuses the gear', () => {
    expect(MAIN_TS).toContain('    enter() {\n      optionsMenu.close();');
    expect(MAIN_TS).toMatch(/mobileHud\.endEditing\(\);[^}]*optionsMenu\.close\(\);\s*optionsToggle\.focus\(\);/);
  });

  it('returns focus to the gear, which leads the fallbacks, after Load, New game and Help', () => {
    expect(MAIN_TS.split(/restorePersistenceFocus\(\s*document,\s*\w+,\s*optionsToggle,/)).toHaveLength(3);
    expect(MAIN_TS).toMatch(/const persistenceFocusFallbacks = \[\s*optionsToggle,/);
    expect(handler("helpButton.addEventListener('click', () => {")).toContain('helpReturnTarget = optionsToggle;');
  });

  it('folds the Traits panel with Needs and People on a phone', () => {
    expect(MAIN_TS).toMatch(/new MobileHud\(hudRoot, mobileHudButton, \[\s*needsRoot,\s*peopleRoot,\s*traitsBlock,\s*\]\)/);
  });
});
