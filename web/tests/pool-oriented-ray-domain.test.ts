import {writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {poolEntrySearchPlan} from '../src/render/character/pool-entry-search-plan.js';
import {poolRootRayIntervals} from '../src/render/character/pool-entry-domain.js';
import {scale} from '../src/render/character/math.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';

it('observes the unchanged leg and tread geometry across the real oriented ray domain',()=>{
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const requestId=Number(process.env.POOL_ORIENTED_RAY_REQUEST??4);if(![4,5,6,7].includes(requestId))throw new Error('Ray diagnostic requires a declared downward-outward contact profile.');
  const compiler=new PoolEntryCompiler(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),[selected.body,selected.extra!],poolFixture),request=poolEntrySearchPlan(.2)[requestId],domain=compiler.prepareLegDomain(.2,request);
  const intervals=poolRootRayIntervals(request.direction,domain.constraints);expect(intervals).toHaveLength(1);const interval=intervals[0],records=[];
  for(let step=1;step<16;step++){
    const fraction=step/16,amount=interval.minimum+(interval.maximum-interval.minimum)*fraction,root=scale(request.direction,amount);
    try{
      const result=compiler.evaluateLegDomain(domain,root,request);
      records.push({fraction,amount,root,knees:result.knees,basis:result.pose.basis,rest:result.pose.rest,legObservation:result.legObservation});
    }catch(error){records.push({fraction,amount,root,error:error instanceof Error?error.message:String(error)});}
  }
  if(process.env.POOL_ORIENTED_RAY_OUTPUT)writeFileSync(process.env.POOL_ORIENTED_RAY_OUTPUT,JSON.stringify({scope:'Fifteen finite leg-only observations on the actual oriented root ray. No hand closure, full-node, support or artifact admission.',appearance,request,intervals,constraints:domain.constraints,
    feet:domain.footContacts.map(contact=>({limb:contact.limb,frame:contact.frame,patch:contact.patch.sourceTriangles})),records},null,2));
  expect(records.some(record=>record.legObservation?.violations.length===0),JSON.stringify(records.map(record=>({fraction:record.fraction,error:record.error,violations:record.legObservation?.violations.map(violation=>[violation.part,violation.surface,violation.signedClearance])})))).toBe(true);
},30000);
