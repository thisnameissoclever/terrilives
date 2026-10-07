// Finite production-catalogue proof. The caller owns the preview server.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const [indexArgument, outputArgument, originArgument = 'http://127.0.0.1:5198'] = process.argv.slice(2);
const flags = process.argv.slice(5);
const diagnosticKey = flags.find(value => value.startsWith('--diagnostic='))?.slice('--diagnostic='.length);
const reusePrepared = flags.find(value => value.startsWith('--prepared='))?.slice('--prepared='.length);
if ((diagnosticKey === undefined) !== (reusePrepared === undefined)) throw Error('Diagnostic mode requires both --diagnostic=KEY and --prepared=PATH');
if (!indexArgument || !outputArgument) {
  console.error('Usage: node sofa-runtime-full-gpu.cjs SOURCE_REFERENCE_INDEX NEW_OUTPUT_DIRECTORY [PREVIEW_ORIGIN]');
  process.exit(2);
}
const indexPath = path.resolve(indexArgument), output = path.resolve(outputArgument);
const origin = new URL(originArgument).origin;
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw Error('Require the task-owned local preview origin');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

(async () => {
  // Preparation is deliberately strict: a partial source index cannot become a passing run.
  let preparedPath = path.join(output, 'prepared.json');
  if (diagnosticKey !== undefined) {
    fs.mkdirSync(output);
    preparedPath = path.resolve(reusePrepared);
  } else {
    const preparedProcess = spawnSync('python', ['-B', path.join(__dirname, 'sofa-runtime-full-prepare.py'), indexPath, output],
      { cwd: root, stdio: 'inherit', timeout: 15 * 60 * 1000 });
    if (preparedProcess.error || preparedProcess.status !== 0) throw preparedProcess.error || Error('Reference preparation failed');
  }
  const prepared = JSON.parse(fs.readFileSync(preparedPath, 'utf8'));
  if (prepared.sourceIndexSHA256 !== sha(indexPath)) throw Error('Prepared reference source index changed');
  const referenceDirectory = path.join(path.dirname(preparedPath), 'references');
  if (diagnosticKey !== undefined) {
    const selected = prepared.cases.filter(row => row.key === diagnosticKey);
    if (selected.length !== 1 || selected[0].sceneKey === 0) throw Error('Diagnostic mode requires exactly one occupied reference');
    prepared.cases = selected;
    prepared.partialDiagnostic = true;
  }
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
    await page.route(origin + '/__sofa_full_reference/*', async route => {
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
      const { sharedSeatKey } = await import('/src/render/shared-seat-sprites.ts');
      const { buildInstanceBatch } = await import('/src/frame.ts');
      const { pickSprite } = await import('/src/input.ts');
      const { FLOATS_PER_INSTANCE } = await import('/src/render/instances.ts');
      const names = ['green', 'blue', 'red'], facings = ['SE', 'NW', 'SW', 'NE'];
      const originalByFacing = {};
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
            throw Error('Sofa alias lacks its complete registered production appearance');
          const resolvedLayers = layers.map(id => {
            if (id === -1) return null;
            const layer = atlas.SPRITES[id];
            if (!layer) throw Error('Sofa alias references an absent layer');
            return [layer.page ?? 0, layer.x, layer.y, layer.w, layer.h, layer.pixel_density ?? 1,
              atlas.SPRITE_ANCHORS[id] ?? null, atlas.BED_LAYER_TRIMS[id] ?? [0, 0]];
          });
          appearanceCache.set(sprite, [record.w, record.h, record.pixel_density ?? 1,
            atlas.SPRITE_ANCHORS[sprite] ?? null, atlas.SPRITE_CONTENT_BOUNDS[sprite] ?? null,
            atlas.SPRITE_CONTENT_TOPS[sprite] ?? null, resolvedLayers,
            coverageIdentity(atlas.JOINT_SCENE_ALPHA_IDS[sprite])]);
        }
        return JSON.stringify([appearanceCache.get(sprite), coverageIdentity(scene.alpha), ownerIdentity]);
      };
      const aliasChecks = { groups: 0, phaseComparisons: 0,
        compared: ['registered layer textures', 'scene dimensions and density', 'anchors', 'layer trims',
          'content bounds', 'joint coverage contents', 'scene coverage contents', 'owner coverage contents and markers'] };
      for (const facing of facings) {
        const original = atlas.spriteIndex('offlineLongSofa' + (facing === 'SE' ? '' : facing));
        const profile = atlas.SHARED_SEAT_CATALOG[original];
        if (!profile || profile.model !== 'long_sofa' || profile.seatIds.join(',') !== 'seat_1,seat_2,seat_3'
            || !profile.actions?.includes(3) || !profile.actions?.includes(8) || profile.cycleTicks !== 16)
          throw Error('Missing complete production shared-sofa profile: ' + facing);
        if (Object.keys(profile.scenes).length !== 27 * 4 * 27) throw Error('Incomplete production sofa catalogue: ' + facing);
        for (let state = 0; state < 27; state++) for (let phase = 0; phase < 4; phase++)
          for (let palette = 0; palette < 27; palette++) {
            const scene = profile.scenes[(state * 4 + phase) * 27 + palette];
            if (!scene || scene.owners.length !== 3 || scene.owners.some((owner, place) =>
              (owner === null) !== (Math.floor(state / (3 ** place)) % 3 === 0)))
              throw Error(`Invalid production sofa scene: ${facing}/${state}/${phase}/${palette}`);
          }
        for (let state = 0; state < 27; state++) for (let palette = 0; palette < 27; palette++) {
          const canonical = appearance(profile.scenes[state * 4 * 27 + palette]);
          aliasChecks.groups++;
          for (let phase = 1; phase < 4; phase++) {
            if (appearance(profile.scenes[(state * 4 + phase) * 27 + palette]) !== canonical)
              throw Error(`Static phase alias changes production appearance: ${facing}/${state}/${phase}/${palette}`);
            aliasChecks.phaseComparisons++;
          }
        }
        originalByFacing[facing] = original;
      }
      const representative = ref => ref.sceneKey === 26 && ref.kind === 'derivedOwnerSources' && ref.palettes.join('') === '012';
      if (!prepared.partialDiagnostic && prepared.cases.filter(representative).length !== 4) throw Error('Require one fully occupied mixed phase witness per facing');
      const expectedGpuCases = prepared.partialDiagnostic ? 1 : prepared.cases.length * 3 + 4 * 3 * 3;
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
      const width = canvas.width, height = canvas.height, originX = 270, originY = 360;
      const pitch = Math.ceil(width * 4 / 256) * 256;
      const makeTexture = descriptor => { const value = device.createTexture(descriptor); resources.push(value); return value; };
      const makeBuffer = descriptor => { const value = device.createBuffer(descriptor); resources.push(value); return value; };
      try {
        renderer = await SpriteRenderer.create({ device, context: gpu, format });
        const referenceTexture = makeTexture({ size: [320, 352], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        const alphaTexture = makeTexture({ size: [320, 352], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
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
            if(a<.5){discard;}
            if(transform.viewport.z>0.5){return vec4f(c.rgb,clamp(a,0.,1.));}
            let rgb=c.rgb/c.a;
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
              ref.canvas[0] * scale, ref.canvas[1] * scale, width, height, ref.referenceEncoding === 'straight-srgb' ? 1 : 0, 0]));
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
        for (let referenceIndex = 0; referenceIndex < prepared.cases.length; referenceIndex++) {
          const ref = prepared.cases[referenceIndex], original = originalByFacing[ref.facing];
          const profile = atlas.SHARED_SEAT_CATALOG[original];
          const occupied = [0, 1, 2].filter(place => Math.floor(ref.sceneKey / (3 ** place)) % 3 !== 0);
          const sourceIds = occupied.map(place => 101 + place).concat(99), targetRow = occupied.length;
          let tick = 0, includeActivityIndicators = false;
          const col = values => new Uint32Array(values), absent = 0xffffffff;
          const positions = new Float32Array(sourceIds.length * 2);
          const source = { count: sourceIds.length, positions: () => positions, prevPositions: () => positions,
            ids: () => col(sourceIds), kinds: () => col(occupied.map(() => 0).concat(1)),
            sprites: () => col(occupied.map(() => 1).concat(original)),
            // This art-composition fixture has no HUD activity indicator. Seated
            // actions and physical places still select the production artwork.
            activities: () => col(occupied.map(place => includeActivityIndicators
              ? (Math.floor(ref.sceneKey / (3 ** place)) % 3 === 2 ? 8 : 7) : 0).concat(0)),
            visualActions: () => col(occupied.map(place => Math.floor(ref.sceneKey / (3 ** place)) % 3 === 2 ? 3 : 8).concat(0)),
            facings: () => col(occupied.map(() => 3).concat(0)), simIds: () => col(occupied.map(place => ref.palettes[place]).concat(absent)),
            carrying: () => col(sourceIds.map(() => absent)), itemKinds: () => [],
            interactionTargets: () => col(occupied.map(() => 99).concat(absent)),
            seatedFurniture: () => col(occupied.map(() => 99).concat(absent)),
            seatedPlaces: () => col(occupied.concat(absent)), seatedWhole: () => col(sourceIds.map(() => 0)),
            modelSeatIds: () => ['seat_1', 'seat_2', 'seat_3'],
            footprintWidths: () => col(occupied.map(() => 0).concat(2)), footprintDepths: () => col(occupied.map(() => 0).concat(1)),
            clockTick: () => tick };
          const selection = new InteractionSelection({}, id => names[id], {}, {}, atlas.SHARED_SEAT_CATALOG);
          const responses = await Promise.all([ref.referenceRGBA, ref.referenceAlpha].map(async name => {
            const response = await fetch('/__sofa_full_reference/' + name);
            if (!response.ok) throw Error('Missing reference bytes: ' + name);
            return response.arrayBuffer();
          }));
          device.queue.writeTexture({ texture: referenceTexture }, responses[0], { bytesPerRow: 320 * 8 }, [320, 352]);
          device.queue.writeTexture({ texture: alphaTexture }, responses[1], { bytesPerRow: 320 * 2 }, [320, 352]);
          const phases = !prepared.partialDiagnostic && representative(ref) ? [0, 1, 2, 3] : [0];
          for (const phase of phases) for (const scale of (prepared.partialDiagnostic ? [1.5] : [1, 1.5, 2.25])) {
            tick = phase * 4;
            let indicatorControl = null;
            if (prepared.partialDiagnostic) {
              includeActivityIndicators = true;
              const control = buildInstanceBatch(source, 1, originX, originY, 24, null, scale, false, tick, null, selection);
              const count = control.count;
              indicatorControl = { count, pixels: await readback(control, scale) };
              includeActivityIndicators = false;
            }
            const batch = buildInstanceBatch(source, 1, originX, originY, 24, null, scale, false, tick, null, selection);
            const key = sharedSeatKey(ref.sceneKey, phase, ...ref.palettes);
            const selectedPalettes = ref.palettes.map((palette, place) => occupied.includes(place) ? palette : 0);
            const selectedKey = sharedSeatKey(ref.sceneKey, phase, ...selectedPalettes);
            const scene = profile.scenes[selectedKey], expanded = profile.scenes[key];
            if (!scene) throw Error('Selected phase key is absent');
            if (!expanded || expanded.sprite !== scene.sprite || expanded.alpha !== scene.alpha
                || JSON.stringify(expanded.owners) !== JSON.stringify(scene.owners))
              throw Error('Empty-seat palette aliases do not preserve the selected scene');
            if (occupied.length && (selection.bedScenes[targetRow]?.sprite !== scene.sprite || selection.bodies[0] !== scene.sprite))
              throw Error(`Production selection disagrees with phase key: ${ref.key}/${phase}`);
            if (!occupied.length && (selection.bedScenes[targetRow] !== undefined || selection.bodies[targetRow] !== -1))
              throw Error('Empty control unexpectedly replaced the ordinary furniture path');
            if (scale === 1) catalogueChecks.push({ key: ref.key, phase, runtimeKey: selectedKey, expandedPaletteKey: key, sprite: scene.sprite,
              selected: occupied.length > 0, emptyUsesOrdinaryFurniture: occupied.length === 0 });
            const actual = await readback(batch, scale);
            const expected = await readback(null, scale, ref);
            if (indicatorControl) {
              let maximum = 0;
              for (let pixel = 0; pixel < expected.length; pixel += 4) for (let channel = 0; channel < 3; channel++)
                maximum = Math.max(maximum, Math.abs(indicatorControl.pixels[pixel + channel] - expected[pixel + channel]));
              catalogueChecks.push({ diagnostic: 'activity_indicator_control', originalBatchCount: indicatorControl.count,
                artworkBatchCount: batch.count, sourceRows: source.count, maximum });
              shots.push(picture(indicatorControl.pixels, ref.key + '-with-activity-indicator'));
            }
            let maximum = 0, components = 0;
            const histogram = new Uint32Array(256);
            for (let pixel = 0; pixel < actual.length; pixel += 4) {
              const a = Math.abs(actual[pixel] - expected[pixel]), b = Math.abs(actual[pixel + 1] - expected[pixel + 1]),
                c = Math.abs(actual[pixel + 2] - expected[pixel + 2]);
              maximum = Math.max(maximum, a, b, c);
              if (a || b || c) { histogram[a]++; histogram[b]++; histogram[c]++; components += 3; }
            }
            const rank = Math.floor(Math.max(0, components - 1) * .95);
            let p95 = 0, cumulative = 0;
            for (let value = 0; value < 256 && components; value++) {
              cumulative += histogram[value]; if (cumulative > rank) { p95 = value; break; }
            }
            const picks = ref.picks.map(witness => {
              const expectedEntity = witness.place < 0 ? 99 : 101 + witness.place;
              const points = witness.points.map(([x, y]) => {
                const screenX = originX + ((x + .5) / 2 - ref.anchor[0]) * scale;
                const screenY = originY + ((y + .5) / 2 + 21 - ref.anchor[1]) * scale;
                const pick = pickSprite(source, screenX, screenY, originX, originY, scale, false, selection);
                return { point: [x, y], actualEntity: pick?.entity ?? null, pass: pick?.entity === expectedEntity };
              });
              return { place: witness.place, expectedEntity, points, pass: points.every(point => point.pass) };
            });
            const picking = picks.every(row => row.pass);
            const pass = maximum <= 6 && p95 <= 2 && picking;
            cases.push({ key: ref.key, kind: ref.kind, sceneKey: ref.sceneKey, facing: ref.facing, palettes: ref.palettes,
              phase, scale, maximum, p95, picking, picks, pass, emptyControl: occupied.length === 0 });
            if (prepared.partialDiagnostic || (!pass && shots.length < 16) || (phase === 0 && scale === 1.5 && ref.sceneKey === 26 && ref.palettes.join('') === '000')) {
              shots.push(picture(actual, `${ref.key}-p${phase}-s${scale}-actual`));
              shots.push(picture(expected, `${ref.key}-p${phase}-s${scale}-reference`));
            }
          }
          if (referenceIndex % 12 === 0) console.log(JSON.stringify({ processedReferences: referenceIndex + 1, totalReferences: prepared.cases.length, gpuCases: cases.length }));
        }
        const validation = await device.popErrorScope();
        return { pass: !validation && !uncaptured.length && cases.length === expectedGpuCases && cases.every(row => row.pass),
          error: validation?.message ?? null, uncaptured, cases, shots, catalogueChecks, aliasChecks, expectedGpuCases,
          pageCount: atlas.ATLAS_PAGE_FILES.length, productionCatalogueActive: true,
          deviceLimits: { maxTextureDimension2D: device.limits.maxTextureDimension2D, maxTextureArrayLayers: device.limits.maxTextureArrayLayers },
          p95Definition: 'RGB components of pixels with any nonzero RGB error, matching reader-runtime-gpu-packed',
          productionTablesAltered: false };
      } finally { for (const resource of resources) resource.destroy(); renderer?.destroy(); device.destroy(); }
    }, prepared);
    for (const shot of result.shots) fs.writeFileSync(path.join(output, shot.key + '.png'), Buffer.from(shot.png.split(',')[1], 'base64'));
    delete result.shots;
    result.pass &&= pageErrors.length === 0;
    if (prepared.partialDiagnostic) { result.diagnosticPass = result.pass; result.pass = false; }
    result.scope = prepared.partialDiagnostic ? 'partial_diagnostic' : 'full_catalogue';
    result.pageErrors = pageErrors;
    result.elapsedSeconds = (Date.now() - started) / 1000;
    result.sourceIndex = indexPath; result.sourceIndexSHA256 = sha(indexPath);
    result.exportManifestSHA256 = prepared.manifestSHA256;
    result.harness = { scriptSHA256: sha(__filename), preparationSHA256: sha(path.join(__dirname, 'sofa-runtime-full-prepare.py')) };
    result.mixedReferenceMeaning = prepared.mixedReferenceMeaning;
    fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ pass: result.pass, scope: result.scope, diagnosticPass: result.diagnosticPass, cases: result.cases.length,
      actualUniformCases: result.cases.filter(row => row.kind === 'actualUniform').length,
      derivedMixedCases: result.cases.filter(row => row.kind === 'derivedOwnerSources').length,
      maximum: Math.max(...result.cases.map(row => row.maximum)), p95: Math.max(...result.cases.map(row => row.p95)),
      picking: result.cases.every(row => row.picking), output }));
    if (!(prepared.partialDiagnostic ? result.diagnosticPass : result.pass)) process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    try { await context?.close(); } finally { await browser?.close(); }
  }
})().catch(error => {
  if (fs.existsSync(output)) fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ pass: false, error: String(error), stack: error.stack }, null, 2) + '\n');
  console.error(error); process.exitCode = 1;
});
