import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FloorFinishResources } from '../src/render/floor-finish-resources.js';
import { FloorScenePresentation } from '../src/render/floor-scene-presentation.js';
import { OverlayPauseController } from '../src/ui/overlay-pause.js';
import { buildStaticInstances } from '../src/render/tiles.js';
import { ARCHITECTURE } from '../src/render/architecture-data.js';
import { activeFloorFinishKeys } from '../src/render/floor-materials.js';
import { prepareArchitectureFinishes } from '../src/render/architecture-finishes.js';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function section(start: string, end: string): string {
  const first = main.indexOf(start), last = main.indexOf(end, first);
  if (first < 0 || last < 0) throw new Error('Missing main integration boundary');
  return main.slice(first, last);
}
// Execute the production wiring, including its gate and complete camera method.
const cameraCode = section('  function applyCamera(): void {', '  // Flagged rather than applied:')
  .replace('(): void', '()');
const drawCode = section('    if (floorScene.visible) {', '    // Inside the sample below');
const publishCode = section('    publish: next => {', '    dispose: next =>').replace('    publish: next => {', '').replace(/\},\s*$/, '');
const stateCode = section('    state: (ready, error) => {', '  });\n  syncFloorResources =').replace('    state: (ready, error) => {', '').replace(/\},\s*$/, '');
const applyMainCamera = new Function('ctx', `with(ctx) { ${cameraCode}; applyCamera(); }`);
const drawMainFrame = new Function('ctx', `with(ctx) { ${drawCode} }`);
const publishMainRenderer = new Function('ctx', 'next', `with(ctx) { ${publishCode} }`);
const stateMainRenderer = new Function('ctx', 'ready', 'error', `with(ctx) { ${stateCode} }`);

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
  const overlayPause = new OverlayPauseController({ setSpeed: speed => speeds.push(speed) }, () => {}, 2);
  const renderer = () => ({ disposed: false, rows: new Float32Array(),
    setArchitectureCamera() {},
    setGrimeInstances() {},grimeSpriteBase:0,
    setStaticGeometry(rows: Float32Array, count: number) { this.rows = rows.slice(0, count * 16); },
    draw(instances: Float32Array, _count: number, scale: number) {
      // Static and dynamic positions must belong to the same camera and loaded world.
      draws.push([this.rows[0], this.rows[1], instances[0], instances[1], scale, this.rows[3]]);
    }, destroy() { this.disposed = true; } });
  const ctx = {
    console: { warn: (...details: unknown[]) => diagnostics.push(details) },
    lot: { width: 2, height: 1, walls: new Uint32Array(), edges: new Uint32Array(), floors,
      coveringLooks: Float32Array.from([18, 1.15, -.12, -25, .55, .1, -20, 1.6, -.18, 0, 1, 0]),
      architecture: { windows: [], catalogue: [], floorCatalogue: catalogue,
        finishes: prepareArchitectureFinishes([], limits, catalogue) } },
    floorResourceError: null as string | null,
    camera: { originX: 100, originY: 200, scale: 1 }, cameraDirty: true, cameraInitialised: true,
    stage: { width: 500, height: 400, clientWidth: 500, clientHeight: 400 }, window: { devicePixelRatio: 1 },
    lightingDirty: false, lighting: null, sky: { width: 0, height: 0, values: new Float32Array() },
    buildStaticInstances, buildGrimeInstances:()=>({instances:new Float32Array(),count:0}), depthScale: 16, clampCamera() {},
    lightingMode: { isFlat: () => true }, renderer: renderer(),
    wallFade: { configure() {}, update() {} },
    placementButtons: { frame() {} }, builder: { active: false, preview: null, colourway: 0 },
    sim: { selectedIndex: () => 0, clockTick: () => 0, floorTiles: () => floors, floorGrime:()=>new Uint32Array() },
    alpha: 0, deltaMs: 0, reducedMotion: { matches: false }, AMBIENT_NEUTRAL: [1, 1, 1],
    buyTool: { ghost: () => null }, wallTool: { highlight: () => null }, roomTool: { highlight: () => null },
    floorTool: { highlight: () => null, resourceStatus: null as string | null, resourceFailed: false,
      setResourceStatus(value: string | null, failed = false) { this.resourceStatus = value; this.resourceFailed = failed; } },
    buildInstanceBatch: (_sim: unknown, _alpha: number, x: number, y: number) => ({ instances: Float32Array.from([x, y]), count: 1 }),
    applyCamera: () => applyMainCamera(ctx),
    floorScene: new FloorScenePresentation({ suspend: () => overlayPause.suspend('floor-materials'),
      resume: () => overlayPause.resume('floor-materials'), status: (blocked, error) => statuses.push([blocked, error]) }),
    syncFloorScene: () => ctx.floorScene.update(activeFloorFinishKeys(floors, null, catalogue), ctx.lot.architecture.finishes.keys, ctx.floorResourceError),
  };
  const pending: { keys: readonly string[]; resolve(value: { renderer: ReturnType<typeof renderer>; finishes: ReturnType<typeof prepareArchitectureFinishes> }): void;
    reject(error: Error): void }[] = [];
  const resources = new FloorFinishResources({
    prepare: (keys: readonly string[]) => new Promise<{ renderer: ReturnType<typeof renderer>; finishes: ReturnType<typeof prepareArchitectureFinishes> }>((resolve, reject) => pending.push({ keys, resolve, reject })),
    publish: next => publishMainRenderer(ctx, next), dispose: next => next.renderer.destroy(),
    state: (ready, error) => stateMainRenderer(ctx, ready, error),
  });
  const request = (selected: number | null = null) => { resources.request(activeFloorFinishKeys(floors, selected, catalogue)); ctx.syncFloorScene(); };
  request();
  const load = (covering: number) => { floors = new Uint32Array([0, 0, covering]); ctx.lot.floors = floors; ctx.cameraDirty = true; request(); };
  const settle = (index: number) => { const next = { renderer: renderer(), finishes: prepareArchitectureFinishes(pending[index].keys, limits, catalogue) }; pending[index].resolve(next); return next; };
  return { ctx, overlayPause, speeds, statuses, draws, diagnostics, pending, resources, request, load, settle,
    frame: () => drawMainFrame(ctx) };
}

describe('main floor scene presentation', () => {
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
    f.pending[0].reject(new Error('pattern unavailable')); await flush();
    f.ctx.camera.originY += 12; f.ctx.cameraDirty = true; f.frame();
    expect(f.draws.at(-1)?.slice(0, 4)).toEqual([72, 434, 72, 434]);
    expect(f.statuses).toEqual([]);
    expect(f.ctx.floorResourceError).toBe('pattern unavailable');
    expect(f.ctx.floorTool.resourceStatus).toBe('Floor materials could not load. Try again.');
    expect(f.ctx.floorTool.resourceFailed).toBe(true);
    expect(f.diagnostics.at(-1)).toEqual(['Floor material resource failed', 'pattern unavailable']);
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

  it('rejects obsolete renderer completion after a second Load and preserves that newer scene', async () => {
    const f = fixture(); f.frame(); f.load(4);
    f.load(2); f.frame();
    expect(f.statuses.at(-1)).toEqual([false, null]);
    const latestSprite = f.draws.at(-1)?.[5];
    const obsolete = f.settle(0); await flush(); f.frame();
    expect(obsolete.renderer.disposed).toBe(true);
    expect(f.draws.at(-1)?.[5]).toBe(latestSprite);
    expect(Array.from(f.ctx.sim.floorTiles())).toEqual([0, 0, 2]);
  });
});
