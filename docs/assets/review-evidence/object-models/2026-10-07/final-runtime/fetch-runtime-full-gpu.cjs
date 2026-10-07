// Finite production-catalogue proof. The caller owns the preview server.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { orderWithPreflight } = require('./fetch-runtime-full-preflight.cjs');
const root = path.resolve(__dirname, '../..');
const [indexArgument, outputArgument, originArgument = 'http://127.0.0.1:5198'] = process.argv.slice(2);
const flags = process.argv.slice(5);
const preflightOnly = flags.includes('--preflight-only');
const reusePrepared = flags.find(value => value.startsWith('--prepared='))?.slice('--prepared='.length);
if (flags.some(value => value !== '--preflight-only' && !value.startsWith('--prepared='))) throw Error('Unknown fetch harness flag');
if (!indexArgument || !outputArgument) {
  console.error('Usage: node fetch-runtime-full-gpu.cjs SOURCE_REFERENCE_INDEX NEW_OUTPUT_DIRECTORY [PREVIEW_ORIGIN] [--preflight-only] [--prepared=PATH]');
  process.exit(2);
}
const indexPath = path.resolve(indexArgument), output = path.resolve(outputArgument);
const origin = new URL(originArgument).origin;
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw Error('Require the task-owned local preview origin');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

(async () => {
  // Preparation is deliberately strict: a partial source index cannot become a passing run.
  let preparedPath = path.join(output, 'prepared.json');
  if (reusePrepared !== undefined) {
    fs.mkdirSync(output);
    preparedPath = path.resolve(reusePrepared);
  } else {
    const preparedProcess = spawnSync('python', ['-B', path.join(__dirname, 'fetch-runtime-full-prepare.py'), indexPath, output],
      { cwd: root, stdio: 'inherit', timeout: 15 * 60 * 1000 });
    if (preparedProcess.error || preparedProcess.status !== 0) throw preparedProcess.error || Error('Reference preparation failed');
  }
  const prepared = JSON.parse(fs.readFileSync(preparedPath, 'utf8'));
  if (prepared.sourceIndexSHA256 !== sha(indexPath)) throw Error('Prepared source index changed');
  for (const binding of prepared.exportManifests) {
    if (sha(path.resolve(path.dirname(indexPath), binding.path)) !== binding.sha256) throw Error('Prepared export manifest changed');
  }
  const ordered = orderWithPreflight(prepared.cases);
  prepared.cases = ordered.cases;
  prepared.preflightKeys = ordered.preflightKeys;
  prepared.preflightLabels = ordered.preflightLabels;
  prepared.preflightOnly = preflightOnly;
  const referenceDirectory = path.join(path.dirname(preparedPath), 'references');
  fs.copyFileSync(__filename, path.join(output, 'harness-at-run.cjs'));
  fs.copyFileSync(path.join(__dirname, 'fetch-runtime-full-preflight.cjs'), path.join(output, 'preflight-at-run.cjs'));
  const { chromium } = require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright-core'));
  let browser, context;
  const started = Date.now();
  let watchdog;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
    watchdog = setTimeout(() => { void browser.close(); }, 20 * 60 * 1000);
    context = await browser.newContext({ viewport: { width: 560, height: 540 } });
    const page = await context.newPage();
    page.on('console', message => { if (message.type() === 'log') console.log(message.text()); });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error)));
    const referenceFiles = new Set(prepared.cases.flatMap(row => [row.referenceRGBA, row.referenceAlpha]));
    await page.route(origin + '/__fetch_full_reference/*', async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      if (!referenceFiles.has(name)) return route.abort();
      return route.fulfill({ path: path.join(referenceDirectory, name), contentType: 'application/octet-stream' });
    });
    await page.route(origin + '/', route => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><html><body><canvas id="proof" width="540" height="520"></canvas></body></html>',
      headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } }));
    await page.goto(origin + '/');
    const result = await page.evaluate(async prepared => {
      const atlas = await import('/src/render/atlas.ts');
      const { SpriteRenderer } = await import('/src/render/sprites.ts');
      const { InteractionSelection } = await import('/src/render/interaction-sprites.ts');
      const { buildInstanceBatch } = await import('/src/frame.ts');
      const { pickSprite } = await import('/src/input.ts');
      const { FLOATS_PER_INSTANCE } = await import('/src/render/instances.ts');
      const names = ['green', 'blue', 'red'], facings = ['SE', 'NW', 'SW', 'NE'], full = 0xffffff;
      const originalByFacing = {};
      const fixture = ref => {
        const state = { ...ref, copy: 0 }, absent = 0xffffffff, original = originalByFacing[ref.facing];
        const u32 = (...values) => new Uint32Array(values), positions = new Float32Array([0, 1, 0, 0]);
        const source = { count: 2, positions: () => positions, prevPositions: () => positions,
          ids: () => u32(42, 99), kinds: () => u32(0, 1), sprites: () => u32(1, original),
          activities: () => u32(0, 0), visualActions: () => u32(0, 0), facings: () => u32(4, 0),
          simIds: () => u32(state.palette, absent), carrying: () => u32(absent, absent), itemKinds: () => [],
          interactionTargets: () => u32(99, absent), footprintWidths: () => u32(0, 1), footprintDepths: () => u32(0, 1),
          readingStages: () => u32(state.stage, 0), readingCopies: () => u32(state.copy, absent),
          readingHomeShelves: () => u32(99, absent), readingHomeSlots: () => u32(state.slot, absent),
          readingReachRemaining: () => u32(state.stage === 6 || state.stage === 7 ? 4 - state.phase : 0, 0),
          readingReachTotals: () => u32(state.stage === 6 || state.stage === 7 ? 4 : 0, 0),
          shelfBookOffsets: () => u32(0, 0), shelfBookCounts: () => u32(0, 1), shelfBookMasks: () => u32(state.physicalMask),
          clockTick: () => 0 };
        const selection = new InteractionSelection({}, id => names[id], {}, {}, {}, {}, {}, atlas.BOOK_REACH_CATALOG);
        return { source, state, selection };
      };
      // Different placeholder sprite IDs are valid aliases. Compare what those
      // IDs resolve to, including the complete picking and joint-alpha records.
      const coverageSignatures = new Map(), coverageIdentities = new Map(), appearanceCache = new Map();
      const coverageIdentity = id => {
        if (!Number.isInteger(id) || !atlas.BED_COVERAGE[id]) throw Error('Missing production coverage');
        if (!coverageIdentities.has(id)) {
          const value = atlas.BED_COVERAGE[id];
          const signature = JSON.stringify([value.size, value.box, value.encoding ?? 'uint8', value.values]);
          if (!coverageSignatures.has(signature)) coverageSignatures.set(signature, coverageSignatures.size);
          coverageIdentities.set(id, coverageSignatures.get(signature));
        }
        return coverageIdentities.get(id);
      };
      const appearance = scene => {
        const sprite = scene.sprite;
        const ownerIdentity = scene.owners.map(owner => owner === null ? null
          : [coverageIdentity(owner.coverage), owner.marker]);
        if (!appearanceCache.has(sprite)) {
          const record = atlas.SPRITES[sprite], layers = atlas.SHARED_SEAT_LAYERS[sprite];
          if (!record || !layers || layers.length !== 5 || atlas.JOINT_SCENE_ALPHA_IDS[sprite] === undefined)
            throw Error('Reach alias lacks its complete registered production appearance');
          const resolvedLayers = layers.map(id => {
            if (id === -1) return null;
            const layer = atlas.SPRITES[id];
            if (!layer) throw Error('Sofa alias references an absent layer');
            return [layer.page ?? 0, layer.x, layer.y, layer.w, layer.h, layer.pixel_density ?? 1,
              atlas.SPRITE_ANCHORS[id] ?? null, atlas.BED_LAYER_TRIMS[id] ?? [0, 0]];
          });
          const stock = atlas.BOOK_REACH_SHELVES.scenes?.[sprite];
          const tables = atlas.BOOK_REACH_SHELVES.tables;
          if (!stock || !tables?.[stock.stock] || tables[stock.stock].length !== 256
              || (stock.correction !== undefined && tables[stock.correction]?.length !== 256))
            throw Error('Reach alias lacks complete production stock tables');
          appearanceCache.set(sprite, [record.w, record.h, record.pixel_density ?? 1,
            atlas.SPRITE_ANCHORS[sprite] ?? null, atlas.SPRITE_CONTENT_BOUNDS[sprite] ?? null,
            atlas.SPRITE_CONTENT_TOPS[sprite] ?? null, resolvedLayers,
            coverageIdentity(atlas.JOINT_SCENE_ALPHA_IDS[sprite]), stock.canvas, stock.offset,
            tables[stock.stock], stock.correction === undefined ? null : tables[stock.correction]]);
        }
        return JSON.stringify([appearanceCache.get(sprite), coverageIdentity(scene.alpha), ownerIdentity]);
      };
      const aliasChecks = { groups: 0, phaseComparisons: 0,
        compared: ['registered layer textures', 'scene dimensions and density', 'anchors', 'layer trims',
          'content bounds', 'joint coverage contents', 'scene coverage contents', 'owner coverage contents and markers',
          'stock and correction tables', 'stock canvas and offset'], stockTransitions: 0, cancellationResets: 0 };
      for (const facing of facings) {
        const original = atlas.spriteIndex('offlineBookcase' + (facing === 'SE' ? '' : facing));
        const profile = atlas.BOOK_REACH_CATALOG[original];
        if (!profile || profile.model !== 'bookshelf' || profile.slots !== 24 || profile.phases !== 4
            || Object.keys(profile.scenes).length !== 2 * 24 * 4 * 3)
          throw Error('Missing complete production fetch/shelve profile: ' + facing);
        originalByFacing[facing] = original;
      }
      const groups = new Map(), identities = new Set();
      for (const alias of prepared.aliases) {
        const key = `${alias.stage}:${alias.slot}:${alias.phase}:${alias.palette}`, identity = alias.facing + ':' + key;
        if (identities.has(identity)) throw Error('Duplicate semantic source alias');
        identities.add(identity);
        const frame = atlas.BOOK_REACH_CATALOG[originalByFacing[alias.facing]].scenes[key];
        const sourcePhase = alias.stage === 6 ? alias.phase : 3 - alias.phase;
        if (!frame || frame.suppressStock !== alias.suppressStock || alias.suppressStock !== (sourcePhase >= 2)
            || frame.scene.owners.length !== 1 || !frame.scene.owners[0]) throw Error('Reach key or stock ownership differs: ' + identity);
        const signature = appearance(frame.scene);
        if (!groups.has(alias.group)) { groups.set(alias.group, signature); aliasChecks.groups++; }
        else {
          if (groups.get(alias.group) !== signature) throw Error('Reach alias changes registered source appearance: ' + identity);
          aliasChecks.phaseComparisons++;
        }
        const { source, state, selection } = fixture({ ...alias, physicalMask: full });
        for (const physical of [0, 1 << alias.slot, full]) {
          state.physicalMask = physical;
          selection.updateSource(source, 0, false);
          const expected = alias.suppressStock ? (physical & ~(1 << alias.slot)) : (physical | (1 << alias.slot));
          if (selection.shelfMask(1, physical) !== expected || selection.bodies[0] !== frame.scene.sprite
              || selection.targetRows[0] !== 1 || selection.suppressed[1] !== 1 || state.copy !== 0)
            throw Error('Reach selection or selected physical-copy mask differs: ' + identity);
          aliasChecks.stockTransitions++;
        }
        state.stage = 0; state.copy = 0xffffffff;
        selection.updateSource(source, 0, false);
        if (selection.shelfMask(1, state.physicalMask) !== state.physicalMask || selection.suppressed[1]
            || selection.bedScenes[0] !== undefined || selection.bodies[0] !== -1)
          throw Error('Cancelled reach retained source appearance or stock forcing: ' + identity);
        aliasChecks.cancellationResets++;
      }
      if (identities.size !== 2304 || aliasChecks.groups !== 588) throw Error('Incomplete distinct poses or semantic alias coverage');
      const expectedGpuCases = prepared.cases.length * 3;
      const canvas = document.querySelector('#proof'), adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw Error('No actual WebGPU adapter');
      const device = await adapter.requestDevice(); // Default device limits, without overrides.
      const uncaptured = [];
      device.addEventListener('uncapturederror', event => uncaptured.push(event.error.message));
      const gpu = canvas.getContext('webgpu'), format = navigator.gpu.getPreferredCanvasFormat();
      gpu.configure({ device, format, alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      device.pushErrorScope('validation');
      let renderer;
      const resources = [], cases = [], shots = [], catalogueChecks = [];
      const width = canvas.width, height = canvas.height, originX = 270.25, originY = 330.5;
      const pitch = Math.ceil(width * 4 / 256) * 256;
      const makeTexture = descriptor => { const value = device.createTexture(descriptor); resources.push(value); return value; };
      const makeBuffer = descriptor => { const value = device.createBuffer(descriptor); resources.push(value); return value; };
      try {
        renderer = await SpriteRenderer.create({ device, context: gpu, format });
        const referenceTexture = makeTexture({ size: [248, 256], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        const alphaTexture = makeTexture({ size: [248, 256], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        const uniform = makeBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const module = device.createShaderModule({ code: `
          @group(0) @binding(0) var image:texture_2d<f32>;
          @group(0) @binding(1) var coverage:texture_2d<f32>;
          @group(0) @binding(2) var sampleImage:sampler;
          struct Transform { rectangle:vec4f, viewport:vec4f, };
          @group(0) @binding(3) var<uniform> transform:Transform;
          struct Varying { @builtin(position) position:vec4f, @location(0) uv:vec2f, };
          const corners=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
          @vertex fn vs(@builtin(vertex_index) index:u32)->Varying {
            let uv=corners[index]; let p=transform.rectangle.xy+uv*transform.rectangle.zw;
            var out:Varying; out.position=vec4f(p.x/transform.viewport.x*2-1,1-p.y/transform.viewport.y*2,.4,1); out.uv=uv; return out;
          }
          @fragment fn fs(in:Varying)->@location(0) vec4f {
            let halfTexel=.5/vec2f(textureDimensions(image)); let uv=clamp(in.uv,halfTexel,vec2f(1)-halfTexel);
            let c=textureSample(image,sampleImage,uv); let a=textureSample(coverage,sampleImage,uv).r;
            if(a<.5){discard;} let rgb=c.rgb/c.a;
            let display=select(1.055*pow(max(rgb,vec3f(0)),vec3f(1./2.4))-.055,rgb*12.92,rgb<=vec3f(.0031308));
            return vec4f(display,clamp(a,0.,1.));
          }` });
        const referencePipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' },
          fragment: { module, entryPoint: 'fs', targets: [{ format, blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] } });
        const referenceGroup = device.createBindGroup({ layout: referencePipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: referenceTexture.createView() }, { binding: 1, resource: alphaTexture.createView() },
          { binding: 2, resource: device.createSampler({ minFilter: 'linear', magFilter: 'linear' }) },
          { binding: 3, resource: { buffer: uniform } } ] });
        const buffer = makeBuffer({ size: pitch * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const readback = async (batch, scale, ref) => {
          if (ref) {
            device.queue.writeBuffer(uniform, 0, new Float32Array([
              originX - ref.anchor[0] * scale, originY + (21 - ref.anchor[1]) * scale,
              ref.canvas[0] * scale, ref.canvas[1] * scale, width, height, 0, 0]));
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginRenderPass({ colorAttachments: [{ view: gpu.getCurrentTexture().createView(),
              loadOp: 'clear', storeOp: 'store', clearValue: { r: .09, g: .09, b: .11, a: 1 } }] });
            pass.setPipeline(referencePipeline); pass.setBindGroup(0, referenceGroup); pass.draw(6); pass.end();
            device.queue.submit([encoder.finish()]);
          } else renderer.draw(batch.instances, batch.count, scale);
          const encoder = device.createCommandEncoder();
          encoder.copyTextureToBuffer({ texture: gpu.getCurrentTexture() }, { buffer, bytesPerRow: pitch, rowsPerImage: height }, [width, height]);
          device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
          const mapped = new Uint8Array(buffer.getMappedRange()), bytes = new Uint8Array(width * height * 4);
          for (let y = 0; y < height; y++) bytes.set(mapped.subarray(y * pitch, y * pitch + width * 4), y * width * 4);
          buffer.unmap(); return bytes;
        };
        const picture = (bytes, key) => {
          const pixels = new Uint8ClampedArray(bytes);
          if (format.startsWith('bgra')) for (let i = 0; i < pixels.length; i += 4) {
            const red = pixels[i + 2]; pixels[i + 2] = pixels[i]; pixels[i] = red;
          }
          const target = document.createElement('canvas'); target.width = width; target.height = height;
          target.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
          return { key, png: target.toDataURL() };
        };
        let preflightFailure = null;
        const referenceCount = prepared.preflightOnly ? prepared.preflightKeys.length : prepared.cases.length;
        for (let referenceIndex = 0; referenceIndex < referenceCount; referenceIndex++) {
          const ref = prepared.cases[referenceIndex], original = originalByFacing[ref.facing];
          const profile = atlas.BOOK_REACH_CATALOG[original];
          const { source, state, selection } = fixture(ref);
          const responses = await Promise.all([ref.referenceRGBA, ref.referenceAlpha].map(async name => {
            const response = await fetch('/__fetch_full_reference/' + name);
            if (!response.ok) throw Error('Missing reference bytes: ' + name);
            return response.arrayBuffer();
          }));
          device.queue.writeTexture({ texture: referenceTexture }, responses[0], { bytesPerRow: 248 * 8 }, [248, 256]);
          device.queue.writeTexture({ texture: alphaTexture }, responses[1], { bytesPerRow: 248 * 2 }, [248, 256]);
          for (const scale of [1, 1.5, 2.25]) {
            const batch = buildInstanceBatch(source, 1, originX, originY, 24, null, scale, false, 0, null, selection);
            const key = `${ref.stage}:${ref.slot}:${ref.phase}:${ref.palette}`, frame = profile.scenes[key];
            if (!frame || selection.bedScenes[0]?.sprite !== frame.scene.sprite || frame.suppressStock !== ref.suppressStock
                || selection.targetRows[0] !== 1 || selection.suppressed[1] !== 1
                || selection.shelfMask(1, ref.physicalMask) !== ref.expectedStockMask || state.copy !== 0)
              throw Error('Production reach selection or inventory mask disagrees: ' + ref.key);
            if (scale === 1) catalogueChecks.push({ key: ref.key, runtimeKey: key, sprite: frame.scene.sprite,
              physicalCopy: state.copy, physicalMask: ref.physicalMask, drawnStockMask: selection.shelfMask(1, ref.physicalMask) });
            const actual = await readback(batch, scale);
            const expected = await readback(null, scale, ref);
            let maximum = 0, components = 0;
            const histogram = new Uint32Array(256);
            for (let pixel = 0; pixel < actual.length; pixel += 4) {
              const a = Math.abs(actual[pixel] - expected[pixel]), b = Math.abs(actual[pixel + 1] - expected[pixel + 1]),
                c = Math.abs(actual[pixel + 2] - expected[pixel + 2]);
              maximum = Math.max(maximum, a, b, c);
              if (a) { histogram[a]++; components++; }
              if (b) { histogram[b]++; components++; }
              if (c) { histogram[c]++; components++; }
            }
            const rank = Math.floor(Math.max(0, components - 1) * .95);
            let p95 = 0, cumulative = 0;
            for (let value = 0; value < 256 && components; value++) {
              cumulative += histogram[value]; if (cumulative > rank) { p95 = value; break; }
            }
            const picks = ref.picks.map(witness => {
              const expectedEntity = witness.actor ? 42 : 99;
              const points = witness.points.map(([x, y]) => {
                const screenX = originX + ((x + .5) / 2 - ref.anchor[0]) * scale;
                const screenY = originY + ((y + .5) / 2 + 21 - ref.anchor[1]) * scale;
                const pick = pickSprite(source, screenX, screenY, originX, originY, scale, false, selection);
                return { point: [x, y], actualEntity: pick?.entity ?? null, pass: pick?.entity === expectedEntity };
              });
              return { owner: witness.actor ? 'actor' : 'furniture', expectedEntity, points, pass: points.every(point => point.pass) };
            });
            const picking = picks.every(row => row.pass);
            const pass = maximum <= 6 && p95 <= 2 && picking;
            cases.push({ key: ref.key, kind: ref.kind, facing: ref.facing, stage: ref.stage, slot: ref.slot,
              phase: ref.phase, palette: ref.palette, scale, maximum, p95, picking, picks, pass,
              physicalCopy: state.copy, physicalMask: ref.physicalMask, drawnStockMask: selection.shelfMask(1, ref.physicalMask),
              transitionWitness: ref.transitionWitness === true, preflightLabel: ref.preflightLabel ?? null });
            if ((!pass && shots.length < 16) || (ref.stage === 6 && ref.phase === 0 && scale === 1.5
                && ref.slot === 0 && ref.kind === 'actual_full_stock_green_beauty')) {
              shots.push(picture(actual, `${ref.key}-s${scale}-actual`));
              shots.push(picture(expected, `${ref.key}-s${scale}-reference`));
            }
            if (ref.preflightLabel && (!pass || uncaptured.length)) {
              preflightFailure = { key: ref.key, label: ref.preflightLabel, scale, maximum, p95, picking };
              break;
            }
          }
          if (preflightFailure) {
            console.log(JSON.stringify({ preflight: 'failed', ...preflightFailure, fullMatrixStarted: false }));
            break;
          }
          if (referenceIndex + 1 === prepared.preflightKeys.length) {
            const preflightValidation = await device.popErrorScope();
            device.pushErrorScope('validation');
            if (preflightValidation || uncaptured.length) {
              preflightFailure = { key: ref.key, label: 'gpu_validation', message: preflightValidation?.message ?? uncaptured.join('; ') };
              console.log(JSON.stringify({ preflight: 'failed', ...preflightFailure, fullMatrixStarted: false }));
              break;
            }
            console.log(JSON.stringify({ preflight: 'passed', cases: prepared.preflightKeys.length * 3,
              fullMatrixContinues: !prepared.preflightOnly }));
          }
          if (referenceIndex % 12 === 0) console.log(JSON.stringify({ processedReferences: referenceIndex + 1, totalReferences: referenceCount, gpuCases: cases.length }));
        }
        const validation = await device.popErrorScope();
        const preflightCases = cases.filter(row => row.preflightLabel !== null);
        const preflightPass = !validation && !uncaptured.length && !preflightFailure
          && preflightCases.length === prepared.preflightKeys.length * 3 && preflightCases.every(row => row.pass);
        return { pass: !prepared.preflightOnly && preflightPass && cases.length === expectedGpuCases && cases.every(row => row.pass),
          scope: preflightFailure ? 'partial_preflight_failure' : prepared.preflightOnly ? 'partial_preflight_only' : 'full_catalogue',
          preflight: { pass: preflightPass, failure: preflightFailure, expectedCases: prepared.preflightKeys.length * 3,
            completedCases: preflightCases.length, keys: prepared.preflightKeys, labels: prepared.preflightLabels },
          error: validation?.message ?? null, uncaptured, cases, shots, catalogueChecks, aliasChecks, expectedGpuCases,
          pageCount: atlas.ATLAS_PAGE_FILES.length, productionCatalogueActive: true,
          deviceLimits: { maxTextureDimension2D: device.limits.maxTextureDimension2D, maxTextureArrayLayers: device.limits.maxTextureArrayLayers },
          p95Definition: 'Nonzero RGB component errors, matching book-reach-stationary-gpu-padded',
          productionTablesAltered: false };
      } finally { for (const resource of resources) resource.destroy(); renderer?.destroy(); device.destroy(); }
    }, prepared);
    for (const shot of result.shots) fs.writeFileSync(path.join(output, shot.key + '.png'), Buffer.from(shot.png.split(',')[1], 'base64'));
    delete result.shots;
    result.pass &&= pageErrors.length === 0;
    result.pageErrors = pageErrors;
    result.elapsedSeconds = (Date.now() - started) / 1000;
    result.sourceIndex = indexPath; result.sourceIndexSHA256 = sha(indexPath);
    result.exportManifests = prepared.exportManifests;
    result.harness = { scriptSHA256: sha(__filename), preparationSHA256: sha(path.join(__dirname, 'fetch-runtime-full-prepare.py')),
      preflightSHA256: sha(path.join(__dirname, 'fetch-runtime-full-preflight.cjs')) };
    result.referenceMeaning = prepared.referenceMeaning;
    fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ pass: result.pass, scope: result.scope, preflightPass: result.preflight.pass, cases: result.cases.length,
      actualEmptyCases: result.cases.filter(row => row.kind === 'actual_empty_stock_beauty').length,
      actualSelectedOnlyCases: result.cases.filter(row => row.kind === 'actual_reachable_selected_only_beauty').length,
      actualFullStockCases: result.cases.filter(row => row.kind === 'actual_full_stock_green_beauty').length,
      derivedOwnerPaletteCases: 0,
      maximum: Math.max(...result.cases.map(row => row.maximum)), p95: Math.max(...result.cases.map(row => row.p95)),
      picking: result.cases.every(row => row.picking), output }));
    if (!(preflightOnly ? result.preflight.pass && pageErrors.length === 0 : result.pass)) process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    try { await context?.close(); } finally { await browser?.close(); }
  }
})().catch(error => {
  if (fs.existsSync(output)) fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ pass: false,
    scope: 'partial_execution_error', error: String(error), stack: error.stack }, null, 2) + '\n');
  console.error(error); process.exitCode = 1;
});
