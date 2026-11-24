import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {decodeGeometry,geometryBuffers,type Bundle,type Geometry,type MeshDescription} from '../src/render/character/bundle.js';
import {prepareClipFamily,type ClipLibrary,type ClipParts} from '../src/render/character/clip-runtime.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {configuredPoseForProof} from '../src/render/character/pose.js';
import {PoolCycleSource,validatePoolCycleDefinition} from '../src/render/character/pool-cycle-source.js';
import {poolContactFixture,poolContactRelease} from '../src/render/character/pool-contact-release.js';
import {interpolatePoolPoseProgram,poolSkinMatrices} from '../src/render/character/pool-contact-sample.js';
import {anatomicalHeight,shapeVertices} from '../src/render/character/shape.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {defaultAppearance} from '../src/character/schema.js';
import {characterActionPlan,type CharacterActionState} from '../src/render/character/action-plan.js';
import type {PoseDiagnostics} from '../src/render/character/contact-types.js';

const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('export/manifest.json',directory),'utf8')) as Bundle;
const library=JSON.parse(readFileSync(new URL('clips/clips.json',directory),'utf8')) as ClipLibrary;
const parts=JSON.parse(readFileSync(new URL('clips/pool/parts.json',directory),'utf8')) as ClipParts;
function load(description:MeshDescription,folder:string):Geometry {
  const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(folder+'/'+description[key],directory))).buffer]));
  return decodeGeometry({...manifest,runtime:description},'runtime',buffers as Record<typeof geometryBuffers[number],ArrayBuffer>);
}
const base=load(manifest.runtime,'export'),rig=prepareClipFamily(base,load(parts.geometry!,'clips/pool'),parts,library,'pool');
const context={wear:'bare' as const,prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter'};

it('selects activity garments from presentation and preserves current saved outfits and color groups',()=>{
  const appearance=defaultAppearance(),saved=structuredClone(appearance),prepared=new PreparedBody(base,appearance);
  const trunks=prepared.select(rig,appearance,{...context,swimwear:'trunks'});
  expect(trunks.extra!.description.parts.map(p=>p.name)).toEqual(expect.arrayContaining(['Creator pool trunks L','Creator pool trunks R','Creator pool trunks waist']));
  expect(trunks.extra!.description.parts.some(p=>p.name.includes('two_piece'))).toBe(false);
  appearance.presentation='feminine';appearance.colors.shirt=[143,35,69];
  const two=prepared.select(rig,appearance,{...context,swimwear:'two_piece'});
  expect(two.extra!.description.parts.some(p=>p.name.includes('trunks'))).toBe(false);
  expect(two.extra!.description.parts.map(p=>p.name)).toEqual(expect.arrayContaining(['Creator pool two_piece top','Creator pool two_piece waist']));
  for(const [selection,group] of [[trunks,3],[two,2]] as const)for(let i=14;i<selection.extra!.vertices.length;i+=16){
    expect(rig.manifest.materials[selection.extra!.vertices[i]].group).toBe(group);
  }
  expect({...appearance,presentation:saved.presentation,colors:saved.colors}).toEqual(saved);
  expect(prepared.select(rig,appearance,{...context,wear:'clothed',swimwear:'none',clip:'idle'}).extra).toBeNull();
});

it('fits all authored pool phases and fractional contacts for both presentations and body extremes',()=>{
  const failures:string[]=[];
  for(const presentation of ['masculine','feminine'] as const)for(const height of [0,50,100])for(const build of [0,100]){
    const appearance=defaultAppearance(presentation);appearance.body={height,build,shoulders:build,hips:build,torso:height};
    const shape={presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(base.vertices);
    for(const action of ['pool_enter','pool_paddle','pool_exit_0','pool_exit_5'])for(let frame=0;frame<rig.manifest.actions[action].length-.5;frame+=.5){
      const audit:PoseDiagnostics={contacts:[],assemblies:{}};
      try{
        const pose=configuredPoseForProof(rig.manifest,shape,action,frame,top,audit,base);
        if(pose.some(value=>!Number.isFinite(value))||audit.contacts.some(c=>c.error>.00001))throw new Error('invalid contact result');
      }catch(error){failures.push(`${presentation} height=${height} build=${build} ${action} frame=${frame}: ${String(error)}`);}
    }
  }
  expect(failures).toEqual([]);
},30000);

it('uses native progress for entry, reverse entry and the exact saved paddle exit origin',()=>{
  const state={action:23,activity:27,entity:1,facing:0,x:0,y:0,tick:100,reducedMotion:false,
    fixtureModel:'pool',wholeSeat:false,readingStage:0,carriedBook:false,carriedDishes:false,carriedDinner:false,
    shelfSlot:0,reachRemaining:0,reachTotal:0,progress:0,poolPhase:1,poolElapsed:7,poolExitOrigin:0} satisfies CharacterActionState;
  const count=(clip:string)=>rig.manifest.actions[clip].length;
  const entering=characterActionPlan(state,count)!;
  expect(entering).toEqual({clip:'pool_enter',sample:14,fixture:true});
  expect(characterActionPlan({...state,poolPhase:4},count)).toEqual(entering);
  expect(characterActionPlan({...state,poolPhase:3,poolElapsed:0,poolExitOrigin:17},count)).toEqual({clip:'pool_exit_5',sample:0,fixture:true});
  expect(library.clips.pool_enter.samples.at(-1)!.bones).toEqual(library.clips.pool_paddle.samples[0].bones);
  for(let origin=0;origin<12;origin++)expect(library.clips['pool_exit_'+origin].samples[0].bones).toEqual(library.clips.pool_paddle.samples[origin].bones);
});

it('contains the complete configured swimmer below the rim and keeps both feet below opaque water',()=>{
  const failures:string[]=[];
  const motion=poolContactRelease.motion;
  validatePoolCycleDefinition(motion);
  for(const presentation of ['masculine','feminine'] as const)for(const height of [0,100])for(const build of [0,100]){
    const appearance=defaultAppearance(presentation);appearance.body={height,build,shoulders:build,hips:build,torso:height};
    const shape={presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(base.vertices);
    const selection=new PreparedBody(base,appearance).select(rig,appearance,{...context,clip:'pool_paddle',swimwear:presentation==='feminine'?'two_piece':'trunks'});
    const source=new PoolCycleSource(rig.manifest,shape,top,[selection.body,selection.extra!],poolContactFixture(),motion);
    const count=rig.manifest.actions.pool_paddle.length;
    const poses=Array.from({length:count},(_,frame)=>source.paddle(frame/count));
    for(let frame=0;frame<count;frame+=.25){
      const key=Math.floor(frame),phase=frame/count;
      const {world}=interpolatePoolPoseProgram(rig.manifest,source.neutral.rest,source.neutral.inverse,
        poses[key],poses[(key+1)%count],frame-key,{action:'pool_paddle',phase});
      const pose=poolSkinMatrices(world,source.neutral.inverse);
      for(const geometry of [selection.body,selection.extra!]){
        const points=posedCageSurface(geometry,shapeVertices(geometry.cage,shape,top),pose);
        for(const part of geometry.description.parts)for(let at=part.start;at<part.start+part.count;at++){
          const vertex=geometry.indices[at]*3,x=points[vertex],y=points[vertex+1],z=points[vertex+2];
          if(z<.90&&(Math.abs(x)>.85||Math.abs(y)>.85||z<.06)||part.name.startsWith('Creator bare foot')&&z>.82){
            failures.push(`${presentation}/${height}/${build} frame=${frame} ${part.name}: ${x},${y},${z}`);break;
          }
        }
      }
    }
  }
  expect(failures.slice(0,20),`${failures.length} containment failures`).toEqual([]);
},30000);
