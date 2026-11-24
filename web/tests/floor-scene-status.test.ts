import { expect, it } from 'vitest';
import { createFloorSceneStatus } from '../src/ui/floor-scene-status.js';
import { operationFeedback } from '../src/ui/operation-feedback.js';
import { sceneObserverHarness } from './helpers/scene-observers.js';

interface ElementFixture {
  id: string; hidden: boolean; textContent: string; type: string; className: string;
  style: Record<string, string>; attributes: Record<string, string>;
  dataset: Record<string, string>;
  children: ElementFixture[]; listeners: Record<string, () => void>;
  setAttribute(name: string, value: string): void;
  append(...items: ElementFixture[]): void;
  addEventListener(name: string, fn: () => void): void;
  getBoundingClientRect(): {width:number;height:number};
}
function element(): ElementFixture {
  return { id: '', hidden: false, textContent: '', type: '', className: '', style: { visibility: '' },
    attributes: {} as Record<string, string>, dataset: {}, children: [] as ReturnType<typeof element>[],
    listeners: {} as Record<string, () => void>,
    getBoundingClientRect:()=>({width:358,height:100}),
    setAttribute(name: string, value: string) { this.attributes[name] = value; },
    append(...items: ReturnType<typeof element>[]) { this.children.push(...items); },
    addEventListener(name: string, fn: () => void) { this.listeners[name] = fn; } };
}

it('shows an explicit scene status and Retry while leaving other application controls in place', () => {
  const body = element(), options = element(), stage = element();
  body.append(options, stage);
  let retries = 0;
  const update = createFloorSceneStatus({ body, createElement: element } as never, stage as never, () => { retries++; });
  const panel = body.children[2], [text, retry] = panel.children;
  expect(panel.id).toBe('floor-scene-status');
  expect(panel.attributes.role).toBe('status');
  expect(panel.hidden).toBe(true);
  update(true, null);
  expect(panel.dataset.pending).toBe('true');
  expect(stage.style.visibility).toBe('hidden');
  expect(panel.hidden).toBe(false);
  expect(text.textContent).toBe('Loading floor materials.');
  expect(retry.hidden).toBe(true);
  update(true, 'offline');
  expect(panel.dataset.pending).toBe('false');
  expect(text.textContent).toBe('Floor materials could not load. Try again.');
  expect(retry.hidden).toBe(false);
  retry.listeners.click();
  expect(retries).toBe(1);
  expect(options.hidden).toBe(false);
  update(false, null);
  expect(stage.style.visibility).toBe('');
  expect(panel.hidden).toBe(true);
});

it('offers optional finish recovery in the scene without hiding the valid world', () => {
  const body=element(),stage=element();
  const update=createFloorSceneStatus({body,createElement:element} as never,stage as never,()=>{});
  update(false,null);
  const feedback=operationFeedback('floor','failure','Boards','Boards could not load.','retry');
  update.preview(feedback);
  const panel=body.children[0];
  expect(panel.hidden).toBe(false);
  expect(stage.style.visibility).toBe('');
  expect(panel.children[0].textContent).toBe('Boards could not load.');
  expect(panel.children[1].hidden).toBe(false);
});

it('caches optional recovery bounds, observes text resize and prioritizes missing placed floors', () => {
  const observers=sceneObserverHarness();
  try{
    const body=element(),stage=element();let retries=0,reads=0,height=100;
    const update=createFloorSceneStatus({body,createElement:element} as never,stage as never,()=>{retries++;});
    const panel=body.children[0];panel.getBoundingClientRect=()=>{reads++;return {width:358,height};};
    const layout={viewport:{left:0,top:0,right:390,bottom:620},obstacles:[{left:8,top:8,right:382,bottom:110}]};
    const feedback=operationFeedback('floor','failure','Boards','Boards could not load.','retry');
    const first=update.preview(feedback,layout)!;
    expect(first.top).toBeGreaterThanOrEqual(118);expect(first.bottom).toBeLessThanOrEqual(612);
    expect(update.preview({...feedback},layout)).toBe(first);expect(reads).toBe(1);
    panel.children[1].listeners.click();expect(retries).toBe(1);expect(stage.style.visibility).toBe('');
    height=160;observers.resize(panel);
    const enlarged=update.preview(feedback,layout)!;expect(enlarged.bottom-enlarged.top).toBeCloseTo(160);
    expect(reads).toBe(2);
    update(true,null);expect(stage.style.visibility).toBe('hidden');expect(panel.children[0].textContent).toBe('Loading floor materials.');
    expect(update.preview(feedback,layout)).toBeNull();expect(panel.children[1].hidden).toBe(true);
    update(true,'offline');expect(panel.children[0].textContent).toBe('Floor materials could not load. Try again.');
    update.preview(null);update(false,null);expect(panel.hidden).toBe(true);expect(stage.style.visibility).toBe('');
  }finally{observers.restore();}
});
