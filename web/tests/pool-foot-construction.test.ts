import {expect,it} from 'vitest';
import {identity} from '../src/render/character/math.js';
import {preparePoolFootContactFrame} from '../src/render/character/pool-foot-contact-frame.js';
import {solveCertifiedPoolFoot,requirePoolFootConstruction} from '../src/render/character/pool-limb-construction-arithmetic.js';
import {poolFootConstructionFixture} from './pool-foot-construction-fixture.js';

it('checks actual fixed-hierarchy IK against its declared exact contact frame and operation trace',()=>{
  const {geometry,cage,patch,fixture,support,pose}=poolFootConstructionFixture();
  const frame=preparePoolFootContactFrame(fixture,support,geometry,cage,pose.inverse[3],patch,identity(),[.5,.25]);
  solveCertifiedPoolFoot(pose,1,2,3,frame,[0,0,1]);
  const proof=requirePoolFootConstruction(frame,pose);
  for(let axis=0;axis<3;axis++)expect(Math.abs(pose.world[3][12+axis]-frame.translation[axis])).toBeLessThanOrEqual(proof.worldError[12+axis]);
  expect(proof.worldError.every(value=>Number.isFinite(value)&&value>=0)).toBe(true);
  pose.world[3][14]-=.001;expect(()=>requirePoolFootConstruction(frame,pose)).toThrow('matching');
});

it('exposes immutable arithmetic bounds without the private hierarchy snapshots',()=>{
  const {geometry,cage,patch,fixture,support,pose}=poolFootConstructionFixture();
  const frame=preparePoolFootContactFrame(fixture,support,geometry,cage,pose.inverse[3],patch,identity(),[.5,.25]);
  solveCertifiedPoolFoot(pose,1,2,3,frame,[0,0,1]);const proof=requirePoolFootConstruction(frame,pose);
  expect(()=>{(proof.worldError as number[])[0]=1;}).toThrow();
  expect('ancestors' in proof).toBe(false);expect('pose' in proof).toBe(false);expect(Object.isFrozen(proof.basisError)).toBe(true);
});
