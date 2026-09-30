import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.ts';
import { buildInstances, instanceCount, VISUAL_ACTION_EAT } from '../src/frame.ts';
import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer } from '../src/render/sprites.ts';
import { FLOATS_PER_INSTANCE, writeInstance } from '../src/render/instances.ts';
import { spriteIndex, ATLAS_FILE_NAME } from '../src/render/atlas.ts';

// Use actual WASM placement and the frame builder, including wide-object depth.
export async function diningTableProof() {
  const { memory } = await init();
  const handle = SimHandle.from_lot();
  const sim = new SimBridge(handle, memory);
  const canvas = document.createElement('canvas');
  canvas.width = 420; canvas.height = 400;
  const gpu = await initDevice(canvas);
  const errors = [], records = [];
  gpu.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  gpu.device.pushErrorScope('validation');
  const board = document.createElement('div');
  board.style = 'display:flex;flex-wrap:wrap;background:#17171c;color:white';
  const renderer = await SpriteRenderer.create(gpu);
  const scale = 2.5;
  const capture = async (label) => {
    const row = Array.from(sim.ids()).indexOf(7);
    const x = sim.positions()[row * 2], y = sim.positions()[row * 2 + 1];
    const ox = 210 - (x-y)*32*scale, oy = 260 - (x+y)*21*scale;
    const floors = new Float32Array(FLOATS_PER_INSTANCE * 30);
    let count = 0;
    for (let fx = 0; fx < 6; fx++) for (let fy = 1; fy < 6; fy++) {
      writeInstance(floors, count++, ox+(fx-fy)*32*scale, oy+(fx+fy)*21*scale,
        .95, spriteIndex('floor'));
    }
    renderer.setStaticGeometry(floors, count);
    const instances = buildInstances(sim, 1, ox, oy, 16, null, scale);
    renderer.draw(instances, instanceCount(sim, null), scale);
    await gpu.device.queue.onSubmittedWorkDone();
    const copy = document.createElement('canvas');
    copy.width = 420; copy.height = 400;
    copy.getContext('2d').drawImage(canvas, 0, 0);
    const section = document.createElement('section');
    const title = document.createElement('div');
    title.textContent = label;
    section.style.width = '420px'; copy.style.display = 'block';
    section.append(title, copy); board.append(section);
    return { label, center: [x, y], footprint: [sim.footprintWidths()[row], sim.footprintDepths()[row]],
      sprite: sim.sprites()[row], projection: [...instances.slice(row * FLOATS_PER_INSTANCE + 8,
        row * FLOATS_PER_INSTANCE + 12)] };
  };
  try {
    for (const [facing, name] of ['SE', 'SW', 'NW', 'NE'].entries()) {
      if (!sim.placeObject(7, 2, 3, facing)) throw new Error('Placement queue rejected');
      sim.flushCommands();
      if (sim.lastPlacementResult()?.reason) throw new Error('Table rotation rejected');
      records.push(await capture(name));
    }
    sim.placeObject(7, 2, 3, 0); sim.flushCommands();
    let meal;
    for (let tick = 0; tick < 6000 && !meal; tick++) {
      sim.tick();
      for (let row = 0; row < sim.count; row++) {
        const id = sim.ids()[row];
        if (sim.chainStatusOf(id)?.includes('Eat dinner') && sim.visualActions()[row] === VISUAL_ACTION_EAT) {
          meal = { tick, id, position: [...sim.positions().slice(row * 2, row * 2 + 2)],
            status: sim.chainStatusOf(id), visualAction: sim.visualActions()[row],
            carrying: sim.carrying()[row], target: sim.interactionTargets()[row] };
          break;
        }
      }
    }
    if (!meal) throw new Error('No terminal dinner observed within 6000 ticks');
    await capture('Actual standing dinner');
    document.body.replaceChildren(board); document.body.style.margin = '0';
    const validation = await gpu.device.popErrorScope();
    return { pass: !validation && errors.length === 0, validation: validation?.message ?? null,
      errors, atlas: ATLAS_FILE_NAME, records, meal };
  } finally {
    handle.free(); gpu.device.destroy();
  }
}
