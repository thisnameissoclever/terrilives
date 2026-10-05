import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { coveredWindowLines, type WindowDefinition, type WindowPlacement } from '../src/architecture/windows.js';
import { architectureSprite } from '../src/render/architecture.js';
import { ambientFor, sunStrength } from '../src/render/daylight.js';
import { buildSkyExposure, sampleSky, OPEN_SKY } from '../src/render/sky.js';
import { buildStaticInstances } from '../src/render/tiles.js';
import { OFFSET_SHADE, FLOATS_PER_INSTANCE } from '../src/render/instances.js';

const catalogue: WindowDefinition[] = Array.from({ length: 9 }, (_, i) => ({
  id: (i + 1) as WindowDefinition['id'], label: `Window ${i + 1}`,
  width: architectureSprite((i + 1) as WindowDefinition['id'], 0, 'front', false)[0].width as 1 | 2 | 3,
}));
const shell: number[][] = [];
for (let i = 0; i < 6; i++) shell.push([0, 0, i, 0], [0, 6, i, 0], [1, i, 0, 0], [1, i, 6, 0]);
const key = (line: readonly number[]) => line.slice(0, 3).join(',');
function room(windows: readonly number[][] = [], extra: readonly number[][] = []) {
  const openings = new Set(windows.map(key));
  const edges = [...shell, ...extra].filter(line => !openings.has(key(line))).flat();
  return buildSkyExposure(8, 8, edges, [6, 6], .2, windows.flat());
}
const lines = (placement: WindowPlacement) => coveredWindowLines(placement, catalogue)
  .map(line => [line.axis, line.x, line.y]);

describe('window daylight', () => {
  it('admits daylight through every model and axis on rear and yard-facing walls', () => {
    const sealed = room();
    for (const model of catalogue) for (const axis of [0, 1] as const) for (const rear of [true, false]) {
      const x = axis === 0 ? (rear ? 0 : 6) : 1;
      const y = axis === 1 ? (rear ? 0 : 6) : 1;
      const opened = room(lines({ axis, x, y, model: model.id }));
      const inside = axis === 0 ? [rear ? 0 : 5, 1] : [1, rear ? 0 : 5];
      expect(sampleSky(sealed, inside[0], inside[1])).toBe(0);
      expect(sampleSky(opened, inside[0], inside[1])).toBeCloseTo(.8);
    }
  });

  it('attenuates each tile from the aperture and lights more floor through a three-unit span', () => {
    const single = room([[0, 0, 1]]);
    for (const [x, expected] of [.8, .6, .4, .2, 0].entries()) {
      expect(sampleSky(single, x, 1)).toBeCloseTo(expected);
    }
    const wide = room(lines({ axis: 0, x: 0, y: 1, model: 7 }));
    expect(sampleSky(wide, 0, 3)).toBeCloseTo(.8);
    expect(sampleSky(single, 0, 3)).toBeCloseTo(.4);
    expect([...wide.values].filter(value => value > 0).length)
      .toBeGreaterThan([...single.values].filter(value => value > 0).length);
  });

  it('does not seed an interior window between sealed rooms, but transmits an external source', () => {
    const partition = Array.from({ length: 6 }, (_, y) => [0, 2, y, 0]);
    const sealed = room([], partition);
    const interior = room([[0, 2, 2]], partition);
    expect([...interior.values]).toEqual([...sealed.values]);
    expect(sampleSky(interior, 2, 2)).toBe(0);
    const lit = room([[0, 0, 2], [0, 2, 2]], partition);
    const blocked = room([[0, 0, 2]], partition);
    expect(sampleSky(blocked, 2, 2)).toBe(0);
    expect(sampleSky(lit, 2, 2)).toBeCloseTo(.4);
    expect(sampleSky(lit, 3, 2)).toBeCloseTo(.2);
  });

  it('keeps the brightest shortest route when yard and rear seeds meet', () => {
    const sky = buildSkyExposure(4, 3, [], [2, 3], .2, [0, 0, 1]);
    expect(sampleSky(sky, 1, 1)).toBeCloseTo(.8);
    expect(sampleSky(sky, 0, 1)).toBeCloseTo(.8);
    expect(sampleSky(sky, 0, 0)).toBeCloseTo(.6);
  });

  it('ignores malformed, out-of-bounds and solid rear lines without aliasing another tile', () => {
    const bad = [[0, 0, -1], [0, 0, 8], [1, 8, 0], [1, -1, 0],
      [0, 0, .5], [1, NaN, 0], [9, 0, 0], [0, Infinity, 0]];
    expect([...room(bad).values]).toEqual([...room().values]);
    const solid = buildSkyExposure(8, 8, shell.flat(), [6, 6], .2, [0, 0, 2, 1, 2, 0]);
    expect(sampleSky(solid, 0, 2)).toBe(0);
    expect(sampleSky(solid, 2, 0)).toBe(0);
    for (const dimension of [0, -1, .5, NaN, Infinity, 1_000_001]) {
      expect(buildSkyExposure(dimension, 8, [], [6, 6], .2)).toBe(OPEN_SKY);
    }
    const duplicates = buildSkyExposure(2, 2, [], [2, 2], 1, [0, 0, 0, 0, 0, 0]);
    expect([...duplicates.values]).toEqual([0, 0, 0, 0]);
  });

  it('writes nonzero exposure changes into actual floor instance shade', () => {
    const lot = { width: 8, height: 8, walls: new Uint32Array(), edges: Uint32Array.from(shell.flat()), house: [6, 6] as const };
    const floorShade = (sky: ReturnType<typeof room>) => {
      const geometry = buildStaticInstances(lot, 0, 0, 8, 1, null, sky);
      expect(geometry.floorCount).toBe(64);
      return geometry.instances[8 * FLOATS_PER_INSTANCE + OFFSET_SHADE];
    };
    expect(floorShade(room())).toBe(1);
    expect(floorShade(room([[0, 0, 1]]))).toBeCloseTo(.2);
  });
});

let memory: WebAssembly.Memory;
beforeAll(async () => { memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory; });
it('keeps sky and per-frame daylight calculations outside the actual world hash', () => {
  const handle = SimHandle.from_lot();
  try {
    const bridge = new SimBridge(handle, memory);
    const baseline = handle.world_hash();
    const saved = bridge.saveBytes();
    const windows = bridge.windowLines();
    for (const tick of [0, 360, 720, 1260]) {
      buildSkyExposure(handle.lot_width(), handle.lot_height(), bridge.wallEdges() ?? null, bridge.houseSize(), .2, windows);
      sunStrength(ambientFor(tick, 1440));
      expect(handle.world_hash()).toBe(baseline);
      expect(bridge.saveBytes()).toEqual(saved);
    }
    bridge.tick();
    expect(handle.world_hash()).not.toBe(baseline);
  } finally { handle.free(); }
});
