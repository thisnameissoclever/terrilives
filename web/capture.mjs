// Capture the real frame from the running game.
// SwiftShader here has no VK_KHR_surface, so presentation (and therefore any
// ordinary screenshot) is black. Rendering works fine. Per docs/headless-sandbox.md
// the way through is to hand the app a cached offscreen texture instead of the
// swapchain's, then copy that texture back after its own submit.
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = '/tmp/claude-0/-home-user-terrilives/1cad3393-2863-576b-9bf6-30e4a5e6b589/scratchpad/out';
const URL_ = process.argv[2] || 'http://localhost:5174/';
const WAIT_MS = Number(process.argv[3] || 9000);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    '--enable-unsafe-webgpu', '--enable-features=Vulkan',
    '--use-vulkan=swiftshader', '--use-angle=vulkan',
    '--disable-vulkan-surface', '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', m => { if (m.type() === 'error') console.log('  [page error]', m.text()); });
page.on('pageerror', e => console.log('  [pageerror]', e.message));

await page.addInitScript(() => {
  const cap = { frames: 0, draws: 0, submits: 0, device: null, tex: null, w: 0, h: 0 };
  window.__cap = cap;

  const origConfigure = GPUCanvasContext.prototype.configure;
  GPUCanvasContext.prototype.configure = function (cfg) {
    const c = this.canvas;
    cap.device = cfg.device; cap.w = c.width; cap.h = c.height;
    cap.tex = cfg.device.createTexture({
      size: [c.width, c.height, 1], format: cfg.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    return origConfigure.call(this, cfg);
  };
  const origGet = GPUCanvasContext.prototype.getCurrentTexture;
  GPUCanvasContext.prototype.getCurrentTexture = function () {
    return cap.tex || origGet.call(this);
  };

  // [L14]: count what actually happened rather than trusting that it did.
  const origDraw = GPURenderPassEncoder.prototype.draw;
  GPURenderPassEncoder.prototype.draw = function (...a) { cap.draws++; return origDraw.apply(this, a); };
  const origSubmit = GPUQueue.prototype.submit;
  GPUQueue.prototype.submit = function (...a) { cap.submits++; return origSubmit.apply(this, a); };
  const origRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (cb) {
    return origRaf.call(window, t => { cap.frames++; return cb(t); });
  };

  window.__grab = async () => {
    const { device, tex, w, h } = window.__cap;
    if (!device || !tex) return null;
    const bpr = Math.ceil(w * 4 / 256) * 256;           // WebGPU requires 256-byte rows
    const buf = device.createBuffer({
      size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: h }, [w, h, 1]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange().slice(0));
    buf.unmap(); buf.destroy();

    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = y * bpr + x * 4, d = (y * w + x) * 4;
        img.data[d] = src[s + 2]; img.data[d + 1] = src[s + 1];   // bgra8unorm -> rgba
        img.data[d + 2] = src[s]; img.data[d + 3] = 255;
      }
    }
    const oc = new OffscreenCanvas(w, h);
    oc.getContext('2d').putImageData(img, 0, 0);
    const blob = await oc.convertToBlob({ type: 'image/png' });
    const b = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  };
});

await page.goto(URL_, { waitUntil: 'load' });
await page.waitForTimeout(WAIT_MS);

const stats = await page.evaluate(() => ({
  visible: document.visibilityState,
  ...window.__cap ? { frames: __cap.frames, draws: __cap.draws, submits: __cap.submits, w: __cap.w, h: __cap.h } : {},
  adapter: 'probed below',
}));
const adapter = await page.evaluate(async () => {
  const a = await navigator.gpu?.requestAdapter();
  return a ? (a.info?.vendor || a.info?.architecture || 'unknown') : 'none';
});
console.log('stats', JSON.stringify({ ...stats, adapter }));

const b64 = await page.evaluate(() => window.__grab());
if (!b64) { console.log('GRAB FAILED'); await browser.close(); process.exit(1); }
fs.writeFileSync(`${OUT}/real-game.png`, Buffer.from(b64, 'base64'));
console.log('wrote real-game.png', fs.statSync(`${OUT}/real-game.png`).size, 'bytes');

await browser.close();
