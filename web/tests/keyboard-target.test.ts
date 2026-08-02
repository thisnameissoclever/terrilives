import { describe, expect, it } from 'vitest';

import {
  KeyboardTargetController,
  keyboardTargets,
  type KeyboardTargetSource,
} from '../src/ui/keyboard-target.js';

function source(selected: number | null = 4): KeyboardTargetSource {
  return {
    count: 4,
    ids: () => new Uint32Array([2, 4, 7, 9]),
    kinds: () => new Uint32Array([1, 0, 1, 0]),
    simName: (entity) => ({ 4: 'Terri', 9: 'Nadia' })[entity] ?? '',
    objectName: (entity) => ({ 2: 'Fridge', 7: 'Rug' })[entity] ?? '',
    interactionLabels: (entity) => (entity === 2 ? ['Grab a snack'] : []),
    socialLabels: () => ['Talk'],
    selectedIndex: () => selected,
  };
}

describe('keyboard targets', () => {
  it('includes named people and actionable objects only', () => {
    expect(keyboardTargets(source())).toEqual([
      { entity: 2, kind: 'object', label: 'Fridge' },
      { entity: 4, kind: 'person', label: 'Terri' },
      { entity: 9, kind: 'person', label: 'Nadia' },
    ]);
  });

  it('wraps in both directions and announces the chosen target', () => {
    const status = { hidden: true, textContent: '' };
    const picker = new KeyboardTargetController(source(), status);
    expect(picker.cycle(-1)?.label).toBe('Nadia');
    expect(picker.cycle(1)?.label).toBe('Fridge');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toContain('Fridge');
  });

  it('opens object and social actions but selects the current person', () => {
    const picker = new KeyboardTargetController(source(), {
      hidden: true,
      textContent: '',
    });
    picker.cycle(1);
    expect(picker.activate()).toMatchObject({ kind: 'menu' });
    picker.cycle(1);
    expect(picker.activate()).toEqual({ kind: 'select', entity: 4, label: 'Terri' });
    picker.cycle(1);
    expect(picker.activate()).toMatchObject({ kind: 'menu' });
  });
});
