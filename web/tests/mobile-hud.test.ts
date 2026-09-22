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

// [B-phone-build-dock] in docs/FEATURES.md: on a phone the Build dock scrolls,
// so each tool keeps its status and confirming buttons in one group pinned to
// the foot of the panel, and the four tool buttons share one row.
describe('the phone Build dock', () => {
  /** The markup of the actions group holding `#id`, or '' when none does. */
  function actionsGroupOf(id: string): string {
    const at = INDEX_HTML.indexOf(`id="${id}"`);
    const open = INDEX_HTML.lastIndexOf('<div class="builder-actions">', at);
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

  it.each([
    ['builder-status', ['builder-confirm', 'builder-cancel', 'builder-sell', 'builder-sale-note']],
    ['wall-status', ['wall-build', 'wall-doorway', 'wall-remove']],
    ['room-status', ['room-build', 'room-cancel']],
    ['buy-status', ['buy-confirm', 'buy-cancel']],
  ])('groups %s with the buttons that act on it', (status, buttons) => {
    const group = actionsGroupOf(status);
    expect(group).toContain(`id="${status}"`);
    for (const button of buttons) expect(group).toContain(`id="${button}"`);
  });

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

  it('scrolls the panel and puts the four tools in one row on a compact screen', () => {
    const compact = mediaBlock(/@media\s*\(max-width:\s*600px\)\s*,\s*\(max-height:\s*480px\)/);
    expect(compact).toMatch(/#builder-dock #builder-controls\s*\{[^}]*max-height:\s*45dvh;\s*overflow-y:\s*auto/);
    expect(compact).toMatch(/#builder-dock #builder-controls\s*\{[^}]*box-sizing:\s*border-box;/);
    expect(compact).toMatch(/#builder-dock #build-tools\s*\{\s*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
    // At 320 wide each tool button is 61 pixels, and "Furniture" needs
    // the side padding trimmed to fit.
    expect(compact).toMatch(/#builder-dock #build-tools \.hud-button\s*\{\s*padding-inline:\s*2px;/);
    // Sell joins Confirm and Cancel in one row, so the Furniture tool's
    // pinned group does not hide its facing and Rotate row.
    expect(compact).toMatch(/#builder-dock #furniture-tool \.builder-actions\s*\{\s*grid-template-columns:\s*repeat\(3,/);
    expect(compact).toMatch(/#builder-dock #furniture-tool \.builder-actions > \.builder-row\s*\{\s*display:\s*contents;/);
    expect(compact).toMatch(/#builder-dock #furniture-tool \.builder-actions > p\s*\{\s*grid-column:\s*1 \/ -1;/);
  });

  // Below 481 pixels of height the panel is about 144 pixels tall, and a
  // pinned group that size would hide the list it acts on.
  it('pins the group to the foot of the panel only where the panel is tall enough', () => {
    const tall = mediaBlock(/@media\s*\(max-width:\s*600px\)\s*and\s*\(min-height:\s*481px\)/);
    expect(tall).toMatch(/#builder-dock \.builder-actions\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0/);
    const compact = mediaBlock(/@media\s*\(max-width:\s*600px\)\s*,\s*\(max-height:\s*480px\)/);
    expect(compact).not.toContain('sticky');
  });
});
