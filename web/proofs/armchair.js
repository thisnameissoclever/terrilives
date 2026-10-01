import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.ts';
import { buildInstances, instanceCount, simShirtVariant } from '../src/frame.ts';
import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer } from '../src/render/sprites.ts';
import { FLOATS_PER_INSTANCE, writeInstance } from '../src/render/instances.ts';
import { spriteIndex, ATLAS_FILE_NAME, INTERACTION_SPRITES } from '../src/render/atlas.ts';
import { ambientFor, AMBIENT_NEUTRAL } from '../src/render/daylight.ts';

// Real WASM placements and target-bound frame writers on an isolated proof page.
// Explicit draw ticks expose every authored sample without extending the Sit action.
export async function armchairProof() {
  const { memory } = await init();
  const canvas = document.createElement('canvas');
  canvas.width = 360; canvas.height = 300;
  const gpu = await initDevice(canvas);
  const errors = [], records = [];
  gpu.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  gpu.device.pushErrorScope('validation');
  const board = document.createElement('div');
  board.style = 'display:flex;flex-wrap:wrap;width:1440px;background:#17171c;color:white';
  try {
    const renderer = await SpriteRenderer.create(gpu);
    const scale = 3, ox = 180 - 9 * 32 * scale, oy = 240 - 17 * 21 * scale;
    const floors = new Float32Array(FLOATS_PER_INSTANCE * 9);
    let count = 0;
    for (let x = 12; x <= 14; x++) for (let y = 3; y <= 5; y++) {
      writeInstance(floors, count++, ox + (x-y)*32*scale, oy + (x+y)*21*scale,
        .95, spriteIndex('floor'));
    }
    renderer.setStaticGeometry(floors, count);
    const capture = async (sim, label, tick, preview = null, night = false) => {
      const selected = preview ? 12 : null;
      const data = buildInstances(sim, 1, ox, oy, 16, selected, scale, false, tick,
        null, undefined, preview, null, sim.objectColourway(12));
      renderer.draw(data, instanceCount(sim, selected, undefined, preview), scale,
        night ? ambientFor(0, 1440) : AMBIENT_NEUTRAL);
      await gpu.device.queue.onSubmittedWorkDone();
      const copy = document.createElement('canvas'); copy.width = 360; copy.height = 300;
      copy.getContext('2d').drawImage(canvas, 0, 0);
      const section = document.createElement('section');
      section.dataset.proof = label; section.style.width = '360px';
      const title = document.createElement('div'); title.textContent = label;
      section.append(title, copy); board.append(section);
      return data;
    };
    for (let agentCount = 0; agentCount <= 3; agentCount++) {
      for (const [facing, suffix] of ['', 'SW', 'NW', 'NE'].entries()) {
        const handle = SimHandle.from_lot(), sim = new SimBridge(handle, memory);
        try {
          const chair = 12, chairRow = Array.from(sim.ids()).indexOf(chair);
          sim.placeObject(chair, 13, 4, facing); sim.flushCommands();
          if (sim.lastPlacementResult()?.reason) throw new Error('Facing rejected');
          if (!sim.loadBytes(sim.saveBytes())) throw new Error('Save round trip failed');
          const empty = spriteIndex(`offlineArmchair${suffix}`);
          if (sim.sprites()[chairRow] !== empty) throw new Error('Wrong compiled facing');
          if (!agentCount) {
            await capture(sim, `${suffix || 'SE'} empty`, 0);
            records.push({ facing, empty });
            continue;
          }
          const agent = 33 + agentCount, row = Array.from(sim.ids()).indexOf(agent);
          sim.useObjectFirst(agent, chair, 0);
          for (let tick = 0; tick < 1200 && sim.visualActions()[row] !== 8; tick++) sim.tick();
          if (sim.visualActions()[row] !== 8 || sim.interactionTargets()[row] !== chair) {
            throw new Error('Sit did not become the active target-bound action');
          }
          const variant = simShirtVariant(sim.simIds()[row]);
          for (let sample = 0; sample < 4; sample++) {
            const tick = 48 + sample * 12 - agent % 24;
            const data = await capture(sim, `${suffix || 'SE'} ${variant} frame ${sample}`, tick);
            const body = data[row * FLOATS_PER_INSTANCE + 3];
            if (data[chairRow * FLOATS_PER_INSTANCE] !== -1e6 || body !== INTERACTION_SPRITES[empty].frames[variant][sample]) {
              throw new Error('Wrong occupied sample or unsuppressed empty chair');
            }
            records.push({ facing, variant, sample, body, tick });
          }
        } finally { handle.free(); }
      }
    }
    const handle = SimHandle.from_lot(), sim = new SimBridge(handle, memory);
    try {
      const chair = 12;
      sim.placeObject(chair, 13, 4, 0); sim.flushCommands();
      if (sim.lastPlacementResult()?.reason) throw new Error('Colourway placement rejected');
      for (const [colourway, name] of sim.colourwayNames().entries()) {
        sim.setColourway(chair, colourway); sim.flushCommands();
        await capture(sim, name, 0); records.push({ colourway, name });
      }
      sim.setColourway(chair, 0); sim.flushCommands();
      await capture(sim, 'Midnight', 0, null, true);
      await capture(sim, 'Selected Build preview', 0, sim.placementPreview(chair, 13, 4, 0));
      records.push({ night: true }, { preview: true });
      sim.useObjectFirst(34, chair, 0);
      const row = Array.from(sim.ids()).indexOf(34);
      for (let tick = 0; tick < 1200 && sim.visualActions()[row] !== 8; tick++) sim.tick();
      if (sim.visualActions()[row] !== 8 || sim.interactionTargets()[row] !== chair) {
        throw new Error('Occupied colourway probe never entered Sit');
      }
      for (const [colourway, name] of sim.colourwayNames().entries()) {
        sim.setColourway(chair, colourway); sim.flushCommands();
        await capture(sim, `Seated blue shirt: ${name}`, sim.clockTick());
        records.push({ occupied: true, colourway, name });
      }
      sim.setColourway(chair, 0); sim.flushCommands();
      await capture(sim, 'Seated blue shirt: midnight', sim.clockTick(), null, true);
      records.push({ occupied: true, night: true });
    } finally { handle.free(); }
    document.body.replaceChildren(board); document.body.style.margin = '0';
    const validation = await gpu.device.popErrorScope();
    return { pass: !validation && !errors.length, validation: validation?.message ?? null,
      errors, atlas: ATLAS_FILE_NAME, records };
  } finally { gpu.device.destroy(); }
}
