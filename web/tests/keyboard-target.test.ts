import { describe, expect, it } from 'vitest';

import {
  KeyboardTargetController,
  keyboardTargets,
  reportKeyboardSelection,
  type KeyboardTargetSource,
} from '../src/ui/keyboard-target.js';
import { surfaceMenuEntries } from '../src/ui/object-menu.js';

function source(selected: number | null = 4): KeyboardTargetSource {
  return {
    count: 4,
    ids: () => new Uint32Array([2, 4, 7, 9]),
    kinds: () => new Uint32Array([1, 0, 1, 0]),
    simName: (entity) => ({ 4: 'Terri', 9: 'Nadia' })[entity] ?? '',
    objectName: (entity) => ({ 2: 'Fridge', 7: 'Rug' })[entity] ?? '',
    entityName: (entity) =>
      ({ 2: 'Fridge', 4: 'Terri', 7: 'Rug', 9: 'Nadia' })[entity] ?? '',
    interactionLabels: (entity) => (entity === 2 ? ['Grab a snack'] : []),
    socialLabels: () => ['Talk'],
    selectedIndex: () => selected,
  };
}

describe('keyboard targets', () => {
  it('preserves owned-title choices beside chores in pointer and keyboard menus', () => {
    const readingSource: KeyboardTargetSource = {
      ...source(),
      interactionLabels: id => id === 2 ? ['Sit'] : [],
      readingChoices: id => id === 2 ? { notice: 'Choose a title.', entries: [{
        label: 'Read Test title',
        action: { kind: 'read', object: 2, action: 'read_available', title: 'title_a' },
      }] } : undefined,
      choreOptions: id => id === 2 ? new Uint32Array([2, 2]) : new Uint32Array(),
    };
    const pointer = surfaceMenuEntries(readingSource, 2);
    const picker = new KeyboardTargetController(readingSource, { hidden: true, textContent: '' });
    picker.cycle(1);
    expect(picker.activate()).toEqual({ kind: 'menu', menu: pointer });
    expect(pointer.readingNotice).toBe('Choose a title.');
    expect(pointer.entries.map(entry => entry.action)).toEqual([
      { kind: 'use', object: 2, interaction: 0 },
      { kind: 'read', object: 2, action: 'read_available', title: 'title_a' },
      { kind: 'chore', choreKind: 2, target: 2 },
      { kind: 'cancel' },
    ]);
  });
  it('includes dirty counters and each dish pile, using the same scoped menus as pointer input', () => {
    const dirty = { ...source(), dishPiles: () => new Uint32Array([7, 0, 10, 7, 0, 11, 7, 2, 12]) };
    const targets = keyboardTargets(dirty);
    expect(targets.filter(t => t.entity === 7).map(t => t.kind)).toEqual(['object', 'dishes', 'dishes']);
    const picker = new KeyboardTargetController(dirty, { hidden: true, textContent: '' });
    picker.cycle(1); picker.cycle(1); picker.cycle(1);
    expect(picker.activate()).toMatchObject({ kind: 'menu', menu: { entries: [{ label: 'Clean up', action: { kind: 'clean', surface: 7, dishes: null } }, { label: 'Nothing' }] } });
    picker.cycle(1);
    expect(picker.activate()).toMatchObject({ kind: 'menu', menu: { entries: [{ label: 'Do dishes', action: { kind: 'clean', surface: 7, dishes: [10, 11] } }, { label: 'Nothing' }] } });
    picker.cycle(1);
    expect(picker.activate()).toMatchObject({ kind: 'menu', menu: { entries: [{ action: { kind: 'clean', dishes: [12] } }, { label: 'Nothing' }] } });
  });
  it('opens descriptions for decorative objects without inventing actions', () => {
    const details = { modelName: 'Home Wash', description: 'Decorative washing machine.' };
    const described = { ...source(), objectDetails: (id: number) => id === 7 ? details : undefined };
    expect(keyboardTargets(described).map(target => target.entity)).toEqual([2, 4, 7, 9]);
    const picker = new KeyboardTargetController(described, { hidden: true, textContent: '' });
    picker.cycle(1);
    picker.cycle(1);
    picker.cycle(1);
    expect(picker.activate()).toMatchObject({ kind: 'menu', menu: { title: 'Rug', details,
      entries: [{ action: { kind: 'cancel' } }] } });
  });
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
    expect(status.textContent).toBe('Target: Fridge.');
    picker.cycle(1);
    expect(status.textContent).toBe(
      'Target: Terri.',
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

  it('announces accepted and rejected keyboard selection attempts', () => {
    const status = { hidden: true, textContent: '' };

    reportKeyboardSelection(status, 'Terri', true);
    expect(status).toEqual({ hidden: false, textContent: 'Selected Terri' });

    reportKeyboardSelection(status, 'Nadia', false);
    expect(status).toEqual({
      hidden: false,
      textContent: 'That person could not be selected',
    });
  });
});
