// The caller owns the isolated page/context and calls dispose in finally.
import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer } from '../src/render/sprites.ts';
import { loadArchitectureAtlas, closeArchitectureAtlas } from '../src/render/architecture-atlas.ts';
import { architectureSprite } from '../src/render/architecture.ts';
import { buildStaticInstances } from '../src/render/tiles.ts';
import { buildSkyExposure, sampleSky } from '../src/render/sky.ts';
import { AMBIENT_NEUTRAL, ambientFor, sunStrength } from '../src/render/daylight.ts';
import { LightingMode } from '../src/ui/lighting-mode.ts';
import { spriteIndex } from '../src/render/atlas.ts';
import { writeInstance } from '../src/render/instances.ts';
import { acquireWithTimeout } from './owned-timeout.ts';
import mainSource from '../src/main.ts?raw';

const assert = (value, message, data = {}) => { if (!value) throw new Error(`${message}: ${JSON.stringify(data)}`); };
const same = (a, b) => a.every((value, i) => value === b[i]);
const empty = new Float32Array();
const catalogue = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, label: `Window ${i + 1}`,
  width: architectureSprite(i + 1, 0, 'front', false)[0].width }));
// Evaluate the production call-site expression so deleting its night gate fails this GPU proof.
const expression = mainSource.match(/\/\/ \[OS-daylight\]: the sky shades the house by day; flat light is even\.\s*([^\n]+),/);
assert(expression, 'Production daylight multiplier is present');
const multiply = new Function('lightingMode', 'interiorDaylightShade', 'sunStrength', 'ambient', `return (${expression[1]});`);
const shell = [];
for (let i = 0; i < 6; i++) shell.push([0, 0, i, 0], [0, 6, i, 0], [1, i, 0, 0], [1, i, 6, 0]);
const key = line => line.slice(0, 3).join(',');
const scene = (windows = [], partition = false) => {
  const placements = windows.map(([axis, x, y]) => ({ axis, x, y, model: 1 }));
  const openings = new Set(windows.map(key));
  const walls = partition ? [...shell, ...Array.from({ length: 6 }, (_, y) => [0, 2, y, 0])] : shell;
  const edges = Uint32Array.from(walls.filter(line => !openings.has(key(line))).flat());
  const sky = buildSkyExposure(8, 8, edges, [6, 6], .2, windows.flat());
  return { sky, lot: { width: 8, height: 8, house: [6, 6], walls: new Uint32Array(), edges,
    windows: Uint32Array.from(windows.flat()), architecture: { windows: placements, catalogue },
    showCutAwayWalls: false } };
};

export async function createWindowDaylightProof() {
  const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 700;
  document.body.append(canvas);
  let gpu, atlas, renderer, readback;
  const errors = [];
  try {
    gpu = await acquireWithTimeout(initDevice(canvas), 10000, value => value.device.destroy(), 'Daylight GPU');
    gpu.context.configure({ device: gpu.device, format: gpu.format, alphaMode: 'premultiplied',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    gpu.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
    const bytesPerRow = Math.ceil(canvas.width * 4 / 256) * 256;
    readback = gpu.device.createBuffer({ size: bytesPerRow * canvas.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    atlas = await acquireWithTimeout(loadArchitectureAtlas(gpu.device.limits, { baseUrl: '/' }), 15000,
      closeArchitectureAtlas, 'Daylight architecture atlas');
    renderer = await acquireWithTimeout(SpriteRenderer.create(gpu, atlas), 15000, value => value.destroy(), 'Daylight renderer');
    closeArchitectureAtlas(atlas); atlas = undefined;
    const ox = 440.37, oy = 220.19;
    renderer.setArchitectureCamera(ox, oy);
    const at = (pixels, x, y) => [...pixels.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4)];
    const point = ([x, y]) => [Math.floor(ox + (x - y) * 32), Math.floor(oy + (x + y) * 21)];
    const capture = async (geometry, ambient, shade) => {
      renderer.setStaticGeometry(geometry.instances, geometry.count, geometry.lowInstances);
      renderer.draw(empty, 0, 1, ambient, shade);
      const encoder = gpu.device.createCommandEncoder();
      if (geometry.count === 0 && geometry.lowInstances.length === 0) {
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: gpu.context.getCurrentTexture().createView(),
          clearValue: { r: .09, g: .09, b: .11, a: 1 }, loadOp: 'clear', storeOp: 'store' }] }); pass.end();
      }
      // The presentation texture is copied before the first await, into independent bytes.
      encoder.copyTextureToBuffer({ texture: gpu.context.getCurrentTexture() }, { buffer: readback, bytesPerRow },
        { width: canvas.width, height: canvas.height });
      gpu.device.queue.submit([encoder.finish()]);
      await acquireWithTimeout(readback.mapAsync(GPUMapMode.READ), 10000, () => readback.unmap(), 'Daylight readback');
      const mapped = new Uint8Array(readback.getMappedRange()), pixels = new Uint8Array(canvas.width * canvas.height * 4);
      for (let y = 0; y < canvas.height; y++) pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + canvas.width * 4), y * canvas.width * 4);
      readback.unmap();
      if (gpu.format.startsWith('bgra')) for (let i = 0; i < pixels.length; i += 4) {
        const red = pixels[i]; pixels[i] = pixels[i + 2]; pixels[i + 2] = red;
      }
      assert(errors.length === 0, 'Daylight GPU validation', { errors });
      assert(pixels[3] === 255, 'Opaque framebuffer clear', { pixel: [...pixels.slice(0, 4)] });
      return pixels;
    };
    const geometry = current => buildStaticInstances(current.lot, ox, oy, 8, 1, null, current.sky);
    const draw = (current, ambient, shade) => capture(geometry(current), ambient, shade);
    const controls = async (current, tile) => {
      const [px, py] = point(tile), built = geometry(current);
      const floor = built.instances.slice(0, built.floorCount * 16);
      const source = at(await capture({ instances: floor, count: built.floorCount, lowInstances: empty }, AMBIENT_NEUTRAL, 0), px, py);
      const clear = at(await capture({ instances: empty, count: 0, lowInstances: empty }, AMBIENT_NEUTRAL, 0), px, py);
      const markerRow = new Float32Array(16);
      writeInstance(markerRow, 0, px + .5, py + .5, .5, spriteIndex('floor'), 1, 0, 1, 1);
      const marker = at(await capture({ instances: markerRow, count: 1, lowInstances: empty }, AMBIENT_NEUTRAL, 0), px, py);
      const room = at(await draw(current, AMBIENT_NEUTRAL, 0), px, py);
      assert(source[3] === 255 && !same(source, clear) && !same(marker, clear) && !same(marker, source),
        'Distinct floor, marker and clear controls', { source, marker, clear });
      assert(same(room, source), 'Room witness shows the floor source, unobscured by walls', { room, source, tile });
      return { px, py, source, marker, clear };
    };
    return {
      multiplierExpression: expression[1],
      async timeCase(name = 'noon') {
        assert(['noon', 'dusk', 'midnight', 'flat', 'reduced'].includes(name), 'Known bounded time case');
        const tick = name === 'noon' ? 720 : name === 'dusk' ? 1260 : 0;
        const mode = new LightingMode({ textContent: null, disabled: false, setAttribute() {} });
        if (name === 'flat') mode.toggle();
        if (name === 'reduced') mode.setSystemFlat(true);
        const ambient = mode.isFlat() ? AMBIENT_NEUTRAL : ambientFor(tick, 1440);
        const shade = multiply(mode, .25, sunStrength, ambient);
        const closed = scene(), opened = scene([[0, 0, 2]]), tile = [1, 2];
        const control = await controls(opened, tile);
        const a = at(await draw(closed, ambient, shade), control.px, control.py);
        const b = at(await draw(opened, ambient, shade), control.px, control.py);
        const exposure = sampleSky(opened.sky, ...tile);
        assert(exposure > .5, 'Aperture changes exposure before measuring light', { exposure });
        if (name === 'noon' || name === 'dusk') {
          const minimum = name === 'noon' ? 5 : 1;
          assert(b.slice(0, 3).every((value, i) => value - a[i] >= minimum), 'Window adds daytime room light', { name, a, b, shade });
        } else assert(same(a, b), 'Window adds exactly zero nighttime or flat illumination', { name, a, b, shade });
        for (const [actual, exposed] of [[a, 0], [b, exposure]]) {
          const expected = control.source.slice(0, 3).map((value, i) => Math.round(value * ambient[i] * (1 - shade * (1 - exposed))));
          assert(actual.slice(0, 3).every((value, i) => Math.abs(value - expected[i]) <= 1),
            'Room pixels match production floor lighting', { actual, expected });
        }
        return { pass: true, name, tick, shade, exposure, closed: a, window: b, control };
      },
      async interiorCase() {
        const tile = [2, 2], ambient = ambientFor(720, 1440);
        const mode = new LightingMode({ textContent: null, disabled: false, setAttribute() {} });
        const shade = multiply(mode, .25, sunStrength, ambient);
        const closed = scene([], true), interior = scene([[0, 2, 2]], true), outside = scene([[0, 0, 2], [0, 2, 2]], true);
        const control = await controls(interior, tile);
        const a = at(await draw(closed, ambient, shade), control.px, control.py);
        const b = at(await draw(interior, ambient, shade), control.px, control.py);
        assert(same(a, b), 'Interior window does not seed outdoor light', { a, b });
        const c = at(await draw(outside, ambient, shade), control.px, control.py);
        assert(c.slice(0, 3).every((value, i) => value > b[i] + 3), 'External source passes through interior window', { b, c });
        return { pass: true, closed: a, interior: b, external: c, control };
      },
      dispose() { readback.destroy(); renderer.destroy(); gpu.device.destroy(); canvas.remove(); },
    };
  } catch (error) {
    if (atlas) closeArchitectureAtlas(atlas); readback?.destroy(); renderer?.destroy(); gpu?.device.destroy(); canvas.remove(); throw error;
  }
}
