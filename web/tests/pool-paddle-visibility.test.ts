import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import type {Geometry} from '../src/render/character/bundle.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {interpolatePoolPoseProgram,poolSkinMatrices} from '../src/render/character/pool-contact-sample.js';
import {PoolCycleSource,validatePoolCycleDefinition} from '../src/render/character/pool-cycle-source.js';
import {configuredPoolChainReach} from '../src/render/character/pool-entry-domain.js';
import {parseOwnedPoolFixture} from '../src/render/character/pool-owned-fixture.js';
import {measureRawPoolPhysicalObservation} from '../src/render/character/pool-owned-compilation.js';
import type {PoolPoseProgram} from '../src/render/character/pool-pose-program.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {poolBase,poolRig} from './pool-observer-fixture.js';

const assets=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const read=(name:string)=>readFileSync(new URL(name,assets),'utf8');

function exposedArea(geometry:Geometry,points:Float32Array,name:string,water:number):number {
  const part=geometry.description.parts.find(part=>part.name===name);
  if(!part)throw new Error('Missing swim surface '+name);
  let total=0,exposed=0;
  for(let i=part.start;i<part.start+part.count;i+=3){
    const a=3*geometry.indices[i],b=3*geometry.indices[i+1],c=3*geometry.indices[i+2];
    const bx=points[b]-points[a],by=points[b+1]-points[a+1],bz=points[b+2]-points[a+2];
    const cx=points[c]-points[a],cy=points[c+1]-points[a+1],cz=points[c+2]-points[a+2];
    const area=Math.hypot(by*cz-bz*cy,bz*cx-bx*cz,bx*cy-by*cx)/2;
    const [lo,mid,hi]=[points[a+2]-water,points[b+2]-water,points[c+2]-water].sort((u,v)=>u-v);
    let fraction=0;
    if(lo>=0)fraction=1;
    else if(hi>0){
      // The water clips a corner triangle; its two edge fractions multiply to its area fraction.
      fraction=mid<=0?hi/(hi-mid)*hi/(hi-lo):1-lo/(lo-mid)*lo/(lo-hi);
    }
    total+=area;
    exposed+=area*fraction;
  }
  if(!(total>0))throw new Error('Empty swim surface '+name);
  return exposed/total;
}

const profiles=[
  ['default masculine','masculine',50,50],
  ['default feminine','feminine',50,50],
  ['short slim feminine','feminine',0,0],
  ['tall broad feminine','feminine',100,100],
  ['short broad masculine','masculine',0,100],
  ['tall slim masculine','masculine',100,0],
] as const;

it.each(profiles)('shows the shaped chest and working arms through the swimming loop and exits for %s',(_profile,presentation,height,width)=>{
  const fixture=parseOwnedPoolFixture(read('clips/pool/contacts-v5.json'));
  const motion:unknown=JSON.parse(read('pool_activity_motion_v16.json'));
  validatePoolCycleDefinition(motion);
  const appearance=defaultAppearance(presentation),bundle=poolRig.manifest;
  appearance.body={height,build:width,shoulders:width,hips:width,torso:width};
  const selection=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',
    fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:presentation==='masculine'?'trunks':'two_piece'});
  if(!selection.extra)throw new Error('Pool requires selected swimwear.');
  const source=new PoolCycleSource(bundle,{presentation:appearance.presentation,...appearance.body,face:appearance.face},
    anatomicalHeight(poolBase.vertices),[selection.body,selection.extra],fixture,motion);
  const corridor=source.entry(.94),common=source.entry(1);
  expect(source.entry(.94)).toBe(corridor);
  expect(common).not.toBe(corridor);
  expect(source.paddle(0)).toBe(common);
  expect(source.paddle(1)).toBe(common);
  for(const t of [0,.25,.5,.75,1]){
    const location={action:'pool_enter',phase:.94+.06*t};
    expect(measureRawPoolPhysicalObservation(source,corridor,common,t,location).passed).toBe(true);
    const {rest,inverse}=source.neutral;
    const pose=interpolatePoolPoseProgram(bundle,rest,inverse,corridor,common,t,location);
    const points=posedCageSurface(selection.body,source.cages[0],poolSkinMatrices(pose.world,inverse));
    const airway=selection.body.description.parts.filter(p=>/nose|smile/i.test(p.name));
    expect(airway.length).toBeGreaterThan(0);
    for(const part of airway){
      let minimum=Infinity;
      for(let i=part.start;i<part.start+part.count;i++)minimum=Math.min(minimum,points[3*selection.body.indices[i]+2]);
      expect(minimum).toBeGreaterThanOrEqual(fixture.waterHeight);
    }
  }
  const check=(action:string,phase:number,left:PoolPoseProgram,right:PoolPoseProgram,t:number)=>{
    const {rest,inverse}=source.neutral;
    const replay=interpolatePoolPoseProgram(bundle,rest,inverse,left,right,t,{action,phase});
    const skin=poolSkinMatrices(replay.world,inverse),body=selection.body;
    const points=posedCageSurface(body,source.cages[0],skin);
    const exposed=(part:string)=>exposedArea(body,points,part,fixture.waterHeight);
    const torso=exposed('Creator bare torso');
    expect(torso).toBeGreaterThanOrEqual(.22);
    expect(torso).toBeLessThanOrEqual(.8);
    for(const [side,suffix] of [['L',''],['R','.001']]){
      expect(exposed('Creator upper arm skin '+side)).toBeGreaterThanOrEqual(.2);
      expect(exposed('Forearm with elbow and wrist sections'+suffix)).toBeGreaterThanOrEqual(.06);
    }
    return (['handL','handR'] as const).map((limb,i)=>({
      exposed:exposed(i===0?'Relaxed palm':'Relaxed palm.001'),
      travel:replay.world[source.anatomy[limb].end][13],
    }));
  };
  const stroke=Array.from({length:13},(_,i)=>source.paddle(i/12));
  const palms:{exposed:number;travel:number}[][]=[[],[]];
  for(let i=0;i<12;i++)for(const t of [0,.25,.5,.75,1]){
    const areas=check('pool_paddle',(i+t)/12,stroke[i],stroke[i+1],t);
    areas.forEach((value,side)=>{
      const previous=palms[side].at(-1),direction=(side===0?1:-1)*(i<6?1:-1);
      if(previous)expect(direction*(value.travel-previous.travel)).toBeGreaterThanOrEqual(-1e-9);
      palms[side].push(value);
    });
    check('pool_exit_'+i,.1*t,stroke[i],common,t);
  }
  for(const [i,limb] of (['handL','handR'] as const).entries()){
    const a=source.anatomy[limb],reach=configuredPoolChainReach(source.neutral.rest,a.upper,a.lower,a.end);
    const exposed=palms[i].map(p=>p.exposed),travel=palms[i].map(p=>p.travel);
    expect(Math.max(...exposed)-Math.min(...exposed)).toBeGreaterThanOrEqual(.2);
    expect(Math.max(...travel)-Math.min(...travel)).toBeGreaterThanOrEqual(.25*reach.maximum);
  }
},90_000);
