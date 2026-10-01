import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.ts';
import { buildInstances, instanceCount } from '../src/frame.ts';
import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer } from '../src/render/sprites.ts';
import { FLOATS_PER_INSTANCE, writeInstance } from '../src/render/instances.ts';
import { spriteIndex, ATLAS_FILE_NAME } from '../src/render/atlas.ts';

// Actual WASM placements and frame writers, including wide depth and colourways.
export async function longSofaProof() {
  const { memory } = await init();
  const handle = SimHandle.from_lot();
  const sim = new SimBridge(handle, memory);
  const canvas = document.createElement('canvas');
  canvas.width = 400; canvas.height = 320;
  const gpu = await initDevice(canvas);
  const errors = [], records = [];
  gpu.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  gpu.device.pushErrorScope('validation');
  const board = document.createElement('div');
  board.style = 'display:flex;flex-wrap:wrap;width:1600px;background:#17171c;color:white';
  const renderer = await SpriteRenderer.create(gpu);
  const scale = 2;
  const capture = async (label, preview = null) => {
    const row = Array.from(sim.ids()).indexOf(11);
    const x = sim.positions()[row * 2], y = sim.positions()[row * 2 + 1];
    const ox = 200-(x-y)*32*scale, oy = 235-(x+y)*21*scale;
    const floors = new Float32Array(FLOATS_PER_INSTANCE * 16);
    let count = 0;
    for (let fx = 9; fx < 13; fx++) for (let fy = 0; fy < 4; fy++) {
      writeInstance(floors, count++, ox+(fx-fy)*32*scale, oy+(fx+fy)*21*scale,
        .95, spriteIndex('floor'));
    }
    renderer.setStaticGeometry(floors, count);
    const selected = preview ? 11 : null;
    const instances = buildInstances(sim, 1, ox, oy, 16, selected, scale, false, 0,
      null, undefined, preview, null, sim.objectColourway(11));
    renderer.draw(instances, instanceCount(sim, selected, undefined, preview), scale);
    await gpu.device.queue.onSubmittedWorkDone();
    const copy = document.createElement('canvas');
    copy.width = 400; copy.height = 320;
    copy.getContext('2d').drawImage(canvas, 0, 0);
    const section = document.createElement('section');
    const title = document.createElement('div');
    title.textContent = label;
    section.style.width = '400px'; copy.style.display = 'block';
    section.append(title, copy); board.append(section);
    return { label, center: [x, y], footprint: [sim.footprintWidths()[row], sim.footprintDepths()[row]],
      sprite: sim.sprites()[row], colourway: sim.objectColourway(11),
      projection: [...instances.slice(row * FLOATS_PER_INSTANCE + 8, row * FLOATS_PER_INSTANCE + 12)] };
  };
  try {
    for (const [facing, name] of ['SE', 'SW', 'NW', 'NE'].entries()) {
      if (!sim.placeObject(11, 10, 0, facing)) throw new Error('Placement queue rejected');
      sim.flushCommands();
      if (sim.lastPlacementResult()?.reason) throw new Error('Sofa rotation rejected');
      if (!sim.loadBytes(sim.saveBytes())) throw new Error('Sofa save round trip failed');
      records.push(await capture(name));
    }
    sim.placeObject(11, 10, 0, 0); sim.flushCommands();
    for (const [colourway, name] of sim.colourwayNames().entries()) {
      sim.setColourway(11, colourway); sim.flushCommands();
      records.push(await capture(name));
    }
    records.push(await capture('Selected Build preview', sim.placementPreview(11, 10, 0, 0)));
    sim.setColourway(11, 0); sim.flushCommands();
    sim.useObjectFirst(34, 11, 0);
    let use;
    for (let tick = 0; tick < 1200 && !use; tick++) {
      sim.tick();
      if (sim.activityOf(34) === 7) {
        const row = Array.from(sim.ids()).indexOf(34);
        use = { tick, id: 34, position: [...sim.positions().slice(row * 2, row * 2 + 2)],
          activity: sim.activityOf(34), visualAction: sim.visualActions()[row],
          target: sim.interactionTargets()[row], queue: sim.actionQueueOf(34) };
      }
    }
    if (!use || use.visualAction !== 0) throw new Error('Expected existing generic-use pose');
    records.push(await capture('Existing generic use (standing)'));
    document.body.replaceChildren(board); document.body.style.margin = '0';
    const validation = await gpu.device.popErrorScope();
    return { pass: !validation && errors.length === 0, validation: validation?.message ?? null,
      errors, atlas: ATLAS_FILE_NAME, records, use };
  } finally {
    handle.free(); gpu.device.destroy();
  }
}
