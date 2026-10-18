import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import registration from '../../assets/models/kitchen/wall-registration.json';
import architecture from '../../assets/models/architecture-depth.json';
import {fixtureRegistration,type FixtureRegistrationSource} from '../src/render/fixture-registration.js';
import {spriteIndex} from '../src/render/atlas.js';
import {buildInstanceBatch,type RenderSource} from '../src/frame.js';
import {buildGrimeInstances} from '../src/render/grime-decals.js';
import {FLOATS_PER_INSTANCE} from '../src/render/instances.js';
import {screenX,screenY,layeredDepth,LAYER_PROP} from '../src/render/iso.js';
import init,{SimHandle} from '../src/wasm/terri_wasm.js';
import {SimBridge} from '../src/bridge.js';
import {writePlacementPreview} from '../src/render/placement-preview.js';

const root=new URL('../../',import.meta.url);
const digest=(path:string)=>createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex');
const facings=['','SW','NW','NE'] as const;
const rotations=[Math.PI/2,0,3*Math.PI/2,Math.PI];
function bounds(row:typeof registration.fixtures[number],angle:number):number[] {
  const points=[];
  for(const x of [row.minimum[0],row.maximum[0]])for(const y of [row.minimum[1],row.maximum[1]])
    points.push([Math.cos(angle)*x-Math.sin(angle)*y,-Math.sin(angle)*x-Math.cos(angle)*y]);
  return [Math.min(...points.map(p=>p[0])),Math.max(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[1]))];
}
function source(sprite:number,edges:number[],position=[5,5]):FixtureRegistrationSource {
  return {count:1,positions:()=>new Float32Array(position),sprites:()=>new Uint32Array([sprite]),
    wallEdges:()=>new Uint32Array(edges),houseSize:()=>[0,0]};
}

it('binds placement bounds to the immutable published geometry and measured producer',()=>{
  expect(digest('assets/models/kitchen/export_wall_registration.py')).toBe(registration.producerSha256);
  for(const row of registration.fixtures)expect(digest(row.source)).toBe(row.sourceSha256);
});

it.each(registration.fixtures)('clears the real rear-wall solid for $sprite in all four facings',row=>{
  for(let facing=0;facing<4;facing++){
    const edges=[[0,5,5,0],[1,5,5,0],[0,6,5,0],[1,5,6,0]][facing];
    const shifts=fixtureRegistration(source(spriteIndex(row.sprite+facings[facing]),edges));
    const [xmin,xmax,ymin,ymax]=bounds(row,rotations[facing]);
    const [dx,dy]=shifts.offsets,inner=architecture.wallAndDoorDepth/2;
    const gap=[xmin+dx+.5-inner,ymin+dy+.5-inner,.5-inner-xmax-dx,.5-inner-ymax-dy][facing];
    expect(gap,row.sprite+' facing '+facing).toBeGreaterThanOrEqual(.00999);
    expect(shifts.infeasible[0]).toBe(0);
  }
});

it('clears both adjoining kitchen corner walls while preserving unsupported free-standing origins',()=>{
  const fixture=registration.fixtures.find(row=>row.sprite==='offlineFridge')!;
  const shifts=fixtureRegistration(source(spriteIndex('offlineFridgeSW'),[0,5,5,0,1,5,5,0]));
  const [xmin,,ymin]=bounds(fixture,0),inner=-.5+architecture.wallAndDoorDepth/2;
  expect(xmin+shifts.offsets[0]).toBeGreaterThan(inner);
  expect(ymin+shifts.offsets[1]).toBeGreaterThan(inner);
  expect([...fixtureRegistration(source(spriteIndex('offlineCounter'),[])).offsets]).toEqual([0,0]);
  expect([...fixtureRegistration(source(spriteIndex('offlineArmchair'),[0,5,5,0])).offsets]).toEqual([0,0]);
});

it('reports impossible opposite-wall geometry without refusing to load native state',()=>{
  const result=fixtureRegistration(source(spriteIndex('offlineCounterSW'),[0,5,5,0,0,6,5,0]));
  expect(result.infeasible[0]).toBe(1);
  expect([...result.offsets].every(Number.isFinite)).toBe(true);
});

it('keeps native placement previews on the resulting object origin and ignores doorway openings',()=>{
  const sprite=spriteIndex('offlineCounterSW'),mock=source(sprite,[1,5,5,0]);
  const preview={valid:true,reason:null,x:5,y:5,width:1,depth:1,sprite,foreground:null,facing:1};
  const old=new Float32Array(FLOATS_PER_INSTANCE*2),updated=new Float32Array(old.length);
  writePlacementPreview(old,0,preview,0,0,24,1,null);
  writePlacementPreview(updated,0,preview,0,0,24,1,null,null,0,undefined,mock);
  const [dx,dy]=fixtureRegistration(mock).offsets;
  expect(updated[FLOATS_PER_INSTANCE]-old[FLOATS_PER_INSTANCE]).toBeCloseTo(screenX(dx,dy,0),4);
  expect(updated[FLOATS_PER_INSTANCE+1]-old[FLOATS_PER_INSTANCE+1]).toBeCloseTo(screenY(dx,dy,0),4);
  // The floor marker in row 0 moves with the art.
  expect(updated[0]-old[0]).toBeCloseTo(screenX(dx,dy,0),4);
  expect(updated[1]-old[1]).toBeCloseTo(screenY(dx,dy,0),4);
  expect([...fixtureRegistration(source(sprite,[1,5,5,1])).offsets]).toEqual([0,0]);
  expect([...fixtureRegistration(source(sprite,[1,5,8,0])).offsets]).toEqual([0,0]);
});

it('moves furniture, every surface item, and grime through the identical physical translation',()=>{
  const zero=new Uint32Array([0]),position=new Float32Array([5,5]);
  const mock:RenderSource&Parameters<typeof buildGrimeInstances>[0]={
    count:1,positions:()=>position,prevPositions:()=>position,ids:()=>new Uint32Array([40]),
    sprites:()=>new Uint32Array([spriteIndex('offlineCounterSW')]),kinds:()=>new Uint32Array([1]),
    activities:()=>zero,visualActions:()=>zero,facings:()=>new Uint32Array([1]),
    carrying:()=>new Uint32Array([0xffffffff]),itemKinds:()=>[],
    footprintWidths:()=>new Uint32Array([1]),footprintDepths:()=>new Uint32Array([1]),
    dirtyDishes:()=>new Uint32Array([1]),mealPortions:()=>new Uint32Array([1]),
    floorGrime:()=>new Uint32Array(),surfaceGrime:()=>new Uint32Array([500]),binWaste:()=>zero,
    wallEdges:()=>new Uint32Array([1,5,5,0]),houseSize:()=>[0,0],
  };
  const free={...mock,wallEdges:()=>new Uint32Array()};
  const original=buildInstanceBatch(free,1,100,120,24),originalCount=original.count;
  const old=original.instances.slice(0,originalCount*FLOATS_PER_INSTANCE);
  const oldGrime=buildGrimeInstances(free,24,24,100,120,1,40000).instances.slice();
  const updated=buildInstanceBatch(mock,1,100,120,24),grime=buildGrimeInstances(mock,24,24,100,120,1,40000);
  expect(updated.count).toBe(originalCount);expect(updated.count).toBe(3);expect(grime.count).toBe(1);
  const [dx,dy]=fixtureRegistration(mock).offsets;
  for(let row=0;row<updated.count;row++){
    const at=row*FLOATS_PER_INSTANCE;
    expect(updated.instances[at]-old[at]).toBeCloseTo(screenX(dx,dy,0),4);
    expect(updated.instances[at+1]-old[at+1]).toBeCloseTo(screenY(dx,dy,0),4);
    expect(updated.instances[at+2]-old[at+2]).toBeCloseTo(layeredDepth(dx,dy,24,LAYER_PROP)-layeredDepth(0,0,24,LAYER_PROP),7);
  }
  expect(grime.instances[0]-oldGrime[0]).toBeCloseTo(screenX(dx,dy,0),4);
  expect(grime.instances[1]-oldGrime[1]).toBeCloseTo(screenY(dx,dy,0),4);
});

let memory:WebAssembly.Memory;
beforeAll(async()=>{memory=(await init({module_or_path:readFileSync('src/wasm/terri_wasm_bg.wasm')})).memory;});
it('registers the actual household without changing native state, contacts, or saves',()=>{
  const handle=SimHandle.from_lot(),sim=new SimBridge(handle,memory);
  try{
    const before=sim.saveBytes(),result=fixtureRegistration(sim),sprites=sim.sprites();
    let moved=0;
    for(let row=0;row<sim.count;row++)if(registration.fixtures.some(fixture=>['','SW','NW','NE'].some(suffix=>spriteIndex(fixture.sprite+suffix)===sprites[row]))){
      expect(result.infeasible[row]).toBe(0);
      if(result.offsets[row*2]||result.offsets[row*2+1])moved++;
    }
    expect(moved).toBeGreaterThan(0);
    expect(sim.saveBytes()).toEqual(before);
    expect(fixtureRegistration(sim)).toBe(result);
  }finally{handle.free();}
});
