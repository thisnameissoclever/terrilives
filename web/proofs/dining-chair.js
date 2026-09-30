import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer } from '../src/render/sprites.ts';
import { FLOATS_PER_INSTANCE, writeInstance } from '../src/render/instances.ts';
import { spriteDrawOffsetX, spriteDrawOffsetY } from '../src/render/sprite-anchors.ts';
import { spriteIndex, SPRITES, ATLAS_FILE_NAME } from '../src/render/atlas.ts';

// Exercise actual GPU sampling and registration without opening a saved game.
export async function diningChairProof() {
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 340;
  const gpu = await initDevice(canvas);
  const errors = [];
  gpu.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  gpu.device.pushErrorScope('validation');
  try {
    const renderer = await SpriteRenderer.create(gpu);
    const rows = new Float32Array(FLOATS_PER_INSTANCE * 8);
    const records = ['', 'NW', 'SW', 'NE'].map((suffix, column) => {
      const sprite = spriteIndex(`offlineDiningChair${suffix}`), x = 135 + column * 270, y = 260;
      writeInstance(rows, column * 2, x, y, .7, spriteIndex('floor'));
      writeInstance(rows, column * 2 + 1, x + spriteDrawOffsetX(sprite) * 2,
        y + spriteDrawOffsetY(sprite) * 2, .5, sprite);
      return { facing: suffix || 'SE', index: sprite, density: SPRITES[sprite].pixel_density };
    });
    renderer.draw(rows, 8, 2);
    await gpu.device.queue.onSubmittedWorkDone();
    const copy = document.createElement('canvas');
    copy.style.display = 'block';
    copy.width = canvas.width; copy.height = canvas.height;
    const ctx = copy.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    ctx.fillStyle = '#fff'; ctx.font = '18px sans-serif'; ctx.textAlign = 'center';
    for (const [column, record] of records.entries()) ctx.fillText(record.facing, 135 + column * 270, 34);
    const validation = await gpu.device.popErrorScope();
    document.body.replaceChildren(copy);
    document.body.style.margin = '0';
    return { pass: !validation && errors.length === 0, validation: validation?.message ?? null,
      errors, atlas: ATLAS_FILE_NAME, records };
  } finally {
    gpu.device.destroy();
  }
}
