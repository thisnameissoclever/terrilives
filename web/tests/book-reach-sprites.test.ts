import { describe, expect, it } from 'vitest';
import { bookReachFrame, bookReachPhase, packBookReachShelves, type BookReachProfile } from '../src/render/book-reach-sprites.js';
import { InteractionSelection, type InteractionColumns } from '../src/render/interaction-sprites.js';
import { packPresentationLayers } from '../src/render/visible-scene-layers.js';
import { packShelfLayers } from '../src/render/shelf-sprites.js';

describe('owned book reach presentation', () => {
  it('uses saved action progress rather than the global animation clock', () => {
    expect([8, 7, 6, 4, 2, 0].map(remaining => bookReachPhase(remaining, 8, 4)))
      .toEqual([0, 0, 1, 2, 3, 3]);
    expect(bookReachPhase(1, 1, 4)).toBe(0);
    expect(() => bookReachPhase(2, 1, 4)).toThrow();
    expect(() => bookReachPhase(0, 0, 4)).toThrow();
  });

  it('selects the exact shelf slot and return stage independently of copy identity', () => {
    const scene = { sprite: 73, alpha: 5, owners: [{ coverage: 6, marker: [0, 0] as const }] };
    const frame = { scene, suppressStock: true };
    const profile: BookReachProfile = { model: 'bookcase', slots: 24, phases: 4,
      scenes: { '7:23:2:1': frame } };
    expect(bookReachFrame(profile, 7, 23, 4, 8, 1)).toBe(frame);
    expect(() => bookReachFrame(profile, 6, 23, 4, 8, 1)).toThrow('missing');
    expect(() => bookReachFrame(profile, 7, 22, 4, 8, 1)).toThrow('missing');
    expect(() => bookReachFrame(profile, 7, 24, 4, 8, 1)).toThrow('invalid');
  });

  it('draws copy zero once and restores stock visibility when the journey changes', () => {
    const absent = 0xffffffff;
    const scene = { sprite: 73, alpha: 5, owners: [{ coverage: 6, marker: [0, 0] as const }] };
    const selection = new InteractionSelection({}, () => 'green', {}, {}, {}, {}, {}, {
      10: { model: 'bookcase', slots: 24, phases: 4,
        scenes: { '6:23:2:0': { scene, suppressStock: true },
          '7:23:2:0': { scene, suppressStock: false } } },
    });
    const columns: InteractionColumns = { count: 2,
      ids: new Uint32Array([40, 90]), kinds: new Uint32Array([0, 1]),
      sprites: new Uint32Array([1, 10]), actions: new Uint32Array(2), activities: new Uint32Array(2),
      readingStages: new Uint32Array([6, 0]), readingCopies: new Uint32Array([0, absent]),
      readingHomeShelves: new Uint32Array([90, absent]), readingHomeSlots: new Uint32Array([23, absent]),
      readingReachRemaining: new Uint32Array([4, 0]), readingReachTotals: new Uint32Array([8, 0]),
    };
    selection.update(columns, 9000, false);
    expect(Array.from(selection.targetRows)).toEqual([1, 1]);
    expect(Array.from(selection.suppressed)).toEqual([0, 1]);
    expect(selection.bedScenes[0]).toBe(scene);
    expect(selection.shelfMask(1, 0xffffff)).toBe(0x7fffff);
    selection.update(columns, 0, true);
    expect(selection.bedScenes[0]).toBe(scene);
    columns.readingStages![0] = 7;
    selection.update(columns, 9000, false);
    expect(selection.shelfMask(1, 0)).toBe(1 << 23);
    columns.readingStages![0] = 2;
    selection.update(columns, 9001, false);
    expect(selection.shelfMask(1, 0xffffff)).toBe(0xffffff);
    expect(selection.bedScenes[0]).toBeUndefined();
    expect(selection.suppressed[1]).toBe(0);
    expect(selection.shelfMask(1, 0)).toBe(0);
  });

  it('combines dynamic shelf contents with a separate reach silhouette and registered occlusion', () => {
    const shared = packPresentationLayers(8, {}, { 6: [0, 1, -1, -1, 2] }, { 6: 9 });
    const shelves = packShelfLayers(shared, 8, {
      5: { base: 4, rows: Array.from({ length: 256 }, () => [-1, -1] as const) },
    });
    const stock: [number, number][] = Array.from({ length: 256 }, () => [-1, -1]);
    const correction: [number, number][] = Array.from({ length: 256 }, () => [-1, -1]);
    stock[63] = [1, 2]; correction[63] = [3, 4];
    const packed = packBookReachShelves(shelves, 8, { tables: [stock, correction],
      scenes: { 6: { stock: 0, correction: 1, canvas: [96, 120], offset: [-8.5, 12.25] } } });
    const start = (packed[6 * 8 + 5] - 1) * 8;
    const stockStart = (packed[start] - 1 + 63) * 8;
    const correctionStart = (packed[start + 1] - 1 + 63) * 8;
    expect(Array.from(packed.slice(stockStart, stockStart + 2))).toEqual([2, 3]);
    expect(Array.from(packed.slice(correctionStart, correctionStart + 2))).toEqual([4, 5]);
    expect(Array.from(new Float32Array(packed.buffer).slice(start + 2, start + 4))).toEqual([96, 120]);
    expect(packed[start + 6]).toBe(10);
    expect(Array.from(new Float32Array(packed.buffer).slice(start + 4, start + 6))).toEqual([-8.5, 12.25]);
    expect(Array.from(packed.slice(6 * 8, 6 * 8 + 5))).toEqual(Array.from(shared.slice(6 * 8, 6 * 8 + 5)));
    expect(() => packBookReachShelves(shelves, 8, { tables: [stock],
      scenes: { 6: { stock: 1, canvas: [96, 120], offset: [0, 0] } } })).toThrow('invalid');
  });
});
