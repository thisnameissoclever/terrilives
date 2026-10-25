import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {configuredJointSetup} from '../src/render/character/pose-joints.js';
import {anatomicalHeight,shapePoint} from '../src/render/character/shape.js';
import {add,inverseAffine,length,multiply,sub,transform,type Vec3} from '../src/render/character/math.js';
import {poolBase,poolFixture,poolRig} from './pool-observer-fixture.js';

it('rejects the old free-hand world pin as an over-folded configured arm',()=>{
  const failures:{presentation:string;frame:number;side:string;distance:number;minimum:number}[]=[];
  for(const presentation of ['masculine','feminine'] as const){
    const appearance=defaultAppearance(presentation);appearance.body={height:100,build:100,shoulders:100,hips:100,torso:100};
    const shape={presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(poolBase.vertices),bones=poolRig.manifest.bones;
    const index=(name:string)=>bones.findIndex(bone=>bone.name===name),hip=index('hips'),point=(matrix:readonly number[]):Vec3=>[matrix[12],matrix[13],matrix[14]];
    for(let frame=0;frame<12;frame++){
      const setup=configuredJointSetup(poolRig.manifest,shape,'pool_paddle',frame,top),shift=sub(point(setup.source[hip]),point(setup.matrices[hip]));
      for(const side of ['L','R']){
        const upper=index('upper_arm.'+side),lower=index('forearm.'+side),hand=index('hand.'+side),reference:Vec3=[side==='L'?-.303:.303,-.075,.737];
        const fixedContact=transform(multiply(setup.source[hand],bones[hand].inverseRest),reference);
        const local=transform(inverseAffine(setup.rest[hand]),shapePoint(reference,4,shape,top));
        const wrist=sub(fixedContact,sub(transform(setup.source[hand],local),point(setup.source[hand])));
        const distance=length(sub(wrist,add(point(setup.matrices[upper]),shift)));
        const segment=(at:number)=>length(sub(shapePoint(bones[at].tail,4,shape,top),shapePoint(bones[at].head,4,shape,top)));
        const minimum=Math.abs(segment(upper)-segment(lower));
        if(distance<=minimum)failures.push({presentation,frame,side,distance,minimum});
      }
    }
  }
  expect(failures.length).toBeGreaterThan(0);
  for(const sample of poolFixture.clips.pool_paddle.samples)for(const limb of Object.values(sample.limbs))expect(limb.mode).toBe('free');
});
