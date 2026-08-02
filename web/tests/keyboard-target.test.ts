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

  it('copies WASM views before a label lookup can detach them', () => {
    const ids = new Uint32Array([2, 4, 7, 9]);
    const kinds = new Uint32Array([1, 0, 1, 0]);
    let detached = false;
    const detachViews = () => {
      if (detached) return;
      detached = true;
      structuredClone(null, { transfer: [ids.buffer, kinds.buffer] });
    };
    const growingSource: KeyboardTargetSource = {
      ...source(),
      ids: () => ids,
      kinds: () => kinds,
      simName: (entity) => {
        detachViews();
        return ({ 4: 'Terri', 9: 'Nadia' })[entity] ?? '';
      },
      objectName: (entity) => {
        detachViews();
        return ({ 2: 'Fridge', 7: 'Rug' })[entity] ?? '';
      },
    };

    expect(keyboardTargets(growingSource)).toEqual([
      { entity: 2, kind: 'object', label: 'Fridge' },
      { entity: 4, kind: 'person', label: 'Terri' },
      { entity: 9, kind: 'person', label: 'Nadia' },
    ]);
    expect(ids.byteLength).toBe(0);
    expect(kinds.byteLength).toBe(0);
  });

  it('wraps in both directions and announces the chosen target', () => {
    const status = { hidden: true, textContent: '' };
    const picker = new KeyboardTargetController(source(), status);
    expect(picker.cycle(-1)?.label).toBe('Nadia');
    expect(picker.cycle(1)?.label).toBe('Fridge');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('Target: Fridge. Enter opens actions.');
    picker.cycle(1);
    expect(status.textContent).toBe(
      'Target: Terri. Space selects this person; Enter selects or opens social actions.',
    );
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

  it('clears the armed entity and its visible status', () => {
    const status = { hidden: true, textContent: '' };
    const picker = new KeyboardTargetController(source(), status);
    expect(picker.cycle(1)?.label).toBe('Fridge');

    picker.clear();

    expect(picker.current()).toBeNull();
    expect(status).toEqual({ hidden: true, textContent: '' });
  });
});
