import {expect,it,vi} from 'vitest';
import {CreatorPreview} from '../src/ui/character-creator/preview.js';
import {CreatorView} from '../src/ui/character-creator/view.js';
import {defaultAppearance} from '../src/character/schema.js';
import type {CharacterPreparation} from '../src/render/character/character-preparation-service.js';

it('invalidates a pending draw immediately when a newer appearance is requested',async()=>{
  let finish!:(artifact:CharacterPreparation)=>void;const ready=new Promise<CharacterPreparation>(resolve=>{finish=resolve;});
  const oldActor={retained:true},preview=Object.assign(Object.create(CreatorPreview.prototype),{actor:oldActor,generation:0,closed:false,requested:'',preparation:null,contacts:{prepare:()=>ready}}) as CreatorPreview;
  const a=defaultAppearance(),b=structuredClone(a);b.body.height=100;
  const draw=preview.draw(a,0);preview.prepare(b,0);finish({bike:{key:'old'},sleep:{key:'old'}} as CharacterPreparation);
  expect(await draw).toBe(false);expect(Reflect.get(preview,'actor')).toBe(oldActor);
});

it('requests the newest contact data while an earlier preview draw is still awaiting work',async()=>{
  const a=defaultAppearance(),b=structuredClone(a);b.body.height=100;
  const prepare=vi.fn(()=>Promise.resolve(undefined)),draw=vi.fn();
  const view=Object.assign(Object.create(CreatorView.prototype),{destroyed:false,session:{draft:{value:{appearance:b}}},preview:{prepare,draw},
    previewInFlight:true,previewReady:true,appearanceReady:false,preparationKey:'',preparationGeneration:0,previewKey:JSON.stringify([a,0,'idle']),previewError:'',facing:0,action:'idle',queuedDraw:false,
    visible:()=>true,syncStatus(){},refreshAnimation(){}}) as CreatorView;
  await (view as unknown as {drawPreview():Promise<void>}).drawPreview();
  expect(prepare).toHaveBeenCalledWith(b,0,'idle');expect(draw).not.toHaveBeenCalled();expect(Reflect.get(view,'queuedDraw')).toBe(true);expect(Reflect.get(view,'previewReady')).toBe(false);
});

function hiddenPreparationView(){
  const pending:{resolve:()=>void;reject:(error:Error)=>void}[]=[];
  const appearance=defaultAppearance(),draw=vi.fn();
  const view=Object.assign(Object.create(CreatorView.prototype),{destroyed:false,session:{draft:{value:{appearance}}},
    preview:{prepare:()=>new Promise<void>((resolve,reject)=>pending.push({resolve,reject})),draw},
    previewInFlight:false,previewReady:false,appearanceReady:false,preparationKey:'',preparationGeneration:0,
    previewKey:'',previewError:'',facing:0,action:'walk',queuedDraw:false,
    visible:()=>false,syncStatus:vi.fn(),refreshAnimation:vi.fn(),element:()=>({textContent:''})});
  return {view,pending,appearance,draw,request:()=>Reflect.get(view,'drawPreview').call(view) as Promise<void>};
}

it('admits a prepared appearance without drawing a hidden preview',async()=>{
  const {view,pending,draw,request}=hiddenPreparationView();
  await request();expect(view.appearanceReady).toBe(false);
  pending[0].resolve();await Promise.resolve();
  expect(view.appearanceReady).toBe(true);expect(view.previewReady).toBe(false);expect(draw).not.toHaveBeenCalled();
});

it('ignores superseded preparation success and reports the latest failure',async()=>{
  const {view,pending,appearance,request}=hiddenPreparationView();
  await request();appearance.body.height=90;await request();
  pending[0].resolve();await Promise.resolve();expect(view.appearanceReady).toBe(false);
  pending[1].reject(new Error('Preparation failed'));await Promise.resolve();await Promise.resolve();
  expect(view.appearanceReady).toBe(false);expect(view.previewError).toBe('Preparation failed');
});

it('keeps a new A request ready when the earlier A request rejects after A-B-A edits',async()=>{
  const {view,pending,appearance,request}=hiddenPreparationView();
  const initial=appearance.body.height;
  await request();appearance.body.height=90;await request();appearance.body.height=initial;await request();
  pending[2].resolve();await Promise.resolve();
  pending[0].reject(new Error('Old request failed'));pending[1].resolve();await Promise.resolve();await Promise.resolve();
  expect(view.appearanceReady).toBe(true);expect(view.previewError).toBe('');
});

it('ignores preparation completion after the creator closes',async()=>{
  const {view,pending,request}=hiddenPreparationView();
  await request();view.destroyed=true;pending[0].resolve();await Promise.resolve();
  expect(view.appearanceReady).toBe(false);
});

it('ignores an older draw failure after hidden A-B-A preparation succeeds',async()=>{
  const {view,pending,appearance,draw,request}=hiddenPreparationView();
  let rejectDraw!:(error:Error)=>void;
  draw.mockImplementation(()=>new Promise<void>((_,reject)=>{rejectDraw=reject;}));
  view.visible=()=>true;const oldDraw=request();
  const initial=appearance.body.height;view.visible=()=>false;
  appearance.body.height=90;await request();appearance.body.height=initial;await request();
  pending[2].resolve();await Promise.resolve();
  rejectDraw(new Error('Old graphics request failed'));await oldDraw;
  expect(view.appearanceReady).toBe(true);expect(view.previewError).toBe('');
  pending[0].resolve();pending[1].resolve();await Promise.resolve();
});

it('clears failed preparation when Undo restores the last successfully drawn appearance',async()=>{
  const {view,pending,appearance,request}=hiddenPreparationView();
  const initial=appearance.body.height;
  await request();pending[0].resolve();await Promise.resolve();
  view.previewKey=JSON.stringify([appearance,0,'walk']);view.previewReady=true;
  appearance.body.height=90;await request();pending[1].reject(new Error('New body failed'));await Promise.resolve();
  expect(view.previewError).toBe('New body failed');
  appearance.body.height=initial;await request();
  expect(view.appearanceReady).toBe(false);expect(view.previewError).toBe('');
  pending[2].resolve();await Promise.resolve();expect(view.appearanceReady).toBe(true);expect(view.previewError).toBe('');
});
