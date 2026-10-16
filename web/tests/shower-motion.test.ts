import {readFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import init,{SimHandle} from '../src/wasm/terri_wasm.js';
import {SimBridge} from '../src/bridge.js';
import {decodeGeometry,geometryBuffers,type Bundle,type Geometry,type MeshDescription} from '../src/render/character/bundle.js';
import {combineClipFamily,type ClipLibrary,type ClipParts} from '../src/render/character/clip-runtime.js';
import {configuredPoseForProof} from '../src/render/character/pose.js';
import {anatomicalHeight,shapePoint,shapeVertices} from '../src/render/character/shape.js';
import {length,sub,transform} from '../src/render/character/math.js';
import {showerSteamEnvelopes,showerSteamCabin} from '../src/render/character/steam-envelope.js';
import {queryConfiguredSurface} from '../src/render/character/surface-query.js';
import {SupportSurface} from '../src/render/character/support-surface.js';
import {configuredJointSetup} from '../src/render/character/pose-joints.js';
import {multiply} from '../src/render/character/math.js';
import type {Vec3} from '../src/render/character/math.js';

let memory:WebAssembly.Memory;
beforeAll(async()=>{memory=(await init({module_or_path:readFileSync('src/wasm/terri_wasm_bg.wasm')})).memory;});

it('gives an ordinary shower enough active time to show repeated washing movements',()=>{
  const handle=SimHandle.from_lot(),sim=new SimBridge(handle,memory);
  try{
    const person=sim.characterAppearances().find(row=>row.sim===1)!;
    const fixture=Array.from(sim.ids()).find(id=>sim.objectModel(id)?.id==='shower')!;
    expect(sim.useObjectFirst(person.entity,fixture,0)).toBe(true);sim.flushCommands();
    const row=Array.from(sim.ids()).indexOf(person.entity);
    for(let tick=0;tick<650&&sim.activities()[row]!==12;tick++)sim.tick();
    expect(sim.activities()[row]).toBe(12);
    let activeTicks=0;
    while(sim.activities()[row]===12&&activeTicks<200){activeTicks++;sim.tick();}
    expect(activeTicks).toBeGreaterThanOrEqual(53);
    expect(activeTicks).toBeLessThanOrEqual(126);
  }finally{handle.free();}
});

function showerGeometry(){
  const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL('export/manifest.json',directory),'utf8')) as Bundle;
  const library=JSON.parse(readFileSync(new URL('clips/clips.json',directory),'utf8')) as ClipLibrary;
  const read=(description:MeshDescription,folder:string):Geometry=>decodeGeometry({...manifest,runtime:description},'runtime',
    Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(folder+'/'+description[key],directory))).buffer])) as Record<typeof geometryBuffers[number],ArrayBuffer>);
  const parts=JSON.parse(readFileSync(new URL('clips/shower/parts.json',directory),'utf8')) as ClipParts;
  return {geometry:combineClipFamily(read(manifest.runtime,'export'),read(parts.geometry!,'clips/shower'),parts,library,'shower'),library};
}

it('moves both configured wrists visibly during a quarter of the shower cycle',()=>{
  const {geometry,library}=showerGeometry();
  const appearance={presentation:'masculine' as const,height:50,build:50},top=anatomicalHeight(geometry.vertices);
  const a=configuredPoseForProof(geometry.manifest,appearance,'shower',0,top,undefined,geometry);
  const b=configuredPoseForProof(geometry.manifest,appearance,'shower',library.clips.shower.samples.length/4,top,undefined,geometry);
  for(const side of ['L','R']){
    const index=geometry.manifest.bones.findIndex(bone=>bone.name==='hand.'+side),bone=geometry.manifest.bones[index];
    const rest=shapePoint(bone.head,4,appearance,top);
    const left=transform(a.subarray(index*16,index*16+16),rest),right=transform(b.subarray(index*16,index*16+16),rest);
    expect(length(sub(left,right)),side+' wrist movement in world units').toBeGreaterThan(.10);
  }
});

it('keeps active shower timing and the subsequent simulation identical after saving and reloading',()=>{
  const first=SimHandle.from_lot(),second=SimHandle.from_lot(),a=new SimBridge(first,memory),b=new SimBridge(second,memory);
  try{
    const person=a.characterAppearances().find(row=>row.sim===1)!,fixture=Array.from(a.ids()).find(id=>a.objectModel(id)?.id==='shower')!;
    expect(a.useObjectFirst(person.entity,fixture,0)).toBe(true);a.flushCommands();
    const row=Array.from(a.ids()).indexOf(person.entity);
    for(let tick=0;tick<650&&a.activities()[row]!==12;tick++)a.tick();
    expect(a.activities()[row]).toBe(12);
    for(let tick=0;tick<17;tick++)a.tick();
    expect(a.activities()[row]).toBe(12);
    const bytes=a.saveBytes();expect(b.loadBytes(bytes)).toBe(true);expect(b.saveBytes()).toEqual(bytes);
    for(let tick=0;tick<160;tick++){expect(b.worldHash()).toBe(a.worldHash());expect(b.activities()[row]).toBe(a.activities()[row]);a.tick();b.tick();}
  }finally{first.free();second.free();}
});

it('tracks finite chest and pelvis steam volumes for every height/build combination, gender, facing, and quarter-cycle',()=>{
  const {geometry,library}=showerGeometry(),top=anatomicalHeight(geometry.vertices);
  for(const presentation of ['masculine','feminine'] as const)for(const height of [0,50,100])for(const build of [0,50,100]){
    const shape={presentation,height,build},shaped=shapeVertices(geometry.cage,shape,top);
    for(const sample of [0,4,8,12]){
      const matrices=configuredPoseForProof(geometry.manifest,shape,'shower',sample,top,undefined,geometry);
      expect([...matrices].every(Number.isFinite)).toBe(true);
      expect(showerSteamCabin(geometry,matrices)[0]).toBeCloseTo(-.3825,5);
      expect(showerSteamCabin(geometry,matrices)[1]).toBeCloseTo(.3825,5);
      for(const side of ['L','R']){
        const index=geometry.manifest.bones.findIndex(bone=>bone.name==='foot.'+side),bone=geometry.manifest.bones[index];
        const foot=transform(matrices.subarray(index*16,index*16+16),shapePoint(bone.head,6,shape,top));
        expect(foot[2]).toBeCloseTo(.185,5);
      }
      for(const facing of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
        const clouds=showerSteamEnvelopes(geometry,shaped,matrices,facing,[0,0,0]);
        expect(clouds).toHaveLength(2);
        for(const cloud of clouds){expect([...cloud.centre,...cloud.radii].every(Number.isFinite)).toBe(true);expect(cloud.radii.every(n=>n>.07&&n<.75)).toBe(true);}
        expect(clouds[0].centre[2]).toBeGreaterThan(clouds[1].centre[2]+.15);
        expect(clouds[1].centre[2]).toBeGreaterThan(.45);
      }
    }
    expect(library.clips.shower.samples).toHaveLength(16);
  }
});

it('keeps the fixed shower head outside the actual configured head and hair surfaces',()=>{
  const {geometry}=showerGeometry(),top=anatomicalHeight(geometry.vertices);
  for(const presentation of ['masculine','feminine'] as const)for(const height of [0,100])for(const build of [0,100])for(const sample of [0,4,8,12]){
    const shape={presentation,height,build},skin=configuredPoseForProof(geometry.manifest,shape,'shower',sample,top,undefined,geometry);
    const {rest,inverse}=configuredJointSetup(geometry.manifest,shape,'shower',sample,top);
    const world=rest.map((m,i)=>multiply(skin.subarray(i*16,i*16+16),m));
    const headParts=geometry.description.parts.filter(p=>p.region===1||p.name===(presentation==='feminine'?'PROOF_BOB':'HAIR_01_TRIPO_CURL'));
    const head=queryConfiguredSurface(geometry,headParts,shape,top,world,inverse),points:Vec3[]=[],triangles:[number,number,number][]=[],ids=new Map<number,number>();
    for(const part of headParts)for(let at=part.start;at<part.start+part.count;at+=3){
      const triangle:[number,number,number]=[0,0,0];
      for(let corner=0;corner<3;corner++){
        const id=geometry.indices[at+corner];let compact=ids.get(id);
        if(compact===undefined){compact=points.length;ids.set(id,compact);points.push([head[id*3],head[id*3+2],head[id*3+1]]);}
        triangle[corner]=compact;
      }
      triangles.push(triangle);
    }
    const surface=new SupportSurface(points,triangles);
    const hardwareParts=geometry.description.parts.filter(p=>['Creator clip shower Shower head','Creator clip shower Shower nozzle face'].includes(p.name));
    const hardware=queryConfiguredSurface(geometry,hardwareParts,shape,top,world,inverse);
    for(const part of hardwareParts)for(let at=part.start;at<part.start+part.count;at++){
      const id=geometry.indices[at],x=hardware[id*3],y=hardware[id*3+1],z=hardware[id*3+2];
      const low=surface.height(x,z,'bottom'),high=surface.height(x,z,'top');
      if(low!==undefined&&high!==undefined)expect(y<low-.001||y>high+.001,JSON.stringify({presentation,height,build,sample,hardware:[x,y,z],head:[low,high]})).toBe(true);
    }
  }
});
