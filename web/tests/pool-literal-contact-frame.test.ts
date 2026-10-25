import {expect,it} from 'vitest';
import literal from './pool-contact-frame-literal.json';
import type {CharacterAppearanceV1} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight,shapeVertices} from '../src/render/character/shape.js';
import {preparePoolEntryAnatomy,poolSurfacePoint} from '../src/render/character/pool-entry-anatomy.js';
import {preparePoolFootContactFrame} from '../src/render/character/pool-foot-contact-frame.js';
import {properPoolRotation,configuredPoolRestSetup} from '../src/render/character/pool-canonical-pose.js';
import {inverseAffine,multiply,scale,sub,type Vec3} from '../src/render/character/math.js';
import {composeSkeletonPose} from '../src/render/character/pose-joints.js';
import {solveCertifiedPoolFoot} from '../src/render/character/pool-limb-construction-arithmetic.js';
import {poolBase,poolFixture,poolRig} from './pool-observer-fixture.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {observePool} from '../src/render/character/pool-observer.js';
import {derivePoolSupportArithmetic,poolViolationsBeyondArithmetic} from '../src/render/character/pool-support-arithmetic.js';
import {observePoolPatchSupport} from '../src/render/character/pool-support-observer.js';
import {registerPoolRootTravel} from '../src/render/character/pool-matrix-producer.js';

it('constructs actual unchanged foot-patch contacts for the retained literal phase .6 candidate',()=>{
  const appearance=literal.appearance as CharacterAppearanceV1,shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(poolBase.vertices);
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const geometry=selected.body,cage=shapeVertices(geometry.cage,shape,top),anatomy=preparePoolEntryAnatomy(geometry,shape,top);
  const bundle=poolRig.manifest,{rest,inverse}=configuredPoolRestSetup(bundle,shape,top),basis=literal.basis.map(properPoolRotation);
  basis[0].splice(12,3,...literal.basis[0].slice(12,15));
  registerPoolRootTravel(basis[0]);
  expect(rest.every((matrix,bone)=>matrix.every((value,index)=>value===literal.rest[bone][index]))).toBe(true);
  const pose={bundle,rest,inverse,basis,world:composeSkeletonPose(bundle.bones,rest,basis)};
  const contacts=[];
  for(const limb of ['footL','footR'] as const){
    const saved=literal.contacts.find(contact=>contact.limb===limb)!,part=anatomy[limb],patch=limb==='footL'?part.back!:part.front!,orientation=properPoolRotation(rest[part.end]);
    const rotation=[...orientation];rotation.splice(12,3,0,0,0);
    const target=scale(sub(saved.target as unknown as Vec3,poolSurfacePoint(rotation,part.anchor)),1/part.anchor[3]);
    const support=poolFixture.clips.pool_enter.samples.find(sample=>sample.phase===.6)!.limbs[limb];
    const frame=preparePoolFootContactFrame(poolFixture,support,geometry,cage,inverse[part.end],patch,orientation,[target[0],target[1]]);
    expect(frame.patchVertices).toContain(frame.activeVertex);
    const pole=pose.world[part.lower].slice(12,15) as unknown as Vec3;
    solveCertifiedPoolFoot(pose,part.upper,part.lower,part.end,frame,pole);
    contacts.push({support,patch,frame});
  }
  const skin=new Float32Array(pose.world.length*16);pose.world.forEach((matrix,index)=>skin.set(multiply(matrix,inverse[index]),index*16));
  const surfaces=[selected.body,selected.extra!].map(geometry=>({geometry,points:posedCageSurface(geometry,shapeVertices(geometry.cage,shape,top),skin)}));
  const observation=observePool(poolFixture,surfaces);
  const proofs=contacts.map(({patch,support,frame})=>derivePoolSupportArithmetic(poolFixture,surfaces[0],cage,pose,patch,support,frame,observation));
  expect(poolViolationsBeyondArithmetic(observation,proofs)).toEqual([]);
  for(const {patch,support} of contacts)expect(observePoolPatchSupport(poolFixture,surfaces,patch,support,.6,observation,proofs).satisfied).toBe(true);
});
