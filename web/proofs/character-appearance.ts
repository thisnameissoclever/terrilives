import { initDevice } from '../src/render/device.js';
import { loadBundle } from '../src/render/character/bundle.js';
import { CharacterRenderer } from '../src/render/character/renderer.js';
import { createPresenter } from '../src/render/character/present.js';
import { CharacterCompositor } from '../src/render/character/compositor.js';
import { CharacterWorldPicker } from '../src/render/character/world-picking.js';
import { configuredPose } from '../src/render/character/pose.js';
import { anatomicalHeight, shapePoint } from '../src/render/character/shape.js';
import { transform } from '../src/render/character/math.js';
import { AppearanceDraft, appearanceFields, colorFields, neutralAppearance, parseAppearance, type AppearanceField } from '../src/render/character/appearance.js';
import { SpriteRenderer } from '../src/render/sprites.js';
import { ProofClock } from '../src/render/character/clock.js';
import { READ_FRAME_TICKS } from '../src/frame.js';
import { createMotionStudy, type MotionStudy } from './character-simulation.js';
import { loadProofDraft, type StoredProofDraft } from '../src/render/character/draft-storage.js';
import { isTransition, TRANSITION_FRAMES } from '../src/render/character/motion.js';
import { FLOATS_PER_INSTANCE, writeInstance } from '../src/render/instances.js';
import { FLOOR_DEPTH, layeredDepth, LAYER_PROP } from '../src/render/iso.js';
import { spriteIndex } from '../src/render/atlas.js';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { pixelBounds, verifyColorIsolation, verifyDepthPartition, verifyRuntimeSurface } from '../src/render/character/gpu-proof.js';
import manifestUrl from '../../assets/models/sims/appearance-proof/export-v2/manifest.json?url';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = element<HTMLCanvasElement>('preview');
const world = element<HTMLCanvasElement>('world');
const status = element<HTMLElement>('status');
const errors: string[] = [];
const KEY = 'natural-causes.appearance-proof.v1';
const fieldNames: Record<AppearanceField, string> = { presentation: 'Presentation', height: 'Height', build: 'Build', hairstyle: 'Hairstyle', skin: 'Skin', hair: 'Hair color', shirt: 'Shirt', trousers: 'Trousers', shoes: 'Shoes' };
const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];

async function start(): Promise<void> {
  const saved = localStorage.getItem(KEY);
  let stored: StoredProofDraft;
  try { stored = loadProofDraft(saved, seed); }
  catch (error) {
    element('new-draft').addEventListener('click', () => {
      const destination = new URL(location.href);
      destination.searchParams.delete('baseline');
      localStorage.removeItem(KEY);
      location.replace(destination.href);
    }, { once: true });
    throw new Error(`Saved appearance proof cannot load: ${String(error)}. Use New random draft to replace it.`);
  }
  let { draft, sourceColors, previousSourceColors } = stored;
  const gpu = await initDevice(canvas);
  const fail = (error: unknown) => { errors.push(String(error)); status.textContent = String(error); status.className = 'bad'; };
  gpu.device.addEventListener('uncapturederror', event => fail(event.error.message));
  gpu.device.pushErrorScope('validation');
  const geometry = await loadBundle(manifestUrl, new URLSearchParams(location.search).has('original') ? 'original' : 'runtime');
  const wasm = await init(); const simulationHandle=SimHandle.from_lot();
  const simulation = new SimBridge(simulationHandle, wasm.memory);
  const simulationHash = simulation.worldHash().toString();
  const saveDraft = () => localStorage.setItem(KEY, JSON.stringify({ ...JSON.parse(draft.serialize()),
    sourceMaterials: sourceColors, previousSourceMaterials: previousSourceColors }));
  if (new URLSearchParams(location.search).has('baseline')) {
    draft = new AppearanceDraft(1, neutralAppearance()); sourceColors = [...colorFields]; previousSourceColors = null;
  }
  const actor = new CharacterRenderer(gpu.device, geometry, canvas.width, canvas.height);
  const presenter = createPresenter(gpu.device, gpu.context, gpu.format, actor.color);
  const worldContext = world.getContext('webgpu'); if (!worldContext) throw new Error('World WebGPU canvas is unavailable');
  worldContext.configure({ device: gpu.device, format: gpu.format, alphaMode: 'premultiplied' });
  const scene = await SpriteRenderer.create({ ...gpu, context: worldContext });
  const compositor = new CharacterCompositor(gpu.device, gpu.format, actor);
  const worldPicker = new CharacterWorldPicker(gpu.device, actor, compositor, () => scene.depthForPicking);
  const staticRows = new Float32Array(FLOATS_PER_INSTANCE * 72);
  const worldScale = 1.5, originX = 480, originY = 130;
  let gridSize=16,cameraX=0,cameraY=0;
  const ground = (x: number, y: number): [number, number] => [originX + (x-cameraX-y+cameraY)*32*worldScale, originY + (x-cameraX+y-cameraY)*21*worldScale];
  const rebuildScene = () => {
    let count = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const [sx, sy] = ground(x+Math.floor(cameraX), y+Math.floor(cameraY)); writeInstance(staticRows, count++, sx, sy, FLOOR_DEPTH, spriteIndex('floor'));
    }
    if (element<HTMLInputElement>('wall').checked) for (let y = 2; y <= 5; y++) {
      const x=4+Math.floor(cameraX),wy=y+Math.floor(cameraY);
      const [sx, sy] = ground(x, wy); const depth = layeredDepth(x, wy, gridSize, LAYER_PROP);
      const step = depth - layeredDepth(x+1, wy, gridSize, LAYER_PROP);
      writeInstance(staticRows, count++, sx, sy, depth, spriteIndex('wallNS'), 1, 1, 1, 0, 5, step);
    }
    scene.setStaticGeometry(staticRows.subarray(0, count * FLOATS_PER_INSTANCE), count);
  };
  rebuildScene();
  let last = performance.now(), stopped = false;
  const clock = new ProofClock();
  let motionStudy: MotionStudy | null = null;
  const driverInput = element<HTMLSelectElement>('driver');
  const actionInput = element<HTMLSelectElement>('action'), facingInput = element<HTMLSelectElement>('facing');
  const readingTicksPerFrame = 2*READ_FRAME_TICKS/geometry.manifest.actions.read.length;
  const currentAction = () => motionStudy?.sample().action ?? actionInput.value;
  const currentFrame = () => {
    if(motionStudy)return motionStudy.sample().frame;
    if(isTransition(actionInput.value))return Math.min(TRANSITION_FRAMES,clock.time);
    if(actionInput.value==='standing_read')return 0;
    const count = geometry.manifest.actions[actionInput.value].length;
    return actionInput.value === 'walk' ? (clock.time*.25 % 1)*count
      : (clock.time/(actionInput.value==='idle'?1:readingTicksPerFrame))%count;
  };
  const place = (comp: CharacterCompositor, render: CharacterRenderer, x: number, y: number) => {
    const [sx, sy] = ground(x, y), textureScale = render.pixelScale;
    const w = render.width / textureScale * worldScale, h = render.height / textureScale * worldScale;
    comp.place([sx-w/2, sy-h*render.groundFraction, w, h], [world.width, world.height], [x, y], gridSize);
  };
  const draw = () => {
    const sample=motionStudy?.sample();
    actor.render(currentAction(), currentFrame(), sample?.angle ?? Number(facingInput.value)); presenter.draw();
    const travel = actionInput.value === 'walk' ? clock.time*.25 % 2 : 0;
    const angle = Number(facingInput.value);
    place(compositor, actor, sample?.x ?? 3+Math.sin(angle)*travel, sample?.y ?? 3+Math.cos(angle)*travel);
    scene.draw(new Float32Array(0), 0, worldScale, undefined, 0, pass => compositor.draw(pass));
  };
  const update = (persist = true) => {
    actor.setAppearance(draft.value, sourceColors);
    if (persist) saveDraft();
    if (simulation.worldHash().toString() !== simulationHash) throw new Error('Appearance editing changed simulation state');
    for (const key of appearanceFields) {
      const input = element<HTMLInputElement | HTMLSelectElement>(`field-${key}`);
      if (input) input.value = String(draft.value[key]);
      const number = document.getElementById(`value-${key}`) as HTMLInputElement | null;
      if (number) number.value = String(draft.value[key]);
      const random = element<HTMLButtonElement>(`random-${key}`); if (random) random.disabled = draft.locks.has(key);
      const lock = element<HTMLInputElement>(`lock-${key}`); if (lock) lock.checked = draft.locks.has(key);
    }
    draw(); status.className = ''; status.textContent = sourceColors.length === colorFields.length
      ? 'Source checkpoint with authored material colors. Appearance and contact approval remain open.'
      : 'Real mesh deformation. Inspect the model and furniture contacts before accepting the appearance.';
  };
  const attempt = (operation: () => void) => { try { operation(); } catch (error) { fail(error); } };
  const fields = element('field-list');
  for (const key of appearanceFields) {
    const row = document.createElement('div'); row.className = 'field';
    const label = document.createElement('label'); label.htmlFor = `field-${key}`; label.textContent = fieldNames[key]; row.append(label);
    let input: HTMLInputElement | HTMLSelectElement;
    if (key === 'presentation' || key === 'hairstyle') {
      input = document.createElement('select');
      for (const name of key === 'presentation' ? ['masculine', 'feminine'] : ['curl', 'bob']) {
        const option = document.createElement('option'); option.value = name; option.textContent = name[0].toUpperCase()+name.slice(1); input.append(option);
      }
    } else {
      input = document.createElement('input'); input.type = key === 'height' || key === 'build' ? 'range' : 'color';
      if (input.type === 'range') { input.min = '0'; input.max = '100'; input.step = '.1'; }
    }
    input.id = `field-${key}`; row.append(input);
    const change = (value: string) => attempt(() => {
      draft.set(key, key === 'height' || key === 'build' ? Number(value) : value);
      previousSourceColors = sourceColors;
      sourceColors = sourceColors.filter(field => field !== key); update(); });
    input.addEventListener('input', () => change(input.value));
    if (key === 'height' || key === 'build') {
      const number = document.createElement('input'); number.type = 'number'; number.min = '0'; number.max = '100'; number.step = '.1'; number.id = `value-${key}`;
      number.setAttribute('aria-label', `${fieldNames[key]} value`); number.addEventListener('change', () => change(number.value)); row.append(number);
    } else row.append(document.createElement('span'));
    const random = document.createElement('button'); random.id = `random-${key}`; random.type = 'button'; random.textContent = 'Random'; random.setAttribute('aria-label', `Randomize ${fieldNames[key].toLowerCase()}`);
    random.addEventListener('click', () => attempt(() => { previousSourceColors = sourceColors;
      const old = draft.value; draft.randomize([key]);
      sourceColors = sourceColors.filter(field => draft.value[field] === old[field]); update(); })); row.append(random);
    const lockLabel = document.createElement('label'), lock = document.createElement('input'); lock.type = 'checkbox'; lock.id = `lock-${key}`;
    lock.setAttribute('aria-label', `Lock ${fieldNames[key].toLowerCase()}`); lock.addEventListener('change', () => {
      if (lock.checked) draft.locks.add(key); else draft.locks.delete(key); random.disabled = lock.checked; attempt(saveDraft); });
    lockLabel.append(lock, 'Lock'); row.append(lockLabel); fields.append(row);
  }
  const randomize = (fields: readonly AppearanceField[] = appearanceFields) => attempt(() => {
    previousSourceColors = sourceColors; const old = draft.value; draft.randomize(fields);
    sourceColors = sourceColors.filter(field => draft.value[field] === old[field]); update();
  });
  element('randomize').addEventListener('click', () => randomize());
  element('randomize-colors').addEventListener('click', () => randomize(colorFields));
  element('undo').addEventListener('click', () => attempt(() => { draft.undo(); sourceColors = previousSourceColors ?? sourceColors; previousSourceColors = null; update(); }));
  element('baseline').addEventListener('click', () => attempt(() => { sourceColors = [...colorFields]; previousSourceColors = null; draft = new AppearanceDraft(1, neutralAppearance()); update(); }));
  element('new-draft').addEventListener('click', () => attempt(() => { sourceColors = []; previousSourceColors = null; draft = new AppearanceDraft(seed()); update(); }));
  actionInput.addEventListener('change', () => attempt(() => { clock.reset(); draw(); }));
  const selectDriver = (mode: string) => {
    motionStudy?.destroy();motionStudy=null;clock.play(false);
    cameraX=0;cameraY=0;gridSize=16;
    if(mode!=='manual') {
      if(mode!=='walk'&&mode!=='read')throw new Error('Invalid simulation study');
      const facing=[3,1,4,2][Math.round(Number(facingInput.value)/(Math.PI/2))];
      motionStudy=createMotionStudy(wasm.memory,mode,facing);
      const sample=motionStudy.sample();cameraX=sample.x-3;cameraY=sample.y-3;gridSize=motionStudy.gridSize;
    }
    driverInput.value=mode;actionInput.disabled=mode!=='manual';
    element('advance').textContent=mode==='manual'?'Next frame':'Next simulation tick';
    element('play').textContent='Play';last=performance.now();rebuildScene();draw();
  };
  driverInput.addEventListener('change',()=>attempt(()=>selectDriver(driverInput.value)));
  facingInput.addEventListener('change', () => attempt(()=>motionStudy?selectDriver(driverInput.value):draw()));
  element('wall').addEventListener('change', () => attempt(() => { rebuildScene(); draw(); }));
  element('advance').addEventListener('click', () => attempt(() => {
    if(motionStudy)motionStudy.step();
    else clock.step(actionInput.value === 'walk' ? .5 : actionInput.value === 'idle' || isTransition(actionInput.value) ? 1 : readingTicksPerFrame);
    element('play').textContent = 'Play'; draw();
  }));
  element('play').addEventListener('click', () => {
    if(motionStudy)motionStudy.play(!motionStudy.playing);else clock.play(!clock.playing);
    last = performance.now();element('play').textContent=(motionStudy?.playing??clock.playing)?'Pause':'Play';
  });
  canvas.addEventListener('click', event => {
    const rect = canvas.getBoundingClientRect();
    actor.pick(Math.floor((event.clientX-rect.left)*canvas.width/rect.width), Math.floor((event.clientY-rect.top)*canvas.height/rect.height)).then(id => {
      element('picked').textContent = id === 0 ? 'No object selected.' : id >= 0x80000000 ? 'Reading chair selected.' : 'Character selected.';
    }).catch(fail);
  });
  const personPosition = () => {
    const sample=motionStudy?.sample();
    const hip=geometry.manifest.bones.findIndex(b=>b.name==='hips');
    const top=anatomicalHeight(geometry.vertices);
    const point=transform(configuredPose(geometry.manifest,draft.value,currentAction(),currentFrame(),top).subarray(hip*16,hip*16+16),
      shapePoint(geometry.manifest.bones[hip].head,3,draft.value,top));
    const angle=sample?.angle??Number(facingInput.value),travel=actionInput.value==='walk'?clock.time*.25%2:0;
    const x=sample?.x??3+Math.sin(angle)*travel,y=sample?.y??3+Math.cos(angle)*travel;
    return [x+Math.cos(angle)*point[0]-Math.sin(angle)*point[1],
      y-Math.sin(angle)*point[0]-Math.cos(angle)*point[1]];
  };
  world.addEventListener('click', event => {
    const rect=world.getBoundingClientRect();
    worldPicker.pick(Math.floor((event.clientX-rect.left)*world.width/rect.width),Math.floor((event.clientY-rect.top)*world.height/rect.height))
      .then(id=>{element('picked').textContent=id===0?'No visible character or chair selected.':id>=0x80000000?'Reading chair selected.':
        `Character selected at (${personPosition().map(value=>value.toFixed(2)).join(', ')}).`;}).catch(fail);
  });
  let benchmarking = false;
  const benchmark = async (durationMs = 60000) => {
    if (benchmarking || durationMs < 1000 || durationMs > 120000) throw new Error('Invalid or overlapping benchmark');
    benchmarking = true; clock.play(false); motionStudy?.play(false); element('play').textContent = 'Play';
    const renders: CharacterRenderer[] = [], compositors: CharacterCompositor[] = [];
    const work: number[] = [], intervals: number[] = [], submission: number[] = [], completionWait: number[] = [];
    const savedCamera={x:cameraX,y:cameraY,gridSize};
    try {
      cameraX=0;cameraY=0;gridSize=16;rebuildScene();
      for (let i = 0; i < 6; i++) {
        const renderer = new CharacterRenderer(gpu.device, geometry, 256, 336);
        renderer.setAppearance({ ...neutralAppearance(), presentation: i % 2 ? 'feminine' : 'masculine',
          hairstyle: i % 2 ? 'bob' : 'curl', height: [0, 50, 100][i % 3], build: [0, 50, 100][Math.floor(i / 2)] });
        renders.push(renderer); compositors.push(new CharacterCompositor(gpu.device, gpu.format, renderer));
      }
      const run = (tick: number) => {
        actor.render('read', (tick/readingTicksPerFrame)%4, 0); presenter.draw();
        for (let i = 0; i < renders.length; i++) {
          renders[i].render(i === 0 ? 'read' : 'walk', i === 0 ? (tick/readingTicksPerFrame)%4 : (tick*2)%8, 0, i+1);
          place(compositors[i], renders[i], 1.5 + i%3*2, 2 + Math.floor(i/3)*2.5);
        }
        scene.draw(new Float32Array(0), 0, worldScale, undefined, 0, pass => { for (const comp of compositors) comp.draw(pass); });
      };
      for (let i = 0; i < 30; i++) { run(i); await gpu.device.queue.onSubmittedWorkDone(); }
      const began = performance.now(); let previous = began;
      while (performance.now()-began < durationMs) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const now = performance.now(); intervals.push(now-previous); previous = now;
        run((now-began)/100); const submitted = performance.now();
        await gpu.device.queue.onSubmittedWorkDone(); const completed = performance.now();
        submission.push(submitted-now); completionWait.push(completed-submitted); work.push(completed-now);
      }
      const percentile = (a: number[], p: number) => [...a].sort((x,y) => x-y)[Math.min(a.length-1, Math.ceil(a.length*p)-1)];
      const result = { samples: work.length, elapsedMs: performance.now()-began, workload: 'Six world characters plus enlarged seated-reading preview',
        workP50Ms: percentile(work, .5), workP95Ms: percentile(work, .95), workMaxMs: Math.max(...work),
        submissionP95Ms: percentile(submission,.95), completionWaitP95Ms: percentile(completionWait,.95),
        intervalP95Ms: percentile(intervals, .95), overBudget: work.filter(n => n > 16.6).length,
        viewport: [world.width, world.height], preview: [canvas.width, canvas.height],
        dynamicTextureBytes: (6*256*336 + canvas.width*canvas.height)*16,
        characterBufferBytes: actor.allocatedBufferBytes + renders.reduce((bytes, renderer) => bytes + renderer.allocatedBufferBytes, 0),
        allocationScope: 'Character buffers and dynamic textures; excludes browser, driver, scene atlas and compositor buffers. depth24plus counted at four bytes per pixel.',
        adapter: { vendor: gpu.device.adapterInfo.vendor, architecture: gpu.device.adapterInfo.architecture },
        javascriptHeap: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
        timingScope: 'Submission includes CPU command generation; completion wait includes GPU processing and browser scheduling. Neither is an isolated GPU timestamp.',
        errors: [...errors], workSamplesMs: work, submissionSamplesMs: submission, completionWaitSamplesMs: completionWait, frameIntervalsMs: intervals };
      element('benchmark-result').textContent = `${result.samples} samples; 95th percentile render work ${result.workP95Ms.toFixed(2)} ms. Desktop target: 16.6 ms.`;
      return result;
    } finally {
      for (const comp of compositors) comp.destroy(); for (const renderer of renders) renderer.destroy();
      cameraX=savedCamera.x;cameraY=savedCamera.y;gridSize=savedCamera.gridSize;rebuildScene();
      benchmarking = false; draw();
    }
  };
  element('benchmark').addEventListener('click', () => { benchmark().catch(fail); });
  update(saved === null); await gpu.device.queue.onSubmittedWorkDone();
  const validation = await gpu.device.popErrorScope(); if (validation) throw validation;
  const info = gpu.device.adapterInfo;
  element('facts').textContent = JSON.stringify({ triangles: geometry.description.indexCount/3, bones: geometry.manifest.bones.length,
    adapter: { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description }, source: geometry.manifest.sourceSha256, simulationHash }, null, 2);
  const loop = (now: number) => {
    if (stopped) return;
    const elapsed = now-last; last = now;
    if ((motionStudy?.playing??clock.playing) && !benchmarking) attempt(() => {
      if(motionStudy)motionStudy.advance(elapsed);else clock.advance(elapsed);
      if(!motionStudy&&isTransition(actionInput.value)&&clock.time>=TRANSITION_FRAMES)clock.play(false);
      if(!(motionStudy?.playing??clock.playing))element('play').textContent='Play';
      draw(); });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  Object.assign(window, { appearanceProof: { actor, geometry, draw, errors, gpu, scene, simulation, benchmark, worldPicker, compositor, personPosition,
    bounds: () => pixelBounds(actor), depthProof: () => verifyDepthPartition(actor),
    colorProof: async () => { try { return await verifyColorIsolation(actor); } finally { update(false); } },
    surfaceProof: () => verifyRuntimeSurface(actor,draft.value,currentAction(),currentFrame()),
    get value() { return { ...draft.value }; }, get frame() { return currentFrame(); },
    get time() { return motionStudy?.sample().tick ?? clock.time; },
    get motionStudy() { return motionStudy; },
    startSimulationStudy(mode:'walk'|'read',angle=0) { facingInput.value=String(angle);selectDriver(mode); },
    advanceSimulation(milliseconds:number) { if(!motionStudy)throw new Error('No simulation study');motionStudy.advance(milliseconds);draw(); },
    seek(action: string, frame: number, facing = 0) {
      if (![...actionInput.options].some(option => option.value === action) || ![...facingInput.options].some(option => option.value === String(facing))
        || !Number.isFinite(frame) || frame < 0) throw new Error('Invalid proof study');
      if(motionStudy)selectDriver('manual');
      actionInput.value = action; facingInput.value = String(facing);
      clock.seek(action === 'walk' ? frame / 2 : isTransition(action) || action === 'idle' ? frame : action === 'standing_read' ? 0 : frame * readingTicksPerFrame);
      element('play').textContent = 'Play'; draw();
    },
    set(value: unknown) { draft = new AppearanceDraft(1, parseAppearance(JSON.stringify(value))); sourceColors = []; previousSourceColors=null; update(); },
  } });
  window.addEventListener('pagehide', () => {
    stopped = true; motionStudy?.destroy();simulationHandle.free();worldPicker.destroy(); actor.destroy(); compositor.destroy(); scene.destroy();
    gpu.context.unconfigure(); worldContext.unconfigure(); gpu.device.destroy();
  }, { once: true });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
}
start().catch(error => {
  const message = error && typeof error.message === 'string' ? error.message : String(error);
  status.textContent = message; status.className = 'bad'; errors.push(message);
});
