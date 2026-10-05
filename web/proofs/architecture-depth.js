// Staged real-device proof. The caller owns its isolated page/context and invokes dispose in finally.
import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer } from '../src/render/sprites.ts';
import { loadArchitectureAtlas, closeArchitectureAtlas } from '../src/render/architecture-atlas.ts';
import { ARCHITECTURE } from '../src/render/architecture-data.ts';
import { architecturePieces, architectureSprite, architectureFloor } from '../src/render/architecture.ts';
import { buildArchitectureWallGeometry } from '../src/render/architecture-geometry.ts';
import { buildStaticInstances } from '../src/render/tiles.ts';
import { floorMaterial, activeFloorFinishKeys } from '../src/render/floor-materials.ts';
import { architectureFinishSlot } from '../src/render/architecture-finishes.ts';
import { FLOATS_PER_INSTANCE, MAX_ARCHITECTURE_FINISH_SLOT, decodeArchitectureMode,
  writeInstance, writeArchitectureDepth, writeArchitectureFloor } from '../src/render/instances.ts';
import shaderSource from '../src/render/sprites.wgsl?raw';
import { architectureModeVectors } from './architecture-mode-vectors.ts';
import { layeredDepth, LAYER_PROP, FLOOR_DEPTH } from '../src/render/iso.ts';
import { spriteIndex } from '../src/render/atlas.ts';
import { writePortals } from '../src/render/portals.ts';
import { acquireWithTimeout } from './owned-timeout.ts';

const empty = new Float32Array();
const step = layeredDepth(0, 0, 16, LAYER_PROP) - layeredDepth(1, 0, 16, LAYER_PROP);
const catalogue = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, label: `Window ${i + 1}`,
  width: architectureSprite(i + 1, 0, 'front', false)[0].width }));
const half = bits => (bits & 0x8000 ? -1 : 1) * (bits & 0x7c00 ? 1 + (bits & 1023) / 1024 : (bits & 1023) / 1024)
  * 2 ** ((bits & 0x7c00 ? (bits >> 10) & 31 : 1) - 15);
const same = (a, b) => a.every((v, i) => v === b[i]);
const assert = (value, message, data = {}) => { if (!value) throw new Error(`${message}: ${JSON.stringify(data)}`); };
const join = rows => { const result = new Float32Array(rows.length * 16); rows.forEach((row, i) => result.set(row, i * 16)); return result; };
const sha256 = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(value => value.toString(16).padStart(2, '0')).join('');

export async function createArchitectureDepthProof() {
  const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 800;
  canvas.style.width = '1000px'; canvas.style.height = '800px'; document.body.append(canvas);
  const gpu = await acquireWithTimeout(initDevice(canvas), 10000, value => value.device.destroy(), 'Acquire architecture GPU');
  gpu.context.configure({ device: gpu.device, format: gpu.format, alphaMode: 'premultiplied',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const bytesPerRow = Math.ceil(canvas.width * 4 / 256) * 256;
  const readback = gpu.device.createBuffer({ size: bytesPerRow * canvas.height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  let atlas, renderer, historicalRenderer;
  const errors = [];
  gpu.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  try {
    atlas = await loadArchitectureAtlas(gpu.device.limits, { baseUrl: '/' });
    const reference = await (await fetch(new URL('./fixtures/architecture/color-rgba.json', import.meta.url))).json();
    assert(reference.sourcePngSha256 === ARCHITECTURE.hashes.color, 'Proof reference names current accepted PNG');
    const compressed = await (await fetch(new URL('./fixtures/architecture/color.rgba.bin', import.meta.url))).arrayBuffer();
    assert(await sha256(compressed) === reference.gzipSha256, 'Proof compressed reference hash');
    const pixels = new Uint8Array(await new Response(new Blob([compressed]).stream()
      .pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    assert(pixels.length === atlas.width * atlas.height * 4 && await sha256(pixels) === reference.rgbaSha256,
      'Proof lossless decoded RGBA hash');
    const depth = atlas.depth;
    const roles = new Uint8Array(await (await fetch(`/${ARCHITECTURE.resources.roles}`)).arrayBuffer());
    gpu.device.pushErrorScope('validation');
    renderer = await SpriteRenderer.create(gpu, atlas);
    closeArchitectureAtlas(atlas); atlas = undefined;
    const startup = await gpu.device.popErrorScope();
    assert(!startup, 'Architecture pipeline validation', { error: startup?.message });
    let ox = 470.37, oy = 330.19;
    const row = (sprite, x = 0, y = 0, scale = 1, low = false, opacity = 1, finish = 0) => {
      const result = new Float32Array(16);
      writeInstance(result, 0, ox + (x - y) * 32 * scale, oy + (x + y) * 21 * scale,
        sprite.kind === 'floor-patch' ? FLOOR_DEPTH : layeredDepth(x, y, 16, LAYER_PROP), sprite.id);
      if (sprite.kind === 'floor-patch') writeArchitectureFloor(result, 0, x, y, finish);
      else writeArchitectureDepth(result, 0, step, opacity, low, finish);
      return result;
    };
    const capture = async (opaque = empty, low = empty, scale = 1, chosen = renderer) => {
      chosen.setArchitectureCamera?.(ox, oy); chosen.setStaticGeometry(opaque, opaque.length / 16, low);
      chosen.draw(empty, 0, scale);
      // Copy before yielding: a presented canvas texture may be discarded after an await.
      const encoder = gpu.device.createCommandEncoder();
      if (opaque.length + low.length === 0) {
        // Production deliberately skips empty draws. The proof still needs a real clear control.
        const clear = encoder.beginRenderPass({ colorAttachments: [{
          view: gpu.context.getCurrentTexture().createView(), clearValue: { r: .09, g: .09, b: .11, a: 1 },
          loadOp: 'clear', storeOp: 'store',
        }] });
        clear.end();
      }
      encoder.copyTextureToBuffer({ texture: gpu.context.getCurrentTexture() }, { buffer: readback, bytesPerRow },
        { width: canvas.width, height: canvas.height });
      gpu.device.queue.submit([encoder.finish()]);
      await acquireWithTimeout(readback.mapAsync(GPUMapMode.READ), 10000, () => readback.unmap(), 'Architecture readback');
      const mapped = new Uint8Array(readback.getMappedRange()), pixels = new Uint8Array(canvas.width * canvas.height * 4);
      for (let y = 0; y < canvas.height; y++) pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + canvas.width * 4), y * canvas.width * 4);
      readback.unmap();
      if (gpu.format.startsWith('bgra')) for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index]; pixels[index] = pixels[index + 2]; pixels[index + 2] = red;
      }
      assert(errors.length === 0, 'Uncaptured GPU validation', { errors });
      assert(pixels[3] === 255, 'Framebuffer readback has opaque clear coverage', { pixel: [...pixels.slice(0, 4)] });
      return pixels;
    };
    const at = (data, x, y) => [...data.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4)];
    const sample = (sprite, role, scale, x = 0, y = 0) => {
      // Find a stable interior role texel that the requested framebuffer scale actually samples.
      const left = ox + (x - y) * 32 * scale - sprite.origin[0] * scale;
      const top = oy + (x + y) * 21 * scale - sprite.origin[1] * scale;
      for (let py = Math.ceil(top + 2); py < top + sprite.h / 2 * scale - 2; py++) {
        for (let px = Math.ceil(left + 2); px < left + sprite.w / 2 * scale - 2; px++) {
          const tx = Math.floor((px + .5 - left) / scale * 2), ty = Math.floor((py + .5 - top) / scale * 2);
          if (tx < 2 || ty < 2 || tx >= sprite.w - 2 || ty >= sprite.h - 2) continue;
          const index = (sprite.y + ty) * ARCHITECTURE.width + sprite.x + tx;
          if (roles[index] !== role || pixels[index * 4 + 3] !== 255) continue;
          if (![index - 1, index + 1, index - ARCHITECTURE.width, index + ARCHITECTURE.width]
            .every(i => roles[i] === role && pixels[i * 4 + 3] === 255)) continue;
          return { px, py, tx, ty, sum: half(depth[index]), expected: [...pixels.slice(index * 4, index * 4 + 4)] };
        }
      }
      throw new Error(`No stable sample for ${sprite.name}, role ${role}, scale ${scale}`);
    };
    return {
      limits: { dimension: gpu.device.limits.maxTextureDimension2D, textures: gpu.device.limits.maxSampledTexturesPerShaderStage },
      reconstructionKeys: Object.keys(reference.sources),
      async modeCase() {
        const helpers = shaderSource.split('// ARCHITECTURE_MODE_HELPERS_BEGIN')[1]
          ?.split('// ARCHITECTURE_MODE_HELPERS_END')[0];
        assert(helpers, 'Production mode helper block is available');
        const module = gpu.device.createShaderModule({ code: helpers + `
          @group(0) @binding(0) var<storage, read> inputs: array<f32>;
          @group(0) @binding(1) var<storage, read_write> outputs: array<vec4u>;
          @compute @workgroup_size(32) fn check(@builtin(global_invocation_id) id: vec3u) {
            if (id.x >= arrayLength(&inputs)) { return; }
            let mode = inputs[id.x];
            outputs[id.x] = vec4u(select(0u, 1u, isArchitecture(mode)),
              select(0u, 1u, isArchitectureFloor(mode)), architectureFinishSlot(mode), bitcast<u32>(mode));
          }` });
        const pipeline = await gpu.device.createComputePipelineAsync({ layout: 'auto', compute: {
          module, entryPoint: 'check', constants: { maxArchitectureFinishSlot: MAX_ARCHITECTURE_FINISH_SLOT },
        } });
        const values = Float32Array.from(architectureModeVectors.map(vector => vector.mode));
        const bits = new Uint32Array(values.buffer), buffers = [];
        const buffer = (size, usage) => { const result = gpu.device.createBuffer({ size, usage }); buffers.push(result); return result; };
        try {
          const input = buffer(values.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
          const output = buffer(values.length * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
          const read = buffer(values.length * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
          gpu.device.queue.writeBuffer(input, 0, values);
          const binding = gpu.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
            { binding: 0, resource: { buffer: input } }, { binding: 1, resource: { buffer: output } },
          ] });
          const encoder = gpu.device.createCommandEncoder(), pass = encoder.beginComputePass();
          pass.setPipeline(pipeline); pass.setBindGroup(0, binding); pass.dispatchWorkgroups(Math.ceil(values.length / 32)); pass.end();
          encoder.copyBufferToBuffer(output, 0, read, 0, values.length * 16); gpu.device.queue.submit([encoder.finish()]);
          await acquireWithTimeout(read.mapAsync(GPUMapMode.READ), 10000, () => read.unmap(), 'Mode helper readback');
          const actual = new Uint32Array(read.getMappedRange().slice(0)); read.unmap();
          const results = architectureModeVectors.map((vector, index) => {
            const cpu = decodeArchitectureMode(values[index]);
            const expected = [vector.floor === null ? 0 : 1, vector.floor === true ? 1 : 0, vector.slot, bits[index]];
            const found = [...actual.slice(index * 4, index * 4 + 4)];
            assert(same(found, expected) && (cpu?.floor ?? null) === vector.floor && (cpu?.finishSlot ?? 0) === vector.slot,
              'Production CPU/GPU mode agreement', { label: vector.label, found, expected, cpu });
            return { label: vector.label, inputBits: bits[index].toString(16), architecture: found[0], floor: found[1], slot: found[2] };
          });
          assert(errors.length === 0, 'Mode proof GPU validation', { errors });
          return { pass: true, count: results.length, maxSlot: MAX_ARCHITECTURE_FINISH_SLOT,
            productionHelpersSHA256: await sha256(new TextEncoder().encode(helpers)), results };
        } finally { for (const resource of buffers) { if (resource.mapState === 'mapped') resource.unmap(); resource.destroy(); } }
      },
      async reconstructionBatch(cases) {
        assert(cases.length <= 16, 'Bounded reconstruction batch');
        const start = performance.now(), results = [];
        for (const item of cases) results.push(await this.reconstructionCase(item.key, item.scale));
        return { pass: true, count: results.length, milliseconds: performance.now() - start, results };
      },
      async depthCase(axis = 1, scale = 1, side = 'front') {
        const sprite = architecturePieces(`straight.${axis === 1 ? 'x' : 'y'}-${side}.full`)[0];
        const point = sample(sprite, 1, scale);
        assert(Math.abs(point.sum) > .015, 'Depth witness has nonzero authored offset', point);
        const surface = row(sprite, 0, 0, scale);
        const expected = layeredDepth(0, 0, 16, LAYER_PROP) - point.sum * step;
        const marker = new Float32Array(16);
        writeInstance(marker, 0, point.px + .5, point.py + .5, expected - .003 * step, spriteIndex('floor'), 1, 0, 1);
        const background = at(await capture(marker, empty, scale), point.px, point.py);
        const clear = at(await capture(empty, empty, scale), point.px, point.py);
        assert(background[3] === 255 && !same(background, clear), 'Depth marker draws an opaque distinct pixel', { background, clear });
        const front = at(await capture(join([surface, marker]), empty, scale), point.px, point.py);
        marker[2] = expected + .003 * step;
        const behind = at(await capture(join([surface, marker]), empty, scale), point.px, point.py);
        assert(same(behind, point.expected), 'Depth witness matches accepted source texel', { behind, expected: point.expected });
        assert(same(front, background) && !same(behind, background), 'Authored depth bracket', { axis, side, scale, point, front, behind, background });
        return { pass: true, axis, side, scale, point, front, behind };
      },
      async apertureCase(axis = 0, model = 7, scale = 1) {
        const window = { axis, x: axis === 0 ? 0 : 1, y: axis === 0 ? 1 : 0, model };
        const geometry = buildArchitectureWallGeometry({ width: 6, height: 6, house: [6, 6],
          edges: new Uint32Array(), windows: [window], catalogue, cutaway: false });
        const windows = geometry.filter(panel => panel.window), panel = windows[0];
        let point;
        for (const part of windows) {
          try { point = sample(ARCHITECTURE.sprites[part.architectureId - ARCHITECTURE.baseSpriteId], 4, scale, part.x, part.y); break; }
          catch { /* A source owner can contain only a pier; try its sibling glazing. */ }
        }
        assert(point, 'Window has sampled glazing', { axis, model });
        const panelRow = part => row(ARCHITECTURE.sprites[part.architectureId - ARCHITECTURE.baseSpriteId], part.x, part.y, scale);
        const reference = at(await capture(join(windows.map(panelRow)), empty, scale), point.px, point.py);
        assert(same(reference, point.expected), 'Glazing witness matches accepted source texel', { reference, expected: point.expected, point });
        const actual = at(await capture(join(geometry.map(panelRow)), empty, scale), point.px, point.py);
        assert(same(actual, reference), 'Rear aperture suppresses solid shell', { axis, model, scale, point, actual, reference });
        return { pass: true, axis, model, scale, actual, origin: [panel.x, panel.y] };
      },
      async blendCase(scale = 1) {
        const sprite = architecturePieces('straight.x-front.cut')[0], point = sample(sprite, 1, scale);
        const opaque = row(sprite, 0, 0, scale, true, 1), faded = row(sprite, 0, 0, scale, true, .25);
        const base = at(await capture(empty, empty, scale), point.px, point.py);
        const full = at(await capture(empty, opaque, scale), point.px, point.py);
        assert(!same(full, base) && same(full, point.expected), 'Short wall witness draws accepted opaque surface', { full, base, expected: point.expected });
        const single = at(await capture(empty, faded, scale), point.px, point.py);
        const pair = at(await capture(empty, join([faded, faded]), scale), point.px, point.py);
        assert(pair.slice(0, 3).every((value, c) => Math.abs(value - (full[c] * .4375 + base[c] * .5625)) <= 2)
          && pair.some((value, c) => Math.abs(value - single[c]) > 4), 'Short walls blend43.75percent without depth writes', { scale, base, full, single, pair });
        return { pass: true, scale, base, full, single, pair };
      },
      async reconstructionCase(key = 'junction.2222', scale = 1) {
        const start = performance.now();
        const pieces = architecturePieces(key);
        assert(pieces[0].kind !== 'floor-patch', 'Raster reconstruction requires a wall source');
        const commonOrigin = [pieces[0].origin[0] + pieces[0].sourceCrop[0] / 2,
          pieces[0].origin[1] + pieces[0].sourceCrop[1] / 2];
        const width = reference.sources[key].width, height = reference.sources[key].height;
        const source = new Uint8Array(width * height * 4);
        for (const piece of pieces) for (let y = 0; y < piece.h; y++) for (let x = 0; x < piece.w; x++) {
          const sourceIndex = ((piece.y + y) * ARCHITECTURE.width + piece.x + x) * 4;
          if (!pixels[sourceIndex + 3]) continue;
          const target = ((piece.sourceCrop[1] + y) * width + piece.sourceCrop[0] + x) * 4;
          assert(source[target + 3] === 0, 'Source owners never overlap', { key, x, y });
          source.set(pixels.subarray(sourceIndex, sourceIndex + 4), target);
        }
        assert(await sha256(source) === reference.sources[key].rgba_sha256,
          'Reconstructed original source RGBA hash', { key, width, height });
        const actual = await capture(join(pieces.map(piece => row(piece, 0, 0, scale))), empty, scale);
        let checked = 0, covered = 0, bad = 0, excludedBoundaries = 0, transparent = 0; const failures = [];
        const left = ox - commonOrigin[0] * scale, top = oy - commonOrigin[1] * scale;
        for (let py = Math.max(0, Math.floor(top)); py < Math.min(canvas.height, top + height / 2 * scale); py++) {
          for (let px = Math.max(0, Math.floor(left)); px < Math.min(canvas.width, left + width / 2 * scale); px++) {
            const fx = (px + .5 - left) * 2 / scale, fy = (py + .5 - top) * 2 / scale;
            if (Math.abs(fx - Math.round(fx)) < .0001 || Math.abs(fy - Math.round(fy)) < .0001) { excludedBoundaries++; continue; }
            const x = Math.floor(fx), y = Math.floor(fy);
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const offset = (y * width + x) * 4;
            const alpha = source[offset + 3] < 128 ? 0 : source[offset + 3] / 255;
            const expected = [23, 23, 28].map((background, channel) => source[offset + channel] * alpha + background * (1 - alpha));
            const found = at(actual, px, py);
            checked++; if (alpha) covered++; else transparent++;
            if (found[3] !== 255 || expected.some((value, c) => Math.abs(found[c] - value) > 1.1)) {
              bad++; if (failures.length < 4) failures.push({ px, py, x, y, expected, found });
            }
          }
        }
        assert(covered > 10 && transparent > 10 && bad === 0, 'Split ownership reconstructs common source raster', { key, scale, covered, checked, transparent, excludedBoundaries, bad, failures });
        return { pass: true, key, scale, pieces: pieces.length, covered, checked, bad,
          transparent, excludedBoundaries, sourceHash: reference.sources[key].rgba_sha256, milliseconds: performance.now() - start };
      },
      async floorMaterialCase({ scale = 1, origin = [320.37, 240.19], mixed = true, missing = false, covering = 3,
        requireSourceReference = true } = {}) {
        const previousOrigin = [ox, oy]; [ox, oy] = origin;
        try {
          const floors = [];
          for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) floors.push(x, y, mixed ? (x + y) % 3 + 1 : covering);
          const lot = { width: 3, height: 3, walls: new Uint32Array(), edges: new Uint32Array(),
            architecture: { windows: [], catalogue: [] }, floors: Uint32Array.from(floors),
            coveringLooks: Float32Array.from([18, 1.15, -.12, -25, .55, .1, -20, 1.6, -.18]) };
          const built = buildStaticInstances(lot, ox, oy, 16, scale);
          const rows = Array.from({ length: built.floorCount }, (_, index) => built.instances.slice(index * 16, index * 16 + 16));
          if (missing) rows.splice(4, 1);
          const clear = await capture(empty, empty, scale);
          assert(same(at(clear, Math.floor(ox), Math.floor(oy)), [23, 23, 28, 255]), 'Floor clear control');
          const actual = await capture(join(rows), empty, scale);
          const reversed = await capture(join([...rows].reverse()), empty, scale);
          assert(same(actual, reversed), 'Mixed material draw order is pixel-identical');
          let covered = 0, outside = 0, missingPixels = 0, referencePixels = 0, failures = 0;
          let excludedCoverageEdges = 0, excludedMaterialEdges = 0, excludedTexelBoundaries = 0;
          const examples = [];
          for (let py = 0; py < canvas.height; py++) for (let px = 0; px < canvas.width; px++) {
            const sx = (px + .5 - ox) / scale, sy = (py + .5 - oy) / scale;
            const gx = (sy / 21 + sx / 32) / 2, gy = (sy / 21 - sx / 32) / 2;
            const inside = gx > -.5 && gx < 2.5 && gy > -.5 && gy < 2.5;
            const absent = missing && gx > .5 && gx < 1.5 && gy > .5 && gy < 1.5;
            if ([gx + .5, gx - 2.5, gy + .5, gy - 2.5, ...(missing ? [gx - .5, gx - 1.5, gy - .5, gy - 1.5] : [])].some(value => Math.abs(value) < 1e-6)) {
              excludedCoverageEdges++; continue;
            }
            const color = at(actual, px, py), isClear = same(color, [23, 23, 28, 255]);
            if (!inside || absent) {
              outside++; if (absent) missingPixels++;
              if (!isClear) failures++;
              continue;
            }
            covered++;
            if (isClear) failures++;
            if ([gx + .5, gy + .5].some(value => Math.abs(value - Math.round(value)) < 1e-6)) {
              excludedMaterialEdges++; continue;
            }
            const x = Math.floor(gx + .5), y = Math.floor(gy + .5);
            const sprite = floorMaterial(mixed ? (x + y) % 3 + 1 : covering, 'house', x, y).sprite;
            const fx = (sx - (x - y) * 32 + sprite.origin[0]) * sprite.pixel_density;
            const fy = (sy - (x + y) * 21 + sprite.origin[1]) * sprite.pixel_density;
            if ([fx, fy].some(value => Math.abs(value - Math.round(value)) < .001)) {
              excludedTexelBoundaries++; continue;
            }
            const tx = Math.max(0, Math.min(sprite.w - 1, Math.floor(fx)));
            const ty = Math.max(0, Math.min(sprite.h - 1, Math.floor(fy)));
            const atSource = ((sprite.y + ty) * ARCHITECTURE.width + sprite.x + tx) * 4;
            const expected = [...pixels.slice(atSource, atSource + 3)];
            referencePixels++;
            if (expected.some((value, channel) => Math.abs(value - color[channel]) > 1)) {
              failures++; if (examples.length < 5) examples.push({ px, py, x, y, expected, color });
            }
          }
          assert(covered > 1000 && outside > 100 && (!missing || missingPixels > 100)
            && failures === 0, 'Production floors retain exact physical coverage and match every stable source witness',
          { scale, origin, mixed, missing, covering, covered, outside, missingPixels, referencePixels, failures, examples });
          assert(!requireSourceReference || referencePixels > 1000, 'Required lossless source comparison has enough stable witnesses',
            { scale, origin, referencePixels, excludedTexelBoundaries, requireSourceReference });
          const marker = new Float32Array(16);
          writeInstance(marker, 0, ox + .5, oy + .5, FLOOR_DEPTH - .01, spriteIndex('floor'), 1, 0, 1);
          const markerOnly = await capture(marker, empty, scale);
          const withFloors = await capture(join([...rows, marker]), empty, scale);
          const witness = [Math.floor(ox), Math.floor(oy)];
          assert(!same(at(markerOnly, ...witness), at(clear, ...witness))
            && same(at(markerOnly, ...witness), at(withFloors, ...witness)), 'A nearer foot marker remains over the floor');
          await capture(join(rows), empty, scale);
          return { pass: true, scale, origin, mixed, missing, covering, covered, outside, missingPixels, referencePixels, failures,
            requireSourceReference, sourceComparison: referencePixels === 0 ? 'unobserved' : 'passed',
            excludedCoverageEdges, excludedMaterialEdges, excludedTexelBoundaries };
        } finally { [ox, oy] = previousOrigin; }
      },
      async floorCatalogueCase() {
        const original = ARCHITECTURE.catalogue;
        const finishCatalogue = { ...original, patterns: { ...original.patterns,
          'fixture.checks': { role: 'floor', period: [2, 2], resource: 'fixture-checks' } },
          palettes: { ...original.palettes, cool: { multiply: [.4, .65, 1] }, warm: { multiply: [1, .55, .2] } },
          finishes: { ...original.finishes,
            cool: { patternKey: 'fixture.checks', paletteKey: 'cool', authoredContentLook: [0, 1, 0] },
            warm: { patternKey: 'fixture.checks', paletteKey: 'warm', authoredContentLook: [0, 1, 0] } },
          coverings: { ...original.coverings, 4: 'cool', 5: 'warm' } };
        const patternResources = { ...ARCHITECTURE.patterns, 'fixture-checks': { width: 256, height: 256,
          url: new URL('./fixtures/architecture/fixture-checks.pattern.png', import.meta.url).href } };
        const lot = { width: 3, height: 1, walls: new Uint32Array(), edges: new Uint32Array(),
          floors: new Uint32Array([0, 0, 1, 1, 0, 4, 2, 0, 5]),
          coveringLooks: Float32Array.from([18, 1.15, -.12, -25, .55, .1, -20, 1.6, -.18, 0, 1, 0, 0, 1, 0]) };
        let selected, alternate;
        try {
          const finishKeys = activeFloorFinishKeys(lot.floors, null, finishCatalogue);
          selected = await loadArchitectureAtlas(gpu.device.limits, { baseUrl: '/', finishKeys, catalogue: finishCatalogue, patternResources });
          alternate = await SpriteRenderer.create(gpu, selected);
          const architecture = { windows: [], catalogue: [], floorCatalogue: finishCatalogue, finishes: selected.finishes };
          const built = buildStaticInstances({ ...lot, architecture }, ox, oy, 16);
          const rows = built.instances.slice(0, built.floorCount * 16);
          const mixed = await capture(rows, empty, 1, alternate);
          const acceptedOnly = await capture(rows.slice(0, 16));
          assert(same(at(mixed, Math.floor(ox), Math.floor(oy)), at(acceptedOnly, Math.floor(ox), Math.floor(oy))), 'Accepted floor stays unchanged beside alternate finishes');
          const samples = [1, 2].map(x => at(mixed, Math.floor(ox + x * 32), Math.floor(oy + x * 21)));
          assert(samples.every(sample => !same(sample, [23, 23, 28, 255])) && !same(samples[0], samples[1]), 'Appended coverings display independent palettes simultaneously');
          for (const covering of [0, 1, 2, 3, 4, 5]) {
            const preview = buildStaticInstances({ ...lot, architecture, floorPreview: [1, 0, covering] }, ox, oy, 16).instances.slice(0, 48);
            const committed = buildStaticInstances({ ...lot, architecture, floors: new Uint32Array([0, 0, 1, 1, 0, covering, 2, 0, 5]) }, ox, oy, 16).instances.slice(0, 48);
            assert(same(await capture(preview, empty, 1, alternate), await capture(committed, empty, 1, alternate)), 'Preview and commit pixels match', { covering });
          }
          return { pass: true, finishKeys, resources: selected.finishes.resources, samples, previewCommitCases: 6 };
        } finally { alternate?.destroy(); if (selected) closeArchitectureAtlas(selected); }
      },
      async floorCoverageCase(scale = 1) {
        const rows = [];
        for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) rows.push(row(architectureFloor('floor.boards', x, y), x, y, scale));
        const actual = await capture(join(rows), empty, scale), reversed = await capture(join(rows.reverse()), empty, scale);
        assert(same(actual, reversed), 'Shared floor coverage is independent of draw order', { scale });
        let interior = 0, holes = 0, leaks = 0;
        for (let py = 0; py < canvas.height; py++) for (let px = 0; px < canvas.width; px++) {
          const sx = (px + .5 - ox) / scale, sy = (py + .5 - oy) / scale;
          const x = (sy / 21 + sx / 32) / 2, y = (sy / 21 - sx / 32) / 2;
          const distance = Math.min(Math.abs(x + .5), Math.abs(x - 2.5), Math.abs(y + .5), Math.abs(y - 2.5));
          if (distance < .001) continue;
          const inside = x > -.5 && x < 2.5 && y > -.5 && y < 2.5;
          const color = at(actual, px, py), clear = same(color, [23, 23, 28, 255]);
          if (inside) { interior++; if (clear) holes++; } else if (!clear) leaks++;
        }
        assert(interior > 100 && holes === 0 && leaks === 0, 'Canonical shared floor vertices have no holes or leaks', { scale, interior, holes, leaks });
        return { pass: true, scale, interior, holes, leaks };
      },
      async finishCase() {
        const finishCatalogue = { ...ARCHITECTURE.catalogue,
          patterns: { ...ARCHITECTURE.catalogue.patterns, stripes: { role: 'wall', period: [1, 2], resource: 'fixture-stripes' },
            checks: { role: 'floor', period: [2, 2], resource: 'fixture-checks' } },
          palettes: { ...ARCHITECTURE.catalogue.palettes, cool: { multiply: [.45, .7, 1] }, warm: { multiply: [1, .6, .3] } },
          finishes: { ...ARCHITECTURE.catalogue.finishes, cool: { patternKey: 'stripes', paletteKey: 'cool' },
            warm: { patternKey: 'stripes', paletteKey: 'warm' }, checks: { patternKey: 'checks', paletteKey: 'cool' } } };
        const patternResources = { ...ARCHITECTURE.patterns,
          'fixture-stripes': { width: 256, height: 256,
            url: new URL('./fixtures/architecture/fixture-stripes.pattern.png', import.meta.url).href },
          'fixture-checks': { width: 256, height: 256,
            url: new URL('./fixtures/architecture/fixture-checks.pattern.png', import.meta.url).href } };
        let selected, alternate;
        try {
          selected = await loadArchitectureAtlas(gpu.device.limits, { baseUrl: '/', finishKeys: ['cool', 'warm', 'checks'], catalogue: finishCatalogue, patternResources });
          alternate = await SpriteRenderer.create(gpu, selected);
          const slots = ['cool', 'warm', 'checks'].map(key => architectureFinishSlot(selected.finishes, key));
          const sprite = architectureSprite(1, 1, 'front', false)[0];
          const accepted = await capture(row(sprite));
          const mixedDefault = await capture(row(sprite), empty, 1, alternate);
          assert(same(accepted, mixedDefault), 'Accepted pixels unchanged when alternate resources loaded');
          const first = await capture(row(sprite, 0, 0, 1, false, 1, slots[0]), empty, 1, alternate);
          const second = await capture(row(sprite, 0, 0, 1, false, 1, slots[1]), empty, 1, alternate);
          const wall = sample(sprite, 1, 1);
          assert(!same(at(first, wall.px, wall.py), at(second, wall.px, wall.py)), 'Identical geometry carries independent palettes');
          // Diagonal translation moves the sprite vertically with no horizontal resampling.
          const mixed = await capture(join([row(sprite), row(sprite, 3, 3, 1, false, 1, slots[0]),
            row(sprite, 6, 6, 1, false, 1, slots[1])]), empty, 1, alternate);
          assert(same(at(mixed, wall.px, wall.py), at(accepted, wall.px, wall.py))
            && same(at(mixed, wall.px, wall.py + 126), at(first, wall.px, wall.py))
            && same(at(mixed, wall.px, wall.py + 252), at(second, wall.px, wall.py)), 'Simultaneous identical geometry keeps independent finish slots');
          const built = buildStaticInstances({ width: 10, height: 10, walls: new Uint32Array(), edges: new Uint32Array(),
            house: [0, 0], showCutAwayWalls: true, architecture: { catalogue,
              windows: [{ axis: 1, x: 2, y: 2, model: 1 }, { axis: 1, x: 5, y: 5, model: 1 }],
              wallFinishSlots: { 'window/1/2/2/1': slots[0], 'window/1/5/5/1': slots[1] } } }, ox, oy, 16);
          const live = await capture(built.instances.slice(0, built.count * 16), built.lowInstances, 1, alternate);
          const a = sample(sprite, 1, 1, 2, 1.5), b = sample(sprite, 1, 1, 5, 4.5);
          const aReference = await capture(row(sprite, 2, 1.5, 1, false, 1, slots[0]), empty, 1, alternate);
          const bReference = await capture(row(sprite, 5, 4.5, 1, false, 1, slots[1]), empty, 1, alternate);
          assert(same(at(live, a.px, a.py), at(aReference, a.px, a.py))
            && same(at(live, b.px, b.py), at(bReference, b.px, b.py)), 'Production geometry routes per-panel finish selections');
          const retained = [];
          for (const role of [3, 4, 5]) {
            const p = sample(sprite, role, 1);
            assert(same(at(first, p.px, p.py), at(accepted, p.px, p.py)) && same(at(second, p.px, p.py), at(accepted, p.px, p.py)),
              'Independent material pixels unchanged', { role, p }); retained.push(role);
          }
          const floor = architectureFloor('floor.boards', 0, 0);
          const originalFloor = await capture(row(floor)), selectedFloor = await capture(row(floor, 0, 0, 1, false, 1, slots[2]), empty, 1, alternate);
          const ground = { px: Math.floor(ox), py: Math.floor(oy) };
          assert(!same(at(originalFloor, ground.px, ground.py), [23, 23, 28, 255]), 'Floor witness is inside canonical diamond');
          assert(!same(at(originalFloor, ground.px, ground.py), at(selectedFloor, ground.px, ground.py)), 'Alternate floor uses neutral carrier');
          const tiles = architectureFloor('floor.tiles', 0, 0);
          const originalTiles = await capture(row(tiles));
          assert(!same(originalFloor, originalTiles), 'Accepted Boards and Tiles are distinct');
          const replacementTiles = await capture(row(tiles, 0, 0, 1, false, 1, slots[2]), empty, 1, alternate);
          assert(same(selectedFloor, replacementTiles), 'Replacement finish removes original Boards and Tiles patterns');
          const short = architecturePieces('straight.x-front.cut')[0], witness = sample(short, 1, 1);
          const shortOpaque = row(short, 0, 0, 1, true, 1, slots[0]);
          const shortFaded = row(short, 0, 0, 1, true, .25, slots[0]);
          const shortBase = at(await capture(empty, empty, 1, alternate), witness.px, witness.py);
          const shortFull = at(await capture(empty, shortOpaque, 1, alternate), witness.px, witness.py);
          const shortSingle = at(await capture(empty, shortFaded, 1, alternate), witness.px, witness.py);
          const shortPair = at(await capture(empty, join([shortFaded, shortFaded]), 1, alternate), witness.px, witness.py);
          assert(!same(shortFull, shortBase) && shortPair.slice(0, 3).every((value, c) =>
            Math.abs(value - (shortFull[c] * .4375 + shortBase[c] * .5625)) <= 2)
            && shortPair.some((value, c) => Math.abs(value - shortSingle[c]) > 4),
          'Nonzero finish slot preserves short-wall blending', { shortBase, shortFull, shortSingle, shortPair });
          const result = { pass: true, retained, slots, resources: selected.finishes.resources, residentBytes: selected.finishes.residentBytes,
            shortBlend: { base: shortBase, full: shortFull, single: shortSingle, pair: shortPair } };
          alternate.destroy(); alternate = undefined;
          // Disposing one renderer must leave its shared device and sibling renderer usable.
          assert(same(await capture(row(sprite)), accepted), 'Renderer disposal preserves shared device');
          return result;
        } finally { alternate?.destroy(); if (selected) closeArchitectureAtlas(selected); }
      },
      async historicalCase(scale = 1) {
        const fixture = await (await fetch(new URL('./fixtures/architecture/historical-inputs.json', import.meta.url))).json();
        const directory = './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/';
        const metadata = await (await fetch(new URL(directory + 'manifest.json', import.meta.url))).json();
        assert(metadata.baseline === fixture.baseline && metadata.files['atlas.ts'] === fixture.atlasSourceSHA256,
          'Historical input atlas identity is pinned');
        const { default: source } = await import('./.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/sprites.ts?raw');
        const { default: shader } = await import('./.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/sprites.wgsl?raw');
        assert(await sha256(new TextEncoder().encode(source)) === metadata.files['sprites.ts']
          && await sha256(new TextEncoder().encode(shader)) === metadata.files['sprites.wgsl'], 'Historical renderer source bytes are pinned');
        const { SpriteRenderer: Baseline } = await import('./.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/sprites.ts');
        historicalRenderer ??= await Baseline.create(gpu);
          const opaque = [], low = [];
          for (const record of fixture.rows) {
            const values = Float32Array.from(record.values);
            assert(Number.isInteger(values[3]) && values[3] >= 0 && values[3] < fixture.historicalPrefixLength,
              'Historical proof contains historical sprite IDs only');
            values[0] = ox + values[0] * scale; values[1] = oy + values[1] * scale;
            (record.low ? low : opaque).push(values);
          }
          const current = await capture(join(opaque), join(low), scale);
          // The original renderer predates the architecture-camera setter; these rows never use it.
          const previous = await capture(join(opaque), join(low), scale, historicalRenderer);
          let nonbackground = 0;
          for (let offset = 0; offset < current.length; offset += 4) {
            if (current[offset] !== 23 || current[offset + 1] !== 23 || current[offset + 2] !== 28) nonbackground++;
          }
          assert(nonbackground > 1000 && same(current, previous), 'Historical renderer pixel parity with pinned inputs', { scale, nonbackground });
          return { pass: true, scale, nonbackground, rows: fixture.rows.length, baseline: fixture.baseline,
            pixelsSHA256: await sha256(current), rendererSHA256: metadata.files['sprites.ts'] };
      },
      async doorContactCase(axis = 0, scale = 1, cutaway = false) {
        const edges = axis === 0 ? [0, 3, 2, 0, 0, 3, 3, 1, 0, 3, 4, 0]
          : [1, 2, 3, 0, 1, 3, 3, 1, 1, 4, 3, 0];
        const built = buildStaticInstances({ width: 6, height: 6, house: [0, 0],
          walls: new Uint32Array(), edges: Uint32Array.from(edges),
          doors: axis === 0 ? Uint32Array.from([3, 3]) : new Uint32Array(),
          horizontalDoors: axis === 1 ? Uint32Array.from([3, 3]) : new Uint32Array(),
          showCutAwayWalls: !cutaway, architecture: { windows: [], catalogue } }, ox, oy, 16, scale);
        const walls = built.instances.slice(built.floorCount * 16, built.count * 16);
        const portal = new Float32Array(32);
        const position = axis === 0 ? [2, 3] : [3, 2];
        writePortals(portal, 0, {
          portalCount: 1, portalPositions: () => Float32Array.from(position),
          portalFrames: () => Uint32Array.from([spriteIndex('frontDoorFrameSELeft')]),
          portalDepthOffsets: () => Float32Array.from([.5]),
          portalLeaves: () => Uint32Array.from([spriteIndex('frontDoorOpenSELeft')]),
          portalFarSides: () => Float32Array.from([3, 3]),
          portalOpenness: () => Float32Array.from([1]),
          portalPreviousOpenness: () => Float32Array.from([1]),
        }, ox, oy, 16, scale, false, null);
        const frame = portal.slice(0, 16);
        const combine = new Float32Array(walls.length + frame.length);
        combine.set(walls); combine.set(frame, walls.length);
        const full = await capture(combine, built.lowInstances, scale);
        const noFrame = await capture(walls, built.lowInstances, scale);
        const noWall = await capture(frame, empty, scale);
        const clear = await capture(empty, empty, scale);
        const records = [];
        let frameWitnesses = 0, wallWitnesses = 0;
        for (const joint of [2.5, 3.5]) for (const offset of [-.06, -.03, -.015, 0, .015, .03, .06])
          for (const z of cutaway ? [.25, .45] : [.35, .95, 1.9]) {
            // Front face of the independently specified 0.14 wall/casing depth.
            const [x, y] = axis === 0 ? [2.57, joint + offset] : [joint + offset, 2.57];
            const px = Math.floor(ox + (x - y) * 32 * scale);
            const py = Math.floor(oy + (x + y) * 21 * scale - z * 38 * scale);
            const actual = at(full, px, py), background = at(clear, px, py);
            assert(!same(actual, background), 'Joined casing/wall contact has visible coverage',
              { axis, scale, cutaway, joint, offset, z, px, py, actual, background });
            frameWitnesses += Number(!same(actual, at(noFrame, px, py)));
            wallWitnesses += Number(!same(actual, at(noWall, px, py)));
            records.push({ joint, offset, z, px, py, actual });
          }
        assert(frameWitnesses > 0 && wallWitnesses > 0, 'Both physical producers affect contact witnesses',
          { axis, scale, cutaway, frameWitnesses, wallWitnesses });
        return { pass: true, axis, scale, cutaway, depth: .14, count: records.length,
          frameWitnesses, wallWitnesses, records };
      },
      async compositionCase(scale = 1) {
        const rear = [{ axis: 1, x: 1, y: 0, model: 1 }, { axis: 0, x: 0, y: 2, model: 4 }];
        const front = [{ axis: 1, x: 2, y: 4, model: 7 }];
        const draw = async (windows, cutaway, house) => {
          const built = buildStaticInstances({ width: 6, height: 6, house, walls: new Uint32Array(), edges: new Uint32Array(),
            showCutAwayWalls: !cutaway, architecture: { windows, catalogue } }, ox, oy, 16, scale);
          return capture(built.instances.slice(0, built.count * 16), built.lowInstances, scale);
        };
        const rearFull = await draw(rear, false, [6, 6]), rearCut = await draw(rear, true, [6, 6]);
        const frontFull = await draw(front, false, [0, 0]), frontCut = await draw(front, true, [0, 0]);
        const background = await capture(empty, empty, scale);
        assert(!same(rearFull, background) && same(rearFull, rearCut), 'Rear shell and windows keep identical full height in play view');
        assert(!same(frontFull, background) && !same(frontCut, background) && !same(frontFull, frontCut),
          'Authored front window switches to a visible cut section');
        return { pass: true, scale, rearHash: await sha256(rearFull), frontFullHash: await sha256(frontFull), frontCutHash: await sha256(frontCut) };
      },
      async showRoom(scale = 1, cutaway = false) {
        const windows = [{ axis: 1, x: 1, y: 0, model: 1 }, { axis: 0, x: 0, y: 2, model: 4 },
          { axis: 1, x: 2, y: 4, model: 7 }];
        const panels = buildArchitectureWallGeometry({ width: 6, height: 6, house: [6, 6], catalogue,
          edges: Uint32Array.from([1, 1, 4, 0, 1, 5, 4, 0, 0, 3, 0, 0, 0, 3, 1, 0, 0, 3, 2, 0]), windows, cutaway });
        const opaque = [], low = [];
        for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) opaque.push(row(architectureFloor('floor.boards', x, y), x, y, scale));
        for (const panel of panels) (panel.low ? low : opaque).push(row(ARCHITECTURE.sprites[panel.architectureId - ARCHITECTURE.baseSpriteId], panel.x, panel.y, scale, panel.low));
        await capture(join(opaque), join(low), scale);
        return { pass: true, scale, cutaway, panels: panels.length };
      },
      dispose() { readback.destroy(); renderer.destroy(); historicalRenderer?.destroy?.(); gpu.device.destroy(); canvas.remove(); },
    };
  } catch (error) { if (atlas) closeArchitectureAtlas(atlas); readback.destroy(); renderer?.destroy(); gpu.device.destroy(); canvas.remove(); throw error; }
}
