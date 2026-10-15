const { chromium } = require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const out = path.resolve('docs/evidence/2026-10-13-creator-repair/final-game-review');
fs.mkdirSync(out, { recursive: true });
const save = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, (_key, value) => typeof value === 'bigint' ? { $bigint: value.toString() } : value, 2) + '\n');
const production = ['web/src/render/character/renderer.ts', 'web/src/render/character/pipelines.ts', 'web/src/render/character/world.ts', 'web/src/render/character/sleep-cover.ts', 'web/src/render/scene-target.ts', 'web/src/render/scene-pipeline.ts', 'assets/models/sims/character-creator/surface-policy.json'];
const hashes = () => Object.fromEntries(production.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
async function launch() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const page = await context.newPage(), diagnostics = [], moduleResponses = [];
  page.on('response', response => { if (response.url().includes('/src/')) moduleResponses.push(response.url()); });
  page.on('pageerror', error => diagnostics.push({ type: 'pageerror', message: error.stack }));
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) diagnostics.push({ type: message.type(), message: message.text() }); });
  return { browser, context, page, diagnostics, moduleResponses };
}
async function frame(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function ready(page) {
  await page.goto('http://127.0.0.1:5187/?stress=0');
  await page.waitForFunction(() => window.__terriStress, null, { timeout: 120000 });
  if (await page.locator('#help-panel').evaluate(element => element.open)) await page.locator('#close-help').click();
  await page.getByText('Pause', { exact: true }).click();
  await frame(page);
  await page.locator('#options-toggle').click();
  const light = await page.locator('#lighting-mode').innerText();
  if (!light.includes('flat')) await page.locator('#lighting-mode').click();
  await page.locator('#options-toggle').click();
  await frame(page);
}
async function load(page, filename) {
  const bytes = [...fs.readFileSync(filename)];
  await page.evaluate(async bytes => { if (!(await globalThis.__terriStress.characters.loadBytes(Uint8Array.from(bytes)))) throw Error('Saved state rejected'); }, bytes);
  await frame(page);
}
async function camera(page, target) {
  const initial = await page.evaluate(() => __terriStress.characters.snapshot().view);
  await page.mouse.move(800, 400);
  await page.mouse.wheel(0, -Math.log(target.scale / initial.scale) / .0012);
  await frame(page);
  const zoomed = await page.evaluate(() => __terriStress.characters.snapshot().view);
  await page.mouse.move(800, 400);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(800 + target.originX - zoomed.originX, 400 + target.originY - zoomed.originY);
  await page.mouse.up({ button: 'middle' });
  await frame(page);
  const actual = await page.evaluate(() => __terriStress.characters.snapshot().view);
  if (Math.abs(actual.scale - target.scale) > .00001 || Math.abs(actual.originX - target.originX) > .01 || Math.abs(actual.originY - target.originY) > .01) throw Error('Camera mismatch ' + JSON.stringify({ target, actual }));
  return actual;
}
async function readRegion(page, origin, size) {
  return page.evaluate(async ({ origin, size }) => {
    const h = __terriStress, d = h.graphicsDevice, result = { origin, size, scene: h.characters.snapshot() };
    for (const [name, texture, bytes] of [['identity', h.sceneIdentityTexture, 4], ['surface', h.sceneSurfaceTexture, 4], ['color', h.sceneColorTexture, 8]]) {
      const row = Math.ceil(size[0] * bytes / 256) * 256, buffer = d.createBuffer({ size: row * size[1], usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try { const encoder = d.createCommandEncoder(); encoder.copyTextureToBuffer({ texture, origin }, { buffer, bytesPerRow: row }, size); d.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ); result[name] = { bytesPerRow: row, data: [...new Uint8Array(buffer.getMappedRange())] }; }
      finally { buffer.unmap(); buffer.destroy(); }
    }
    return result;
  }, { origin, size });
}
const half = number => { const exponent = (number >>> 10) & 31, mantissa = number & 1023; return (number & 32768 ? -1 : 1) * (exponent === 0 ? 2 ** -14 * mantissa / 1024 : exponent === 31 ? Infinity : 2 ** (exponent - 15) * (1 + mantissa / 1024)); };
function decode(region) {
  const raw = Object.fromEntries(['identity', 'surface', 'color'].map(key => [key, Buffer.from(region[key].data)]));
  return (lx, ly, sx = 0, sy = 0) => {
    const x = lx * 2 + sx - region.origin[0], y = ly * 2 + sy - region.origin[1], color = y * region.color.bytesPerRow + x * 8;
    return { logical: [lx, ly], sub: [sx, sy], identity: raw.identity.readUInt32LE(y * region.identity.bytesPerRow + x * 4), surface: raw.surface.readFloatLE(y * region.surface.bytesPerRow + x * 4), rgba: [0, 1, 2, 3].map(i => half(raw.color.readUInt16LE(color + i * 2))) };
  };
}
function assertHealthy(diagnostics) {
  const failures = diagnostics.filter(row => row.type === 'pageerror' || /validation|shader|GPU|render pipeline|bind group|vertex/i.test(row.message));
  if (failures.length) throw Error('Graphics or page diagnostics: ' + JSON.stringify(failures));
}
module.exports = { fs, path, out, save, hashes, launch, ready, frame, load, camera, readRegion, decode, assertHealthy };
