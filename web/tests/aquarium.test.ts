import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import * as atlas from '../src/render/atlas.js';
import { objectBodySprite, buildInstances, instanceCount } from '../src/frame.js';
import { FLOATS_PER_INSTANCE as STRIDE } from '../src/render/instances.js';
import { emissiveForSprite } from '../src/render/lighting.js';
import { pickSprite, type PickSource } from '../src/input.js';

let memory: WebAssembly.Memory;

/** The offset after `count` postcard varints starting at `offset`; a u64 varint is at most ten bytes. */
function skipVarints(bytes: Uint8Array, offset: number, count: number): number {
  for (let field = 0; field < count; field++) {
    let length = 1;
    while (length < 10 && (bytes[offset + length - 1] & 0x80) !== 0) length++;
    offset += length;
  }
  return offset;
}
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

it('loads a released-main save with its published state intact and empty chore extensions', () => {
  const bytes = Uint8Array.from(readFileSync('tests/fixtures/aquarium-released-main.sav'));
  expect(createHash('sha256').update(bytes).digest('hex'))
    .toBe('117f99a05d6e9ad879954ec46c6ccc84858a3d9d7c6d7b957847927600a6eea6');
  const handle = SimHandle.from_lot();
  try {
    const sim = new SimBridge(handle, memory);
    expect(sim.loadBytes(bytes)).toBe(true);
    // Written before skills and affinities existed, so its next save
    // appends the skills field after the loaded bytes: Some (1), then the
    // seeded practice rows, and then the drawn affinity values. Drawing
    // those values ([OA-values]) moves the saved generator, which follows
    // the content fingerprint and the tick; every other loaded byte is kept.
    const saved = sim.saveBytes();
    const rngStart = skipVarints(bytes, 10, 2);
    const rngEnd = skipVarints(bytes, rngStart, 2);
    const savedRngEnd = skipVarints(saved, rngStart, 2);
    expect(saved.slice(0, rngStart)).toEqual(bytes.slice(0, rngStart));
    expect(saved.slice(rngStart, savedRngEnd)).not.toEqual(bytes.slice(rngStart, rngEnd));
    const rest = bytes.length - rngEnd;
    expect(saved.slice(savedRngEnd, savedRngEnd + rest)).toEqual(bytes.slice(rngEnd));
    expect(saved[savedRngEnd + rest]).toBe(1);
    // Moved from 6601771059661594058 when the skill ladder became flat and the seeded practice changed.
    // Moved from 13907076554945442085 when loading began drawing each person's affinity values once
    // ([OA-values]): the draws advance the generator and the values join the hash. Measured natively.
    // Moved from 11804688860418536815 when the aquarium kind took the trait tag `aquarium`, so Fish
    // watcher sets a mild 0.4 in place of the drawn value; with the tag removed the old value returns.
    expect(sim.worldHash().toString()).toBe('4526374402505414594');
    expect([...saved.slice(-3)]).toEqual([0, 0, 0]);
    const row = Array.from(sim.ids()).indexOf(27);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(sim.sprites()[row]).toBe(atlas.spriteIndex('offlineAquarium'));
    expect([...sim.positions().slice(row * 2, row * 2 + 2)]).toEqual([6, 10]);
    expect(sim.interactionLabels(27)).toEqual(['Watch the fish']);
  } finally {
    handle.free();
  }
});

it.each(['', 'NW', 'SW', 'NE'])('keeps fish timing and the picking envelope for facing %s', suffix => {
  const zero = atlas.spriteIndex('offlineAquarium' + suffix);
  const one = atlas.spriteIndex('offlineAquariumFrame1' + suffix);
  const frames = Array.from({ length: 8 }, (_, frame) => atlas.spriteIndex(`offlineAquariumSwim${frame}` + suffix));
  for (let frame = 0; frame < 8; frame++) {
    for (const tick of [frame*6, frame*6+5]) {
      expect(objectBodySprite(zero, tick, false)).toBe(frames[frame]);
      expect(objectBodySprite(zero, tick+48, false)).toBe(frames[frame]);
    }
    expect(objectBodySprite(one, frame*6, false)).toBe(one);
    expect(objectBodySprite(zero, frame*6, true)).toBe(frames[0]);
  }
  expect(objectBodySprite(zero, 48, false)).toBe(frames[0]);
  expect(atlas.SPRITE_ANCHORS[zero]).toEqual(atlas.SPRITE_ANCHORS[one]);
  expect(atlas.SPRITE_CONTENT_BOUNDS[zero]).toEqual(atlas.SPRITE_CONTENT_BOUNDS[one]);
  for (const index of [zero, one, ...frames]) {
    expect(atlas.SPRITES[index]).toMatchObject({ w: 192, h: 240, pixel_density: 2 });
    expect(emissiveForSprite(index)).toBe(0);
    expect(atlas.SPRITE_ANCHORS[index]).toEqual(atlas.SPRITE_ANCHORS[zero]);
    expect(atlas.SPRITE_CONTENT_BOUNDS[index]).toEqual(atlas.SPRITE_CONTENT_BOUNDS[zero]);
  }
  const source: PickSource = { count: 1, positions: () => new Float32Array([0, 0]),
    kinds: () => new Uint32Array([1]), ids: () => new Uint32Array([27]),
    sprites: () => new Uint32Array([zero]), activities: () => new Uint32Array([0]) };
  expect(pickSprite(source, 0, -25, 0, 0)).toEqual({ entity: 27, isAgent: false });
  expect(pickSprite(source, 47, -25, 0, 0)).toBeNull();
  expect(pickSprite(source, 0, 24, 0, 0)).toBeNull();
});

it('preserves aquarium placement, colours and save bytes through four rotations', () => {
  const handle = SimHandle.from_lot();
  try {
    const sim = new SimBridge(handle, memory);
    expect(sim.catalogue().find(row => row.name === 'Aquarium of Managed Expectations'))
      .toMatchObject({ price: 220, facings: 15, baseFacing: 0 });
    expect(sim.interactionLabels(27)).toEqual(['Watch the fish']);
    for (const [facing, suffix] of ['', 'SW', 'NW', 'NE'].entries()) {
      const index = atlas.spriteIndex('offlineAquarium' + suffix);
      expect(sim.placementPreview(27, 6, 10, facing)).toMatchObject({ valid: true, width: 1, depth: 1, sprite: index });
      expect(sim.placeObject(27, 6, 10, facing)).toBe(true); sim.flushCommands();
      expect(sim.lastPlacementResult()).toEqual({ object: 27, reason: null });
      for (let colour = 0; colour < sim.colourwayNames().length; colour++) {
        expect(sim.setColourway(27, colour)).toBe(true); sim.flushCommands();
        const save = sim.saveBytes(), hash = sim.worldHash(), tick = sim.clockTick();
        expect(sim.loadBytes(save)).toBe(true);
        expect(sim.saveBytes()).toEqual(save);
        expect(sim.worldHash()).toBe(hash);
        expect(sim.clockTick()).toBe(tick);
        const row = Array.from(sim.ids()).indexOf(27);
        expect([...sim.positions().slice(row*2, row*2+2)]).toEqual([6, 10]);
        expect([sim.footprintWidths()[row], sim.footprintDepths()[row]]).toEqual([1, 1]);
        expect(sim.sprites()[row]).toBe(index);
        expect(sim.objectFacing(27)).toBe(facing);
        expect(sim.objectColourway(27)).toBe(colour);
        const normal = buildInstances(sim, 1, 0, 0, 16).slice();
        const preview = sim.placementPreview(27, 6, 10, facing);
        const shown = buildInstances(sim, 1, 0, 0, 16, 27, 1, false, 0,
          null, undefined, preview, null, colour);
        const body = instanceCount(sim, 27, undefined, preview)-1;
        expect([...shown.slice(row*STRIDE, row*STRIDE+2)]).toEqual([-1e6, -1e6]);
        expect(shown[body*STRIDE+3]).toBe(index);
        expect([...shown.slice(body*STRIDE+12, body*STRIDE+15)])
          .toEqual([...normal.slice(row*STRIDE+12, row*STRIDE+15)]);
      }
    }
  } finally { handle.free(); }
});

it('keeps watching beside the tank and restores the same active action', () => {
  const handle = SimHandle.from_lot();
  try {
    const sim = new SimBridge(handle, memory);
    expect(sim.useObjectFirst(34, 27, 0)).toBe(true);
    let found = false;
    for (let tick = 0; tick < 1200; tick++) {
      sim.tick();
      if (sim.activityOf(34) !== 10 || sim.actionQueueOf(34)[0] !==
          'Watch the fish: Aquarium of Managed Expectations') continue;
      const save = sim.saveBytes(), hash = sim.worldHash();
      expect(sim.loadBytes(save)).toBe(true);
      expect(sim.saveBytes()).toEqual(save); expect(sim.worldHash()).toBe(hash);
      const row = Array.from(sim.ids()).indexOf(34);
      expect(sim.visualActions()[row]).toBe(7);
      expect(sim.activityOf(34)).toBe(10);
      expect(sim.interactionTargets()[row]).toBe(0xffffffff);
      expect([...sim.positions().slice(row*2, row*2+2)]).not.toEqual([6, 10]);
      found = true; break;
    }
    expect(found).toBe(true);
  } finally { handle.free(); }
});
