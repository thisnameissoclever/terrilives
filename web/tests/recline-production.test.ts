import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { buildInstanceBatch, simShirtVariant } from '../src/frame.js';
import { pickSprite } from '../src/input.js';
import { BED_COVERAGE, SOFA_RECLINE_CATALOG } from '../src/render/atlas.js';
import { sampleBedCoverage } from '../src/render/bed-sprites.js';
import { reclineKey, sharedSeatPhase } from '../src/render/shared-seat-sprites.js';
import { spriteWidth, spriteHeight } from '../src/render/sprite-size.js';
import { TILE_HALF_HEIGHT } from '../src/render/iso.js';

let memory: WebAssembly.Memory;
beforeAll(async () => { memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory; });

it.each([0, 1, 2, 3])('draws and picks the real active whole-sofa owner in object facing %i', facing => {
  const handle = new SimHandle(16, 16), source = new SimBridge(handle, memory);
  try {
    expect(source.spawnObject(4, 4, 'long_sofa')).toBe(true);
    source.spawnAgent(3, 4, 50);
    expect(source.count).toBe(2);
    const sofa = source.ids()[0], person = source.ids()[1];
    expect(source.placeObject(sofa, 4, 4, facing)).toBe(true); source.flushCommands();
    const action = source.objectModel(sofa)!.actions.findIndex(row => row.id === 'stretch_out');
    expect(action).toBeGreaterThanOrEqual(0);
    expect(source.useObjectFirst(person, sofa, action)).toBe(true);
    for (let tick = 0; tick < 200 && source.seatedWhole()[1] !== 1; tick++) source.tick();
    expect(source.seatedWhole()[1]).toBe(1);
    expect(source.seatedFurniture()[1]).toBe(sofa);
    expect(source.visualActions()[1]).toBe(0);
    expect(source.activities()[1]).toBe(15);
    const profile = SOFA_RECLINE_CATALOG[source.sprites()[0]];
    expect(profile.wholeSeatId).toBe('whole_sofa');
    const palette = ['green', 'blue', 'red'].indexOf(simShirtVariant(source.simIds()[1]));
    const scene = profile.scenes[reclineKey(sharedSeatPhase(source.clockTick(), false), palette)];
    const scale = 1.5;
    const batch = buildInstanceBatch(source, 1, 250, 280, 16, null, scale, false, source.clockTick());
    expect(batch.instances[0]).toBe(-1e6);
    expect(batch.instances[16 + 3]).toBe(scene.sprite);
    const left = batch.instances[16] - spriteWidth(scene.sprite) / 2 * scale;
    const top = batch.instances[17] + (TILE_HALF_HEIGHT - spriteHeight(scene.sprite)) * scale;
    const mask = BED_COVERAGE[scene.owners[0]!.coverage];
    let picked = false;
    for (let y = mask.box[1]; y < mask.box[3] && !picked; y++) for (let x = mask.box[0]; x < mask.box[2] && !picked; x++) {
      if (sampleBedCoverage(mask, x, y) < .99) continue;
      const pick = pickSprite(source, left + (x + .5) / 2 * scale, top + (y + .5) / 2 * scale, 250, 280, scale);
      picked = pick?.entity === person && pick.isAgent;
    }
    expect(picked).toBe(true);
    const before = Array.from(batch.instances.slice(16, 32)), saved = source.saveBytes();
    expect(source.loadBytes(saved)).toBe(true);
    expect(Array.from(buildInstanceBatch(source, 1, 250, 280, 16, null, scale, false, source.clockTick()).instances.slice(16, 32))).toEqual(before);
    source.cancelIntents(person); source.flushCommands();
    expect(source.seatedWhole()[1]).toBe(0);
    expect(buildInstanceBatch(source, 1, 250, 280, 16, null, scale, false, source.clockTick()).instances[3]).toBe(source.sprites()[0]);
  } finally { handle.free(); }
});
