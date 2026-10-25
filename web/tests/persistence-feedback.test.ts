import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveStore } from '../src/storage/save-store.js';
import { SceneFeedback, operationFeedback } from '../src/ui/operation-feedback.js';
import { PersistenceSceneFeedback } from '../src/ui/persistence-feedback.js';
import { PersistenceController, type PersistenceFeedbackEvent } from '../src/ui/persistence-controller.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((pass, fail) => { resolve = pass; reject = fail; });
  return { promise, resolve, reject };
}

function fixture() {
  const attributes = new Map<string, string>([['role', 'status'], ['aria-live', 'polite']]);
  const element = { textContent: '', dataset: {} as Record<string, string>, style: {} as Record<string, string>,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    getAttribute: (name: string) => attributes.get(name) ?? null };
  const hintAttributes = new Map<string, string>();
  const hint = { hidden: true, textContent: '',
    setAttribute: (name: string, value: string) => hintAttributes.set(name, value),
    removeAttribute: (name: string) => hintAttributes.delete(name) };
  const scene = new SceneFeedback(element as unknown as HTMLElement);
  const presentation = new PersistenceSceneFeedback(scene, hint);
  const events: PersistenceFeedbackEvent[] = [];
  const game = { tick: 0, acceptsLoad: true, saveBytes: () => new Uint8Array([1, 2, 3]),
    loadBytes: () => game.acceptsLoad, clockTick: () => game.tick, dayTicks: () => 100 };
  const store: SaveStore = { save: vi.fn(async () => {}), load: vi.fn(async () => new Uint8Array([1])),
    clear: vi.fn(async () => {}), close: vi.fn() };
  const controller = new PersistenceController(store, game, hint, vi.fn(), undefined, event => {
    events.push(event); presentation.present(event);
  });
  return { attributes, hintAttributes, element, hint, scene, events, game, store, controller };
}

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(performance, 'now').mockReturnValue(0); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('persistence presentation through the real controller and scene', () => {
  it('keeps startup outcomes and both automatic entry points quiet without a legacy publisher', async () => {
    for (const saved of [null, new Uint8Array([1])]) {
      const f = fixture(); f.store.load = vi.fn(async () => saved);
      f.scene.present('build', operationFeedback('place', 'failure', 'Chair', 'Occupied.'));
      await f.controller.restoreAtStartup();
      expect(f.events.at(-1)).toMatchObject({ operation: 'restore', state: 'success', automatic: false });
      f.game.tick = 100; f.controller.updateAutosave();
      await Promise.resolve(); await Promise.resolve();
      expect(f.events.at(-1)).toMatchObject({ operation: 'save', state: 'success', automatic: true });
      await f.controller.saveAutomatically();
      expect(f.element.textContent).toBe('Occupied.');
      expect(f.hint.textContent).toBe(''); expect(f.hint.hidden).toBe(true);
      expect(f.hintAttributes.size).toBe(0); expect(f.attributes.has('aria-busy')).toBe(false);
      expect(f.attributes.has('data-pending')).toBe(false);
    }
  });

  it('treats custom manual text literally and expires only its useful success after four seconds', async () => {
    const f = fixture();
    const published = vi.spyOn(f.scene, 'present');
    await f.controller.save('Autosaved');
    expect(published.mock.calls.at(-1)?.[2]).toBeNull();
    expect(f.events.at(-1)).toMatchObject({ automatic: false, state: 'success', message: 'Autosaved' });
    expect(f.element.textContent).toBe('Autosaved');
    f.scene.frame(3999); expect(f.element.textContent).toBe('Autosaved');
    f.scene.frame(4000); expect(f.element.textContent).toBe('');
    expect(f.attributes.get('role')).toBe('status'); expect(f.attributes.get('aria-live')).toBe('polite');
  });

  it.each(['save', 'clear'] as const)('delays the %s spinner to 1.25 seconds and clears it on completion', async operation => {
    const f = fixture(), waiting = deferred<void>(); f.store[operation] = vi.fn(() => waiting.promise);
    const result = f.controller[operation]();
    expect(f.element.dataset.state).toBe('pending'); expect(f.attributes.get('aria-busy')).toBe('true');
    expect(f.hintAttributes.size).toBe(0);
    vi.advanceTimersByTime(1249); expect(f.attributes.has('data-pending')).toBe(false);
    vi.advanceTimersByTime(1); expect(f.attributes.get('data-pending')).toBe('true');
    waiting.resolve(); expect(await result).toBe(true);
    expect(f.attributes.has('data-pending')).toBe(false); expect(f.attributes.has('aria-busy')).toBe(false);
    if (operation === 'clear') expect(f.element.textContent).toBe('');
  });

  it.each(['save', 'clear'] as const)('cancels the delayed %s spinner when storage settles before its delay', async operation => {
    const f = fixture(); await f.controller[operation](); vi.advanceTimersByTime(2000);
    expect(f.attributes.has('data-pending')).toBe(false); expect(f.attributes.has('aria-busy')).toBe(false);
  });

  it('shows Load immediately through preparation, with no publication for overlapping attempts', async () => {
    const f = fixture(), waiting = deferred<Uint8Array | null>(); f.store.load = () => waiting.promise;
    const result = f.controller.load();
    expect(f.attributes.get('data-pending')).toBe('true');
    expect(f.controller.controlState().confirmationDisabled).toBe(true);
    expect(await f.controller.save()).toBe(false); expect(await f.controller.clear()).toBe(false);
    expect(f.events).toHaveLength(1);
    waiting.resolve(new Uint8Array([1])); expect(await result).toBe(true);
    expect(f.attributes.has('data-pending')).toBe(false);
    expect(f.controller.controlState().confirmationDisabled).toBe(false);
  });

  it.each(['save', 'clear'] as const)('removes the %s spinner on failure and retains the supported remedy', async operation => {
    const f = fixture(), waiting = deferred<void>(); f.store[operation] = () => waiting.promise;
    const result = f.controller[operation](); vi.advanceTimersByTime(1250);
    waiting.reject(new Error('Disk unavailable')); expect(await result).toBe(false);
    expect(f.attributes.has('data-pending')).toBe(false); expect(f.attributes.has('aria-busy')).toBe(false);
    expect(f.element.dataset.state).toBe('failure');
    expect(f.element.textContent).toContain(operation === 'save' ? 'Try again' : 'Try New game again');
    f.scene.frame(99000); expect(f.element.textContent).not.toBe('');
  });

  it('keeps protected startup failure in the scene and a non-live hint beside recovery controls', async () => {
    const f = fixture(); f.game.acceptsLoad = false;
    expect(await f.controller.restoreAtStartup()).toBe('invalid');
    expect(f.events.at(-1)).toMatchObject({ operation: 'restore', state: 'failure', savingPaused: true });
    const failure = f.element.textContent;
    expect(failure).toContain('Saving paused. Retry Load or confirm New game');
    expect(f.hint).toMatchObject({ hidden: false, textContent: failure }); expect(f.hintAttributes.size).toBe(0);
    f.scene.present('build', operationFeedback('place', 'failure', 'Chair', 'Occupied.'));
    expect(f.hint.textContent).toBe(failure);
    expect(await f.controller.saveAutomatically()).toBe(false);
    f.game.acceptsLoad = true; expect(await f.controller.load()).toBe(true);
    expect(f.hint).toMatchObject({ hidden: true, textContent: '' });
    expect(f.element.textContent).toBe('Saved game loaded');
  });

  it('retains protection through failed clear and releases the hint on successful clear', async () => {
    const f = fixture(); f.game.acceptsLoad = false; await f.controller.load();
    f.store.clear = async () => { throw new Error('Disk unavailable'); };
    expect(await f.controller.clear()).toBe(false);
    expect(f.hint.hidden).toBe(false); expect(f.hint.textContent).toContain('Saving paused');
    expect(f.element.textContent).toContain('Try New game again');
    f.store.clear = async () => {}; expect(await f.controller.clear()).toBe(true);
    expect(f.hint).toMatchObject({ hidden: true, textContent: '' }); expect(f.element.textContent).toBe('');
  });

  it('resolves a visible Save failure with quiet automatic success', async () => {
    const f = fixture(); f.store.save = async () => { throw new Error('Disk unavailable'); };
    expect(await f.controller.saveAutomatically()).toBe(false);
    expect(f.element.textContent).toBe('Save failed. Try again.');
    f.store.save = async () => {}; expect(await f.controller.saveAutomatically()).toBe(true);
    expect(f.element.textContent).toBe('');
  });

  it.each(['load', 'clear', 'other-owner'] as const)('does not let automatic success erase a superseding %s failure', async next => {
    const f = fixture(); f.store.save = async () => { throw new Error('Disk unavailable'); };
    await f.controller.save();
    if (next === 'load') { f.store.load = async () => null; await f.controller.load(); }
    else if (next === 'clear') { f.store.clear = async () => { throw new Error('Disk unavailable'); }; await f.controller.clear(); }
    else f.scene.present('build', operationFeedback('place', 'failure', 'Chair', 'Occupied.'));
    const failure = f.element.textContent;
    f.store.save = async () => {}; expect(await f.controller.saveAutomatically()).toBe(true);
    expect(f.element.textContent).toBe(failure); expect(f.element.dataset.state).toBe('failure');
  });

  it('moves a manual retry from failure through pending to its real outcome', async () => {
    const f = fixture(); f.store.save = async () => { throw new Error('Disk unavailable'); }; await f.controller.save();
    const waiting = deferred<void>(); f.store.save = () => waiting.promise;
    const retry = f.controller.save(); expect(f.element.textContent).toBe('Saving');
    expect(f.element.dataset.state).toBe('pending');
    waiting.reject(new Error('Disk still unavailable')); expect(await retry).toBe(false);
    expect(f.element.textContent).toBe('Save failed. Try again.'); expect(f.element.dataset.state).toBe('failure');
  });
});

it('keeps the recovery hint out of the clock and live regions, and gives scene spinners one CSS authority', () => {
  const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const hint = markup.match(/<p id="save-status"[^>]*>/)?.[0];
  expect(hint).toBe('<p id="save-status" hidden>');
  const actions = markup.match(/<section id="game-actions"[\s\S]*?<\/section>/)?.[0];
  expect(actions).toContain(hint);
  const css = readFileSync(new URL('../src/ui/build-controls.css', import.meta.url), 'utf8');
  const pendingSelectors = css.match(/\[data-state='pending'\][^,{]*/g);
  expect(pendingSelectors).toEqual(Array(2).fill("[data-state='pending']:not([data-surface='scene'])::before"));
});
