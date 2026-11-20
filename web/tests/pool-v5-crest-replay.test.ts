import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import retained from './fixtures/pool-v5-crest-rejection.json';
import {validateAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight,shapeVertices} from '../src/render/character/shape.js';
import {configuredRestSetup,composeSkeletonPose} from '../src/render/character/pose-joints.js';
import {poolSkinMatrices} from '../src/render/character/pool-contact-sample.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {observePoolSource} from '../src/render/character/pool-observer.js';
import {poolViolationsBeyondArithmetic} from '../src/render/character/pool-support-arithmetic.js';
import {parseOwnedPoolFixture} from '../src/render/character/pool-owned-fixture.js';
import {poolBase,poolRig} from './pool-observer-fixture.js';
import type {PoolFixtureV1} from '../src/render/character/pool-contact-types.js';

it('replays and rejects the frozen v5 crest crossing through the final maintained observer',()=>{
 for(const [path,hash] of Object.entries(retained.inputs)){
  expect(createHash('sha256').update(readFileSync(new URL('../../'+path,import.meta.url))).digest('hex'),path).toBe(hash);
 }
 const appearance=validateAppearance(structuredClone(retained.appearance));
 const shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(poolBase.vertices);
 const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
 expect(selected.extra).not.toBeNull();expect(poolRig.manifest.sourceSha256).toBe(retained.provenance.sourceRigSha256);
 const setup=configuredRestSetup(poolRig.manifest,shape,top),world=composeSkeletonPose(poolRig.manifest.bones,setup.rest,retained.basis);
 expect(world.every((matrix,bone)=>matrix.every((value,index)=>value===retained.world[bone][index]))).toBe(true);
 const skin=poolSkinMatrices(world,setup.inverse),surfaces=[selected.body,selected.extra!].map(geometry=>({geometry,points:posedCageSurface(geometry,shapeVertices(geometry.cage,shape,top),skin)}));
 const text=readFileSync(new URL('../../assets/models/sims/character-creator/clips/pool/contacts-v2.json',import.meta.url),'utf8');
 for(const fixture of [JSON.parse(text) as PoolFixtureV1,parseOwnedPoolFixture(text)]){
  const observation=observePoolSource(fixture,surfaces,{action:retained.provenance.action,phase:retained.provenance.phase});
  expect(observation.violations).toEqual(retained.expectedViolations);
  const unresolved=poolViolationsBeyondArithmetic(observation,[]);
  expect(unresolved).toHaveLength(1);expect(unresolved[0]).toBe(observation.violations[0]);
  expect(unresolved[0]).toMatchObject({part:'Creator bare leg L',surface:'Pool ladder crest landing',bodyTriangle:12260,surfaceTriangle:2,signedClearance:-.002392299510227569});
 }
});
