import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { buildInstances, simShirtVariant, type RenderSource } from '../src/frame.js';
import { FLOATS_PER_INSTANCE } from '../src/render/instances.js';
import { pickSprite } from '../src/input.js';
import { screenX, screenY, TILE_HALF_HEIGHT } from '../src/render/iso.js';
import { BATHROOM_SPRITES, BATHROOM_LAYERS, BATHROOM_COVERAGE, BATHROOM_MASKS,
  SPRITE_ANCHORS, spriteIndex } from '../src/render/atlas.js';
import { sampleBedCoverage } from '../src/render/bed-sprites.js';
import { fetchFrame, FETCH_VISUAL_ACTION } from '../src/render/fetch-animation.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

const none = 0xffffffff;

function fetchingSource(empty: number, simId: number, progress: number): RenderSource {
  const fridge = 41, agent = 99;
  return {
    count: 2, positions: () => new Float32Array([5, 3, 6, 3]),
    prevPositions: () => new Float32Array([5, 3, 6, 3]),
    ids: () => new Uint32Array([fridge, agent]), kinds: () => new Uint32Array([1, 0]),
    sprites: () => new Uint32Array([empty, 0]), activities: () => new Uint32Array([0, 21]),
    visualActions: () => new Uint32Array([0, FETCH_VISUAL_ACTION]), facings: () => new Uint32Array([0, 2]),
    simIds: () => new Uint32Array([none, simId]), carrying: () => new Uint32Array([none, none]),
    foregroundSprites: () => new Uint32Array([none, none]),
    interactionTargets: () => new Uint32Array([none, fridge]), itemKinds: () => [],
    choreProgress: () => new Uint32Array([0, progress]),
  };
}

it('selects samples from progress, rests under reduced motion and holds when progress holds', () => {
  expect(fetchFrame(0, 8, false)).toBe(0);
  expect(fetchFrame(124, 8, false)).toBe(0);
  expect(fetchFrame(125, 8, false)).toBe(1);
  expect(fetchFrame(999, 8, false)).toBe(7);
  expect(fetchFrame(5000, 8, false)).toBe(7);
  expect(fetchFrame(600, 8, true)).toBe(0);
  expect(fetchFrame(Number.NaN, 8, false)).toBe(0);
  expect(() => fetchFrame(10, 0, false)).toThrow();
});

it('fridge reach scenes cover every facing, palette and sample with separate visible click owners', () => {
  for (const suffix of ['', 'NW', 'SW', 'NE']) for (let simId = 0; simId < 3; simId++) {
    const empty = spriteIndex('offlineFridge' + suffix);
    const frames = BATHROOM_SPRITES[empty][FETCH_VISUAL_ACTION].frames[simShirtVariant(simId)];
    expect(frames).toHaveLength(8);
    expect(new Set(frames).size).toBe(8);
    for (let sample = 0; sample < 8; sample++) {
      const progress = Math.floor(sample * 1000 / 8) + 3;
      const source = fetchingSource(empty, simId, progress);
      // Simulation time does not drive the reach: two ticks with equal progress draw one sample.
      const first = buildInstances(source, 1, 0, 0, 16, null, 1, false, 3);
      const later = buildInstances(source, 1, 0, 0, 16, null, 1, false, 11);
      const scene = first[FLOATS_PER_INSTANCE + 3];
      expect(scene).toBe(frames[sample]);
      expect(later[FLOATS_PER_INSTANCE + 3]).toBe(scene);
      expect(first[0]).toBe(-1e6);
      expect(BATHROOM_LAYERS[scene]).toBeDefined();
      expect(buildInstances(source, 1, 0, 0, 16, null, 1, true, 3)[FLOATS_PER_INSTANCE + 3]).toBe(frames[0]);
      const [anchorX, anchorY] = SPRITE_ANCHORS[scene];
      for (const [role, owner] of [[0, 99], [1, 41]] as const) {
        const mask = BATHROOM_MASKS[BATHROOM_COVERAGE[scene][role]];
        // Shared outline ink can draw over either owner, so a witness pixel is one
        // its owner covers completely with no ink on top.
        const ink = BATHROOM_MASKS[BATHROOM_COVERAGE[scene][2]];
        let witness: [number, number] | undefined;
        for (let y = mask.box[1]; y < mask.box[3] && !witness; y++)
          for (let x = mask.box[0]; x < mask.box[2]; x++)
            if (sampleBedCoverage(mask, x, y) > .99 && sampleBedCoverage(ink, x, y) < .01) { witness = [x, y]; break; }
        expect(witness).toBeDefined();
        expect(pickSprite(source,
          screenX(5, 3, 0) + witness![0] / 2 - anchorX,
          screenY(5, 3, 0) + TILE_HALF_HEIGHT + witness![1] / 2 - anchorY,
          0, 0, 1, false)).toEqual({ entity: owner, isAgent: owner === 99 });
      }
    }
  }
});

it('the padded scene draws the fridge on the empty fridge anchor', () => {
  for (const suffix of ['', 'NW', 'SW', 'NE']) {
    const empty = spriteIndex('offlineFridge' + suffix);
    for (const scene of BATHROOM_SPRITES[empty][FETCH_VISUAL_ACTION].frames.green) {
      // The canvas grows by 30 logical pixels on the left and 20 on top.
      expect(SPRITE_ANCHORS[scene][0] - SPRITE_ANCHORS[empty][0]).toBeCloseTo(30, 6);
      expect(SPRITE_ANCHORS[scene][1] - SPRITE_ANCHORS[empty][1]).toBeCloseTo(20, 6);
    }
  }
});

it('both compiled fridge steps play the reach through the bridge, and Load resumes it', () => {
  for (const interaction of [0, 1]) {
    const handle = new SimHandle(16, 16);
    const source = new SimBridge(handle, memory);
    try {
      expect(source.spawnObject(4, 4, 'fridge')).toBe(true);
      expect(source.spawnObject(4, 6, 'counter')).toBe(true);
      expect(source.spawnObject(6, 6, 'stove')).toBe(true);
      source.spawnAgent(2, 4, 50);
      const fridge = source.ids()[0], agent = source.ids()[3];
      expect(source.useObject(agent, fridge, interaction)).toBe(true);
      const row = () => Array.from(source.ids()).indexOf(agent);
      for (let tick = 0; tick < 200 && source.visualActions()[row()] !== FETCH_VISUAL_ACTION; tick++) source.tick();
      expect(source.visualActions()[row()]).toBe(FETCH_VISUAL_ACTION);
      expect(source.interactionTargets()[row()]).toBe(fridge);
      const empty = source.sprites()[Array.from(source.ids()).indexOf(fridge)];
      const frames = BATHROOM_SPRITES[empty][FETCH_VISUAL_ACTION].frames[simShirtVariant(source.simIds()[row()])];
      const scene = () => buildInstances(source, 1, 0, 0, 16, null, 1, false, source.clockTick())[row() * FLOATS_PER_INSTANCE + 3];
      const seen: number[] = [];
      let previous = -1, saved: Uint8Array | undefined, savedProgress = 0;
      for (let tick = 0; tick < 80 && source.visualActions()[row()] === FETCH_VISUAL_ACTION; tick++) {
        const progress = source.choreProgress()[row()];
        expect(progress).toBeGreaterThanOrEqual(previous);
        previous = progress;
        const sample = frames.indexOf(scene());
        expect(sample).toBe(fetchFrame(progress, 8, false));
        if (seen[seen.length - 1] !== sample) seen.push(sample);
        if (sample === 4 && !saved) { saved = source.saveBytes(); savedProgress = progress; }
        source.tick();
      }
      expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(saved).toBeDefined();
      expect(savedProgress).toBeGreaterThan(0);
      // A loaded step has no saved length, so the reach resumes halfway: the door open, the hand in.
      expect(source.loadBytes(saved!)).toBe(true);
      expect(Array.from(source.saveBytes())).toEqual(Array.from(saved!));
      expect(source.visualActions()[row()]).toBe(FETCH_VISUAL_ACTION);
      expect(source.choreProgress()[row()]).toBe(500);
      expect(scene()).toBe(frames[4]);
      source.cancelIntents(agent); source.flushCommands();
      expect(source.visualActions()[row()]).not.toBe(FETCH_VISUAL_ACTION);
      expect(source.interactionTargets()[row()]).toBe(none);
      expect(buildInstances(source, 1, 0, 0, 16, null, 1, false, source.clockTick())[0]).not.toBe(-1e6);
    } finally { handle.free(); }
  }
});

