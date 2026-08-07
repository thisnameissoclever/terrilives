import { describe, expect, it } from 'vitest';

import { LightingMode, type LightingModeButton } from '../src/ui/lighting-mode.js';
import type { PreferenceStore } from '../src/ui/help-panel.js';

interface ButtonState extends LightingModeButton {
  readonly attributes: Map<string, string>;
}

function button(): ButtonState {
  const attributes = new Map<string, string>();
  return {
    textContent: null,
    disabled: false,
    attributes,
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
}

function stored(value: string | null): PreferenceStore {
  return {
    getItem: () => value,
    setItem() {},
  };
}

describe('LightingMode', () => {
  it('starts in automatic lighting without a saved preference', () => {
    const surface = button();
    const mode = new LightingMode(surface);

    expect(mode.isFlat()).toBe(false);
    expect(surface.textContent).toBe('Light: auto');
    expect(surface.attributes.get('aria-pressed')).toBe('false');
    expect(surface.disabled).toBe(false);
  });

  it("restores only the exact persisted '1' as flat lighting", () => {
    for (const [value, expectedFlat] of [
      ['1', true],
      ['0', false],
      ['true', false],
      ['', false],
      [null, false],
    ] as const) {
      const surface = button();
      const mode = new LightingMode(surface, stored(value));

      expect(mode.isFlat(), `stored value ${String(value)}`).toBe(expectedFlat);
      expect(surface.textContent).toBe(
        expectedFlat ? 'Light: flat' : 'Light: auto',
      );
      expect(surface.attributes.get('aria-pressed')).toBe(String(expectedFlat));
      expect(surface.disabled).toBe(false);
    }
  });

  it('toggles the session state and writes the versioned preference', () => {
    const surface = button();
    const writes: Array<readonly [string, string]> = [];
    const store: PreferenceStore = {
      getItem: () => null,
      setItem(key, value) {
        writes.push([key, value]);
      },
    };
    const mode = new LightingMode(surface, store);

    expect(mode.toggle()).toBe(true);
    expect(surface.textContent).toBe('Light: flat');
    expect(surface.attributes.get('aria-pressed')).toBe('true');
    expect(writes).toEqual([['terrilives.lighting-mode.v1', '1']]);

    expect(mode.toggle()).toBe(false);
    expect(surface.textContent).toBe('Light: auto');
    expect(surface.attributes.get('aria-pressed')).toBe('false');
    expect(writes).toEqual([
      ['terrilives.lighting-mode.v1', '1'],
      ['terrilives.lighting-mode.v1', '0'],
    ]);
  });

  it('keeps working for the session when preference reads and writes are blocked', () => {
    const surface = button();
    const blocked: PreferenceStore = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    };
    const mode = new LightingMode(surface, blocked);

    expect(mode.isFlat()).toBe(false);
    expect(mode.toggle()).toBe(true);
    expect(mode.isFlat()).toBe(true);
    expect(surface.textContent).toBe('Light: flat');
    expect(surface.attributes.get('aria-pressed')).toBe('true');
    expect(surface.disabled).toBe(false);

    expect(mode.toggle()).toBe(false);
    expect(surface.textContent).toBe('Light: auto');
    expect(surface.attributes.get('aria-pressed')).toBe('false');
  });

  it('forces, disables, and then restores automatic lighting for reduced motion', () => {
    const surface = button();
    const writes: Array<readonly [string, string]> = [];
    const store: PreferenceStore = {
      getItem: () => null,
      setItem(key, value) {
        writes.push([key, value]);
      },
    };
    const mode = new LightingMode(surface, store);

    mode.setSystemFlat(true);
    expect(mode.isFlat()).toBe(true);
    expect(surface.textContent).toBe('Light: flat');
    expect(surface.attributes.get('aria-pressed')).toBe('true');
    expect(surface.disabled).toBe(true);

    expect(mode.toggle()).toBe(true);
    expect(writes).toEqual([]);
    expect(surface.textContent).toBe('Light: flat');
    expect(surface.disabled).toBe(true);

    mode.setSystemFlat(false);
    expect(mode.isFlat()).toBe(false);
    expect(surface.textContent).toBe('Light: auto');
    expect(surface.attributes.get('aria-pressed')).toBe('false');
    expect(surface.disabled).toBe(false);
  });

  it('preserves a saved flat choice across a temporary system constraint', () => {
    const surface = button();
    let writes = 0;
    const store: PreferenceStore = {
      getItem: () => '1',
      setItem() {
        writes += 1;
      },
    };
    const mode = new LightingMode(surface, store);

    mode.setSystemFlat(true);
    expect(mode.toggle()).toBe(true);
    expect(writes).toBe(0);

    mode.setSystemFlat(false);
    expect(mode.isFlat()).toBe(true);
    expect(surface.textContent).toBe('Light: flat');
    expect(surface.attributes.get('aria-pressed')).toBe('true');
    expect(surface.disabled).toBe(false);
  });
});
