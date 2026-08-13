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

describe('MobileHud', () => {
  it('uses the same compact threshold as the responsive stylesheet', () => {
    expect(COMPACT_HUD_MEDIA_QUERY).toBe(
      '(max-width: 600px), (max-height: 480px)',
    );
    expect(INDEX_HTML).toContain(
      '@media (max-width: 600px), (max-height: 480px)',
    );
  });

  it('removes every secondary HUD surface from closed compact layout', () => {
    expect(INDEX_HTML).toMatch(
      /#hud\[data-mobile-open='false'\]\s*>\s*:not\(#household-summary\)\s*\{\s*display:\s*none\s*;/,
    );
    expect(INDEX_HTML).toMatch(
      /#hud\[data-mobile-open='false'\]\s+#lighting-mode\s*\{\s*display:\s*none\s*;/,
    );
    expect(INDEX_HTML).toContain('id="hud" data-mobile-open="false"');
    expect(INDEX_HTML).toContain('id="mobile-hud-toggle"');
    expect(INDEX_HTML).toContain(
      'aria-controls="household-roster needs-panel people-panel time-controls game-actions"',
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
