import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.ts';
import { buildInstances, instanceCount, simShirtVariant } from '../src/frame.ts';
import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer } from '../src/render/sprites.ts';
import { FLOATS_PER_INSTANCE, writeInstance } from '../src/render/instances.ts';
import { spriteIndex, ATLAS_FILE_NAME, INTERACTION_SPRITES } from '../src/render/atlas.ts';
import { buildLightField, sampleLight, emissiveForSprite } from '../src/render/lighting.ts';
import { ambientFor, AMBIENT_NEUTRAL } from '../src/render/daylight.ts';

// Isolated real-renderer fixtures. Production UI use is a separate played check.
export async function ottomanProof() {
  const { memory } = await init();
  const handle = SimHandle.from_lot();
  const sim = new SimBridge(handle, memory);
  const canvas = document.createElement('canvas');
  canvas.width = 400; canvas.height = 340;
  const gpu = await initDevice(canvas);
  const errors = [], records = [];
  const baseline = sim.saveBytes();
  gpu.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  gpu.device.pushErrorScope('validation');
  try {
    const renderer = await SpriteRenderer.create(gpu);
    const board = document.createElement('div');
    board.style = 'display:flex;flex-wrap:wrap;width:1600px;background:#17171c;color:white';
    const scale = 3, x = 12, y = 3;
    const ox = 200-(x-y)*32*scale, oy = 280-(x+y)*21*scale;
    const floors = new Float32Array(FLOATS_PER_INSTANCE * 9);
    let count = 0;
    for (let fx = x-1; fx <= x+1; fx++) for (let fy = y-1; fy <= y+1; fy++) {
      writeInstance(floors, count++, ox+(fx-fy)*32*scale, oy+(fx+fy)*21*scale, .95, spriteIndex('floor'));
    }
    renderer.setStaticGeometry(floors, count);
    const capture = async (label, night = false, preview = null, seated = null) => {
      const row = Array.from(sim.ids()).indexOf(18);
      const light = buildLightField(sim, 16, 12, sim.wallTiles(), true, sim.wallEdges());
      const selected = preview ? 18 : null;
      const instances = buildInstances(sim, 1, ox, oy, 16, selected, scale,
        seated?.reducedMotion ?? false, seated?.tick ?? 0,
        light, undefined, preview, null, sim.objectColourway(18));
      renderer.draw(instances, instanceCount(sim, selected, undefined, preview), scale,
        night ? ambientFor(0, 1340) : AMBIENT_NEUTRAL);
      await gpu.device.queue.onSubmittedWorkDone();
      const copy = document.createElement('canvas'); copy.width = 400; copy.height = 340;
      copy.getContext('2d').drawImage(canvas, 0, 0);
      const section = document.createElement('section'), title = document.createElement('div');
      title.textContent = label; section.style.width = '400px'; copy.style.display = 'block';
      section.append(title, copy); board.append(section);
      const actorRow = seated ? Array.from(sim.ids()).indexOf(seated.agent) : -1;
      if (seated && (actorRow < 0 || sim.visualActions()[actorRow] !== 8 ||
          sim.interactionTargets()[actorRow] !== 18)) throw new Error('Wrong active sitting target');
      const body = seated ? actorRow : preview ? instanceCount(sim, selected, undefined, preview) - 1 : row;
      if (preview && (instances[row*FLOATS_PER_INSTANCE] !== -1e6 ||
          instances[row*FLOATS_PER_INSTANCE+1] !== -1e6)) throw new Error('Old ottoman preview row still visible');
      const variant = seated ? simShirtVariant(sim.simIds()[actorRow]) : null;
      const expectedBody = seated ? INTERACTION_SPRITES[sim.sprites()[row]].frames[variant][seated.sample]
        : sim.sprites()[row];
      if (instances[body*FLOATS_PER_INSTANCE+3] !== expectedBody) throw new Error('Wrong ottoman body');
      if (seated && instances[row*FLOATS_PER_INSTANCE] !== -1e6) throw new Error('Empty ottoman remains visible while occupied');
      const record = { label, facing: sim.objectFacing(18), sprite: sim.sprites()[row],
        colourway: sim.objectColourway(18), entity: 18, sourceEmissive: emissiveForSprite(sim.sprites()[row]),
        renderedLight: instances[body*FLOATS_PER_INSTANCE+7], tileLight: sampleLight(light, x, y),
        occupied: seated ? { ...seated, variant, body: expectedBody, target: 18, action: 8 } : null };
      const expectedShift = sim.colourwayShifts().slice(record.colourway*3, record.colourway*3+3);
      expectedShift[1] -= 1;
      const actualShift = instances.slice(body*FLOATS_PER_INSTANCE+12, body*FLOATS_PER_INSTANCE+15);
      if (actualShift.some((value, index) => value !== expectedShift[index])) throw new Error('Rendered colour differs after load');
      if (record.sourceEmissive !== 0 || Math.abs(record.renderedLight-record.tileLight) > .000001) {
        throw new Error('Ottoman emission or received room light changed');
      }
      records.push(record);
    };
    for (const [facing, name] of ['SE', 'SW', 'NW', 'NE'].entries()) {
      if (!sim.placeObject(18, x, y, facing)) throw new Error('Placement rejected');
      sim.flushCommands();
      if (sim.lastPlacementResult()?.reason) throw new Error('Ottoman rotation rejected');
      if (!sim.loadBytes(sim.saveBytes())) throw new Error('Save round trip failed');
      await capture(name); await capture(`${name}: midnight`, true);
    }
    sim.placeObject(18, x, y, 0); sim.flushCommands();
    for (const [colourway, name] of sim.colourwayNames().entries()) {
      sim.setColourway(18, colourway); sim.flushCommands();
      if (!sim.loadBytes(sim.saveBytes())) throw new Error('Recoloured save round trip failed');
      await capture(name);
    }
    sim.setColourway(18, 0); sim.flushCommands();
    await capture('Build preview', false, sim.placementPreview(18, x, y, 0));
    for (const agent of [34, 35, 36]) {
      for (const [facing, name] of ['SE', 'SW', 'NW', 'NE'].entries()) {
        if (!sim.loadBytes(baseline)) throw new Error('Fixture reset failed');
        if (!sim.placeObject(18, x, y, facing)) throw new Error('Occupied placement rejected');
        sim.flushCommands();
        if (sim.lastPlacementResult()?.reason) throw new Error('Occupied rotation rejected');
        if (!sim.useObjectFirst(agent, 18, 0)) throw new Error('Sitting request rejected');
        const actorRow = Array.from(sim.ids()).indexOf(agent);
        for (let tick = 0; tick < 1200; tick++) {
          if (sim.visualActions()[actorRow] === 8 && sim.interactionTargets()[actorRow] === 18) break;
          sim.tick();
        }
        if (sim.visualActions()[actorRow] !== 8 || sim.interactionTargets()[actorRow] !== 18 ||
            sim.activityOf(agent) !== 11) throw new Error('Target-bound Sit did not start');
        const variant = simShirtVariant(sim.simIds()[actorRow]);
        const saved = sim.saveBytes();
        if (!sim.loadBytes(saved)) throw new Error('Occupied save round trip failed');
        // Explicit draw ticks inspect the complete clip without extending the action.
        for (let sample = 0; sample < 4; sample++) {
          await capture(`${name} ${variant}: sample ${sample}`, false, null,
            { agent, sample, tick: 20 + 5 * sample - agent % 10 });
        }
        await capture(`${name} ${variant}: reduced motion`, false, null,
          { agent, sample: 0, tick: 999, reducedMotion: true });
        if (facing === 0 && agent === 34) {
          for (const [colourway, colourName] of sim.colourwayNames().entries()) {
            sim.setColourway(18, colourway); sim.flushCommands();
            if (!sim.loadBytes(sim.saveBytes())) throw new Error('Occupied colour save failed');
            await capture(`Seated blue shirt: ${colourName}`, false, null,
              { agent, sample: 0, tick: 20 - agent % 10 });
          }
          sim.setColourway(18, 0); sim.flushCommands();
          await capture('Seated blue shirt: midnight', true, null,
            { agent, sample: 0, tick: 20 - agent % 10 });
        }
        if (!sim.cancelIntents(agent)) throw new Error('Sitting cancellation rejected');
        sim.tick();
        await capture(`${name} ${variant}: cancelled`);
      }
    }
    document.body.replaceChildren(board); document.body.style.margin = '0';
    const validation = await gpu.device.popErrorScope();
    return { pass: !validation && !errors.length, validation: validation?.message ?? null,
      errors, atlas: ATLAS_FILE_NAME, records };
  } finally { handle.free(); gpu.device.destroy(); }
}
