import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.ts';
import { buildInstances, instanceCount } from '../src/frame.ts';
import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer } from '../src/render/sprites.ts';
import { FLOATS_PER_INSTANCE, writeInstance } from '../src/render/instances.ts';
import { spriteIndex, ATLAS_FILE_NAME } from '../src/render/atlas.ts';
import { buildLightField, sampleLight, emissiveForSprite } from '../src/render/lighting.ts';
import { ambientFor, AMBIENT_NEUTRAL } from '../src/render/daylight.ts';

// Isolated real-renderer fixtures. Production UI use is a separate played check.
export async function bookcaseProof() {
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
    const scale = 3, x = 8, y = 0;
    const ox = 200-(x-y)*32*scale, oy = 280-(x+y)*21*scale;
    const floors = new Float32Array(FLOATS_PER_INSTANCE * 9);
    let count = 0;
    for (let fx = x-1; fx <= x+1; fx++) for (let fy = y-1; fy <= y+1; fy++) {
      writeInstance(floors, count++, ox+(fx-fy)*32*scale, oy+(fx+fy)*21*scale, .95, spriteIndex('floor'));
    }
    renderer.setStaticGeometry(floors, count);
    const capture = async (label, night = false, preview = null, isolated = false) => {
      const row = Array.from(sim.ids()).indexOf(10);
      const light = buildLightField(sim, 16, 12, sim.wallTiles(), true, sim.wallEdges());
      const selected = preview ? 10 : null;
      const instances = buildInstances(sim, 1, ox, oy, 16, selected, scale, false, 0,
        light, undefined, preview, null, sim.objectColourway(10));
      const drawn = isolated ? instances.slice(row*FLOATS_PER_INSTANCE, (row+1)*FLOATS_PER_INSTANCE) : instances;
      renderer.draw(drawn, isolated ? 1 : instanceCount(sim, selected, undefined, preview), scale,
        night ? ambientFor(0, 1340) : AMBIENT_NEUTRAL);
      await gpu.device.queue.onSubmittedWorkDone();
      const copy = document.createElement('canvas'); copy.width = 400; copy.height = 340;
      copy.getContext('2d').drawImage(canvas, 0, 0);
      const section = document.createElement('section'), title = document.createElement('div');
      title.textContent = label; section.style.width = '400px'; copy.style.display = 'block';
      section.append(title, copy); board.append(section);
      const body = preview ? instanceCount(sim, selected, undefined, preview) - 1 : row;
      if (preview && (instances[row*FLOATS_PER_INSTANCE] !== -1e6 ||
          instances[row*FLOATS_PER_INSTANCE+1] !== -1e6)) throw new Error('Old bookcase preview row still visible');
      if (instances[body*FLOATS_PER_INSTANCE+3] !== sim.sprites()[row]) throw new Error('Wrong bookcase body');
      const record = { label, isolated, facing: sim.objectFacing(10), sprite: sim.sprites()[row],
        colourway: sim.objectColourway(10), entity: 10, sourceEmissive: emissiveForSprite(sim.sprites()[row]),
        renderedLight: instances[body*FLOATS_PER_INSTANCE+7], tileLight: sampleLight(light, x, y) };
      const expectedShift = sim.colourwayShifts().slice(record.colourway*3, record.colourway*3+3);
      expectedShift[1] -= 1;
      const actualShift = instances.slice(body*FLOATS_PER_INSTANCE+12, body*FLOATS_PER_INSTANCE+15);
      if (actualShift.some((value, index) => value !== expectedShift[index])) throw new Error('Rendered colour differs after load');
      if (record.sourceEmissive !== 0 || Math.abs(record.renderedLight-record.tileLight) > .000001) {
        throw new Error('Bookcase emission or received room light changed');
      }
      records.push(record);
    };
    for (const [facing, name] of ['SE', 'SW', 'NW', 'NE'].entries()) {
      if (!sim.placeObject(10, x, y, facing)) throw new Error('Placement rejected');
      sim.flushCommands();
      if (sim.lastPlacementResult()?.reason) throw new Error('Bookcase rotation rejected');
      if (!sim.loadBytes(sim.saveBytes())) throw new Error('Save round trip failed');
      await capture(`${name}: isolated`, false, null, true); await capture(`${name}: midnight room`, true);
    }
    sim.placeObject(10, x, y, 0); sim.flushCommands();
    for (const [colourway, name] of sim.colourwayNames().entries()) {
      sim.setColourway(10, colourway); sim.flushCommands();
      if (!sim.loadBytes(sim.saveBytes())) throw new Error('Recoloured save round trip failed');
      await capture(name);
    }
    sim.setColourway(10, 0); sim.flushCommands();
    await capture('Build preview', false, sim.placementPreview(10, x, y, 0));
    if (JSON.stringify(sim.interactionLabels(10)) !== JSON.stringify(['Read a book'])) throw new Error('Bookcase interaction changed');
    document.body.replaceChildren(board); document.body.style.margin = '0';
    const validation = await gpu.device.popErrorScope();
    return { pass: !validation && !errors.length, validation: validation?.message ?? null,
      errors, atlas: ATLAS_FILE_NAME, records, interactionLabels: sim.interactionLabels(10) };
  } finally { handle.free(); gpu.device.destroy(); }
}
