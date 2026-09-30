import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer } from '../src/render/sprites.ts';
import { FLOATS_PER_INSTANCE, writeInstance } from '../src/render/instances.ts';
import { spriteIndex } from '../src/render/atlas.ts';
import { layeredDepth, LAYER_PROP } from '../src/render/iso.ts';
import { buildStaticInstances } from '../src/render/tiles.ts';

/** Real GPU coverage, blending and near/far arm depth; no shader-source mocks. */
export async function cutawayWallProof() {
  const canvas = document.createElement('canvas');
  canvas.width = 440; canvas.height = 400;
  const gpu = await initDevice(canvas);
  gpu.device.pushErrorScope('validation');
  const renderer = await SpriteRenderer.create(gpu);
  const step = layeredDepth(0, 0, 16, LAYER_PROP) - layeredDepth(1, 0, 16, LAYER_PROP);
  const wall = new Float32Array(FLOATS_PER_INSTANCE);
  const marker = new Float32Array(FLOATS_PER_INSTANCE);
  const empty = new Float32Array();
  const copy = document.createElement('canvas'); copy.width = 440; copy.height = 400;
  const ctx = copy.getContext('2d');
  const results = [];
  const sample = async (scale, px, py, useWall) => {
    renderer.setStaticGeometry(empty, 0, useWall ? wall : empty);
    renderer.draw(marker, 1, scale);
    await gpu.device.queue.onSubmittedWorkDone();
    ctx.drawImage(canvas, 0, 0);
    return [...ctx.getImageData(px, py, 1, 1).data];
  };
  try {
    for (const scale of [1, 1.75, 3]) {
      for (let mask = 1; mask <= 15; mask++) {
        for (const sign of [-1, 1]) {
          const near = sign > 0 ? 2 : 4, far = sign > 0 ? 1 : 8;
          // Sample the lower near face and the exposed far arm above a join.
          for (const top of [false, true]) {
            const bit = top ? far : ((mask & near) ? near : far);
            if (!(mask & bit)) continue;
            const localX = sign * 8;
            const localY = top ? -26 : -12;
            // Quarter-pixel origin keeps probes off integer source-column
            // boundaries, where interpolation precision can choose either texel.
            const px = Math.floor(220.25 + localX * scale), py = Math.floor(220.25 + localY * scale);
            // Independently bracket the plane at the actual fragment's source column.
            const rasterX = Math.floor((px + .5 - 220.25) / scale);
            const offset = Math.abs(rasterX) / 32 * (bit === near ? 1 : -1);
            const depth = .5 - offset * step;
            writeInstance(wall, 0, 220.25, 220.25, .5, spriteIndex(`wallLow${mask}`), 1, 1, 1, 0, mask, step);
            wall[10] = 1; wall[11] = 26;
            // Magenta floor tile serves as a solid depth probe through the wall face.
            writeInstance(marker, 0, px + .5, py + .5, depth + .02 * step, spriteIndex('floor'), 1, 0, 1);
            const background = await sample(scale, px, py, false);
            const opaque = await sample(scale, px, py, true);
            wall[10] = .25;
            const faded = await sample(scale, px, py, true);
            const blends = faded.slice(0, 3).every((value, c) => Math.abs(value - (opaque[c] * .25 + background[c] * .75)) <= 2);
            marker[2] = depth - .02 * step;
            const front = await sample(scale, px, py, true);
            const frontWins = front.every((value, c) => value === background[c]);
            const covered = opaque.some((value, c) => value !== background[c]);
            results.push({ scale, mask, sign, top, blends, frontWins, covered,
              pass: blends && frontWins && covered });
          }
        }
      }
    }
    // Equal-depth translucent surfaces must both blend. This fails if draw
    // binds a depth-writing pipeline, even if its descriptor source looks right.
    writeInstance(wall, 0, 220, 220, .5, spriteIndex('wallLow10'), 1, 1, 1, 0, 10, step);
    wall[10] = .25; wall[11] = 26;
    writeInstance(marker, 0, -1000, -1000, .5, spriteIndex('floor'));
    const base = await sample(1, 228, 208, false);
    const single = await sample(1, 228, 208, true);
    const pair = new Float32Array(FLOATS_PER_INSTANCE * 2); pair.set(wall); pair.set(wall, FLOATS_PER_INSTANCE);
    renderer.setStaticGeometry(empty, 0, pair);
    renderer.draw(empty, 0);
    await gpu.device.queue.onSubmittedWorkDone(); ctx.drawImage(canvas, 0, 0);
    const twice = [...ctx.getImageData(228, 208, 1, 1).data];
    results.push({ depthWrites: false, pass: twice.slice(0, 3).every((v, c) =>
      Math.abs(v - (single[c] * 1.75 - base[c] * .75)) <= 2)
      && twice.some((v, c) => Math.abs(v - single[c]) > 8) });

    // A single straight face must blend once across panel seams. Distinct
    // crossing walls can legitimately overlap in projection and blend twice.
    for (const scale of [1, 1.75, 3]) for (const axis of [0, 1]) {
      const geometry = buildStaticInstances({ width: 5, height: 5, walls: new Uint32Array(),
        edges: Uint32Array.from(axis === 0 ? [0, 2, 0, 0, 0, 2, 1, 0, 0, 2, 2, 0]
          : [1, 0, 2, 0, 1, 1, 2, 0, 1, 2, 2, 0]) }, 220, 90, 16, scale);
      writeInstance(marker, 0, -1000, -1000, .5, spriteIndex('floor'));
      const capture = async rows => {
        renderer.setStaticGeometry(empty, 0, rows);
        renderer.draw(marker, 1, scale);
        await gpu.device.queue.onSubmittedWorkDone();
        ctx.drawImage(canvas, 0, 0);
        return ctx.getImageData(0, 0, 440, 400).data;
      };
      const background = await capture(empty);
      const opaque = await capture(geometry.lowInstances);
      for (let i = 0; i < geometry.lowPanels.length; i++) geometry.lowInstances[i * FLOATS_PER_INSTANCE + 10] = .25;
      const faded = await capture(geometry.lowInstances);
      let bad = 0, covered = 0;
      for (let i = 0; i < opaque.length; i += 4) {
        if (Math.abs(opaque[i] - background[i]) < 8) continue;
        covered++;
        if ([0, 1, 2].some(c => Math.abs(faded[i + c] - (opaque[i + c] * .25 + background[i + c] * .75)) > 2)) bad++;
      }
      results.push({ scale, axis, seam: true, bad, covered, pass: bad === 0 && covered > 200 });
    }
    const error = await gpu.device.popErrorScope();
    return { pass: !error && results.every(r => r.pass), count: results.length,
      failures: results.filter(r => !r.pass), error: error?.message ?? null };
  } finally { gpu.device.destroy(); }
}
