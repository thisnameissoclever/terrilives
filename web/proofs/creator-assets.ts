import { initDevice } from '../src/render/device.js';
import { loadBundle } from '../src/render/character/bundle.js';
import { selectGeometry, type AppearanceContext } from '../src/render/character/variants.js';
import { CharacterRenderer } from '../src/render/character/renderer.js';
import { createPresenter } from '../src/render/character/present.js';
import { defaultAppearance, validateAppearance, type CharacterAppearanceV1 } from '../src/character/schema.js';
import manifestUrl from '../../assets/models/sims/character-creator/export/manifest.json?url';

async function start() {
  const canvas = document.querySelector<HTMLCanvasElement>('#preview')!;
  const record = document.querySelector<HTMLTextAreaElement>('#record')!;
  const status = document.querySelector<HTMLElement>('#status')!;
  const action = document.querySelector<HTMLSelectElement>('#action')!;
  const bare = document.querySelector<HTMLInputElement>('#bare')!;
  const gpu = await initDevice(canvas), source = await loadBundle(manifestUrl);
  const errors: string[] = [];
  gpu.device.addEventListener('uncapturederror', event => { errors.push(event.error.message); status.textContent = event.error.message; });
  let actor: CharacterRenderer | undefined, facing = 0, frame = 0;
  async function draw(appearance: CharacterAppearanceV1, context: AppearanceContext, pose = 'idle', phase = 0, angle = 0) {
    validateAppearance(appearance);
    const geometry = selectGeometry(source, appearance, context);
    if (actor?.geometry !== geometry) { actor?.destroy(); actor = new CharacterRenderer(gpu.device, geometry, canvas.width, canvas.height); }
    actor.setCharacterAppearance(appearance);
    actor.render(pose, phase, angle);
    createPresenter(gpu.device, gpu.context, gpu.format, actor.color).draw();
    await gpu.device.queue.onSubmittedWorkDone();
    status.textContent = `${geometry.description.indexCount / 3} triangles; ${geometry.description.parts.length} parts; ${pose}, frame ${phase}.`;
    return { triangles: geometry.description.indexCount / 3, parts: geometry.description.parts.map(part => part.name), errors: [...errors] };
  }
  const update = () => draw(JSON.parse(record.value), { wear: bare.checked ? 'bare' : 'clothed', prop: action.value === 'read' ? 'book' : 'none',
    fixture: action.value === 'read' ? 'armchair' : 'none', eyes_closed: action.value === 'sleep' }, action.value, frame, facing)
    .catch(error => { status.textContent = String(error); });
  record.value = JSON.stringify(defaultAppearance(), null, 2);
  document.querySelector('#apply')!.addEventListener('click', update);
  document.querySelector('#turn')!.addEventListener('click', () => { facing = (facing + Math.PI / 2) % (Math.PI * 2); void update(); });
  document.querySelector('#step')!.addEventListener('click', () => { frame += .25; void update(); });
  action.addEventListener('change', () => { frame = 0; void update(); }); bare.addEventListener('change', update);
  window.addEventListener('pagehide', () => { actor?.destroy(); gpu.device.destroy(); }, { once: true });
  await update();
  Object.assign(window, { creatorStudy: { draw, defaultAppearance, errors } });
}
void start().catch(error => {
  document.querySelector('#status')!.textContent = String(error);
  Object.assign(window, { creatorStudyError: String(error) });
});
