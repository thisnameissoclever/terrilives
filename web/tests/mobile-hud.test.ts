import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  COMPACT_HUD_MEDIA_QUERY,
  MobileHud,
  type MobileHudButton,
  type MobileHudDetails,
  type MobileHudRoot,
} from '../src/ui/mobile-hud.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

interface RecordedRoot extends MobileHudRoot {
  readonly attributes: Map<string, string>;
}

interface RecordedButton extends MobileHudButton {
  readonly attributes: Map<string, string>;
}

function root(): RecordedRoot {
  const attributes = new Map<string, string>();
  return {
    attributes,
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
}

function button(): RecordedButton {
  const attributes = new Map<string, string>();
  return {
    attributes,
    hidden: false,
    textContent: '',
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
}

function details(open = true): MobileHudDetails {
  return { open };
}

function openingTagFor(id: string): string {
  const tag = INDEX_HTML.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0];
  if (!tag) {
    throw new Error(`missing opening tag for #${id}`);
  }
  return tag;
}

function attributeValue(tag: string, name: string): string {
  const value = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))?.[1];
  if (value === undefined) {
    throw new Error(`missing ${name} attribute in ${tag}`);
  }
  return value;
}

describe('MobileHud', () => {
  it('collapses editing details and restores desktop state without reopening compact panels', () => {
    const panels = [details(true), details(false)];
    const hud = new MobileHud(root(), button(), panels);
    hud.beginEditing(); hud.beginEditing();
    expect(panels.map(panel => panel.open)).toEqual([false, false]);
    hud.endEditing();
    expect(panels.map(panel => panel.open)).toEqual([true, false]);
    hud.beginEditing(); hud.setCompact(true); hud.endEditing();
    expect(panels.map(panel => panel.open)).toEqual([false, false]);
  });
  it('uses the same compact threshold as the responsive stylesheet', () => {
    expect(COMPACT_HUD_MEDIA_QUERY).toBe(
      '(max-width: 600px), (max-height: 480px)',
    );
    expect(INDEX_HTML).toMatch(
      /@media\s*\(max-width:\s*600px\)\s*,\s*\(max-height:\s*480px\)/,
    );
  });

  it('removes every secondary HUD surface from closed compact layout', () => {
    expect(INDEX_HTML).toMatch(
      /#hud\[data-mobile-open='false'\]\s*>\s*:not\(#household-summary\)\s*\{\s*display:\s*none\s*;/,
    );
    expect(INDEX_HTML).toMatch(
      /#hud\[data-mobile-open='false'\]\s+#lighting-mode\s*\{\s*display:\s*none\s*;/,
    );
    expect(openingTagFor('hud')).toMatch(/\bdata-mobile-open\s*=\s*"false"/);
    const controlledIds = attributeValue(
      openingTagFor('mobile-hud-toggle'),
      'aria-controls',
    )
      .split(/\s+/)
      .sort();
    expect(controlledIds).toEqual(
      [
        'lighting-mode',
        'household-roster',
        'needs-panel',
        'people-panel',
        'time-controls',
        'audio-controls',
        'game-actions',
      ].sort(),
    );
  });

  it('uses the placed safe-area insets as the portrait sheet height boundary', () => {
    expect(INDEX_HTML).toMatch(
      /max-height:\s*calc\(\s*100dvh\s*-\s*max\(8px,\s*env\(safe-area-inset-top\)\)\s*-\s*max\(8px,\s*env\(safe-area-inset-bottom\)\)\s*\)/,
    );
  });

  it('collapses the HUD and its detail panels when the viewport becomes compact', () => {
    const hudRoot = root();
    const toggle = button();
    const needs = details();
    const people = details();
    const hud = new MobileHud(hudRoot, toggle, [needs, people]);

    hud.setCompact(true);

    expect(hudRoot.attributes.get('data-mobile-open')).toBe('false');
    expect(toggle.hidden).toBe(false);
    expect(toggle.textContent).toBe('Menu');
    expect(toggle.attributes.get('aria-expanded')).toBe('false');
    expect(toggle.attributes.get('aria-label')).toBe('Open game menu');
    expect(needs.open).toBe(false);
    expect(people.open).toBe(false);
  });

  it('opens and closes the same compact HUD without reopening detail panels', () => {
    const hudRoot = root();
    const toggle = button();
    const needs = details();
    const people = details();
    const hud = new MobileHud(hudRoot, toggle, [needs, people]);
    hud.setCompact(true);

    expect(hud.toggle()).toBe(true);
    expect(hudRoot.attributes.get('data-mobile-open')).toBe('true');
    expect(toggle.textContent).toBe('Close');
    expect(toggle.attributes.get('aria-expanded')).toBe('true');
    expect(toggle.attributes.get('aria-label')).toBe('Close game menu');
    expect(needs.open).toBe(false);
    expect(people.open).toBe(false);

    expect(hud.toggle()).toBe(false);
    expect(hudRoot.attributes.get('data-mobile-open')).toBe('false');
    expect(toggle.textContent).toBe('Menu');
  });

  it('hides the toggle and exposes the normal HUD outside compact mode', () => {
    const hudRoot = root();
    const toggle = button();
    const hud = new MobileHud(hudRoot, toggle, [details(), details()]);

    hud.setCompact(false);

    expect(toggle.hidden).toBe(true);
    expect(hudRoot.attributes.get('data-mobile-open')).toBe('false');
    expect(hud.toggle()).toBe(false);
  });

  it('closes again after leaving and re-entering compact mode', () => {
    const hudRoot = root();
    const toggle = button();
    const needs = details(false);
    const people = details(false);
    const hud = new MobileHud(hudRoot, toggle, [needs, people]);
    hud.setCompact(true);
    hud.toggle();
    needs.open = true;
    people.open = true;

    hud.setCompact(false);
    hud.setCompact(true);

    expect(hudRoot.attributes.get('data-mobile-open')).toBe('false');
    expect(needs.open).toBe(false);
    expect(people.open).toBe(false);
  });
});

// [B-phone-build-dock] in docs/FEATURES.md: each Build tool holds a region of
// choices and a footer of its status and the buttons that act on it. On a
// phone at least 481 pixels tall only the choices scroll, so the footer is
// always in view and nothing ever sits behind it.
describe('the phone Build dock', () => {
  /** The markup of the `<div class="{kind}">` holding `#id`, or '' when none does. */
  function groupOf(kind: string, id: string): string {
    const at = INDEX_HTML.indexOf(`id="${id}"`);
    const open = INDEX_HTML.lastIndexOf(`<div class="${kind}">`, at);
    if (at < 0 || open < 0) return '';
    const tags = /<\/?div\b/g;
    tags.lastIndex = open;
    let depth = 0;
    for (let tag = tags.exec(INDEX_HTML); tag; tag = tags.exec(INDEX_HTML)) {
      depth += tag[0] === '<div' ? 1 : -1;
      if (depth === 0) return at < tag.index ? INDEX_HTML.slice(open, tag.index) : '';
    }
    return '';
  }

  /** The rules of the first `@media` block whose condition matches `condition`. */
  function mediaBlock(condition: RegExp): string {
    const start = INDEX_HTML.search(condition);
    if (start < 0) return '';
    let depth = 0;
    for (let at = INDEX_HTML.indexOf('{', start); at < INDEX_HTML.length; at += 1) {
      if (INDEX_HTML[at] === '{') depth += 1;
      if (INDEX_HTML[at] === '}') depth -= 1;
      if (depth === 0) return INDEX_HTML.slice(start, at);
    }
    return '';
  }

  const COMPACT = /@media\s*\(max-width:\s*600px\)\s*,\s*\(max-height:\s*480px\)/;
  const TALL = /@media\s*\(max-width:\s*600px\)\s*and\s*\(min-height:\s*481px\)/;
  const NARROW = /@media\s*\(max-width:\s*300px\)/;

  it.each([
    ['builder-status', ['builder-confirm', 'builder-cancel', 'builder-sell', 'builder-sale-note']],
    ['wall-status', ['wall-build', 'wall-doorway', 'wall-remove']],
    ['room-status', ['room-build', 'room-cancel']],
    ['buy-status', ['buy-confirm', 'buy-cancel']],
  ])('puts %s in one footer with the buttons that act on it', (status, buttons) => {
    const footer = groupOf('builder-actions', status);
    expect(footer).toContain(`id="${status}"`);
    for (const button of buttons) expect(footer).toContain(`id="${button}"`);
  });

  it.each([
    ['builder-object', ['builder-rotate', 'builder-rotation-note', 'builder-keyboard-help', 'builder-touch-help']],
    ['buy-object', ['buy-filter', 'buy-rotate', 'buy-price', 'buy-serves', 'buy-keyboard-help', 'buy-touch-help']],
    ['wall-keyboard-help', ['wall-touch-help']],
    ['room-keyboard-help', ['room-touch-help']],
  ])('puts %s in the choices above that footer', (first, rest) => {
    const choices = groupOf('builder-choices', first);
    for (const id of [first, ...rest]) expect(choices).toContain(`id="${id}"`);
    expect(choices).not.toContain('builder-actions');
  });

  it('trims the panel on every compact screen', () => {
    const compact = mediaBlock(COMPACT);
    // The whole panel, border included, stays at 45% of the screen.
    expect(compact).toMatch(/#builder-dock #builder-controls\s*\{[^}]*box-sizing:\s*border-box;[^}]*max-height:\s*45dvh;[^}]*overflow-y:\s*auto/);
    // The heading and the paused note leave the view but not the page.
    expect(compact).toMatch(/#builder-dock #builder-name,\s*#builder-dock #builder-paused\s*\{[^}]*position:\s*absolute;[^}]*clip-path:\s*inset\(50%\)/);
    // The four tools share one row, their side padding trimmed so the
    // longest label fits at 320 wide.
    expect(compact).toMatch(/#builder-dock #build-tools\s*\{\s*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
    expect(compact).toMatch(/#builder-dock #build-tools \.hud-button\s*\{\s*padding-inline:\s*2px;/);
    // Each list's label sits beside it.
    expect(compact).toMatch(/#builder-dock \.builder-choices\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\);/);
    expect(compact).toMatch(/#builder-dock \.builder-choices > :not\(label\):not\(select\)\s*\{\s*grid-column:\s*1 \/ -1;/);
    // Sell joins Confirm and Cancel.
    expect(compact).toMatch(/#builder-dock #furniture-tool \.builder-actions\s*\{\s*grid-template-columns:\s*repeat\(3,/);
    expect(compact).toMatch(/#builder-dock #furniture-tool \.builder-actions > \.builder-row\s*\{\s*display:\s*contents;/);
    expect(compact).toMatch(/#builder-dock #furniture-tool \.builder-actions > p\s*\{\s*grid-column:\s*1 \/ -1;/);
  });

  it('scrolls only the choices where the panel is tall enough', () => {
    const tall = mediaBlock(TALL);
    expect(tall).toMatch(/#builder-dock #builder-controls\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/);
    expect(tall).toMatch(/#builder-dock #builder-controls > \.builder-tool:not\(\[hidden\]\)\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/);
    expect(tall).toMatch(/#builder-dock \.builder-choices\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/);
    expect(tall).toMatch(/#builder-dock \.builder-actions\s*\{[^}]*flex:\s*none;/);
    // Nothing is pinned over content anywhere, so focus is never hidden.
    expect(INDEX_HTML).not.toContain('sticky');
  });

  // Below 481 pixels of height the panel can be 144 pixels tall, too short
  // for a fixed footer and a region above it, so the whole panel scrolls.
  it('leaves the short panel to scroll whole', () => {
    expect(mediaBlock(COMPACT)).not.toMatch(/display:\s*flex/);
  });

  // On a desktop the choices join the tool's own grid and the help lines
  // follow the footer, so the side panel reads as it did before.
  it('keeps the desktop order: choices, footer, then help', () => {
    expect(INDEX_HTML).toMatch(/\n      \.builder-choices\s*\{\s*display:\s*contents;\s*\}/);
    expect(INDEX_HTML).toMatch(/\n      \.builder-help\s*\{\s*order:\s*1;\s*\}/);
    for (const id of ['builder-keyboard-help', 'builder-touch-help', 'buy-keyboard-help', 'buy-touch-help',
      'wall-keyboard-help', 'wall-touch-help', 'room-keyboard-help', 'room-touch-help']) {
      expect(INDEX_HTML).toMatch(new RegExp(`id="${id}" class="builder-note builder-help"`));
    }
  });

  it('puts the tools back two by two below 301 pixels wide', () => {
    expect(mediaBlock(NARROW)).toMatch(/#builder-dock #build-tools\s*\{\s*grid-template-columns:\s*1fr 1fr;/);
  });
});
