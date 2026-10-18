import {readFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import init,{SimHandle} from '../src/wasm/terri_wasm.js';
import {SimBridge} from '../src/bridge.js';
import {buildInstanceBatch} from '../src/frame.js';
import {CharacterScenePlan} from '../src/render/character/scene-plan.js';
import {spriteIndex} from '../src/render/atlas.js';
import {FLOATS_PER_INSTANCE} from '../src/render/instances.js';
import {FLOOR_DEPTH,LAYER_PROP,layeredDepth,screenX,screenY} from '../src/render/iso.js';
import {GROUND_MARKER_COMMAND,MAX_GROUND_MARKERS,groundMarkerRows} from '../src/render/ground-selection.js';

let memory:WebAssembly.Memory;
beforeAll(async()=>{memory=(await init({module_or_path:readFileSync('src/wasm/terri_wasm_bg.wasm')})).memory;});

function marker(data:Float32Array,count:number):Float32Array {
  const sprite=spriteIndex('selectionRing');
  for(let i=0;i<count;i++)if(data[i*FLOATS_PER_INSTANCE+3]===sprite)return data.slice(i*FLOATS_PER_INSTANCE,i*FLOATS_PER_INSTANCE+4);
  throw new Error('The selected person has no floor indicator.');
}

it('keeps ring sprites without the marker command, such as the tile highlight, out of the floor-marker draw',()=>{
  const data=new Float32Array(FLOATS_PER_INSTANCE*3),rows=new Int32Array(MAX_GROUND_MARKERS);
  for(let row=0;row<3;row++)data[row*FLOATS_PER_INSTANCE+3]=spriteIndex('selectionRing');
  expect(groundMarkerRows(data,3,rows)).toBe(0);
  data[FLOATS_PER_INSTANCE+8]=GROUND_MARKER_COMMAND;
  expect(groundMarkerRows(data,3,rows)).toBe(1);
  expect(rows[0]).toBe(1);
  expect(groundMarkerRows(data,1,rows)).toBe(0);
});

it.each([.13,.185,.568,1.1])('keeps the indicator on the ground beneath a pose with feet at height %s',height=>{
  const handle=SimHandle.from_lot(),sim=new SimBridge(handle,memory);
  try{
    const person=sim.characterAppearances().find(row=>row.sim===1)!;
    const row=Array.from(sim.ids()).indexOf(person.entity);
    const dynamic=new CharacterScenePlan(()=>4,()=>{
      dynamic.actors.find(actor=>actor.entity===person.entity)!.feet=[5,6,height];
    });
    dynamic.sync(sim);
    const batch=buildInstanceBatch(sim,1,100,120,24,row,2,false,sim.clockTick(),null,undefined,null,null,0,undefined,dynamic);
    const ring=marker(batch.instances,batch.count);
    expect(ring[0]).toBe(screenX(5,6,100,2));
    expect(ring[1]).toBe(screenY(5,6,120,2));
    expect(ring[2]).toBeGreaterThan(layeredDepth(-100,-100,24,LAYER_PROP));
    expect(ring[2]).toBeLessThan(FLOOR_DEPTH);
  }finally{handle.free();}
});

it('keeps the legacy sleeping indicator behind furniture instead of over the blanket',()=>{
  const handle=SimHandle.from_lot(),sim=new SimBridge(handle,memory);
  try{
    const person=sim.characterAppearances().find(row=>row.sim===1)!;
    const bed=Array.from(sim.ids()).find(id=>sim.objectModel(id)?.id==='double_bed')!;
    expect(sim.useObjectFirst(person.entity,bed,0)).toBe(true);sim.flushCommands();
    const row=Array.from(sim.ids()).indexOf(person.entity);
    for(let tick=0;tick<650&&sim.visualActions()[row]!==9;tick++)sim.tick();
    expect(sim.visualActions()[row]).toBe(9);
    const batch=buildInstanceBatch(sim,1,100,120,24,row,2,false,sim.clockTick());
    const ring=marker(batch.instances,batch.count);
    expect(ring[2]).toBeGreaterThan(layeredDepth(-100,-100,24,LAYER_PROP));
    expect(ring[2]).toBeLessThan(FLOOR_DEPTH);
  }finally{handle.free();}
});
