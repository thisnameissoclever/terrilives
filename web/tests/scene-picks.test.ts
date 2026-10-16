import {expect,it,vi} from 'vitest';
import {ScenePickRegistry} from '../src/render/scene-picks.js';
import {CharacterWorld,type CharacterSceneView} from '../src/render/character/world.js';
import type {SimBridge} from '../src/bridge.js';
import type {SceneTarget} from '../src/render/scene-target.js';
import {resolveLeftClick,resolveRightClick,type Pick,type MenuTarget} from '../src/input.js';

// These tests isolate asynchronous ownership; real GPU effect coverage is tested separately.
vi.mock('../src/render/character/shower-steam.js',()=>({ShowerSteam:class {begin(){}destroy(){}}}));

function worldWithPick(read:()=>Promise<number>){
 let revision=0;
 let target={pick:read} as unknown as SceneTarget;
 const source={count:2,positions:()=>new Float32Array(4),sprites:()=>new Uint32Array(2),appearanceHash:()=>0n,characterAppearances:()=>[],lotRevision:()=>revision,ids:()=>new Uint32Array([80,900]),
  kinds:()=>new Uint32Array([0,1]),objectModel:()=>null,itemKinds:()=>[]} as unknown as SimBridge;
 const world=Reflect.construct(CharacterWorld,[{},'rgba8unorm',new Map(),()=>target]) as CharacterWorld;
 world.beginFrame(source,{fixtureDepthBase:40000} as CharacterSceneView);
 world.plan.pickOwners.begin(new Uint32Array([80,900]),new Uint32Array([0,1]),new Uint32Array([7,0xffffffff]));
 return {world,revise:()=>revision++,replaceTarget:()=>{target={pick:read} as unknown as SceneTarget;}};
}

it('returns authoritative empty visibility for a fixture covered by a wall',async()=>{
 const {world}=worldWithPick(async()=>0);
 expect(await world.pick(50,50)).toBeNull();
 world.destroy();
});

it('resolves fixture and person identities from the shared scene rather than actor-only meshes',async()=>{
 let token=2;const {world}=worldWithPick(async()=>token);
 expect(await world.pick(50,50)).toEqual({entity:900,sim:null,kind:'fixture'});
 token=1;expect(await world.pick(50,50)).toEqual({entity:80,sim:7,kind:'person'});
 token=0;expect(await world.pick(50,50)).toBeNull();
 token=500;expect(await world.pick(50,50)).toBeNull();
 world.destroy();
});

it('snapshots row and auxiliary identities before the asynchronous readback',async()=>{
 let finish!:(token:number)=>void;const {world}=worldWithPick(()=>new Promise(resolve=>{finish=resolve;}));
 const token=world.plan.pickOwners.cleanup(900,[601,605]);
 const pending=world.pick(50,50);
 world.plan.pickOwners.begin(new Uint32Array([999,888]),new Uint32Array([0,1]),new Uint32Array([9,0xffffffff]));
 world.plan.pickOwners.book(1234);finish(token);
 expect(await pending).toEqual({entity:900,sim:null,kind:'fixture',cleanup:{surface:900,dishes:[601,605]}});
 const primary=world.pick(50,50);world.plan.pickOwners.begin(new Uint32Array([333]),new Uint32Array([1]));finish(2);
 expect(await primary).toEqual({entity:888,sim:null,kind:'fixture'});
 world.destroy();
});

it.each(['lot','target','reset'] as const)('discards a stale %s readback',async(change)=>{
 let finish!:(token:number)=>void;const test=worldWithPick(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=test.world.pick(50,50);
 if(change==='lot')test.revise();else if(change==='target')test.replaceTarget();else test.world.reset();
 finish(2);expect(await pending).toBeUndefined();test.world.destroy();
});

it('retains exact cleanup dishes and the dropped-book recovery command',async()=>{
 const owners=new ScenePickRegistry();owners.begin(new Uint32Array([900]),new Uint32Array([1]));
 const dish=owners.cleanup(900,[601,605]),book=owners.book(0x8000000a),snapshot=owners.snapshot();
 expect(dish).not.toBe(1);expect(book).not.toBe(dish);
 const asPick=(token:number):Pick=>{const hit=snapshot.get(token)!;return {entity:hit.entity,isAgent:hit.kind==='person',cleanup:hit.cleanup,bookCopy:hit.bookCopy};};
 expect(resolveLeftClick(asPick(dish),80,false)).toEqual({kind:'clean',agent:80,surface:900,dishes:[601,605],placement:'front'});
 const target={selectedIndex:()=>80,canRecoverBook:()=>true,pendingBookCommands:()=>0} as unknown as MenuTarget;
 const menu=resolveRightClick(target,{x:0,y:0},0,0,1,false,asPick(book));
 expect(menu!.entries[0].action).toEqual({kind:'recover-book',copy:0x8000000a});
 expect(asPick(book).entity).toBe(0xffffffff);
});
