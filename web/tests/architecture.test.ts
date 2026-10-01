import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ARCHITECTURE } from '../src/render/architecture-data.js';
import { architectureSprite, architectureJunction, architectureFloor } from '../src/render/architecture.js';
import { buildArchitectureWallGeometry } from '../src/render/architecture-geometry.js';
import { buildStaticInstances } from '../src/render/tiles.js';
import { WallFade } from '../src/render/wall-fade.js';
import { architectureMode, decodeArchitectureMode } from '../src/render/instances.js';
import { architectureFinishSlot, architectureLocalPoint, prepareArchitectureFinishes,
  type FinishCatalogue } from '../src/render/architecture-finishes.js';
import type { WindowDefinition, WindowModelId } from '../src/architecture/windows.js';

const catalogue: WindowDefinition[] = Array.from({ length: 9 }, (_, index) => ({
  id: (index + 1) as WindowModelId, label: `Window ${index + 1}`,
  width: architectureSprite((index + 1) as WindowModelId, 0, 'front', false)[0].width as 1 | 2 | 3,
}));
const base = { width: 10, height: 10, house: [6, 6] as const,
  edges: new Uint32Array(), windows: [], catalogue, cutaway: false };
const limits = { maxSampledTexturesPerShaderStage: 16, maxTextureDimension2D: 8192,
  maxTextureArrayLayers: 256, maxStorageBufferBindingSize: 128 * 1024 * 1024 };

describe('authored wall geometry', () => {
  it('uses every model at its own span in every real direction and height', () => {
    let forms = 0;
    for (const entry of catalogue) for (const axis of [0, 1] as const) {
      for (const side of ['front', 'back'] as const) for (const cutaway of [false, true]) {
        const pieces = architectureSprite(entry.id, axis, side, cutaway);
        expect(pieces).toHaveLength(entry.width);
        expect(pieces.map(piece => piece.ownedSpan)).toEqual(Array.from({ length: entry.width }, (_, i) => i));
        expect(new Set(pieces.map(piece => piece.source)).size).toBe(1);
        const panels = buildArchitectureWallGeometry({ ...base, side, cutaway,
          windows: [{ axis, x: 2, y: 2, model: entry.id }] }).filter(panel => panel.window);
        expect(panels.map(panel => panel.architectureId)).toEqual(pieces.map(piece => piece.id));
        expect(new Set(panels.map(panel => `${panel.x}/${panel.y}`)).size).toBe(1);
        expect(panels[0].farTiles).toHaveLength(entry.width);
        forms++;
      }
    }
    expect(forms).toBe(72);
  });

  it('suppresses every rear-shell half-arm covered by a window while keeping both outside endpoints', () => {
    for (const axis of [0, 1] as const) {
      const window = { axis, x: axis === 0 ? 0 : 1, y: axis === 0 ? 1 : 0, model: 7 as const };
      const panels = buildArchitectureWallGeometry({ ...base, windows: [window] });
      const solids = panels.filter(panel => !panel.window);
      for (let offset = 1; offset < 3; offset++) {
        expect(solids.filter(panel => panel.x === window.x - .5 + (axis === 1 ? offset : 0)
          && panel.y === window.y - .5 + (axis === 0 ? offset : 0))).toHaveLength(0);
      }
      for (const offset of [0, 3]) {
        const endpoint = solids.filter(panel => panel.x === window.x - .5 + (axis === 1 ? offset : 0)
          && panel.y === window.y - .5 + (axis === 0 ? offset : 0));
        expect(endpoint).toHaveLength(1);
        const descriptor = ARCHITECTURE.sprites[endpoint[0].architectureId! - ARCHITECTURE.baseSpriteId];
        expect(descriptor.kind).toBe('junction');
        if (descriptor.kind === 'junction') {
          expect(descriptor.armHeights[axis === 0 ? (offset === 0 ? 1 : 3) : (offset === 0 ? 0 : 2)]).toBe(0);
        }
      }
    }
  });

  it('keeps rear windows at the shell height while authored windows follow the play cut', () => {
    for (const entry of catalogue) for (const axis of [0, 1] as const) {
      for (const rear of [false, true]) {
        const window = { axis, x: rear && axis === 0 ? 0 : 2,
          y: rear && axis === 1 ? 0 : 2, model: entry.id };
        const panels = buildArchitectureWallGeometry({ ...base, cutaway: true, windows: [window] })
          .filter(panel => panel.window);
        const ids: number[] = architectureSprite(entry.id, axis, 'front', !rear).map(piece => piece.id);
        expect(panels.map(panel => panel.architectureId)).toEqual(ids);
        expect(panels.every(panel => panel.low === !rear)).toBe(true);
        const built = buildStaticInstances({ ...base, windows: new Uint32Array(), walls: new Uint32Array(),
          architecture: { windows: [window], catalogue } }, 0, 0, 16);
        const rows = rear ? built.instances.slice(0, built.count * 16) : built.lowInstances;
        expect(Array.from({ length: rows.length / 16 }, (_, i) => rows[i * 16 + 3])
          .filter(id => ids.includes(id))).toEqual(ids);
      }
    }
  });

  it('selects all80 authored height junctions with one owner per present arm', () => {
    let count = 0;
    for (let code = 1; code < 81; code++) {
      const heights = [code % 3, Math.floor(code / 3) % 3, Math.floor(code / 9) % 3,
        Math.floor(code / 27) % 3] as [number, number, number, number];
      const pieces = architectureJunction(heights);
      expect(pieces.map(piece => piece.ownedSpan)).toEqual(heights.flatMap((height, arm) => height ? [arm] : []));
      expect(pieces.every(piece => piece.kind === 'junction' && piece.armHeights.join() === heights.join())).toBe(true);
      count++;
    }
    expect(count).toBe(80);
    expect(() => architectureJunction([0, 0, 0, 0])).toThrow();
  });

  it('builds every incident-arm mask on both full and cut graph paths', () => {
    const incident = [[1, 2, 2, 0], [0, 2, 2, 0], [1, 1, 2, 0], [0, 2, 1, 0]];
    for (let mask = 1; mask < 16; mask++) for (const cutaway of [false, true]) {
      const edges = Uint32Array.from(incident.flatMap((edge, arm) => mask & (1 << arm) ? edge : []));
      const panels = buildArchitectureWallGeometry({ ...base, edges, cutaway })
        .filter(panel => panel.x === 1.5 && panel.y === 1.5);
      const key = incident.map((_, arm) => mask & (1 << arm) ? (cutaway ? 1 : 2) : 0).join('');
      expect(panels.map(panel => panel.architectureId)).toEqual(architectureJunction(key.split('').map(Number) as [number, number, number, number]).map(piece => piece.id));
      expect(panels.every(panel => panel.low === cutaway)).toBe(true);
    }
  });

  it('routes independent prepared finishes through normal instances of identical window geometry', () => {
    const result = buildStaticInstances({ width: 10, height: 10, walls: new Uint32Array(), edges: new Uint32Array(),
      house: [0, 0], showCutAwayWalls: true, architecture: { catalogue, windows: [
        { axis: 1, x: 2, y: 2, model: 1 }, { axis: 1, x: 5, y: 5, model: 1 }],
      wallFinishSlots: { 'window/1/2/2/1': 1, 'window/1/5/5/1': 2 } } }, 0, 0, 16);
    const sprite = architectureSprite(1, 1, 'front', false)[0].id;
    const modes = Array.from({ length: result.count }, (_, i) => result.instances.subarray(i * 16, i * 16 + 16))
      .filter(row => row[3] === sprite).map(row => row[8]);
    expect(modes).toEqual([-6, -10]);
  });

  it('joins a cut interior divider to full rear shell in a single mixed-height source', () => {
    const panels = buildArchitectureWallGeometry({ ...base, cutaway: true,
      edges: Uint32Array.from([0, 2, 0, 0, 0, 2, 1, 0]) });
    const join = panels.filter(panel => panel.x === 1.5 && panel.y === -.5);
    expect(join).toHaveLength(3);
    expect(join.map(panel => panel.low)).toEqual([false, true, false]);
    expect(join.every(panel => panel.spriteName.startsWith('junction.2120.'))).toBe(true);
  });

  it('preserves physical row positions and depth at fractional camera zoom', () => {
    for (const scale of [.5, 1, 1.375, 2.5]) {
      const result = buildStaticInstances({ ...base, windows: new Uint32Array(), walls: new Uint32Array(), showCutAwayWalls: true,
        architecture: { windows: [{ axis: 1, x: 2, y: 2, model: 7 }], catalogue } }, 200.37, 100.19, 16, scale);
      const rows = result.instances.slice(0, result.count * 16);
      const ids = architectureSprite(7, 1, 'front', false).map(piece => piece.id);
      const selected = Array.from({ length: result.count }, (_, i) => rows.subarray(i * 16, (i + 1) * 16))
        .filter(row => ids.includes(row[3] as typeof ids[number]));
      expect(selected).toHaveLength(3);
      for (const row of selected) {
        expect(row[0]).toBeCloseTo(200.37 + (3 - 1.5) * 32 * scale, 4);
        expect(row[1]).toBeCloseTo(100.19 + (3 + 1.5) * 21 * scale, 4);
        expect([...row.slice(4, 7)]).toEqual([1, 1, 1]);
        expect(row[8]).toBe(-2);
      }
    }
  });

  it('fades every ownership piece for any far cell, preserves camera state and resets on Load', () => {
    const panels = buildArchitectureWallGeometry({ ...base, cutaway: true,
      windows: [{ axis: 1, x: 2, y: 2, model: 7 }] }).filter(panel => panel.window);
    const rows = new Float32Array(panels.length * 16), fade = new WallFade();
    const positions = Float32Array.from([2, 1, 4, 1]);
    const source = { count: 2, positions: () => positions, prevPositions: () => positions,
      kinds: () => new Uint32Array(2), activities: () => new Uint32Array(2) };
    fade.configure(rows, panels, 10, 10); fade.update(source, 1, 100, false);
    expect([rows[10], rows[26], rows[42]]).toEqual([.625, .625, .625]);
    positions.set([8, 8, 4, 1]); fade.configure(rows, panels, 10, 10); fade.update(source, 1, 0, true);
    expect([rows[10], rows[26], rows[42]]).toEqual([.25, .25, .25]);
    positions.set([8, 8, 8, 8]); fade.update(source, 1, 200, false);
    expect([rows[10], rows[26], rows[42]]).toEqual([1, 1, 1]);
    positions.set([2, 1, 4, 1]); fade.update(source, 1, 0, true); fade.reset();
    expect([rows[10], rows[26], rows[42]]).toEqual([1, 1, 1]);
  });
});

describe('finish catalogue and registered source coordinates', () => {
  it('encodes independent wall/floor finish slots without altering historical modes', () => {
    for (const slot of [0, 1, 2, 17, 1048575]) for (const floor of [false, true]) {
      const mode = architectureMode(floor, slot);
      expect(Math.fround(mode)).toBe(mode);
      expect(decodeArchitectureMode(mode)).toEqual({ floor, finishSlot: slot });
    }
    for (const value of [NaN, Infinity, -.5, 1048576]) expect(() => architectureMode(false, value)).toThrow();
    for (const mode of [-1, 0, 15, -4, -5, NaN, -2.5]) expect(decodeArchitectureMode(mode)).toBeNull();
  });

  it('loads only active patterns for1000 extra palettes and enforces actual binding limits', () => {
    const finishes = { ...ARCHITECTURE.catalogue.finishes } as Record<string, { patternKey: string; paletteKey: string }>;
    for (let i = 0; i < 1000; i++) finishes[`extra.${i}`] = { patternKey: 'wall.plaster', paletteKey: 'cool' };
    const extended: FinishCatalogue = { ...ARCHITECTURE.catalogue, finishes,
      palettes: { ...ARCHITECTURE.catalogue.palettes, cool: { multiply: [.5, .7, 1] } } };
    const selected = prepareArchitectureFinishes(['extra.0', 'extra.999', 'extra.0'], limits, extended);
    expect(selected.keys).toHaveLength(2); expect(selected.resources).toEqual(['plaster']);
    expect(selected.residentBytes).toBe(65916928 + 256 * 256 * 4);
    expect(architectureFinishSlot(selected, 'extra.999')).toBe(2);
    expect(() => architectureFinishSlot(selected, 'extra.2')).toThrow(/not prepared/);
    expect(() => prepareArchitectureFinishes(['extra.0'], { ...limits, maxSampledTexturesPerShaderStage: 4 }, extended)).toThrow(/sampled/);
    expect(() => prepareArchitectureFinishes(['extra.0'], { ...limits, maxTextureArrayLayers: 1 }, extended)).toThrow(/layer/);
    expect(() => prepareArchitectureFinishes(['extra.0'], { ...limits, maxStorageBufferBindingSize: 16 }, extended)).toThrow(/storage/);
    expect(prepareArchitectureFinishes([], limits).residentBytes).toBe(35954688);
  });

  it('reconstructs common source coordinates from actual signed depth texels across all split owners', () => {
    const bytes = readFileSync(`public/${ARCHITECTURE.resources.depth}`);
    const roles = readFileSync(`public/${ARCHITECTURE.resources.roles}`);
    const half = (bits: number): number => (bits & 0x8000 ? -1 : 1)
      * (bits & 0x7c00 ? 1 + (bits & 1023) / 1024 : (bits & 1023) / 1024)
      * 2 ** ((bits & 0x7c00 ? (bits >> 10) & 31 : 1) - 15);
    let samples = 0, negative = 0;
    for (const sprite of ARCHITECTURE.sprites) {
      if (sprite.kind === 'floor-patch') continue;
      const sourceOrigin = [sprite.origin[0] + sprite.sourceCrop[0] / 2,
        sprite.origin[1] + sprite.sourceCrop[1] / 2];
      for (let y = 0; y < sprite.h; y += 7) for (let x = 0; x < sprite.w; x += 7) {
        const index = (sprite.y + y) * ARCHITECTURE.width + sprite.x + x;
        if (roles[index] === 0) continue;
        const sum = half(bytes.readUInt16LE(index * 2));
        const local = architectureLocalPoint(x, y, sprite.origin, 2, sum);
        const common = architectureLocalPoint(x + sprite.sourceCrop[0], y + sprite.sourceCrop[1], sourceOrigin, 2, sum);
        expect(local).toEqual(common); expect(local[0] + local[1]).toBeCloseTo(sum, 12);
        samples++; if (sum < 0) negative++;
      }
    }
    expect(samples).toBeGreaterThan(10000); expect(negative).toBeGreaterThan(1000);
    expect(architectureFloor('floor.boards', -1, -1)).toBe(architectureFloor('floor.boards', 3, 3));
  });
});
