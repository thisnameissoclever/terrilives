import { describe, expect, it } from 'vitest';
import { AppearanceDraft, neutralAppearance, parseAppearance } from '../src/render/character/appearance.js';
import { shapePoint } from '../src/render/character/shape.js';

describe('appearance proof record', () => {
  it('restores the next random draw, locks, and undo history with a draft', () => {
    const first = new AppearanceDraft(199);
    first.randomize(); first.locks.add('build'); first.randomize();
    const restored = AppearanceDraft.restore(first.serialize());
    expect(restored.value).toEqual(first.value); expect([...restored.locks]).toEqual([...first.locks]);
    first.undo(); restored.undo(); expect(restored.value).toEqual(first.value);
    first.randomize(); restored.randomize(); expect(restored.value).toEqual(first.value);
  });
  it('loads exact saved values without making random draws', () => {
    const a = neutralAppearance(); a.height = 17.125; a.build = 96;
    const encoded = JSON.stringify(a);
    expect(new AppearanceDraft(128, parseAppearance(encoded)).value).toEqual(a);
    expect(JSON.stringify(parseAppearance(encoded))).toBe(encoded);
  });
  it('rejects malformed records instead of substituting a default', () => {
    for (const patch of [{ version: 2 }, { height: null }, { build: 101 }, { hairstyle: 'missing' }, { skin: '#xyzxyz' }]) {
      expect(() => parseAppearance(JSON.stringify({ ...neutralAppearance(), ...patch }))).toThrow();
    }
  });
  it('reproduces seeded draws and keeps all locked fields through randomization and undo', () => {
    const a = new AppearanceDraft(177), b = new AppearanceDraft(177);
    expect(a.value).toEqual(b.value);
    a.locks.add('height'); a.locks.add('skin');
    const before = { ...a.value };
    a.randomize(); expect(a.value.height).toBe(before.height); expect(a.value.skin).toBe(before.skin);
    expect(a.value).not.toEqual(before);
    a.undo(); expect(a.value).toEqual(before);
    a.randomize(['height']); expect(a.value).toEqual(before);
  });
  it('draws both presentations and numeric extremes without touching global random', () => {
    const draft = new AppearanceDraft(131);
    const seen = new Set<string>(), heights = new Set<number>();
    for (let i = 0; i < 2000; i++) { draft.randomize(); seen.add(draft.value.presentation); heights.add(draft.value.height); }
    expect(seen.size).toBe(2); expect(heights.has(0)).toBe(true); expect(heights.has(100)).toBe(true);
  });
});

describe('actual rest geometry deformation', () => {
  it('has no trouser jump at the anatomical hip transition', () => {
    for (const presentation of ['masculine', 'feminine'] as const) for (const build of [0, 50, 100]) {
      const a = { ...neutralAppearance(), presentation, build };
      const below = shapePoint([.18, .08, .78-.000001], 3, a);
      const above = shapePoint([.18, .08, .78+.000001], 3, a);
      expect(Math.hypot(...above.map((v, i) => v-below[i]))).toBeLessThan(.00001);
    }
  });
  it('keeps the pelvis centreline continuous and centred when changing build', () => {
    for (const presentation of ['masculine', 'feminine'] as const) for (const build of [0, 50, 100]) {
      const a = { ...neutralAppearance(), presentation, build };
      const left=shapePoint([-.000001,.08,.76],3,a),right=shapePoint([.000001,.08,.76],3,a);
      expect(right[0]-left[0]).toBeLessThan(.00001);
      expect(shapePoint([0,0,.86],3,a)[0]).toBe(0);
    }
  });
  it('keeps neutral masculine positions unchanged and changes intermediate values continuously', () => {
    const a = neutralAppearance(); const p = [0.22, -0.12, 1.15] as const;
    expect(shapePoint(p, 2, a)).toEqual(p);
    const x0 = shapePoint(p, 2, { ...a, build: 50 })[0];
    const x1 = shapePoint(p, 2, { ...a, build: 50.1 })[0];
    const x2 = shapePoint(p, 2, { ...a, build: 51 })[0];
    expect(x1).toBeGreaterThan(x0); expect(x2).toBeGreaterThan(x1);
    expect(x1 - x0).toBeCloseTo((x2 - x0) / 10, 6);
  });
  it('preserves head size and anchors the soles while varying standing height', () => {
    const a = { ...neutralAppearance(), height: 100 };
    const top = shapePoint([0, 0, 2.1], 1, a), low = shapePoint([0, 0, 1.5], 1, a);
    expect(top[2] - low[2]).toBeCloseTo(.6, 6);
    expect(shapePoint([.12, 0, 0], 6, a)[2]).toBe(0);
    expect(top[2]).toBeCloseTo(2.1 * 1.15, 6);
  });
  it('supports all 18 preset/height/build combinations without unrelated color changes', () => {
    for (const presentation of ['masculine', 'feminine'] as const) for (const height of [0, 50, 100]) for (const build of [0, 50, 100]) {
      const a = { ...neutralAppearance(), presentation, height, build };
      const saved = JSON.stringify(a);
      for (const region of [1, 2, 3, 4, 6, 8, 9]) expect(shapePoint([.15, -.1, 1.2], region, a).every(Number.isFinite)).toBe(true);
      expect(JSON.stringify(a)).toBe(saved);
    }
  });
});
