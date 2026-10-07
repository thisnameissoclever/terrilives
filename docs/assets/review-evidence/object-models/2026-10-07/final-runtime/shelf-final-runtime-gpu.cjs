const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const manifestPath = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
const baseURL = process.argv[4] || 'http://127.0.0.1:5198';
const { chromium } = require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright-core'));
const manifest = JSON.parse(fs.readFileSync(manifestPath));
const references = [];
for (const facing of ['SE', 'NW', 'SW', 'NE']) {
  const rows = manifest.source_captures.filter(row => row.facing === facing);
  const selected = [0, 0xffffff, 0x555555, 0x924925,
    ...[0, 6, 12, 18].map(bit => 1 << bit),
    ...[0, 6, 12, 18].map(bit => 0xffffff ^ (1 << bit))]
    .map(mask => rows.find(row => row.mask === mask));
  for (const row of selected) {
    if (!row) throw Error('Missing independent shelf source control');
    const source = path.join(root, row.reuse.path);
    if (crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex') !== row.sha256) {
      throw Error('Independent shelf source changed');
    }
    references.push({ facing, mask: row.mask, key: row.key, source });
  }
}

(async () => {
  if (fs.existsSync(output)) throw Error("Preserve the existing proof output");
  fs.mkdirSync(output);
  const prepared = references.map(row => ({ ...row, reduced: path.join(output, row.key + '-reference.png') }));
  const reduction = require('node:child_process').spawnSync('python', ['-c',
    "import json,sys; from PIL import Image; rows=json.load(sys.stdin); [(Image.open(r['source']).convert('RGBA').resize((192,240),Image.Resampling.LANCZOS).save(r['reduced'])) for r in rows]"],
    { input: JSON.stringify(prepared), encoding: 'utf8' });
  if (reduction.status !== 0) throw Error(reduction.stderr || 'Independent reference reduction failed');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const context = await browser.newContext({ viewport: { width: 440, height: 360 } });
  try {
    const page = await context.newPage();
    await page.route('**/__shelf_reference/*', async route => {
      const key = new URL(route.request().url()).pathname.split('/').pop();
      const row = prepared.find(row => row.key + '.png' === key);
      if (!row) return route.abort();
      await route.fulfill({ path: row.reduced, contentType: 'image/png' });
    });
    await page.route(baseURL + '/', route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><html><body style="margin:0;background:#17171c"><canvas id="proof" width="400" height="320"></canvas></body></html>',
      headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
    }));
    await page.goto(baseURL + '/');
    const result = await page.evaluate(async refs => {
      const { SpriteRenderer } = await import('/src/render/sprites.ts');
      const atlas = await import('/src/render/atlas.ts');
      const { writeInstance, writeColourway, FLOATS_PER_INSTANCE } = await import('/src/render/instances.ts');
      const { packPresentationLayers } = await import('/src/render/visible-scene-layers.ts');
      const { packShelfLayers } = await import('/src/render/shelf-sprites.ts');
      const { GRIME_SPRITE_COUNT } = await import('/src/render/grime-decals.ts');
      const canvas = document.querySelector('#proof');
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw Error('No actual GPU adapter');
      const device = await adapter.requestDevice();
      const context = canvas.getContext('webgpu');
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      const uncaptured = [];
      device.addEventListener('uncapturederror', event => uncaptured.push(event.error.message));
      device.pushErrorScope('validation');
      const renderer = await SpriteRenderer.create({ device, context, format });
      const tableCount = atlas.SPRITES.length + GRIME_SPRITE_COUNT;
      const sceneTable = packShelfLayers(packPresentationLayers(tableCount,
        { ...atlas.BED_LAYERS, ...atlas.SEATING_LAYERS }, atlas.SHARED_SEAT_LAYERS), tableCount, atlas.SHELF_PROFILES);
      const rows = new Float32Array(FLOATS_PER_INSTANCE);
      const width = canvas.width, height = canvas.height;
      const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
      const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const draw = async (sprite, mask, scale, shift, shade) => {
        writeInstance(rows, 0, width / 2, 24 + (120 - 21) * scale, .4, sprite, mask, 1, 1);
        writeColourway(rows, 0, new Float32Array([0, 0, 0, ...shift]), 1);
        renderer.draw(rows, 1, scale, shade);
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture: context.getCurrentTexture() },
          { buffer, bytesPerRow, rowsPerImage: height }, { width, height });
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const source = new Uint8Array(buffer.getMappedRange());
        const result = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) result.set(source.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
        buffer.unmap();
        return result;
      };
      const shifts = [[0, 1, 0], [-30, 1.2, 0], [80, 1, 0], [160, .75, .05], [0, .4, -.1]];
      const metrics = [], screenshots = [];
      try {
        for (const ref of refs) {
          const sprite = atlas.spriteIndex('offlineBookcase' + (ref.facing === 'SE' ? '' : ref.facing));
          const bitmap = await createImageBitmap(await (await fetch('/__shelf_reference/' + ref.key + '.png')).blob(),
            { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
          const rect = atlas.SPRITES[sprite];
          device.queue.copyExternalImageToTexture({ source: bitmap },
            { texture: renderer.ownedTextures[0], origin: [rect.x, rect.y, rect.page ?? 0] }, { width: rect.w, height: rect.h });
          bitmap.close();
          const record = sceneTable.subarray(sprite * 8, sprite * 8 + 8);
          for (const scale of [2, 1.5, 2.25]) {
            for (let colourway = 0; colourway < shifts.length; colourway++) {
              const shade = colourway % 2 === 0 ? [1, 1, 1, 1] : [.55, .62, .75, 1];
              device.queue.writeBuffer(renderer.bedBuffer, sprite * 32, record);
              const actual = await draw(sprite, ref.mask, scale, shifts[colourway], shade);
              if (scale === 2 && colourway === 0 && (ref.mask === 0 || ref.mask === 0xffffff)) {
                const image = new Uint8ClampedArray(actual);
                if (format.startsWith('bgra')) for (let pixel = 0; pixel < image.length; pixel += 4) {
                  const red = image[pixel + 2]; image[pixel + 2] = image[pixel]; image[pixel] = red;
                }
                const snapshot = document.createElement('canvas'); snapshot.width = width; snapshot.height = height;
                snapshot.getContext('2d').putImageData(new ImageData(image, width, height), 0, 0);
                screenshots.push({ facing: ref.facing, mask: ref.mask, png: snapshot.toDataURL('image/png') });
              }
              device.queue.writeBuffer(renderer.bedBuffer, sprite * 32, new Uint32Array(8));
              const expected = await draw(sprite, 1, scale, shifts[colourway], shade);
              const differences = []; let maximum = 0, nonzero = 0;
              for (let index = 0; index < actual.length; index += 4) {
                const pixel = [Math.abs(actual[index] - expected[index]), Math.abs(actual[index + 1] - expected[index + 1]), Math.abs(actual[index + 2] - expected[index + 2])];
                maximum = Math.max(maximum, ...pixel);
                if (pixel.some(value => value > 0)) { differences.push(...pixel); nonzero++; }
              }
              differences.sort((a, b) => a - b);
              const p95 = differences.length ? differences[Math.floor((differences.length - 1) * .95)] : 0;
              metrics.push({ facing: ref.facing, mask: ref.mask, key: ref.key, scale, colourway, maximum, p95, affectedPixels: nonzero,
                pass: maximum <= 6 && p95 <= 2 });
            }
          }
          device.queue.writeBuffer(renderer.bedBuffer, sprite * 32, record);
          await draw(sprite, ref.mask, 2, shifts[0], [1, 1, 1, 1]);
        }
        const error = await device.popErrorScope();
        return { adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
          device: adapter.info.device, description: adapter.info.description }, format, screenshots, pageCount: atlas.ATLAS_PAGE_FILES.length,
          textureBytes: atlas.ATLAS_PAGE_FILES.length * 2048 * 2048 * 4,
          deviceLimits: { arrayLayers: device.limits.maxTextureArrayLayers, interStageVariables: device.limits.maxInterStageShaderVariables },
          error: error?.message ?? null, uncaptured, cases: metrics, pass: !error && !uncaptured.length && metrics.every(row => row.pass) };
      } finally { buffer.destroy(); renderer.destroy(); device.destroy(); }
    }, references.map(({ source, ...row }) => row));
    for (const shot of result.screenshots) fs.writeFileSync(path.join(output, shot.facing + '-' + shot.mask + '.png'),
      Buffer.from(shot.png.split(',')[1], 'base64'));
    delete result.screenshots;
    result.manifestPath = manifestPath;
    result.manifestSHA256 = crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');
    result.harnessSHA256 = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
    fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ pass: result.pass, pages: result.pageCount, cases: result.cases.length,
      max: Math.max(...result.cases.map(row => row.maximum)), p95: Math.max(...result.cases.map(row => row.p95)), error: result.error }));
    if (!result.pass) process.exitCode = 1;
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
