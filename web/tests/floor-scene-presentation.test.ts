import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FloorFinishResources } from '../src/render/floor-finish-resources.js';
import { FloorScenePresentation } from '../src/render/floor-scene-presentation.js';
import { OverlayPauseController } from '../src/ui/overlay-pause.js';
import { buildStaticInstances } from '../src/render/tiles.js';
import { ARCHITECTURE } from '../src/render/architecture-data.js';
import { activeFloorFinishKeys } from '../src/render/floor-materials.js';
import { prepareArchitectureFinishes } from '../src/render/architecture-finishes.js';
import { sceneFramebufferSize } from '../src/render/scene-sampling.js';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function section(start: string, end: string): string {
  const first = main.indexOf(start), last = main.indexOf(end, first);
  if (first < 0 || last < 0) throw new Error('Missing main integration boundary');
  return main.slice(first, last);
}
// Execute the production wiring, including its gate and complete camera method.
const cameraCode = section('  function applyCamera(): void {', '  // Flagged rather than applied:')
  .replace('(): void', '()');
const drawCode = section('    if (presenting&&floorScene.visible', '    // Inside the sample below');
const publishCode = section('    publish: next => {', '    dispose: next =>').replace('    publish: next => {', '').replace(/\},\s*$/, '');
const stateCode = section('    state: (ready, error) => {', '  }, residentFinishKeys);').replace('    state: (ready, error) => {', '').replace(/\},\s*$/, '');
const failureHookCode = section('    dispose: next =>', '    state: (ready, error) => {');
const applyMainCamera = new Function('ctx', `with(ctx) { ${cameraCode}; applyCamera(); }`);
const drawMainFrame = new Function('ctx', `with(ctx) { ${drawCode} }`);
const publishMainRenderer = new Function('ctx', 'next', `with(ctx) { ${publishCode} }`);
const stateMainRenderer = new Function('ctx', 'ready', 'error', `with(ctx) { ${stateCode} }`);
const failureMainRenderer = new Function('ctx', 'error', 'context', `with(ctx) { return ({ ${failureHookCode} }).failure?.(error, context); }`);
const recoveryCode = section('        const finishKeys = activeFloorFinishKeys', '\n      catch(error){void replacement.then')
  .replace('let rebuilt: SpriteRenderer;', 'let rebuilt;').replace(/\}\s*$/, '');
const recoverMainRenderer = new Function('ctx', `return (async () => { with(ctx) { ${recoveryCode} } })();`);

const catalogue = { ...ARCHITECTURE.catalogue,
  palettes: { ...ARCHITECTURE.catalogue.palettes, blue: { multiply: [.2, .5, 1] } },
  finishes: { ...ARCHITECTURE.catalogue.finishes, fixture: { patternKey: 'floor.tiles', paletteKey: 'blue', authoredContentLook: [0, 1, 0] } },
  coverings: { ...ARCHITECTURE.catalogue.coverings, 4: 'fixture' } };
const limits = { maxSampledTexturesPerShaderStage: 16, maxTextureDimension2D: 8192,
  maxTextureArrayLayers: 256, maxStorageBufferBindingSize: 1e8 };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function fixture() {
  let floors = new Uint32Array([0, 0, 1]);
  const speeds: number[] = [], statuses: [boolean, string | null][] = [], draws: number[][] = [];
  const diagnostics: unknown[][] = [];
  const startup: { name: string; detail: unknown; error?: unknown }[] = [], events: string[] = [], eventDetails: unknown[] = [];
  // Each submitted-work promise stays pending until a test settles it.
  const gpuWork: { resolve(): void; reject(error: Error): void }[] = [];
  const overlayPause = new OverlayPauseController({ setSpeed: speed => speeds.push(speed) }, () => {}, 2);
  const renderer = () => ({ disposed: false, rows: new Float32Array(),
    setArchitectureCamera() {},
    publishFloorFinishes(_next: unknown, rebuild: () => void) { rebuild(); },
    discardFloorFinishes(next: { disposed: boolean }) { next.disposed = true; },
    setGrimeInstances() {},grimeSpriteBase:0,fixtureDepthBase:0,
    setStaticGeometry(rows: Float32Array, count: number) { this.rows = rows.slice(0, count * 16); },
    draw(instances: Float32Array, _count: number, scale: number) {
      // Static and dynamic positions must belong to the same camera and loaded world.
      draws.push([this.rows[0], this.rows[1], instances[0], instances[1], scale, this.rows[3]]);
    }, destroy() { this.disposed = true; } });
  const ctx = {
    sceneFramebufferSize,gpu:{device:{limits,queue:{onSubmittedWorkDone:()=>new Promise<void>((resolve,reject)=>gpuWork.push({resolve,reject}))}}},
    // The first drawn frame reports startup once; see the first-scene report in main.ts.
    firstSceneRecorded:false,
    recordDiagnostic:(name:string,detail:unknown,error?:unknown)=>startup.push(error===undefined?{name,detail}:{name,detail,error}),
    console: { warn: (...details: unknown[]) => diagnostics.push(details) },
    lotWidth: 2, lotHeight: 1,
    lot: { width: 2, height: 1, houseOrigin: [0, 0] as const, walls: new Uint32Array(), edges: new Uint32Array(), floors,
      coveringLooks: Float32Array.from([18, 1.15, -.12, -25, .55, .1, -20, 1.6, -.18, 0, 1, 0]),
      architecture: { windows: [], catalogue: [], floorCatalogue: catalogue,
        finishes: prepareArchitectureFinishes([], limits, catalogue) } },
    floorResourceError: null as string | null,
    graphicsClosed:false, graphicsRecovering:false, presenting: true,
    characterWorld:{beginFrame(){},plan:null,draw(){}},
    weatherScene: { setOutside() {}, prepare() {} }, weatherTuning: null, drawWorldEffects() {},
    camera: { originX: 100, originY: 200, scale: 1 }, cameraDirty: true, cameraInitialised: true,
    stage: { width: 500, height: 400, clientWidth: 500, clientHeight: 400,
      getBoundingClientRect() { return {left:0,top:0,width:this.clientWidth,height:this.clientHeight}; } }, window: { devicePixelRatio: 1, dispatchEvent: (event: Event) => { events.push(event.type); eventDetails.push((event as CustomEvent).detail); } },
    nowMs:0, orderDiagnostics:{failedActors:()=>new Set<number>()}, failureBubbles:{update(){}},
    lightingDirty: false, lighting: null, sky: { width: 0, height: 0, values: new Float32Array() },
    buildStaticInstances, buildGrimeInstances:()=>({instances:new Float32Array(),count:0}), depthScale: 16, clampCamera() {},
    lightingMode: { isFlat: () => true }, renderer: renderer(),
    wallFade: { configure() {}, update() {} },
    // Feedback ownership is covered by main-scene-feedback; this host exercises scene rendering.
    renderBuildFeedback() {},
    placementButtons: { frame() {} }, builder: { active: false, preview: null, colourway: 0 },
    sim: { selectedIndex: () => 0, clockTick: () => 0, dayTicks: () => 1440, seasonIndex: () => 0,
      roomTiles: () => ({ ok: true, value: [] }), floorTiles: () => floors, worldSurfaces: () => new Uint8Array(2), floorGrime:()=>new Uint32Array() },
    alpha: 0, deltaMs: 0, reducedMotion: { matches: false }, AMBIENT_NEUTRAL: [1, 1, 1],
    buyTool: { ghost: () => null }, wallTool: { highlight: () => null }, roomTool: { highlight: () => null },
    roomReview: { highlight: () => null }, roomsTool: { selecting: false }, roomSelection: { highlight: () => null },
    landTool: { highlight: () => null },
    floorTool: { highlight: () => null, resourceStatus: null as string | null, resourceFailed: false,
      setResourceStatus(value: string | null, failed = false) { this.resourceStatus = value; this.resourceFailed = failed; } },
    buildInstanceBatch: (_sim: unknown, _alpha: number, x: number, y: number) => ({ instances: Float32Array.from([x, y]), count: 1 }),
    applyCamera: () => applyMainCamera(ctx),
    floorScene: new FloorScenePresentation({ suspend: () => overlayPause.suspend('floor-materials'),
      resume: () => overlayPause.resume('floor-materials'), status: (blocked, error) => statuses.push([blocked, error]) }),
    syncFloorScene: () => ctx.floorScene.update(activeFloorFinishKeys(floors, null, catalogue), ctx.lot.architecture.finishes.keys, ctx.floorResourceError),
  };
  const pending: { keys: readonly string[]; resolve(value: { renderer: ReturnType<typeof renderer>; prepared: { finishes: ReturnType<typeof prepareArchitectureFinishes>; device: typeof ctx.gpu.device; disposed: boolean } }): void;
    reject(error: unknown): void }[] = [];
  const resources = new FloorFinishResources({
    prepare: (keys: readonly string[]) => new Promise<{ renderer: ReturnType<typeof renderer>; prepared: { finishes: ReturnType<typeof prepareArchitectureFinishes>; device: typeof ctx.gpu.device; disposed: boolean } }>((resolve, reject) => pending.push({ keys, resolve, reject })),
    publish: next => publishMainRenderer(ctx, next), dispose: next => next.renderer.discardFloorFinishes(next.prepared),
    failure: (error: unknown, context: { operation: 'prepare' | 'publish'; finishKeys: readonly string[] }) => failureMainRenderer(ctx, error, context),
    state: (ready, error) => stateMainRenderer(ctx, ready, error),
  });
  const request = (selected: number | null = null) => { resources.request(activeFloorFinishKeys(floors, selected, catalogue)); ctx.syncFloorScene(); };
  request();
  const load = (covering: number) => { floors = new Uint32Array([0, 0, covering]); ctx.lot.floors = floors; ctx.cameraDirty = true; request(); };
  const settle = (index: number) => { const next = { renderer: ctx.renderer, prepared: { finishes: prepareArchitectureFinishes(pending[index].keys, limits, catalogue), device: ctx.gpu.device, disposed: false } }; pending[index].resolve(next); return next; };
  return { ctx, overlayPause, speeds, statuses, draws, diagnostics, startup, events, eventDetails, gpuWork, pending, resources, request, load, settle,
    frame: () => drawMainFrame(ctx) };
}

describe('main floor scene presentation', () => {
  it.each(['prepare', 'publish'] as const)('reports the original current %s failure once and retains Retry publication', async operation => {
    const f = fixture(), cause = new Error('original download cause');
    const error = new Error('floor resource unavailable', { cause });
    error.name = 'AbortError';
    const originalStack = error.stack, originalFinishes = f.ctx.lot.architecture.finishes;
    const publish = f.ctx.renderer.publishFloorFinishes;
    f.request(4);
    let rejectedCandidate: ReturnType<typeof f.settle> | undefined;
    if (operation === 'prepare') f.pending[0].reject(error);
    else {
      f.ctx.renderer.publishFloorFinishes = () => { throw error; };
      rejectedCandidate = f.settle(0);
    }
    await flush();
    expect(f.diagnostics).toHaveLength(1);
    expect(f.diagnostics[0]).toEqual(['Floor material resource failed',
      { operation, finishKeys: f.pending[0].keys }, error]);
    const reported = f.diagnostics[0][2] as Error;
    expect(reported).toBe(error); expect(reported.name).toBe('AbortError');
    expect(reported.stack).toBe(originalStack); expect(reported.cause).toBe(cause);
    expect(f.ctx.floorResourceError).toBe(error.message);
    expect(f.ctx.floorTool.resourceStatus).toBe('Floor materials could not load. Try again.');
    expect(f.ctx.lot.architecture.finishes).toBe(originalFinishes);
    if (rejectedCandidate) expect(rejectedCandidate.prepared.disposed).toBe(true);
    f.request(4); expect(f.pending).toHaveLength(1); expect(f.diagnostics).toHaveLength(1);
    f.ctx.renderer.publishFloorFinishes = publish;
    f.resources.retry(); expect(f.pending).toHaveLength(2);
    const replacement = f.settle(1); await flush();
    expect(f.ctx.lot.architecture.finishes).toBe(replacement.prepared.finishes);
    expect(f.ctx.floorResourceError).toBeNull(); expect(f.ctx.floorTool.resourceStatus).toBeNull();
    expect(f.diagnostics).toHaveLength(1);
  });

  it.each(['superseded', 'paused', 'destroyed'] as const)('keeps %s preparation failures quiet', async obsolete => {
    const f = fixture(); f.request(4);
    if (obsolete === 'superseded') f.resources.request([]);
    else if (obsolete === 'paused') f.resources.pause();
    else f.resources.destroy();
    f.pending[0].reject(new Error('obsolete failure')); await flush();
    expect(f.diagnostics).toEqual([]); expect(f.ctx.floorResourceError).toBeNull();
    expect(f.pending).toHaveLength(1);
  });

  it('reports an unknown thrown value without constructing a replacement Error', async () => {
    const f = fixture(), error = { detail: 'untyped resource failure' };
    f.request(4); f.pending[0].reject(error); await flush();
    expect(f.diagnostics).toHaveLength(1); expect(f.diagnostics[0][2]).toBe(error);
    expect(f.diagnostics[0][2]).not.toBeInstanceOf(Error);
    expect(f.ctx.floorResourceError).toBe('[object Object]');
    expect(f.ctx.floorTool.resourceStatus).toBe('Floor materials could not load. Try again.');
  });
  it('explicitly loads a new-device base renderer and resumes from its prepared finishes', async () => {
    const f = fixture(), old = f.ctx.renderer, newDevice = { limits }, rebuilt = { ...old, rows: new Float32Array() };
    const calls: string[] = [], atlas = { finishes: prepareArchitectureFinishes([], limits) };
    const world = { prepareFixtures() { calls.push('characters-ready'); } };
    const ctx = { ...f.ctx, gpu: { device: newDevice }, activeFloorFinishKeys: () => [],
      loadArchitectureAtlas: async (seen: unknown) => { expect(seen).toBe(newDevice.limits); calls.push('base-load'); return atlas; },
      SpriteRenderer: { create: async (gpu: { device: unknown }, loaded: unknown) => {
        expect(gpu.device).toBe(newDevice); expect(loaded).toBe(atlas); calls.push('renderer-create'); return rebuilt;
      } }, closeArchitectureAtlas: (loaded: unknown) => { expect(loaded).toBe(atlas); calls.push('atlas-close'); },
      floorResources: { resume: (keys: string[]) => { expect(keys).toEqual([]); calls.push('resume'); } },
      applyCamera: () => { calls.push('camera'); }, replacement: Promise.resolve(world), characterWorld: null as unknown };
    await recoverMainRenderer(ctx);
    expect(ctx.renderer).toBe(rebuilt); expect(ctx.renderer).not.toBe(old); expect(ctx.characterWorld).toBe(world);
    expect(calls).toEqual(['base-load', 'renderer-create', 'atlas-close', 'camera', 'resume', 'characters-ready']);
  });

  it('rejects a stale old-device candidate before changing live finishes or geometry', () => {
    const f = fixture(), current = f.ctx.renderer, finishes = f.ctx.lot.architecture.finishes;
    expect(() => publishMainRenderer(f.ctx, { renderer: current, prepared: { device: {}, finishes } })).toThrow(/old graphics device/);
    expect(f.ctx.renderer).toBe(current); expect(f.ctx.lot.architecture.finishes).toBe(finishes);
  });

  const firstScene = (state: string) => ({ name: 'graphics.first-frame', detail: { id: 'first-scene', state } });
  it('reports the first drawn scene once and announces startup only after the GPU finishes it', async () => {
    const f = fixture(); f.ctx.presenting = false; f.frame();
    expect(f.startup).toEqual([]);
    f.ctx.presenting = true; f.frame(); f.frame();
    await flush();
    expect(f.gpuWork).toHaveLength(1);
    expect(f.startup).toEqual([firstScene('start')]);
    expect(f.events).toEqual([]);
    f.gpuWork[0].resolve(); await flush();
    expect(f.startup).toEqual([firstScene('start'), firstScene('complete')]);
    expect(f.events).toEqual(['terrilives:startup-ready']);
  });
  it('reports a failed first scene and announces a startup failure instead of readiness', async () => {
    const f = fixture(); f.frame();
    const error = new Error('device lost');
    f.gpuWork[0].reject(error); await flush();
    expect(f.startup).toEqual([firstScene('start'), { ...firstScene('failed'), error }]);
    expect(f.events).toEqual(['terrilives:startup-failure']);
    // The same error object reaches the report and the failure event's listeners.
    expect(f.startup[1].error).toBe(error);
    expect(f.eventDetails).toEqual([error]); expect(f.eventDetails[0]).toBe(error);
  });
  it('retains the current scene while graphics are recovering and resumes coherent drawing',()=>{
    const f=fixture();f.frame();expect(f.draws).toHaveLength(1);
    f.ctx.graphicsRecovering=true;f.frame();expect(f.draws).toHaveLength(1);
    f.ctx.graphicsRecovering=false;f.frame();expect(f.draws).toHaveLength(2);
    expect(f.draws[1]).toEqual(f.draws[0]);
  });
  it('draws nothing for a hidden tab step and resumes drawing when presenting again',()=>{
    const f=fixture();f.ctx.presenting=false;f.frame();expect(f.draws).toHaveLength(0);
    f.ctx.presenting=true;f.frame();expect(f.draws).toHaveLength(1);
  });
  it('keeps camera/static/dynamic rendering coherent during a delayed or rejected preview load', async () => {
    const f = fixture();
    f.frame();
    f.request(4);
    f.ctx.camera.originX += 27; f.ctx.camera.scale = 1.75;
    f.ctx.stage.clientWidth = 390; f.ctx.stage.clientHeight = 844; f.ctx.cameraDirty = true;
    f.frame();
    expect(f.draws.at(-1)?.slice(0, 4)).toEqual([72, 422, 72, 422]);
    expect(f.draws.at(-1)?.[4]).toBe(1.75);
    expect(f.overlayPause.suspended).toBe(false);
    const error = new Error('pattern unavailable');
    f.pending[0].reject(error); await flush();
    f.ctx.camera.originY += 12; f.ctx.cameraDirty = true; f.frame();
    expect(f.draws.at(-1)?.slice(0, 4)).toEqual([72, 434, 72, 434]);
    expect(f.statuses).toEqual([]);
    expect(f.ctx.floorResourceError).toBe('pattern unavailable');
    expect(f.ctx.floorTool.resourceStatus).toBe('Floor materials could not load. Try again.');
    expect(f.ctx.floorTool.resourceFailed).toBe(true);
    expect(f.diagnostics.at(-1)).toEqual(['Floor material resource failed',
      { operation: 'prepare', finishKeys: f.pending[0].keys }, error]);
  });

  it('hides the complete loaded scene on missing resources, reports failure and rebuilds current camera on Retry', async () => {
    const f = fixture(); f.frame();
    f.overlayPause.suspend('help');
    f.load(4);
    f.ctx.camera.originX = 180; f.ctx.camera.scale = .75;
    f.ctx.stage.clientWidth = 390; f.ctx.stage.clientHeight = 844; f.ctx.cameraDirty = true;
    f.frame(); expect(f.draws).toHaveLength(1);
    expect(f.statuses.at(-1)).toEqual([true, null]);
    f.pending[0].reject(new Error('offline')); await flush();
    f.frame(); expect(f.draws).toHaveLength(1);
    expect(f.statuses.at(-1)).toEqual([true, 'offline']);
    expect(f.overlayPause.suspendedExcept('help')).toBe(true);
    f.resources.retry(); expect(f.pending).toHaveLength(2);
    expect(f.statuses.at(-1)).toEqual([true, null]);
    f.settle(1); await flush(); f.frame();
    expect(f.draws).toHaveLength(2);
    expect(f.draws.at(-1)?.slice(0, 4)).toEqual([125, 422, 125, 422]);
    expect(f.draws.at(-1)?.[4]).toBe(.75);
    expect(f.statuses.at(-1)).toEqual([false, null]);
    expect(f.overlayPause.suspended).toBe(true);
    expect(f.overlayPause.suspendedExcept('help')).toBe(false);
    expect(Array.from(f.ctx.sim.floorTiles())).toEqual([0, 0, 4]);
  });

  it('rejects obsolete finish completion after a second Load and preserves that newer scene', async () => {
    const f = fixture(); f.frame(); f.load(4);
    f.load(2); f.frame();
    expect(f.statuses.at(-1)).toEqual([false, null]);
    const latestSprite = f.draws.at(-1)?.[5];
    const obsolete = f.settle(0); await flush(); f.frame();
    expect(obsolete.prepared.disposed).toBe(true); expect(obsolete.renderer.disposed).toBe(false);
    expect(f.draws.at(-1)?.[5]).toBe(latestSprite);
    expect(Array.from(f.ctx.sim.floorTiles())).toEqual([0, 0, 2]);
  });
});
