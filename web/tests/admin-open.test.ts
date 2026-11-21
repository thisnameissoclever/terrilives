import { describe, expect, it, vi } from 'vitest';
import { ADMIN_PANEL_SHORTCUTS } from '../src/ui/shortcuts.js';
import { installAdminOpening, isDebugOverlayKey, type AdminOpeningDeps } from '../src/admin/admin-open.js';

// [AP-web-keys] and [AP-tests-web] item 4: the tilde key opens and closes the
// admin panel, and only that. The plain backtick stays the developer overlay's.

interface KeyInit {
  key?: string;
  code?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  /** Whether the AltGraph modifier state reads as held. */
  altGraph?: boolean;
  repeat?: boolean;
  target?: unknown;
}

function setup(options: { open?: boolean; build?: boolean; otherDialog?: boolean; skipRunning?: boolean } = {}) {
  const log: string[] = [];
  const state = { open: options.open ?? false, build: options.build ?? false, otherDialog: options.otherDialog ?? false, skipRunning: options.skipRunning ?? false };
  let listener: ((event: KeyboardEvent) => void) | null = null;
  const doc = {
    addEventListener(type: string, callback: (event: KeyboardEvent) => void) { if (type === 'keydown') listener = callback; },
    removeEventListener(type: string) { if (type === 'keydown') listener = null; },
    querySelector: (_selector: string) => (state.otherDialog ? {} : null),
  };
  const deps: AdminOpeningDeps = {
    doc: doc as unknown as Document,
    panel: {
      get isOpen() { return state.open; },
      open() { log.push('open'); state.open = true; return true; },
      close() { log.push('close'); state.open = false; },
    },
    buildActive: () => state.build,
    say: text => { log.push(`say ${text}`); },
    skip: { get running() { return state.skipRunning; }, stop() { log.push('skip stop'); } },
  };
  const dispose = installAdminOpening(deps);
  const press = (init: KeyInit = {}) => {
    const { altGraph = false, ...fields } = init;
    const event = {
      key: '~', code: 'Backquote', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, repeat: false, target: null,
      defaultPrevented: false, ...fields,
      getModifierState: (name: string) => name === 'AltGraph' && altGraph,
      preventDefault() { (this as { defaultPrevented: boolean }).defaultPrevented = true; },
    };
    listener!(event as unknown as KeyboardEvent);
    return event;
  };
  return { log, state, press, dispose, hasListener: () => listener !== null };
}

describe('the tilde key', () => {
  it('opens the panel and closes it again', () => {
    const { log, press } = setup();
    const first = press();
    expect(log).toEqual(['open']);
    expect(first.defaultPrevented).toBe(true);
    press();
    expect(log).toEqual(['open', 'close']);
  });

  it('matches the character, so a layout that types ~ another way still works', () => {
    const { log, press } = setup();
    press({ key: '~', code: 'IntlBackslash', shiftKey: false });
    expect(log).toEqual(['open']);
  });

  it('does nothing for a backquote that types no tilde', () => {
    const { log, press } = setup();
    press({ key: '`', code: 'Backquote', shiftKey: false });
    press({ key: 'Dead', code: 'Backquote', shiftKey: true });
    expect(log).toEqual([]);
  });

  it('ignores a held key, so holding it does not flicker the panel', () => {
    const { log, press } = setup();
    press({ repeat: true });
    expect(log).toEqual([]);
  });

  it.each(['ctrlKey', 'altKey', 'metaKey'] as const)('ignores %s chords, open or closed', modifier => {
    const closed = setup();
    closed.press({ [modifier]: true });
    expect(closed.log).toEqual([]);
    const open = setup({ open: true });
    open.press({ [modifier]: true });
    expect(open.log).toEqual([]);
  });

  // German, Spanish, French and Italian Windows layouts type ~ with AltGr,
  // which the browser reports as Ctrl and Alt held together.
  it.each([
    ['German', 'BracketRight'],
    ['Spanish', 'Digit4'],
    ['French', 'Digit2'],
  ])('opens and closes with the %s AltGr tilde', (_layout, code) => {
    const { log, press } = setup();
    const altGr = { key: '~', code, shiftKey: false, ctrlKey: true, altKey: true, altGraph: true };
    expect(press(altGr).defaultPrevented).toBe(true);
    press(altGr);
    expect(log).toEqual(['open', 'close']);
  });

  it('opens with Ctrl and Alt held together even when the AltGraph state does not read as held', () => {
    const { log, press } = setup();
    press({ key: '~', code: 'BracketRight', shiftKey: false, ctrlKey: true, altKey: true });
    expect(log).toEqual(['open']);
  });

  it('opens when only the AltGraph state reads as held', () => {
    const { log, press } = setup();
    press({ key: '~', code: 'BracketRight', shiftKey: false, altGraph: true });
    expect(log).toEqual(['open']);
  });

  it('ignores Meta with AltGr, which is still a chord', () => {
    const { log, press } = setup();
    press({ key: '~', code: 'BracketRight', ctrlKey: true, altKey: true, altGraph: true, metaKey: true });
    expect(log).toEqual([]);
  });

  it('says to leave Build mode, and does not open, while Build mode is active', () => {
    const { log, press } = setup({ build: true });
    press();
    expect(log).toEqual(['say Leave Build mode to open the admin panel.']);
  });

  it('does not open over another dialog', () => {
    const { log, press } = setup({ otherDialog: true });
    press();
    expect(log).toEqual([]);
  });

  it.each([
    ['a text field', { tagName: 'INPUT', type: 'text' }],
    ['a number field', { tagName: 'INPUT', type: 'number' }],
    ['a field with no type', { tagName: 'INPUT', type: '' }],
    ['a text area', { tagName: 'TEXTAREA' }],
    ['an editable element', { tagName: 'DIV', isContentEditable: true }],
  ])('does not open while typing in %s outside the panel', (_name, target) => {
    const { log, press } = setup();
    const event = press({ target });
    expect(log).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('opens from a button or a checkbox, which take no typed text', () => {
    const { log, press } = setup();
    press({ target: { tagName: 'INPUT', type: 'checkbox' } });
    expect(log).toEqual(['open']);
  });

  it('closes the panel from a number field inside it, typing no character', () => {
    const { log, press } = setup({ open: true });
    const event = press({ target: { tagName: 'INPUT', type: 'number' } });
    expect(log).toEqual(['close']);
    expect(event.defaultPrevented).toBe(true);
  });

  it('closes the panel even over a nested dialog or while Build mode flag is set', () => {
    const { log, press } = setup({ open: true, otherDialog: true, build: true });
    press();
    expect(log).toEqual(['close']);
  });

  it('stops a running skip before it closes the panel', () => {
    const { log, press } = setup({ open: true, skipRunning: true });
    press();
    expect(log).toEqual(['skip stop', 'close']);
  });

  it('does not touch the skip when none runs', () => {
    const { log, press } = setup({ open: true });
    press();
    expect(log).toEqual(['close']);
  });

  it('stops listening once disposed', () => {
    const { dispose, hasListener } = setup();
    dispose();
    expect(hasListener()).toBe(false);
  });
});

describe('the developer overlay key', () => {
  const key = (init: KeyInit) => isDebugOverlayKey({
    key: '`', code: 'Backquote', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...init,
  });

  it('is still the plain backtick', () => {
    expect(key({})).toBe(true);
  });

  it('ignores Shift plus the backquote key, which is the tilde', () => {
    expect(key({ key: '~', shiftKey: true })).toBe(false);
  });

  it('ignores any press that types a tilde, whatever the layout does with Shift', () => {
    expect(key({ key: '~', shiftKey: false })).toBe(false);
  });

  it('ignores other keys', () => {
    expect(key({ key: 'a', code: 'KeyA' })).toBe(false);
  });

  it('keeps toggling with Ctrl or Alt held, as before', () => {
    expect(key({ ctrlKey: true })).toBe(true);
    expect(key({ altKey: true })).toBe(true);
  });

  it('ignores an AltGr tilde, even one typed on the backquote key', () => {
    expect(key({ key: '~', ctrlKey: true, altKey: true })).toBe(false);
    expect(key({ key: '~', code: 'BracketRight', ctrlKey: true, altKey: true })).toBe(false);
  });

  it('never fires for the same press that opens the panel', () => {
    const { press } = setup();
    const toggle = vi.fn();
    const event = press();
    if (isDebugOverlayKey(event as unknown as KeyboardEvent)) toggle();
    expect(toggle).not.toHaveBeenCalled();
  });
});

describe('the Help shortcut list', () => {
  it('lists the tilde key and the touch route with the reviewed wording (S-help)', () => {
    expect(ADMIN_PANEL_SHORTCUTS.rows).toEqual([{ label: 'Open or close the admin panel', keys: ['~'] }]);
    expect(ADMIN_PANEL_SHORTCUTS.note).toBe("Touch: hold the lot's bottom corner tile");
  });
});
