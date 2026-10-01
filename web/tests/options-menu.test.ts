import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { OptionsMenu, attachOptionsMenu } from '../src/ui/options-menu.js';
import { restorePersistenceFocus } from '../src/ui/persistence-controller.js';

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
  it('holds only the gear and its panel, without owning other HUD surfaces', () => {
    // Walk the div tags from the wrapper's opening to its matching close,
    // with comments blanked out so a tag named in one cannot end the walk.
    const page = INDEX_HTML.replace(/<!--[\s\S]*?-->/g, (comment) => ' '.repeat(comment.length));
    const start = page.indexOf('<div id="options">');
    const tags = /<div\b[^>]*>|<\/div>/g;
    tags.lastIndex = start;
    let depth = 0;
    let end = -1;
    for (let tag = tags.exec(page); tag; tag = tags.exec(page)) {
      depth += tag[0] === '</div>' ? -1 : 1;
      if (depth === 0) { end = tags.lastIndex; break; }
    }
    expect(end).toBeGreaterThan(start);
    const wrapper = page.slice(start, end);
    expect(wrapper).toContain('id="options-toggle"');
    expect(wrapper).toContain('id="options-panel"');
    for (const outside of ['hud', 'household-summary', 'builder-dock', 'object-menu', 'debug-panel']) {
      expect(wrapper, outside).not.toContain(`id="${outside}"`);
    }
  });

  it('belongs to the world controls before the separate Sim dock', () => {
    const options = INDEX_HTML.indexOf('<div id="options">');
    expect(options).toBeGreaterThan(INDEX_HTML.indexOf('<div id="world-actions">'));
    expect(options).toBeLessThan(INDEX_HTML.indexOf('id="sim-dock"'));
  });

  it.each(['lighting-mode', 'audio-controls', 'audio-mute', 'effects-volume',
    'game-actions', 'save-game', 'load-game', 'death-enabled', 'new-game', 'show-help'])(
    'holds #%s in the panel',
    (id) => {
      expect(INDEX_HTML.split(`id="${id}"`)).toHaveLength(2);
      expect(between('options-panel', 'sim-dock')).toContain(`id="${id}"`);
    },
  );

  it.each(['save-status', 'command-feedback', 'keyboard-target'])(
    'keeps the live region #%s in the always-shown household status',
    (id) => {
      expect(between('household-summary', 'time-controls')).toContain(`id="${id}"`);
    },
  );

  it('names the gear, ties it to its panel, and starts the panel hidden', () => {
    const gear = INDEX_HTML.slice(INDEX_HTML.indexOf('id="options-toggle"'), INDEX_HTML.indexOf('id="options-panel"'));
    expect(gear).toContain('aria-label="Options"');
    expect(gear).toContain('aria-controls="options-panel"');
    expect(gear).toContain('aria-expanded="false"');
    expect(INDEX_HTML).toContain('<div id="options-panel" role="group" aria-label="Options" hidden>');
    expect(gear).toContain('Options</button>');
  });

  it('bounds the Options panel to the viewport and obeys its hidden state', () => {
    expect(rule('      #options-panel')).toContain('overflow-y: auto');
    expect(rule('      #options-panel')).toContain('100dvh');
    expect(INDEX_HTML).toMatch(/#options-panel\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
  });

  it.each(['queue-mode', 'stop-orders'])('keeps #%s in the Queue panel, exactly once', id => {
    expect(INDEX_HTML.split(`id="${id}"`)).toHaveLength(2);
    expect(between('sim-queue', 'sim-people')).toContain(`id="${id}"`);
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
    expect(MAIN_TS).toContain("document.querySelector('dialog[open]') !== null");
    expect(MAIN_TS.indexOf('attachOptionsMenu(')).toBeGreaterThan(-1);
    expect(MAIN_TS.indexOf('attachOptionsMenu(')).toBeLessThan(MAIN_TS.indexOf('attachPointerInput('));
  });

  it.each([
    "loadButton.addEventListener('click', () => {",
    "newGameButton.addEventListener('click', () => {",
    "helpButton.addEventListener('click', () => {",
    "newHousemateButton.addEventListener('click', () => {",
  ])('closes the panel before the dialog opens: %s', (opening) => {
    expect(handler(opening)).toMatch(/^[^\n]*\n\s*optionsMenu\.close\(\);/);
  });

  it('closes Options when Build starts and restores focus to Build when it ends', () => {
    expect(MAIN_TS).toMatch(/enter\(\) \{\r?\n\s*optionsMenu\.close\(\);/);
    expect(MAIN_TS).toMatch(/compactHud\.endEditing\(\);[^}]*optionsMenu\.close\(\);\s*document\.querySelector<HTMLButtonElement>\('#build-toggle'\)\?\.focus\(\);/);
  });

  it('returns focus to the gear, which leads the fallbacks, after Load, New game and Help', () => {
    for (const opening of [
      "confirmLoadGame.addEventListener('click', (event) => {",
      "confirmNewGame.addEventListener('click', (event) => {",
    ]) {
      expect(handler(opening)).toMatch(/restorePersistenceFocus\(\s*document,\s*\w+,\s*optionsToggle,/);
    }
    expect(MAIN_TS).toMatch(/const persistenceFocusFallbacks = \[\s*optionsToggle,/);
    expect(handler("helpButton.addEventListener('click', () => {")).toContain('helpReturnTarget = optionsToggle;');
  });

  describe.each([
    ['loadGameDialog', 'loadingGame', 'load-game'],
    ['newGameDialog', 'clearingForNewGame', 'new-game'],
  ])('%s cancellation', (dialogName, busyName, owner) => {
    function close(busy = false, deliberateFocus = false) {
      const body = {};
      const elsewhere = {};
      const source = { body, activeElement: deliberateFocus ? elsewhere : body };
      const toggle = { disabled: false, focus: vi.fn() };
      const resume = vi.fn();
      let listener: (() => void) | undefined;
      const dialog = {
        open: false,
        contains: () => false,
        addEventListener: (type: string, callback: () => void) => {
          expect(type).toBe('close');
          listener = callback;
        },
      };
      // Execute the real bootstrap listener, including its busy-operation guard.
      // Native Escape and method=dialog cancellation both dispatch this close.
      runInNewContext(`${handler(`${dialogName}.addEventListener('close', () => {`)}\n  });`, {
        [dialogName]: dialog,
        [busyName]: busy,
        document: source,
        optionsToggle: toggle,
        persistenceFocusFallbacks: [],
        restorePersistenceFocus,
        overlayPause: { resume },
      });
      expect(listener).toBeTypeOf('function');
      listener!();
      return { toggle, resume };
    }

    it('returns stranded focus to visible Options and releases its pause', () => {
      const { toggle, resume } = close();
      expect(toggle.focus).toHaveBeenCalledTimes(1);
      expect(resume).toHaveBeenCalledExactlyOnceWith(owner);
    });

    it('leaves a confirmed operation in charge of focus and its pause', () => {
      const { toggle, resume } = close(true);
      expect(toggle.focus).not.toHaveBeenCalled();
      expect(resume).not.toHaveBeenCalled();
    });

    it('preserves deliberate focus elsewhere after cancellation', () => {
      const { toggle, resume } = close(false, true);
      expect(toggle.focus).not.toHaveBeenCalled();
      expect(resume).toHaveBeenCalledExactlyOnceWith(owner);
    });
  });

  it('wires the shared compact HUD with a queue capacity refresh', () => {
    expect(MAIN_TS).toContain('createCompactHud(document, () => actionQueue.invalidate(), () => optionsMenu.close())');
  });
});
