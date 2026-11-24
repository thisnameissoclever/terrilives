import {expect,it} from 'vitest';
import definition from '../../assets/models/sims/character-creator/pool_activity_motion_v14.json';
import {defaultAppearance} from '../src/character/schema.js';
import {poolV14Fixture} from './pool-v14-fixture.js';
import {interpolatePoolPoseProgram} from '../src/render/character/pool-contact-sample.js';
import {PoolCycleSource,validatePoolCycleDefinition} from '../src/render/character/pool-cycle-source.js';
import {poolSourcePolicy,poolSourceRecord} from '../src/render/character/pool-source-policy.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {poolBase,poolRig} from './pool-observer-fixture.js';

function attachedInterval(){
 const motion:unknown=definition;
 validatePoolCycleDefinition(motion);
 const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
 const selection=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,
  includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
 if(!selection.extra)throw new Error('Pool replay requires the selected swimwear.');
 const fixture=structuredClone(poolV14Fixture),bundle=poolRig.manifest,top=anatomicalHeight(poolBase.vertices);
 const source=new PoolCycleSource(bundle,shape,top,[selection.body,selection.extra],fixture,motion);
 const left=source.entry(.12),right=source.entry(.14),amount=.5,travel=.12+(.14-.12)*amount;
 const forward={action:'pool_enter',phase:travel},reverse={action:'pool_exit_1',phase:1-.9*travel};
 const evaluate=(location:typeof forward)=>interpolatePoolPoseProgram(bundle,source.neutral.rest,source.neutral.inverse,left,right,amount,location).world;
 expect(left.controls[2].state.attached).toBeDefined();
 expect(right.controls[2].state.attached).toBeDefined();
 return {fixture,forward,reverse,evaluate};
}

it('refuses a changed actual reverse rail region while the entry reference stays valid',()=>{
 const {fixture,forward,reverse,evaluate}=attachedInterval(),expected=evaluate(forward);
 expect(evaluate(reverse)).toEqual(expected);
 const saved=poolSourcePolicy(fixture,forward.action,forward.phase);
 const record=poolSourceRecord(fixture,reverse).limbs.handL;
 if(record.region?.kind!=='rail')throw new Error('The reverse control requires an actual rail region.');
 record.region.parameter=[1.25,record.region.parameter[1]];
 expect(poolSourcePolicy(fixture,forward.action,forward.phase)).toEqual(saved);
 expect(poolSourcePolicy(fixture,reverse.action,reverse.phase).handL.region).not.toEqual(saved.handL.region);
 expect(()=>evaluate(reverse)).toThrow('Pool rail goal differs from its actual observation source context.');
 expect(evaluate(forward)).toEqual(expected);
});

it('evaluates the current mutable entry fixture on repeated raw calls',()=>{
 const {fixture,forward,reverse,evaluate}=attachedInterval(),expected=evaluate(forward);
 const record=poolSourceRecord(fixture,forward).limbs.handL;
 if(record.region?.kind!=='rail')throw new Error('The raw control requires an actual rail region.');
 record.region.parameter=[1.25,record.region.parameter[1]];
 expect(()=>evaluate(forward)).toThrow('Pool rail goal differs from its actual observation source context.');
 expect(evaluate(reverse)).toEqual(expected);
});
