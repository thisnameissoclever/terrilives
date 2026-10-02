import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer } from '../src/render/sprites.ts';
import { FLOATS_PER_INSTANCE as STRIDE, writeInstance } from '../src/render/instances.ts';
import { writePortals } from '../src/render/portals.ts';
import { spriteIndex } from '../src/render/atlas.ts';
import { layeredDepth, LAYER_SIM, LAYER_PROP, FLOOR_DEPTH } from '../src/render/iso.ts';
import { simBodySprite, VISUAL_ACTION_WALK } from '../src/frame.ts';
import { spriteDrawOffsetX, spriteDrawOffsetY } from '../src/render/sprite-anchors.ts';

const vectors = [[1, 0], [0, 1], [-1, 0], [0, -1]];
function source(facing, phase) {
  const [dx, dy] = vectors[facing];
  return {
    portalCount: 1, portalPositions: () => new Float32Array([3, 2]),
    portalFrames: () => new Uint32Array([spriteIndex('frontDoorFrameSELeft')]),
    portalDepthOffsets: () => new Float32Array([(dx + dy) / 2]),
    portalLeaves: reduced => new Uint32Array([spriteIndex(phase === 0 ? 'frontDoorClosedSELeft' : reduced || phase === 8 ? 'frontDoorOpenSELeft' : 'frontDoorAjarSELeft')]),
    portalOpenness: () => new Float32Array([phase / 8]),
    portalPreviousOpenness: () => new Float32Array([phase / 8]),
    portalFarSides: () => new Float32Array([3 + dx, 2 + dy]),
  };
}
const rotate = (x, y, facing) => [[x, y], [-y, x], [-x, -y], [y, -x]][facing];

export async function doorDepthProof({ show = false, progress = () => {} } = {}) {
  const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 400;
  progress({ stage: 'device' });
  const gpu = await initDevice(canvas);
  gpu.device.pushErrorScope('validation');
  let renderer;
  const results = [];
  const copy = document.createElement('canvas'); copy.width = 360; copy.height = 400;
  const ctx = copy.getContext('2d');
  const sample = async (rows, count, scale, px, py) => {
    renderer.draw(rows, count, scale);
    await gpu.device.queue.onSubmittedWorkDone();
    ctx.drawImage(canvas, 0, 0);
    return [...ctx.getImageData(px, py, 1, 1).data];
  };
  try {
    progress({ stage: 'renderer' });
    renderer = await SpriteRenderer.create(gpu);
    for (const scale of [1, 1.75, 3]) for (let facing = 0; facing < 4; facing++) {
      for (let phase = 0; phase < 9; phase++) {
        progress({ stage: 'case', scale, facing, phase });
        const rows = new Float32Array(2 * STRIDE);
        writePortals(rows, 0, source(facing, phase), 180 - 32 * scale, 320 - 105 * scale, 16, scale, false, null);
        const theta = phase / 8 * Math.PI / 2;
        const normal = Math.cos(theta + facing * Math.PI / 2) + Math.sin(theta + facing * Math.PI / 2);
        const points = [{ part: 0, xyz: [...rotate(.5, 0, facing), 0], kind: 'threshold' }];
        const [hx, hy] = rotate(.465, -.365, facing);
        const nx = Math.cos(theta + facing * Math.PI / 2), ny = Math.sin(theta + facing * Math.PI / 2);
        if (Math.abs(normal) > .2) {
          const side = Math.sign(normal);
          const x = .465 + side * .042 * Math.cos(theta) - .365 * Math.sin(theta);
          const y = -.365 + side * .042 * Math.sin(theta) + .365 * Math.cos(theta);
          points.push({ part: 1, xyz: [...rotate(x, y, facing), .65], kind: 'leaf',
            plane: [nx, ny, nx * hx + ny * hy + side * .042] });
        } else {
          // Look straight onto the slab's hinge or latch edge, using its
          // physical end plane instead of the broad face's singular plane.
          const ex = -ny, ey = nx, end = ex + ey > 0 ? .73 : 0;
          points.push({ part: 1, xyz: [hx + ex * end, hy + ey * end, .65], kind: 'edge',
            plane: [ex, ey, ex * hx + ey * hy + end] });
        }
        for (const [kind, y0, y1, z] of [['post', .39, .5, .9], ['header', -.5, .5, 1.9]]) {
          const corners = [[.43,y0],[.57,y0],[.43,y1],[.57,y1]].map(([x,y])=>rotate(x,y,facing));
          // The frontmost intersection of the screen column and this solid
          // rectangle is independent of the exporter's ray-cast depth map.
          points.push({ part: 0, xyz: [...rotate(facing < 2 ? .57 : .43, (y0+y1)/2, facing), z], kind,
            bounds: [Math.max(...corners.map(p=>p[0])), Math.max(...corners.map(p=>p[1]))] });
        }
        for (const { part, xyz: [x, y, z], kind, plane, bounds } of points) for (const reverse of [false, true]) {
          const px = Math.floor(180 + (x - y) * 32 * scale);
          const py = Math.floor(320 + (x + y) * 21 * scale - z * 38 * scale);
          const column = (px + .5 - 180) / (32 * scale);
          const floor = kind === 'threshold';
          const pixelSum = floor ? 0 : bounds ? Math.min(2*bounds[0]-column, 2*bounds[1]+column)
            : (2*plane[2]-(plane[0]-plane[1])*column)/(plane[0]+plane[1]);
          let pass = true;
          for (const [delta, wins] of floor ? [[.97, true], [FLOOR_DEPTH, false]] : [[.065, true], [-.065, false]]) {
            const marker = new Float32Array(STRIDE);
            writeInstance(marker, 0, px + .5, py + .5,
              floor ? delta : layeredDepth(3 + pixelSum + delta, 2, 16, part === 0 ? LAYER_PROP : 3), spriteIndex('floor'), 1, 0, 1);
            const expected = await sample(marker, 1, scale, px, py);
            const trial = new Float32Array(2 * STRIDE);
            trial.set(rows.subarray(part * STRIDE, (part + 1) * STRIDE), reverse ? STRIDE : 0);
            trial.set(marker, reverse ? 0 : STRIDE);
            const actual = await sample(trial, 2, scale, px, py);
            pass &&= actual.every((v, c) => v === expected[c]) === wins;
          }
          results.push({ scale, facing, phase, part, kind, reverse, pass });
        }
      }
    }
    if (show) {
      const board = document.createElement('div');
      board.style = 'display:grid;grid-template-columns:repeat(3,360px);gap:8px;background:#d0cdc6;color:#222';
      document.body.replaceChildren(board);
      for (let facing = 0; facing < 4; facing++) for (const phase of [0, 4, 8]) {
        const rows = new Float32Array(3 * STRIDE), scale = 3;
        writePortals(rows, 0, source(facing, phase), 84, 5, 16, scale, false, null);
        const [dx, dy] = vectors[facing];
        const x = 3 + dx * .48, y = 2 + dy * .48;
        const sprite = simBodySprite(1, VISUAL_ACTION_WALK, facing + 1, 0, false, x, y);
        writeInstance(rows, 2, 84 + (x - y) * 32 * scale + spriteDrawOffsetX(sprite) * scale,
          5 + (x + y) * 21 * scale + spriteDrawOffsetY(sprite) * scale,
          layeredDepth(x, y, 16, LAYER_SIM), sprite);
        renderer.draw(rows, phase === 0 ? 2 : 3, scale);
        await gpu.device.queue.onSubmittedWorkDone();
        const view = document.createElement('canvas'); view.width = 360; view.height = 400;
        view.getContext('2d').drawImage(canvas, 0, 0);
        const cell = document.createElement('div'); cell.append(`Orientation ${facing + 1}, ${phase * 90 / 8} degrees`, view); board.append(cell);
      }
    }
    const error = await gpu.device.popErrorScope();
    return { pass: !error && results.length === 864 && results.every(r => r.pass), error: error?.message ?? null, results };
  } finally { gpu.device.destroy(); }
}
