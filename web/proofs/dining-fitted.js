import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer, packSpriteTable } from '../src/render/sprites.ts';
import { buildInstances } from '../src/frame.ts';
import { InteractionSelection } from '../src/render/interaction-sprites.ts';
import { INTERACTION_SPRITES, SPRITE_PAIRS, spriteIndex } from '../src/render/atlas.ts';
import { FLOATS_PER_INSTANCE } from '../src/render/instances.ts';
import manifest from '../../assets/models/domestic/export/seated-dining/manifest.json';

const images = import.meta.glob('../../assets/models/domestic/export/seated-dining/*.png',
  { eager: true, query: '?url', import: 'default' });

export async function diningFittedProof() {
  const canvas = document.createElement('canvas');
  canvas.width = 160; canvas.height = 224;
  const gpu = await initDevice(canvas);
  const errors = [], records = [];
  gpu.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  gpu.device.pushErrorScope('validation');
  const board = document.createElement('div');
  board.style = 'display:flex;flex-wrap:wrap;width:640px;background:#17171c;color:white';
  try {
    const renderer = await SpriteRenderer.create(gpu);
    renderer.setStaticGeometry(new Float32Array(0), 0);
    const positions = new Float32Array([0, 0, 0, 0]), none = 0xffffffff;
    const table = packSpriteTable();
    for (const facing of ['SE', 'SW', 'NW', 'NE']) {
      const empty = spriteIndex('offlineDiningChair' + (facing === 'SE' ? '' : facing));
      const source = { count: 2, positions: () => positions, prevPositions: () => positions,
        ids: () => new Uint32Array([101, 102]), kinds: () => new Uint32Array([1, 0]),
        sprites: () => new Uint32Array([empty, spriteIndex('sim')]),
        activities: () => new Uint32Array([0, 3]), visualActions: () => new Uint32Array([0, 13]),
        interactionTargets: () => new Uint32Array([none, 101]),
        // Isolate occupied art using a co-located support transform.
        mealTables: () => new Uint32Array([none, 101]),
        simIds: () => new Uint32Array([none, 0]), facings: () => new Uint32Array(2),
        itemKinds: () => [], carrying: () => new Uint32Array(2).fill(none) };
      for (const variant of ['green', 'blue', 'red']) {
        const selection = new InteractionSelection(INTERACTION_SPRITES, () => variant);
        for (let phase = 0; phase < 8; phase++) {
          const tick = phase * 4 - 102 % 16 + 32;
          const data = buildInstances(source, 1, 80, 182, 16, null, 2, false, tick, null, selection);
          const sprite = data[FLOATS_PER_INSTANCE + 3];
          if (sprite !== INTERACTION_SPRITES[empty].frames[variant][phase] || data[0] !== -1e6) {
            throw new Error('Occupied diner is not anchored to its suppressed chair');
          }
          // Compare occupied art alone; activity bubbles are separate UI sprites.
          renderer.draw(data, source.count + 1, 2);
          await gpu.device.queue.onSubmittedWorkDone();
          const copy = document.createElement('canvas'); copy.width = 160; copy.height = 224;
          const context = copy.getContext('2d'); context.drawImage(canvas, 0, 0);
          const actual = context.getImageData(0, 0, 160, 224).data;
          const row = manifest.frames.find(row => row.facing === facing && row.variant === variant && row.frame === phase);
          const url = images['../../assets/models/domestic/export/seated-dining/' + row.reference.path];
          const bitmap = await createImageBitmap(await (await fetch(url)).blob(),
            { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
          const expectedCanvas = document.createElement('canvas'); expectedCanvas.width = 160; expectedCanvas.height = 224;
          const expectedContext = expectedCanvas.getContext('2d'); expectedContext.drawImage(bitmap, 0, 0); bitmap.close();
          const reference = expectedContext.getImageData(0, 0, 160, 224).data;
          const compare = values => {
            const differences = [];
            let worst = null;
            for (let pixel = 0; pixel < reference.length; pixel += 4) {
              if (reference[pixel + 3] < 250) continue;
              const alpha = reference[pixel + 3] / 255;
              const error = Math.max(...[0, 1, 2].map(c => Math.abs(values[pixel + c] - reference[pixel + c] / alpha)));
              differences.push(error);
              if (!worst || error > worst.error) worst = { error, x: pixel / 4 % 160, y: Math.floor(pixel / 4 / 160),
                actual: Array.from(values.slice(pixel, pixel + 4)), reference: Array.from(reference.slice(pixel, pixel + 4)) };
            }
            differences.sort((a, b) => a - b);
            return { p95: differences[Math.floor(differences.length * .95)], max: differences.at(-1), pixels: differences.length, worst };
          };
          const metrics = compare(actual);
          if (metrics.p95 > 12 || metrics.max > 64) {
            const section = document.createElement('section'); section.append(copy);
            board.append(section); document.body.replaceChildren(board);
            throw new Error(JSON.stringify({ facing, variant, phase, ...metrics }));
          }
          if (variant === 'green' && phase === 4) {
            const broken = table.slice(); broken[sprite * 8 + 6] = 0; broken[sprite * 8 + 7] = 0;
            try {
              gpu.device.queue.writeBuffer(renderer.spriteBuffer, 0, broken);
              renderer.draw(data, source.count + 1, 2);
              await gpu.device.queue.onSubmittedWorkDone();
              context.drawImage(canvas, 0, 0);
              const mutation = compare(context.getImageData(0, 0, 160, 224).data);
              if (mutation.p95 <= 12 && mutation.max <= 64) throw new Error('Missing chair contribution escaped detection');
              records.push({ facing, mutation });
            } finally { gpu.device.queue.writeBuffer(renderer.spriteBuffer, 0, table); }
            context.putImageData(new ImageData(new Uint8ClampedArray(actual), 160, 224), 0, 0);
            const section = document.createElement('section'); section.style.width = '160px';
            const title = document.createElement('div'); title.textContent = `${facing} raised spoon`;
            section.append(title, copy); board.append(section);
          }
          records.push({ facing, variant, phase, sprite, pair: SPRITE_PAIRS[sprite], ...metrics });
        }
      }
    }
    document.body.replaceChildren(board); document.body.style.margin = '0';
    const validation = await gpu.device.popErrorScope();
    return { pass: !validation && !errors.length, validation: validation?.message ?? null, errors, records };
  } finally { gpu.device.destroy(); }
}
