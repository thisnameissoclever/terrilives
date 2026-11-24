import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {defaultAppearance,validateAppearance} from '../src/character/schema.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {interpolatePoolPoseProgram,poolSkinMatrices} from '../src/render/character/pool-contact-sample.js';
import {PoolCycleSource,validatePoolCycleDefinition} from '../src/render/character/pool-cycle-source.js';
import {observePoolSource} from '../src/render/character/pool-observer.js';
import {parseOwnedPoolFixture} from '../src/render/character/pool-owned-fixture.js';
import type {PoolPoseProgram} from '../src/render/character/pool-pose-program.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {poolBase,poolRig} from './pool-observer-fixture.js';

const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const read=(file:string)=>readFileSync(new URL(file,directory));
const motionV14=read('pool_activity_motion_v14.json'),motionV15=read('pool_activity_motion_v15.json');
const contactsV3=read('clips/pool/contacts-v3.json'),contactsV4=read('clips/pool/contacts-v4.json');
const sha256=(data:Buffer)=>createHash('sha256').update(data).digest('hex');

it('binds the experimental stroke to the existing physical fixture and source clock',()=>{
 const oldDigest=sha256(motionV14),digest=sha256(motionV15);
 expect(contactsV4.equals(Buffer.from(contactsV3.toString().replace(
  '"poseProducer":"'+oldDigest+'"','"poseProducer":"'+digest+'"')))).toBe(true);
 const previous=JSON.parse(motionV14.toString()),candidate=JSON.parse(motionV15.toString());
 const {waterStroke,groundGrip,crestFit,...unchanged}=candidate;
 expect({...unchanged,version:14}).toEqual(previous);
 expect(()=>validatePoolCycleDefinition(candidate)).not.toThrow();
 expect(()=>validatePoolCycleDefinition(unchanged)).toThrow('v15 water stroke is invalid');
 expect(()=>validatePoolCycleDefinition({...previous,waterStroke})).toThrow('cannot author a water stroke');
});

it('constructs and physically observes the short broad body through the shared swim join and stroke',()=>{
 const previous:unknown=JSON.parse(motionV14.toString()),candidate:unknown=JSON.parse(motionV15.toString());
 validatePoolCycleDefinition(previous);validatePoolCycleDefinition(candidate);
 const base=defaultAppearance('masculine');
 const appearance=validateAppearance({...base,body:{height:0,build:100,shoulders:100,hips:100,torso:100}});
 const shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
 const selection=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',
  eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'trunks'});
 if(!selection.extra)throw new Error('Pool stroke needs the selected swimwear');
 const bundle=poolRig.manifest,geometry=[selection.body,selection.extra],top=anatomicalHeight(poolBase.vertices);
 const before=new PoolCycleSource(bundle,shape,top,geometry,parseOwnedPoolFixture(contactsV3.toString()),previous);
 const fixture=parseOwnedPoolFixture(contactsV4.toString());
 const after=new PoolCycleSource(bundle,shape,top,geometry,fixture,candidate);
 expect(()=>before.entry(1)).toThrow('Pool authored source exceeds actual footR reach at 1');
 const approach=after.entry(.94),join=after.entry(1);
 expect(approach).toEqual(before.entry(.94));
 expect(after.paddle(0)).toBe(join);
 expect(after.paddle(1)).toBe(join);
 const failures:unknown[]=[];
 const inspect=(action:'pool_enter'|'pool_paddle',start:number,end:number,left:PoolPoseProgram,right:PoolPoseProgram,fractions:number[])=>{
  for(const fraction of fractions){
   const phase=fraction===0?start:fraction===1?end:start+(end-start)*fraction;
   const location={action,phase};
   try{
    const pose=interpolatePoolPoseProgram(bundle,after.neutral.rest,after.neutral.inverse,left,right,fraction,location);
    const skin=poolSkinMatrices(pose.world,after.neutral.inverse);
    const surfaces=geometry.map((g,index)=>({geometry:g,points:posedCageSurface(g,after.cages[index],skin)}));
    const observation=observePoolSource(fixture,surfaces,location);
    const airway=observation.parts.filter(p=>/nose|smile/i.test(p.name));
    const airwayMinimum=airway.length?Math.min(...airway.map(p=>p.minimum[2])):null;
    if(observation.violations.length||(action==='pool_paddle'||phase===1)&&(airwayMinimum===null||airwayMinimum<fixture.waterHeight))
     failures.push({...location,airwayMinimum,violations:observation.violations});
   }catch(error){failures.push({...location,error:String(error)});}
  }
 };
 inspect('pool_enter',.94,1,approach,join,[0,.25,.5,.75,1]);
 const stroke=Array.from({length:13},(_,index)=>after.paddle(index/12));
 for(let i=0;i<12;i++)inspect('pool_paddle',i/12,(i+1)/12,stroke[i],stroke[i+1],[0,.25,.5,.75]);
 expect(failures).toEqual([]);
},90_000);
