import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.ts';
import { buildInstances, instanceCount } from '../src/frame.ts';
import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer } from '../src/render/sprites.ts';
import { FLOATS_PER_INSTANCE, writeInstance } from '../src/render/instances.ts';
import { spriteIndex, ATLAS_FILE_NAME } from '../src/render/atlas.ts';
import { buildLightField, sampleLight } from '../src/render/lighting.ts';
import { ambientFor, AMBIENT_NEUTRAL } from '../src/render/daylight.ts';

// Runs only in the isolated proof document; production UI is tested separately.
export async function floorLampProof() {
  const { memory } = await init();
  const handle = SimHandle.from_lot();
  const sim = new SimBridge(handle, memory);
  const canvas = document.createElement('canvas');
  canvas.width = 400; canvas.height = 340;
  const gpu = await initDevice(canvas);
  const errors = [], records = [];
  gpu.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  gpu.device.pushErrorScope('validation');
  try {
    const renderer = await SpriteRenderer.create(gpu);
    const board = document.createElement('div');
    board.style = 'display:flex;flex-wrap:wrap;width:1600px;background:#17171c;color:white';
    const scale = 3, x = 10, y = 2;
    const ox = 200-(x-y)*32*scale, oy = 280-(x+y)*21*scale;
    const floors = new Float32Array(FLOATS_PER_INSTANCE * 9);
    let count = 0;
    for (let fx = x-1; fx <= x+1; fx++) for (let fy = y-1; fy <= y+1; fy++) {
      writeInstance(floors, count++, ox+(fx-fy)*32*scale, oy+(fx+fy)*21*scale, .95, spriteIndex('floor'));
    }
    renderer.setStaticGeometry(floors, count);
    const capture = async (label, night = false, preview = null) => {
      const row = Array.from(sim.ids()).indexOf(15);
      const light = buildLightField(sim, 16, 12, sim.wallTiles(), true, sim.wallEdges());
      const selected = preview ? 15 : null;
      const instances = buildInstances(sim, 1, ox, oy, 16, selected, scale, false, 0,
        light, undefined, preview, null, sim.objectColourway(15));
      renderer.draw(instances, instanceCount(sim, selected, undefined, preview), scale,
        night ? ambientFor(0, 1440) : AMBIENT_NEUTRAL);
      await gpu.device.queue.onSubmittedWorkDone();
      const copy = document.createElement('canvas'); copy.width = 400; copy.height = 340;
      copy.getContext('2d').drawImage(canvas, 0, 0);
      const section = document.createElement('section'), title = document.createElement('div');
      title.textContent = label; section.style.width = '400px'; copy.style.display = 'block';
      section.append(title, copy); board.append(section);
      const visible = [];
      for (let i = 0; i < instanceCount(sim, selected, undefined, preview); i++) {
        if (instances[i*FLOATS_PER_INSTANCE+3] === sim.sprites()[row]) visible.push(i);
      }
      if (visible.length !== 1) throw new Error('Expected exactly one visible lamp instance');
      const record = { label, facing: sim.objectFacing(15), sprite: sim.sprites()[row],
        colourway: sim.objectColourway(15), emissive: instances[visible[0]*FLOATS_PER_INSTANCE+7],
        tileLight: sampleLight(light, x, y) };
      if (Math.abs(record.emissive-.85) > .00001 || record.tileLight < Math.fround(.35)) {
        throw new Error('Lamp lost its existing emissive or room light');
      }
      records.push(record);
    };
    for (const [facing, name] of ['SE', 'SW', 'NW', 'NE'].entries()) {
      if (!sim.placeObject(15, x, y, facing)) throw new Error('Placement rejected');
      sim.flushCommands();
      if (sim.lastPlacementResult()?.reason) throw new Error('Lamp rotation rejected');
      const save = sim.saveBytes();
      if (!sim.loadBytes(save)) throw new Error('Save round trip failed');
      await capture(name); await capture(`${name}: midnight`, true);
    }
    sim.placeObject(15, x, y, 0); sim.flushCommands();
    for (const [colourway, name] of sim.colourwayNames().entries()) {
      sim.setColourway(15, colourway); sim.flushCommands();
      await capture(name);
    }
    sim.setColourway(15, 0); sim.flushCommands();
    await capture('Build preview', false, sim.placementPreview(15, x, y, 0));
    document.body.replaceChildren(board); document.body.style.margin = '0';
    const validation = await gpu.device.popErrorScope();
    return { pass: !validation && !errors.length, validation: validation?.message ?? null,
      errors, atlas: ATLAS_FILE_NAME, records };
  } finally { handle.free(); gpu.device.destroy(); }
}
