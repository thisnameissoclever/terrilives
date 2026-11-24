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

it('examines the actual feasible downward-outward ray with independent legitimate knee choices',()=>{
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(poolBase.vertices);
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const compiler=new PoolEntryCompiler(poolRig.manifest,shape,top,[selected.body,selected.extra!],poolFixture),request=poolEntrySearchPlan(.2)[4],domain=compiler.prepareLegDomain(.2,request);
  const intervals=poolRootRayIntervals(request.direction,domain.constraints);expect(intervals).toHaveLength(1);
  expect(intervals[0].maximum).toBeCloseTo(.5536477693110093,12);
  const started=performance.now(),records=[];
  for(const bend of [0,.5])for(let step=1;step<16;step++){
    const fraction=step/16,amount=intervals[0].minimum+(intervals[0].maximum-intervals[0].minimum)*fraction,root=scale(request.direction,amount);
    const {pose,knees,legObservation}=compiler.evaluateLegDomain(domain,root,{...request,kneeL:bend,kneeR:bend});
    records.push({fraction,amount,root,bend,knees,basis:pose.basis,rest:pose.rest,legObservation});
  }
  if(process.env.POOL_RAY_OUTPUT)writeFileSync(process.env.POOL_RAY_OUTPUT,JSON.stringify({scope:'Thirty finite leg-only observations on one actual reach ray. No hand, full-body, support or trajectory admission.',appearance,request,constraints:domain.constraints,
    feet:domain.footContacts.map(contact=>({limb:contact.limb,frame:contact.frame,patch:contact.patch.sourceTriangles})),intervals,elapsedMs:performance.now()-started,records},null,2));
  expect(records.some(record=>record.legObservation&&record.legObservation.violations.length===0),JSON.stringify(records.map(record=>({fraction:record.fraction,bend:record.bend,knees:record.knees.map(knee=>knee.admissible),
    violations:record.legObservation?.violations.map(v=>[v.part,v.surface,v.signedClearance])})),null,2)).toBe(true);
},60000);
