import { describe, expect, it } from 'vitest';
import { FloorFinishResources } from '../src/render/floor-finish-resources.js';

function fixture() {
  const pending: { keys: readonly string[]; resolve(value: string): void; reject(error: Error): void }[] = [];
  const published: string[] = [], disposed: string[] = [];
  const states: [boolean, string | null][] = [];
  const manager = new FloorFinishResources<string>({
    prepare: keys => new Promise((resolve, reject) => pending.push({ keys, resolve, reject })),
    publish: value => { published.push(value); }, dispose: value => { disposed.push(value); },
    state: (ready, error) => { states.push([ready, error]); },
  });
  manager.request([]);
  return { manager, pending, published, disposed, states };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('active floor resource replacement', () => {
  it('retains starter resources, canonicalizes sets and publishes only once', async () => {
    const f = fixture();
    expect(f.pending).toHaveLength(0);
    f.manager.request(['blue', 'boards', 'blue']);
    f.manager.request(['boards', 'blue']);
    expect(f.pending).toHaveLength(1);
    expect(f.pending[0].keys).toEqual(['blue', 'boards']);
    expect(f.states.at(-1)).toEqual([false, null]);
    f.pending[0].resolve('replacement');
    await flush();
    expect(f.published).toEqual(['replacement']);
    expect(f.states.at(-1)).toEqual([true, null]);
    f.manager.request(['blue', 'boards']);
    expect(f.pending).toHaveLength(1);
  });
  it('disposes stale results before starting the latest selection after load or another choice', async () => {
    const f = fixture();
    f.manager.request(['old']);
    f.manager.request(['intermediate']);
    f.manager.request(['loaded']);
    expect(f.pending).toHaveLength(1);
    f.pending[0].resolve('obsolete');
    await flush();
    expect(f.disposed).toEqual(['obsolete']);
    expect(f.published).toEqual([]);
    expect(f.pending[1].keys).toEqual(['loaded']);
    f.pending[1].resolve('latest');
    await flush();
    expect(f.published).toEqual(['latest']);
  });
  it('reports failure without replacing the current renderer or retrying every frame', async () => {
    const f = fixture();
    f.manager.request(['bad']);
    f.pending[0].reject(new Error('resource unavailable'));
    await flush();
    expect(f.states.at(-1)).toEqual([false, 'resource unavailable']);
    f.manager.request(['bad']);
    expect(f.pending).toHaveLength(1);
    expect(f.published).toEqual([]);
    f.manager.request([]);
    expect(f.states.at(-1)).toEqual([true, null]);
  });
  it('disposes an obsolete result even when the choice returns to the currently ready resources', async () => {
    const f = fixture();
    f.manager.request(['other']);
    f.manager.request([]);
    f.pending[0].resolve('obsolete');
    await flush();
    expect(f.disposed).toEqual(['obsolete']);
    expect(f.pending).toHaveLength(1);
    expect(f.states.at(-1)).toEqual([true, null]);
  });
  it('treats the finishes loaded with the first renderer as already resident', async () => {
    const states: [boolean, string | null][] = [];
    const prepared: (readonly string[])[] = [];
    const manager = new FloorFinishResources<string>({
      prepare: keys => { prepared.push(keys); return Promise.resolve('unused'); },
      publish: () => {}, dispose: () => {},
      state: (ready, error) => { states.push([ready, error]); },
    }, ['boards', 'blue', 'boards']);
    manager.request(['blue', 'boards']);
    await flush();
    expect(prepared).toEqual([]);
    expect(states).toEqual([[true, null]]);
    manager.request(['blue', 'boards', 'carpet']);
    await flush();
    expect(prepared).toEqual([['blue', 'boards', 'carpet']]);
  });
});
