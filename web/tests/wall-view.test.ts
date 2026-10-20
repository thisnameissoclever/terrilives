import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WallView, WallViewControls } from '../src/ui/wall-view.js';
import { shortcutGroups } from '../src/ui/shortcuts.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

/** The Low and Full buttons as the panel declares them, with only what the controls use. */
function page() {
  const listeners = new Map<string, () => void>();
  const buttons = new Map<string, { attributes: Map<string, string>; setAttribute(name: string, value: string): void;
    addEventListener(type: string, listener: () => void): void }>();
  for (const prefix of ['wall', 'room']) for (const height of ['low', 'full']) {
    const id = `${prefix}-height-${height}`;
    const attributes = new Map<string, string>();
    buttons.set(id, { attributes, setAttribute: (name, value) => { attributes.set(name, value); },
      addEventListener: (_type, listener) => { listeners.set(id, listener); } });
  }
  const document = { querySelector: (selector: string) => buttons.get(selector.slice(1)) ?? null } as unknown as Document;
  return { document, buttons, click: (id: string) => listeners.get(id)!() };
}

describe('the wall height ([WB-height])', () => {
  it('starts low, and toggles between low and full, saying when it changed', () => {
    let changes = 0;
    const view = new WallView(() => { changes += 1; });
    expect(view.height).toBe('low');
    view.toggle();
    expect([view.height, changes]).toEqual(['full', 1]);
    view.set('full');
    expect(changes).toBe(1);
    view.toggle();
    expect([view.height, changes]).toEqual(['low', 2]);
  });

  it('presses the button for the current height in both panels', () => {
    const { document, buttons, click } = page();
    let controls: WallViewControls | undefined;
    const view = new WallView(() => controls?.render());
    controls = new WallViewControls(document, view, ['wall', 'room']);
    const pressed = () => [...buttons].filter(([, button]) => button.attributes.get('aria-pressed') === 'true').map(([id]) => id);
    expect(pressed()).toEqual(['wall-height-low', 'room-height-low']);
    click('room-height-full');
    expect(view.height).toBe('full');
    expect(pressed()).toEqual(['wall-height-full', 'room-height-full']);
  });

  it('is declared in both panels, listed with the shortcuts and wired into the page', () => {
    for (const id of ['wall-height-low', 'wall-height-full', 'room-height-low', 'room-height-full']) {
      expect(INDEX_HTML.split(`id="${id}"`)).toHaveLength(2);
    }
    for (const tool of ['walls', 'room'] as const) {
      expect(shortcutGroups(tool, []).flatMap(group => group.rows).some(row => row.keys.includes('T'))).toBe(true);
    }
    expect(MAIN_TS).toContain("new WallViewControls(document, wallView, ['wall', 'room'])");
    expect(MAIN_TS).toContain("event.key.toLowerCase() === 't' && (wallTool.active || roomTool.active)");
  });
});
