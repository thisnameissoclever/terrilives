import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { BuildSceneFeedback, SceneFeedback, operationFeedback, type OperationFeedback } from '../src/ui/operation-feedback.js';
import { SceneLayoutObserver } from '../src/ui/scene-feedback-layout.js';
import { CompactHud } from '../src/ui/compact-hud.js';
import { sceneObserverHarness } from './helpers/scene-observers.js';
import { createFloorSceneStatus } from '../src/ui/floor-scene-status.js';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
function routingSource(): string {
  const file = ts.createSourceFile('main.ts', main, ts.ScriptTarget.Latest, true);
  const body = file.statements.filter(ts.isFunctionDeclaration).find(node => node.name?.text === 'main')!.body!;
  const from = body.statements.findIndex(node => ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)
    && node.expression.left.getText(file) === 'placementActions');
  const to = body.statements.findIndex((node, index) => index > from && ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(file) === 'installShortcuts');
  return ts.transpile(body.statements.slice(from + 1, to).map(node => node.getText(file)).join('\n')
    + '\nreturn renderBuildFeedback;', { target: ts.ScriptTarget.ES2022 });
}
interface Rect { left:number; top:number; right:number; bottom:number; width:number; height:number }
const rect = (left:number,top:number,width:number,height:number):Rect => ({left,top,right:left+width,bottom:top+height,width,height});
class Element {
  textContent = ''; hidden = false; dataset:Record<string,string> = {}; style:Record<string,string> = {};
  attributes = new Map<string,string>(); children:Element[] = []; parentElement:Element|null = null;
  reads=0;
  constructor(readonly ownerDocument: Doc, readonly id:string, public box = rect(0,0,360,54)) {}
  append(...nodes:Element[]) { for(const node of nodes){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(child=>child!==node);this.children.push(node);node.parentElement=this;} }
  setAttribute(name:string,value:string) { this.attributes.set(name,value); } removeAttribute(name:string) { this.attributes.delete(name); }
  addEventListener() {}
  getAttribute(name:string) { return this.attributes.get(name)??null; }
  getBoundingClientRect() { this.reads++;return this.box; }
  get width() { return this.box.width; } get height() { return this.box.height; }
}
class Doc {
  documentElement = {clientWidth:1280,clientHeight:720}; body = new Element(this,'body'); nodes = new Map<string,Element>();
  createElement() { return new Element(this,''); }
  getElementById(id:string) { return this.nodes.get(id)??null; }
  querySelector(selector:string) { return this.getElementById(selector.replace(/^#/,'')); }
  node(id:string,box?:Rect) { const node=new Element(this,id,box);this.nodes.set(id,node);return node; }
}
function fixture(phone = false) {
  const document=new Doc();if(phone)document.documentElement={clientWidth:390,clientHeight:844};
  const stage=document.node('stage',rect(0,0,document.documentElement.clientWidth,document.documentElement.clientHeight));
  const hudRoot=document.node('hud',phone?rect(8,8,254,100):rect(8,8,304,650));
  const builderDock=document.node('builder-dock',phone?rect(8,620,374,216):rect(0,720,0,0));
  const optionsPanel=document.node('options-panel');optionsPanel.hidden=true;
  const menuRoot=document.node('object-menu');menuRoot.hidden=true;
  const simDock=document.node('sim-dock',rect(8,770,374,66));simDock.hidden=true;
  const placementRoot=document.node('placement-actions',phone?rect(35,350,320,180):rect(650,260,320,180));placementRoot.hidden=true;
  const camera=document.node('build-camera',phone?rect(272,8,110,92):rect(1150,8,110,44));
  for(const id of ['buy-tool','furniture-tool','wall-tool','room-tool','floor-tool','land-tool'])document.node(id);
  const element=document.node('command-feedback');element.setAttribute('role','status');element.setAttribute('aria-live','polite');hudRoot.append(element);
  const sceneFeedback=new SceneFeedback(element as unknown as HTMLElement);
  const presentFloorSceneStatus=createFloorSceneStatus(document as never,stage as never,vi.fn());
  presentFloorSceneStatus(false,null);
  const success=operationFeedback('buy','success','Trash can','Trash can bought.');
  const refusal=operationFeedback('buy','failure','Trash can','That position overlaps other furniture.','move');
  const builder={active:true,preview:null,feedback:null};
  const buyTool={active:true,resultFeedback:success,feedback:refusal,ghost:()=>({x:1,y:1,width:1,depth:1})};
  const tools={active:false,feedback:null as OperationFeedback|null,line:null,first:null,tile:null,anchorPoint:()=>null};
  const roomReview={active:false,geometryChanged:vi.fn()};
  const context={document,sceneFeedback,BuildSceneFeedback,SceneLayoutObserver,placementButtons:{},placementActions:null,sim:{lotRevision:()=>1},
    builder,buyTool,wallTool:{...tools},roomTool:{...tools},floorTool:{...tools},landTool:{active:false,resultFeedback:null},roomReview,stage,hudRoot,builderDock,optionsPanel,placementRoot,menuRoot,
    presentFloorSceneStatus,floorScene:{visible:true},resetSceneBuildFeedback:()=>{},compactBuildQuery:{matches:phone},camera:{scale:1,originX:700,originY:200},screenX:(x:number)=>x*20,screenY:(_x:number,y:number)=>y*20,
    dockTop:()=>phone?620:720,placementKeepOut:()=>({left:phone?0:312,gearBottom:108}),
  };
  const render=new Function('ctx',`with(ctx){${routingSource()}}`)(context) as (now:number)=>void;
  return {document,element,sceneFeedback,context,render,success,refusal,roomReview,buyTool,placementRoot,builderDock,camera,simDock};
}

it.each([false,true])('owns unselected floor recovery in the scene, with mutually exclusive contextual recovery (%s)',phone=>{
  const f=fixture(phone);f.buyTool.active=false;
  const floors=f.context.floorTool;
  Object.assign(floors,{active:true,resourceStatus:'offline',feedback:operationFeedback('floor','failure','Boards','Boards could not load.','retry')});
  const recovery=f.document.body.children.find(node=>node.id==='floor-scene-status')!;
  f.render(0);expect(recovery.hidden).toBe(false);expect(f.context.stage.style.visibility).toBe('');
  expect(recovery.children[0].textContent).toBe('Boards could not load.');expect(recovery.children[1].hidden).toBe(false);
  expect(f.element.textContent).toBe('');
  const reads=recovery.reads;f.render(1);expect(recovery.reads).toBe(reads);
  Object.assign(floors,{tile:[1,1],anchorPoint:()=>[1,1]});f.render(2);
  expect(recovery.hidden).toBe(true);expect(f.element.textContent).toBe('');expect(floors.feedback?.message).toBe('Boards could not load.');
  // Contextual Cancel keeps the selected finish, so its unresolved recovery moves back into the scene.
  Object.assign(floors,{tile:null,anchorPoint:()=>null});f.render(2.5);
  expect(recovery.hidden).toBe(false);expect(recovery.children[1].hidden).toBe(false);
  Object.assign(floors,{tile:null,anchorPoint:()=>null,resourceStatus:'loading',feedback:operationFeedback('floor','pending','Boards','Loading Boards...')});f.render(3);
  expect(recovery.hidden).toBe(false);expect(recovery.children[1].hidden).toBe(true);
  expect(recovery.dataset.pending).toBe('true');expect(f.element.textContent).toBe('');
  f.context.resetSceneBuildFeedback();expect(recovery.hidden).toBe(true);
  f.render(4);Object.assign(floors,{resourceStatus:null,feedback:null});f.render(5);expect(recovery.hidden).toBe(true);
  Object.assign(floors,{resourceStatus:'offline',feedback:operationFeedback('floor','failure','Tiles','Tiles could not load.','retry')});f.render(6);
  f.roomReview.active=true;f.render(7);expect(recovery.hidden).toBe(true);
  f.roomReview.active=false;f.render(8);f.context.builder.active=false;f.render(9);expect(recovery.hidden).toBe(true);
  f.context.builder.active=true;f.render(10);floors.active=false;f.render(11);expect(recovery.hidden).toBe(true);
});
it.each([false,true])('routes the actual Build receipt consumer into the scene, never a tool panel (%s)',phone=>{
  const f=fixture(phone);f.render(0);
  expect(f.element.textContent).toBe('Trash can bought.');
  expect(f.element.parentElement).toBe(f.document.body);
  expect([...f.document.nodes.values()].filter(node=>node.id.endsWith('-tool')).flatMap(node=>node.children)).toEqual([]);
  expect(f.buyTool.feedback.message).toBe('That position overlaps other furniture.');
  f.render(4001);expect(f.element.textContent).toBe('');expect(f.buyTool.feedback).toBe(f.refusal);
});

it('keeps a newer command error clear of optional floor recovery in the phone scene',()=>{
  const f=fixture(true);f.buyTool.active=false;
  Object.assign(f.context.floorTool,{active:true,resourceStatus:'offline',feedback:operationFeedback('floor','failure','Boards','Boards could not load.','retry')});
  f.render(0);
  const panel=f.document.body.children.find(node=>node.id==='floor-scene-status')!;
  f.sceneFeedback.status.textContent='Order queue is full';f.sceneFeedback.status.setAttribute('data-kind','error');f.render(100);
  expect(panel.hidden).toBe(false);expect(f.element.textContent).toBe('Order queue is full');expect(f.element.style.opacity).toBe('');
  const top=Number.parseFloat(f.element.style.top),other=Number.parseFloat(panel.style.top);
  expect(top+f.element.box.height+8<=other||other+panel.box.height+8<=top).toBe(true);
});

it.each(['existing','new'] as const)('invalidates actual main scene bounds on compact dock expansion without a window resize (%s message)',kind=>{
  const observers=sceneObserverHarness(),clock=vi.spyOn(performance,'now').mockReturnValue(0);
  try{
    const f=fixture(true);f.context.builder.active=false;
    const dockBody=f.document.node('sim-dock-body');
    const hud=new CompactHud(state=>{
      f.simDock.hidden=state.editing;dockBody.hidden=state.collapsed;
      f.simDock.box=state.collapsed?rect(8,770,374,66):rect(8,430,374,406);
      observers.mutation(f.simDock);observers.resize(f.simDock);
    });
    hud.setCompact(true);hud.toggleCollapsed();
    f.sceneFeedback.anchor({x:195,y:700});f.sceneFeedback.status.textContent='Persistent error';f.sceneFeedback.status.setAttribute('data-kind','error');
    f.render(0);const collapsedTop=Number.parseFloat(f.element.style.top);
    expect(collapsedTop+54).toBeLessThanOrEqual(762);const reads=f.simDock.reads;
    f.render(50);expect(f.simDock.reads).toBe(reads);
    hud.toggleCollapsed();
    if(kind==='new'){clock.mockReturnValue(100);f.sceneFeedback.status.textContent='Orders cleared';}
    f.render(100);expect(Number.parseFloat(f.element.style.top)+54).toBeLessThanOrEqual(422);
    expect(f.simDock.reads).toBeGreaterThan(reads);
    hud.toggleCollapsed();f.render(200);expect(Number.parseFloat(f.element.style.top)).toBe(collapsedTop);
    hud.beginEditing();f.render(300);expect(Number.parseFloat(f.element.style.top)).toBe(712);
    hud.endEditing();f.render(400);expect(Number.parseFloat(f.element.style.top)).toBe(collapsedTop);
  }finally{clock.mockRestore();observers.restore();}
});

it('keeps an unanchored room result in the available phone scene and clears it for review or a tool change',()=>{
  const f=fixture(true);f.buyTool.active=false;Object.assign(f.context.roomTool,{active:true,feedback:operationFeedback('room','success','Room','Room built.')});
  f.render(0);expect(f.element.textContent).toBe('Room built.');
  const top=Number.parseFloat(f.element.style.top),left=Number.parseFloat(f.element.style.left);
  expect(top).toBeGreaterThanOrEqual(116);expect(top+f.element.box.height).toBeLessThanOrEqual(612);expect(left).toBeGreaterThanOrEqual(8);
  f.roomReview.active=true;f.render(1000);expect(f.element.textContent).toBe('');
  f.roomReview.active=false;f.render(1100);expect(f.element.textContent).toBe('');
  Object.assign(f.context.roomTool,{feedback:operationFeedback('room','success','Room','Room built.')});f.render(1200);
  expect(f.element.textContent).toBe('Room built.');f.context.roomTool.active=false;f.render(1300);expect(f.element.textContent).toBe('');
});

it('supersedes a receipt with a new pending operation without moving an anchored refusal into the scene',()=>{
  const f=fixture();f.render(0);expect(f.element.textContent).toBe('Trash can bought.');
  Object.assign(f.buyTool,{resultFeedback:null,feedback:operationFeedback('buy','pending','Trash can','Buying Trash can...')});
  f.render(100);expect(f.element.textContent).toBe('');
  Object.assign(f.buyTool,{feedback:f.refusal});f.render(200);expect(f.element.textContent).toBe('');
  expect(f.buyTool.feedback).toBe(f.refusal);
});

it('gives each identical Build receipt its own lifetime without restarting an unchanged polled receipt',()=>{
  const f=fixture();f.render(0);f.render(2000);
  Object.assign(f.buyTool,{resultFeedback:operationFeedback('buy','success','Trash can','Trash can bought.')});
  f.render(3000);f.render(4001);expect(f.element.textContent).toBe('Trash can bought.');
  f.render(7001);expect(f.element.textContent).toBe('');f.render(8000);expect(f.element.textContent).toBe('');
});

it('does not resurrect an older consumed receipt after a newer operation supersedes it',()=>{
  const f=fixture();f.render(0);
  Object.assign(f.buyTool,{resultFeedback:operationFeedback('buy','success','Chair','Chair bought.')});f.render(100);
  Object.assign(f.buyTool,{resultFeedback:f.success});f.render(200);expect(f.element.textContent).toBe('Chair bought.');
});

it('does not republish an unchanged polled pending state over a newer command error',()=>{
  const f=fixture();f.buyTool.active=false;
  Object.assign(f.context.floorTool,{active:true});
  Object.defineProperty(f.context.floorTool,'feedback',{get:()=>operationFeedback('floor','pending','Tile','Loading Tile...')});
  f.render(0);expect(f.element.textContent).toBe('Loading Tile...');
  f.sceneFeedback.status.textContent='Order queue is full';f.sceneFeedback.status.setAttribute('data-kind','error');
  f.render(100);expect(f.element.textContent).toBe('Order queue is full');
});

it('forgets a canceled Build anchor before a later unanchored receipt',()=>{
  const f=fixture();f.render(0);f.context.builder.active=false;f.render(100);
  f.context.builder.active=true;Object.assign(f.buyTool,{ghost:()=>null,resultFeedback:operationFeedback('buy','success','Trash can','Trash can bought.')});
  f.render(200);expect(Number.parseFloat(f.element.style.left)).toBe(460);
});

it('resets the Build receipt and anchor on a world replacement while Build remains active',()=>{
  const f=fixture();f.render(0);f.context.resetSceneBuildFeedback();expect(f.element.textContent).toBe('');
  Object.assign(f.buyTool,{ghost:()=>null,resultFeedback:operationFeedback('buy','success','Trash can','Trash can bought.')});
  f.render(200);expect(Number.parseFloat(f.element.style.left)).toBe(460);
});

it('routes a Land receipt into the scene, expires it, and supersedes it when a new decision starts',()=>{
  const f=fixture();f.buyTool.active=false;Object.assign(f.context.landTool,{active:true,resultFeedback:operationFeedback('land','success','Behind the house','Bought 160 squares behind the house for $24,000.')});
  f.render(0);expect(f.element.textContent).toBe('Bought 160 squares behind the house for $24,000.');
  expect(f.document.getElementById('land-tool')!.children).toEqual([]);f.render(4001);expect(f.element.textContent).toBe('');
  Object.assign(f.context.landTool,{resultFeedback:operationFeedback('land','success','Left side','Bought 200 squares on the left side for $30,000.')});
  f.render(5000);expect(f.element.textContent).toContain('200 squares');
  Object.assign(f.context.landTool,{resultFeedback:null});f.render(5100);expect(f.element.textContent).toBe('');
});
