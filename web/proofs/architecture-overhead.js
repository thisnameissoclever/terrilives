import { SpriteRenderer as CandidateRenderer } from '../src/render/sprites.ts';
import { SpriteRenderer as BaselineRenderer } from './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/sprites.ts';
import { buildStaticInstances as historicalGeometry } from './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/tiles.ts';
import { spriteIndex } from './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/atlas.ts';
import { spriteDrawOffsetX, spriteDrawOffsetY } from './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/sprite-anchors.ts';
import baselineManifest from './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/manifest.json';
import { buildStaticInstances } from '../src/render/tiles.ts';
import { loadArchitectureAtlas, closeArchitectureAtlas } from '../src/render/architecture-atlas.ts';
import { architectureSprite } from '../src/render/architecture.ts';
import { ARCHITECTURE } from '../src/render/architecture-data.ts';
import { writeInstance } from './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/instances.ts';
import { layeredDepth, LAYER_PROP } from './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/iso.ts';
import { acquireWithTimeout } from './owned-timeout.ts';
import { benchmarkOrder, distribution, timestampDurations, selectGeometryComponent, opaqueBatchPlan } from './architecture-benchmark-metrics.mjs';
import metricsSource from './architecture-benchmark-metrics.mjs?raw';
import proofSource from './architecture-overhead.js?raw';
import appearanceProfiles from './fixtures/architecture/appearance-profiles.json';
import appearanceSource from './fixtures/architecture/appearance-profiles.json?raw';
import { OFFSET_COLOURWAY_HUE, OFFSET_COLOURWAY_STRENGTH, OFFSET_COLOURWAY_LIGHTNESS } from '../src/render/instances.ts';

const baselineSources = import.meta.glob('./.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/*.{ts,wgsl}', { query: '?raw', import: 'default', eager: true });
const candidateSources = import.meta.glob('../src/render/*.{ts,wgsl}', { query: '?raw', import: 'default', eager: true });
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value))].map(x => x.toString(16).padStart(2, '0')).join('');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const visible = () => assert(document.visibilityState === 'visible', 'Benchmark requires a visible document throughout');
const bounded = (promise, name) => acquireWithTimeout(promise, 15000, () => {}, name);

// The same logical lot is consumed by each revision. The old renderer never sees new IDs.
function makeLot(finalScene, cutaway, appearance) {
  const profile = appearanceProfiles.profiles[appearance];
  assert(profile, `Unknown appearance profile: ${appearance}`);
  const size = finalScene ? 34 : 8, shell = [], windows = [], lines = [], floors = [];
  const catalogue = Array.from({length:9}, (_,i) => ({id:i+1, label:`Window ${i+1}`, width:architectureSprite(i+1,0,'front',false)[0].width}));
  let start = 1;
  if (finalScene) for (const model of catalogue) {
    windows.push({axis:0,x:0,y:start,model:model.id}, {axis:1,x:start,y:0,model:model.id});
    for (let j=0;j<model.width;j++) lines.push(0,0,start+j, 1,start+j,0);
    start += model.width+1;
  }
  const opened = new Set(Array.from({length:lines.length/3},(_,i)=>lines.slice(i*3,i*3+3).join(',')));
  for(let i=0;i<size;i++) for(const edge of [[0,0,i,0],[0,size,i,0],[1,i,0,0],[1,i,size,0]])
    if(!opened.has(edge.slice(0,3).join(','))) shell.push(...edge);
  for(let x=0;x<size;x++) for(let y=0;y<size;y++) floors.push(x,y,1+(x%3));
  return { lot:{width:size,height:size,house:[size,size],walls:new Uint32Array(),edges:Uint32Array.from(shell),windows:Uint32Array.from(lines),floors:Uint32Array.from(floors),coveringLooks:Float32Array.from(profile.coveringLooks),showCutAwayWalls:!cutaway}, architecture:{windows,catalogue}, size };
}

const MAX_FRAMES = 120;

async function timestampDevice(canvas) {
  assert(navigator.gpu, 'WebGPU is unavailable');
  const adapter = await bounded(navigator.gpu.requestAdapter(), 'Timestamp adapter');
  assert(adapter?.features.has('timestamp-query'), 'Adapter does not support timestamp-query; direct GPU timing is unobserved');
  const device = await acquireWithTimeout(adapter.requestDevice({ requiredFeatures: ['timestamp-query'] }),
    15000, value => value.destroy(), 'Timestamp device');
  try {
    const context = canvas.getContext('webgpu');
    assert(context, 'Could not acquire the benchmark WebGPU canvas');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'premultiplied',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    return { device, context, format, adapterInfo: { vendor: adapter.info?.vendor ?? '',
      architecture: adapter.info?.architecture ?? '', device: adapter.info?.device ?? '',
      description: adapter.info?.description ?? '' } };
  } catch (error) { device.destroy(); throw error; }
}

/**
 * Owned visible proof canvas, with no per-frame GPU fence or query readback.
 * Configure once, run one bounded round per call, finish, then dispose in finally.
 */
export async function createArchitectureBenchmark() {
  visible();
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 900; document.body.append(canvas);
  let gpu, atlas, baseline, candidate, readback, querySet, queryResolve, queryReadback;
  let active = null, configured, busy = false, disposed = false, finished = false;
  let timingIndex = -1, timestampPasses = 0, activeArm = null, passDrawIndex = 0;
  const restore = [], errors = [], resources = { baseline: [], candidate: [] };
  const counts = () => ({ drawCalls: 0, submits: 0, bufferUploads: 0, bufferUploadBytes: 0,
    textureUploads: 0, gpuBufferAllocations: 0, gpuTextureAllocations: 0 });
  let observed = counts();
  const cpuScratch = new Float64Array(MAX_FRAMES), cadenceScratch = new Float64Array(MAX_FRAMES);
  const hook = (object, name, wrapped) => {
    const original = object[name]; object[name] = wrapped(original);
    restore.push(() => { object[name] = original; });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; timingIndex = -1;
    if (atlas) closeArchitectureAtlas(atlas);
    for (const fn of restore.reverse()) fn();
    readback?.destroy(); querySet?.destroy(); queryResolve?.destroy(); queryReadback?.destroy();
    candidate?.destroy(); baseline?.destroy?.(); gpu?.device.destroy(); canvas.remove();
  };
  const ready = () => {
    assert(!disposed && !finished && !busy, 'Benchmark must be active and idle'); visible();
  };
  try {
    gpu = await timestampDevice(canvas);
    assert(gpu.device.features.has('timestamp-query'), 'Timestamp feature was not enabled on the device');
    gpu.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
    hook(gpu.device, 'createBuffer', original => function(desc) {
      observed.gpuBufferAllocations++; return original.call(this, desc);
    });
    hook(gpu.device, 'createTexture', original => function(desc) {
      observed.gpuTextureAllocations++;
      if (active) resources[active].push({ format: desc.format, size: desc.size });
      return original.call(this, desc);
    });
    hook(gpu.device.queue, 'writeBuffer', original => function(buffer, offset, data, dataOffset = 0, size) {
      observed.bufferUploads++;
      observed.bufferUploadBytes += (size ?? (data.length ?? data.byteLength) - dataOffset) * (data.BYTES_PER_ELEMENT ?? 1);
      return original.call(this, buffer, offset, data, dataOffset, size);
    });
    for (const name of ['writeTexture', 'copyExternalImageToTexture']) {
      hook(gpu.device.queue, name, original => function(...args) { observed.textureUploads++; return original.apply(this, args); });
    }
    hook(gpu.device.queue, 'submit', original => function(...args) { observed.submits++; return original.apply(this, args); });
    hook(GPURenderPassEncoder.prototype, 'draw', original => function(vertices, instances, firstVertex = 0, firstInstance = 0) {
      const opaque = passDrawIndex++ === 0;
      if (activeArm === 'candidateFinal' && opaque && configured?.batching === 'split-floors') {
        const plan = configured.opaqueBatches;
        assert(vertices === 6 && instances === configured.opaqueTotal && firstVertex === 0 && firstInstance === 0,
          'Split intervention must replace only the complete original opaque draw');
        for (const batch of plan) {
          observed.drawCalls++;
          original.call(this, vertices, batch.instanceCount, firstVertex, batch.firstInstance);
        }
        return;
      }
      observed.drawCalls++; return original.call(this, vertices, instances, firstVertex, firstInstance);
    });

    querySet = gpu.device.createQuerySet({ type: 'timestamp', count: MAX_FRAMES * 2 });
    const queryBytes = MAX_FRAMES * 2 * 8;
    queryResolve = gpu.device.createBuffer({ size: queryBytes, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    queryReadback = gpu.device.createBuffer({ size: queryBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const timestampWrites = Array.from({ length: MAX_FRAMES }, (_, index) => ({ querySet,
      beginningOfPassWriteIndex: index * 2, endOfPassWriteIndex: index * 2 + 1 }));
    hook(GPUCommandEncoder.prototype, 'beginRenderPass', original => function(descriptor) {
      passDrawIndex = 0;
      if (timingIndex >= 0) {
        assert(timestampPasses === 0, 'Expected one render pass per measured draw');
        assert(descriptor.timestampWrites === undefined, 'Renderer already owns timestamp writes');
        descriptor.timestampWrites = timestampWrites[timingIndex]; timestampPasses++;
      }
      return original.call(this, descriptor);
    });

    const sources = { baseline: baselineManifest, candidate: {}, proofSHA256: await hash(proofSource), metricsSHA256: await hash(metricsSource), appearanceFixtureSHA256: await hash(appearanceSource), contentSource: appearanceProfiles.source };
    for (const [path, source] of Object.entries(baselineSources)) {
      assert(await hash(source) === baselineManifest.files[path.split('/').pop()], `Pinned baseline changed: ${path}`);
    }
    for (const [path, source] of Object.entries(candidateSources)) sources.candidate[path.split('/').pop()] = await hash(source);
    gpu.device.pushErrorScope('validation');
    active = 'baseline'; observed = counts();
    baseline = await bounded(BaselineRenderer.create(gpu), 'Baseline renderer'); const baselineSetup = { ...observed };
    atlas = await acquireWithTimeout(loadArchitectureAtlas(gpu.device.limits, { baseUrl: '/' }),
      15000, closeArchitectureAtlas, 'Architecture atlas');
    const atlasBytes = { color: atlas.width * atlas.height * 4, depth: atlas.depth.byteLength,
      carrier: atlas.carrier ? atlas.width * atlas.height * 4 : 0, roles: atlas.roles?.byteLength ?? 0,
      patterns: (atlas.patterns ?? []).map(image => image.width * image.height * 4),
      activePatternCount: atlas.patterns?.length ?? 0, resources: ARCHITECTURE.resources };
    active = 'candidate'; observed = counts();
    candidate = await bounded(CandidateRenderer.create(gpu, atlas), 'Candidate renderer'); const candidateSetup = { ...observed };
    closeArchitectureAtlas(atlas); atlas = null; active = null;
    let bytesPerRow = 0;
    const metadata = { sources, appearanceProfiles, atlasBytes, resources, setup: { baseline: baselineSetup, candidate: candidateSetup },
      userAgent: navigator.userAgent, hardware: gpu.adapterInfo, format: gpu.format,
      limits: { maxTextureDimension2D: gpu.device.limits.maxTextureDimension2D,
        maxSampledTexturesPerShaderStage: gpu.device.limits.maxSampledTexturesPerShaderStage },
      timestampQuery: { supported: true, enabled: true, querySlots: MAX_FRAMES * 2,
        resolveBufferBytes: queryBytes, readbackBufferBytes: queryBytes, unit: 'nanoseconds',
        precision: 'Implementation-dependent quantization. Raw uint64 values, zeros and observed duration divisibility are retained.' },
      timingScope: { cpu: 'Synchronous renderer.draw call, including identical benchmark counter/timestamp descriptor hooks. No await inside the interval.',
        gpu: 'Elapsed time from beginning to end of the actual render pass. Excludes uploads, pre-pass queue waiting, readback and JavaScript promise resumption; may include GPU preemption or scheduling, so it is not pure occupied shader time.',
        cadence: 'Differences between consecutive requestAnimationFrame callback timestamps. Refresh-limited cadence is not a performance acceptance test.',
        protocol: 'One draw per visible animation frame. No per-frame completion fence, query resolve or map. One query resolve/copy/submit/map after each measured arm block.' },
      allocationScope: 'GPU buffer/texture allocations are counted. Query resources and sample buffers are preallocated. JavaScript heap allocation and driver padding are unmeasured.',
      armDefinitions: { baselineHistorical: 'Pinned baseline renderer with pinned historical geometry for the final logical lot.',
        candidateHistorical: 'Current renderer with the exact same historical geometry and dynamic bytes.',
        candidateFinal: 'Current renderer with authored architecture geometry for the same logical lot.' },
      schedule: Array.from({ length: 6 }, (_, round) => benchmarkOrder(round)) };
    const arms = {};
    const activate = name => {
      const arm = arms[name]; active = arm.resource; activeArm = name;
      arm.renderer.setStaticGeometry(arm.geometry.instances, arm.geometry.count, arm.geometry.lowInstances);
      return arm.renderer;
    };
    const capture = async name => {
      const renderer = activate(name);
      renderer.draw(configured.props, 12, configured.scale);
      const encoder = gpu.device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: gpu.context.getCurrentTexture() }, { buffer: readback, bytesPerRow },
        { width: canvas.width, height: canvas.height });
      gpu.device.queue.submit([encoder.finish()]);
      await bounded(readback.mapAsync(GPUMapMode.READ), 'Benchmark pixel readback');
      const mapped = new Uint8Array(readback.getMappedRange()), pixels = new Uint8Array(canvas.width * canvas.height * 4);
      for (let y = 0; y < canvas.height; y++) pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + canvas.width * 4), y * canvas.width * 4);
      readback.unmap();
      let changed = 0;
      for (let i = 4; i < pixels.length; i += 4) {
        if (pixels[i] !== pixels[0] || pixels[i + 1] !== pixels[1] || pixels[i + 2] !== pixels[2]) changed++;
      }
      assert(pixels[3] === 255 && changed > 1000, 'Framebuffer must contain opaque clear and visible geometry');
      active = null;
      return { sha256: await hash(pixels), nonBackgroundPixels: changed, corner: [...pixels.slice(0, 4)] };
    };
    const inputHashes = async geometry => ({ opaque: await hash(geometry.instances), low: await hash(geometry.lowInstances) });
    return { metadata,
      async configure({ scale = 1, cutaway = true, appearance = 'shipped-content', component = 'all', batching = 'combined' } = {}) {
        ready(); assert(['combined', 'split-floors'].includes(batching), 'Unknown opaque batching mode');
        assert(batching !== 'split-floors' || component === 'all', 'Split-floor intervention requires the complete scene');
        assert([1, 1.75].includes(scale), 'Use scale 1 or 1.75 for the final stress lot'); busy = true;
        try {
          const data = makeLot(true, cutaway, appearance);
          canvas.width = Math.ceil((data.size * 64 + 160) * scale); canvas.height = Math.ceil((data.size * 42 + 220) * scale);
          assert(canvas.width <= gpu.device.limits.maxTextureDimension2D && canvas.height <= gpu.device.limits.maxTextureDimension2D,
            'Scene exceeds device canvas limit');
          readback?.destroy(); bytesPerRow = Math.ceil(canvas.width * 4 / 256) * 256;
          readback = gpu.device.createBuffer({ size: bytesPerRow * canvas.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
          const ox = canvas.width / 2 + .37, oy = 120 * scale + .19;
          const old = historicalGeometry(data.lot, ox, oy, data.size, scale);
          const previous = { instances: old.instances.slice(0, old.count * 16), count: old.count, floorCount: old.floorCount, lowInstances: old.lowInstances.slice() };
          const current = buildStaticInstances({ ...data.lot, architecture: data.architecture }, ox, oy, data.size, scale);
          const next = { instances: current.instances.slice(0, current.count * 16), count: current.count, floorCount: current.floorCount, lowInstances: current.lowInstances.slice() };
          let shiftedFloorRows = 0;
          for (let index = 0; index < current.floorCount; index++) {
            const offset = index * 16;
            if (next.instances[offset + OFFSET_COLOURWAY_HUE] !== 0
              || next.instances[offset + OFFSET_COLOURWAY_STRENGTH] !== 0
              || next.instances[offset + OFFSET_COLOURWAY_LIGHTNESS] !== 0) shiftedFloorRows++;
          }
          assert(current.floorCount === data.size * data.size, 'Inspect every authored interior floor row');
          if (appearance === 'shipped-content') assert(shiftedFloorRows === 0, 'Shipped covering looks must encode exact identity colourway shifts');
          else assert(shiftedFloorRows === current.floorCount, 'Altered zero-look profile must exercise the changed appearance');
          const appearanceEvidence = { profile: appearance, source: appearanceProfiles.source,
            fixtureSHA256: sources.appearanceFixtureSHA256, coveringLooks: [...data.lot.coveringLooks],
            coveringLooksSHA256: await hash(data.lot.coveringLooks), checkedFloorRows: current.floorCount,
            shiftedFloorRows, encodedColourwayIdentity: shiftedFloorRows === 0 };

          const props = new Float32Array(12 * 16);
          for (let i = 0; i < 12; i++) {
            const x = 1 + i % 4, y = 1 + Math.floor(i / 4), id = spriteIndex(i % 3 === 0 ? 'offlineDeskSW' : i % 3 === 1 ? 'offlineBunk' : 'sim');
            writeInstance(props, i, ox + ((x - y) * 32 + spriteDrawOffsetX(id)) * scale,
              oy + ((x + y) * 21 + spriteDrawOffsetY(id)) * scale, layeredDepth(x, y, data.size, LAYER_PROP), id);
          }
          const rowCount = geometry => ({ static: geometry.count, floorPrefix: geometry.floorCount,
            low: geometry.lowInstances.length / 16, dynamic: 12 });
          const geometrySelection = { component,
            rule: 'Use each producer floorCount prefix. Floors removes low walls; walls retains them. All arms retain the same twelve dynamic rows.',
            originalCounts: { historical: rowCount(previous), authored: rowCount(next) },
            originalHashes: { historical: await inputHashes(previous), authored: await inputHashes(next) } };
          const selectedPrevious = selectGeometryComponent(previous, component), selectedNext = selectGeometryComponent(next, component);
          candidate.setArchitectureCamera(ox, oy);
          arms.baselineHistorical = { renderer: baseline, resource: 'baseline', geometry: selectedPrevious };
          arms.candidateHistorical = { renderer: candidate, resource: 'candidate', geometry: selectedPrevious };
          arms.candidateFinal = { renderer: candidate, resource: 'candidate', geometry: selectedNext };
          configured = { scene: 'final-stress-34x34', scale, cutaway, props, appearance: appearanceEvidence, geometrySelection,
            batching, opaqueTotal: selectedNext.count + 12,
            opaqueBatches: component === 'all' ? opaqueBatchPlan(selectedNext.count + 12, selectedNext.floorCount) : null };
          const pixels = {}, inputs = {}, rowCounts = {};
          for (const name of benchmarkOrder(0)) {
            pixels[name] = await capture(name); inputs[name] = await inputHashes(arms[name].geometry);
            rowCounts[name] = rowCount(arms[name].geometry);
          }
          assert(pixels.baselineHistorical.sha256 === pixels.candidateHistorical.sha256, 'Identical historical input pixels differ');
          assert(inputs.baselineHistorical.opaque === inputs.candidateHistorical.opaque && inputs.baselineHistorical.low === inputs.candidateHistorical.low,
            'Historical arms must share identical geometry bytes');
          let batchingEvidence = { mode: batching, interventionArm: 'candidateFinal', pixelEqualityChecked: false };
          if (component === 'all') {
            const modePixels = {}, modeDrawCalls = {};
            for (const mode of ['combined', 'split-floors']) {
              configured.batching = mode; observed = counts();
              modePixels[mode] = await capture('candidateFinal'); modeDrawCalls[mode] = observed.drawCalls;
            }
            configured.batching = batching;
            const after = await inputHashes(selectedNext);
            assert(after.opaque === inputs.candidateFinal.opaque && after.low === inputs.candidateFinal.low,
              'Batch intervention changed authored geometry bytes');
            assert(modePixels.combined.sha256 === modePixels['split-floors'].sha256,
              'Combined and split-floor batching must have exactly identical framebuffer pixels');
            assert(modeDrawCalls.combined === 2 && modeDrawCalls['split-floors'] === 3,
              'Complete-scene batching control requires exactly two combined or three split draw calls');
            batchingEvidence = { ...batchingEvidence, pixelEqualityChecked: true, pixels: modePixels,
              drawCalls: modeDrawCalls, unchangedInputs: true, inputHashes: after,
              opaqueTotal: configured.opaqueTotal, floorPrefix: selectedNext.floorCount,
              splitOpaqueDraws: configured.opaqueBatches,
              unchanged: 'Pipeline, bindings, render pass, submission, row bytes and order, low-wall draw, and both historical arms.' };
          }
          configured.batchingEvidence = batchingEvidence;
          geometrySelection.selectedCounts = rowCounts; geometrySelection.selectedHashes = inputs;
          configured.inputs = inputs; configured.propsHash = await hash(props);
          return { scene: configured.scene, scale, cutaway, appearance: appearanceEvidence, geometrySelection, batching: batchingEvidence, canvas: { width: canvas.width, height: canvas.height },
            depthAttachmentBytesLowerBound: canvas.width * canvas.height * 3, windows: data.architecture.windows.length,
            interiorFloorTiles: data.size * data.size, pixels, historicalPixelsEqual: true, inputHashes: inputs,
            dynamicSHA256: configured.propsHash, rowCounts };
        } finally { busy = false; active = null; }
      },
      async runRound({ round = 0, warmup = 60, frames = 120 } = {}) {
        ready(); assert(configured, 'Configure the final scene before measuring');
        assert(Number.isInteger(frames) && frames >= 30 && frames <= MAX_FRAMES
          && Number.isInteger(warmup) && warmup >= 1 && warmup <= MAX_FRAMES, 'Use 30-120 samples and 1-120 warmup frames');
        const order = benchmarkOrder(round), result = { round, order, frames, warmup, appearance: configured.appearance, geometrySelection: configured.geometrySelection, batching: configured.batchingEvidence, arms: {} }; busy = true;
        try {
          for (const name of order) {
            const renderer = activate(name);
            let previousRaf, cadenceCount = 0;
            for (let i = 0; i < warmup + frames; i++) {
              const raf = await bounded(new Promise(resolve => requestAnimationFrame(resolve)), 'Visible animation frame');
              assert(!disposed, 'Benchmark was disposed'); visible();
              const measured = i >= warmup, index = i - warmup;
              if (i === warmup) observed = counts();
              timestampPasses = 0; timingIndex = measured ? index : -1;
              if (measured) {
                const start = performance.now(); renderer.draw(configured.props, 12, configured.scale);
                cpuScratch[index] = performance.now() - start;
                assert(timestampPasses === 1, 'Each measured frame must write one timestamp pair');
                cadenceScratch[cadenceCount++] = raf - previousRaf;
              } else renderer.draw(configured.props, 12, configured.scale);
              timingIndex = -1; previousRaf = raf;
            }
            const frameCounters = { ...observed };
            const expectedDraws = 1 + (arms[name].geometry.lowInstances.length ? 1 : 0)
              + (name === 'candidateFinal' && configured.batching === 'split-floors' ? 1 : 0);
            assert(frameCounters.drawCalls === expectedDraws * frames && frameCounters.submits === frames,
              'Measured batching must preserve one submission and the expected draw count per frame');
            const encoder = gpu.device.createCommandEncoder(), usedBytes = frames * 2 * 8;
            encoder.resolveQuerySet(querySet, 0, frames * 2, queryResolve, 0);
            encoder.copyBufferToBuffer(queryResolve, 0, queryReadback, 0, usedBytes);
            gpu.device.queue.submit([encoder.finish()]);
            await acquireWithTimeout(queryReadback.mapAsync(GPUMapMode.READ, 0, usedBytes), 15000,
              () => queryReadback.unmap(), 'Block timestamp readback');
            const timestamps = new BigUint64Array(queryReadback.getMappedRange(0, usedBytes)).slice();
            queryReadback.unmap();
            const currentInputs = await inputHashes(arms[name].geometry);
            assert(currentInputs.opaque === configured.inputs[name].opaque && currentInputs.low === configured.inputs[name].low
              && await hash(configured.props) === configured.propsHash, 'Frame sampling changed geometry or dynamic inputs');
            result.arms[name] = { cpu: { ...distribution(cpuScratch.subarray(0, frames)), unit: 'milliseconds' },
              gpu: timestampDurations(timestamps), cadence: { ...distribution(cadenceScratch.subarray(0, cadenceCount)), unit: 'milliseconds' },
              frameCounters, readback: { resolves: 1, copies: 1, submits: 1, maps: 1, bytes: usedBytes }, unchangedInputs: true };
          }
          assert(errors.length === 0, errors.join('; ')); return result;
        } finally { timingIndex = -1; busy = false; active = null; }
      },
      async finish() {
        ready(); finished = true;
        const error = await bounded(gpu.device.popErrorScope(), 'Benchmark validation');
        return { resources, validationError: error?.message ?? null, uncapturedErrors: errors,
          pass: !error && errors.length === 0, acceptance: 'Validation only; CPU/GPU timing and quantization require separate review.' };
      },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
