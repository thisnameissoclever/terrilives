import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.ts';
import { buildInstances, instanceCount } from '../src/frame.ts';
import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer } from '../src/render/sprites.ts';
import { FLOATS_PER_INSTANCE, writeInstance } from '../src/render/instances.ts';
import { spriteIndex, ATLAS_FILE_NAME } from '../src/render/atlas.ts';
import { buildLightField, sampleLight } from '../src/render/lighting.ts';
import { ambientFor, AMBIENT_NEUTRAL } from '../src/render/daylight.ts';

// Actual saved placements and frame writers, not synthetic furniture instances.
export async function livingMediaProof() {
  const { memory } = await init();
  const handle = SimHandle.from_lot();
  const sim = new SimBridge(handle, memory);
  const baseline = sim.saveBytes();
  const canvas = document.createElement('canvas');
  canvas.width = 400; canvas.height = 280;
  const gpu = await initDevice(canvas);
  const errors = [], records = [], uses = [];
  gpu.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  gpu.device.pushErrorScope('validation');
  const board = document.createElement('div');
  board.style = 'display:flex;flex-wrap:wrap;width:1600px;background:#17171c;color:white';
  const renderer = await SpriteRenderer.create(gpu);
  const scale = 3;
  const capture = async (item, label, preview = null, night = false) => {
    const row = Array.from(sim.ids()).indexOf(item.id);
    const x = sim.positions()[row * 2], y = sim.positions()[row * 2 + 1];
    const ox = 200-(x-y)*32*scale, oy = 210-(x+y)*21*scale;
    const floors = new Float32Array(FLOATS_PER_INSTANCE * 9);
    let count = 0;
    for (let fx = item.x-1; fx <= item.x+1; fx++) for (let fy = 2; fy <= 4; fy++) {
      writeInstance(floors, count++, ox+(fx-fy)*32*scale, oy+(fx+fy)*21*scale,
        .95, spriteIndex('floor'));
    }
    renderer.setStaticGeometry(floors, count);
    const light = buildLightField(sim, 16, 12, new Uint32Array(), true);
    const selected = preview ? item.id : null;
    const instances = buildInstances(sim, 1, ox, oy, 16, selected, scale, false, 0,
      light, undefined, preview, null, sim.objectColourway(item.id));
    renderer.draw(instances, instanceCount(sim, selected, undefined, preview), scale,
      night ? ambientFor(0, 1440) : AMBIENT_NEUTRAL);
    await gpu.device.queue.onSubmittedWorkDone();
    const copy = document.createElement('canvas');
    copy.width = 400; copy.height = 280;
    copy.getContext('2d').drawImage(canvas, 0, 0);
    const section = document.createElement('section');
    const title = document.createElement('div');
    title.textContent = `${item.label}: ${label}`;
    section.style.width = '400px'; copy.style.display = 'block';
    section.append(title, copy); board.append(section);
    return { label, object: item.id, center: [x, y], facing: sim.objectFacing(item.id),
      sprite: sim.sprites()[row], colourway: sim.objectColourway(item.id),
      emissive: instances[row * FLOATS_PER_INSTANCE + 7], tileLight: sampleLight(light, x, y) };
  };
  try {
    for (const item of [
      { id: 17, x: 10, label: 'TV', action: 'Watch TV' },
      { id: 16, x: 8, label: 'Radio', action: 'Listen to the radio' },
    ]) {
      if (!sim.loadBytes(baseline)) throw new Error('Baseline load failed');
      for (const [facing, name] of ['SE', 'SW', 'NW', 'NE'].entries()) {
        if (!sim.placeObject(item.id, item.x, 3, facing)) throw new Error('Placement rejected');
        sim.flushCommands();
        if (sim.lastPlacementResult()?.reason) throw new Error('Media rotation rejected');
        if (!sim.loadBytes(sim.saveBytes())) throw new Error('Save round trip failed');
        records.push(await capture(item, name));
      }
      sim.placeObject(item.id, item.x, 3, 0); sim.flushCommands();
      for (const [colourway, name] of sim.colourwayNames().entries()) {
        sim.setColourway(item.id, colourway); sim.flushCommands();
        records.push(await capture(item, name));
      }
      records.push(await capture(item, 'Selected Build preview', sim.placementPreview(item.id, item.x, 3, 0)));
      sim.setColourway(item.id, 0); sim.flushCommands();
      records.push(await capture(item, 'Midnight', null, true));
      sim.useObjectFirst(34, item.id, 0);
      let use;
      for (let tick = 0; tick < 1200 && !use; tick++) {
        sim.tick();
        if (sim.activityOf(34) === 7 && sim.actionQueueOf(34)[0]?.startsWith(item.action)) {
          const row = Array.from(sim.ids()).indexOf(34);
          use = { tick, object: item.id, activity: sim.activityOf(34),
            visualAction: sim.visualActions()[row], target: sim.interactionTargets()[row],
            queue: sim.actionQueueOf(34) };
        }
      }
      if (!use || use.visualAction !== 0 || use.target !== 0xffffffff) {
        throw new Error('Expected requested active action with the existing generic-use pose');
      }
      uses.push(use);
      records.push(await capture(item, 'Existing standing use'));
    }
    document.body.replaceChildren(board); document.body.style.margin = '0';
    const validation = await gpu.device.popErrorScope();
    return { pass: !validation && !errors.length, validation: validation?.message ?? null,
      errors, atlas: ATLAS_FILE_NAME, records, uses };
  } finally { handle.free(); gpu.device.destroy(); }
}
