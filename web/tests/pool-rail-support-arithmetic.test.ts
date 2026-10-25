import {beforeAll,expect,it} from 'vitest';
import key from '../../assets/models/sims/character-creator/pool_activity_key_v2.json';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {poolEntrySearchPlan} from '../src/render/character/pool-entry-search-plan.js';
import {clonePoolMatrix} from '../src/render/character/pool-matrix-producer.js';
import {solvePoolHierarchyLimb,type PoolHierarchy} from '../src/render/character/pool-canonical-pose.js';
import {composeSkeletonPose} from '../src/render/character/pose-joints.js';
import {inverseAffine,type Vec3} from '../src/render/character/math.js';
import {poolSkinMatrices} from '../src/render/character/pool-contact-sample.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {observePool,observePoolSource} from '../src/render/character/pool-observer.js';
import {observePoolPatchSupport} from '../src/render/character/pool-support-observer.js';
import {preparePoolRailContactFrame} from '../src/render/character/pool-rail-contact-frame.js';
import {solveCertifiedPoolRail} from '../src/render/character/pool-rail-construction-arithmetic.js';
import {derivePoolRailArithmetic,poolRailArithmeticBound} from '../src/render/character/pool-rail-support-arithmetic.js';
import {poolViolationsBeyondArithmetic} from '../src/render/character/pool-support-arithmetic.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';

function setup(){
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const compiler=new PoolEntryCompiler(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),[selected.body,selected.extra!],poolFixture);
  const domain=compiler.prepareLegDomain(key.phase,poolEntrySearchPlan(key.phase)[key.requestId]);
  const candidate=compiler.compileNodeCandidates(key.phase,{requestId:key.requestId,root:key.rootDelta as unknown as Vec3,trunkPitchDegrees:key.trunk.worldPitchDegrees,headSourcePhase:key.head.sourcePhase})[0];
  return {compiler,domain,candidate,geometry:selected.body};
}
let actual:ReturnType<typeof setup>;beforeAll(()=>{actual=setup();});
function prepared(side:'handL'|'handR'='handL'){
  const contact=actual.candidate.contacts.find(contact=>contact.limb===side)!;
  const pose:PoolHierarchy={...actual.candidate.pose,rest:actual.candidate.pose.rest.map(clonePoolMatrix),basis:actual.candidate.pose.basis.map(clonePoolMatrix),inverse:actual.candidate.pose.inverse.map(matrix=>[...matrix]),world:actual.candidate.pose.world.map(matrix=>[...matrix])};
  const fixture=structuredClone(poolFixture),geometry=actual.geometry,cage=actual.domain.cages[0].slice(),patch=actual.compiler.anatomy[side].patch,support=structuredClone(actual.domain.source.limbs[side]);
  const expected={fixture,geometry,cage,patch,support};
  const frame=preparePoolRailContactFrame(fixture,support,geometry,cage,pose.inverse[contact.anatomy.end],patch,contact.orientation,contact.parameter!);
  const solve=()=>solveCertifiedPoolRail(pose,contact.anatomy.upper,contact.anatomy.lower,contact.anatomy.end,frame,contact.pole,expected);
  solve();
  const evaluate=()=>{const surface={geometry,points:posedCageSurface(geometry,cage,poolSkinMatrices(pose.world,pose.inverse))};return {surface,observation:observePoolSource(fixture,[surface],{action:'pool_enter',phase:key.phase})};};
  const evaluated=evaluate();
  const derive=(surface=evaluated.surface,observation=evaluated.observation)=>derivePoolRailArithmetic(fixture,surface,cage,pose,patch,support,frame,observation);
  return {...expected,contact,pose,frame,solve,evaluate,derive,...evaluated};
}

it.each([false,true])('rail contact allowance authenticates its measured row, both rows observed=%s',both=>{
  const p=prepared(),bound=p.derive().maximumOutputError,world=p.pose.world.map(matrix=>[...matrix]);
  world[p.patch.bone][12]+=p.frame.side*bound/4;
  const other={geometry:p.geometry,points:posedCageSurface(p.geometry,p.cage,poolSkinMatrices(world,p.pose.inverse))};
  const observation=both?observePoolSource(p.fixture,[p.surface,other],{action:'pool_enter',phase:key.phase}):p.observation,proof=p.derive(p.surface,observation);
  const positive=observePoolPatchSupport(p.fixture,[p.surface],p.patch,p.support,key.phase,observation,[proof]);
  expect(observation.violations).toHaveLength(0);expect(positive.satisfied).toBe(true);expect(positive.arithmeticBound).toBe(bound);
  const negative=observePoolPatchSupport(p.fixture,[other],p.patch,p.support,key.phase,observation,[proof]);
  expect(negative.minimumGap).toBeGreaterThan(0);expect(negative.minimumGap).toBeLessThan(bound);
  expect(negative.arithmeticBound).toBe(0);expect(negative.satisfied).toBe(false);
});

it('authenticates rail observations against their actual surface points',()=>{
  const p=prepared(),bound=p.derive().maximumOutputError,points=p.surface.points.slice(),part=p.geometry.description.parts.find(part=>part.name===p.patch.part)!;
  for(const vertex of new Set(p.geometry.indices.subarray(part.start,part.start+part.count)))points[vertex*3]-=bound/4;
  const observation=observePoolSource(p.fixture,[{geometry:p.geometry,points}],{action:'pool_enter',phase:key.phase});
  expect(observation.violations.some(v=>v.part===p.patch.part&&v.surface===p.support.surface&&v.signedClearance>=-bound)).toBe(true);
  expect(()=>p.derive(p.surface,observation)).toThrow();
});

it('authenticates rail witness geometry across duplicate part names',()=>{
  const p=prepared(),bound=p.derive().maximumOutputError,points=p.surface.points.slice(),part=p.geometry.description.parts.find(part=>part.name===p.patch.part)!;
  for(const vertex of new Set(p.geometry.indices.subarray(part.start,part.start+part.count)))points[vertex*3]-=bound/4;
  const observation=observePoolSource(p.fixture,[p.surface,{geometry:{...p.geometry},points}],{action:'pool_enter',phase:key.phase}),raw=observation.violations.filter(v=>v.part===p.patch.part&&v.surface===p.support.surface);
  expect(raw.length).toBeGreaterThan(0);const proof=p.derive(p.surface,observation);
  expect(poolViolationsBeyondArithmetic(observation,[proof])).toEqual(expect.arrayContaining(raw));
});

it.each(['handL','handR'] as const)('binds %s exact finite edge through actual arm and complete selected palm output',side=>{
  const input=prepared(side),raw=JSON.stringify(input.observation),proof=input.derive();
  expect(proof.method).toBe('constructive-rail-edge-v1');expect(proof.actualActivePointResidual).toBeLessThan(proof.maximumOutputError);
  expect(poolRailArithmeticBound(proof,input.patch.part,input.support.surface!,input.geometry,input.observation)).toBe(proof.maximumOutputError);
  const result=observePoolPatchSupport(input.fixture,[input.surface],input.patch,input.support,key.phase,input.observation,[proof]);
  expect(result.required).toBe(true);expect(result.satisfied).toBe(true);expect(result.minimumGap).toBeGreaterThan(0);expect(result.minimumGap).toBeLessThan(result.arithmeticBound);
  expect(JSON.stringify(input.observation)).toBe(raw);
});

it('rejects changed observed points and recomputed output from a changed post-solve world',()=>{
  const point=prepared();point.surface.points[point.frame.activeVertex*3]-=.001;expect(()=>point.derive()).toThrow('actual observed');
  for(const recompute of [false,true]){const input=prepared();input.pose.world[input.patch.bone][12]-=.001;
    const evaluated=recompute?input.evaluate():input;expect(()=>input.derive(evaluated.surface,evaluated.observation)).toThrow('unchanged target-to-arm');}
});

it.each([-1e-3,-(2**-50),2**-50,1e-3])('rejects uncertified intended translation shift %s even with recomputed output',shift=>{
  const input=prepared(),target=[...input.frame.translation] as [number,number,number];target[0]+=shift;
  solvePoolHierarchyLimb(input.pose,input.contact.anatomy.upper,input.contact.anatomy.lower,input.patch.bone,target,input.contact.pole,input.frame.orientation);
  const changed=input.evaluate();expect(()=>input.derive(changed.surface,changed.observation)).toThrow();
});

it.each(['rest-scale','rest-shear','basis-scale','basis-shear'])('refuses %s before solving rather than rebasing measured error',kind=>{
  const input=prepared(),matrix=kind.startsWith('rest')?input.pose.rest[input.patch.bone]:input.pose.basis[input.contact.anatomy.upper];
  if(kind.endsWith('scale'))matrix[0]*=1.01;else matrix[4]+=.01;
  input.pose.inverse=input.pose.rest.map(inverseAffine);input.pose.world=composeSkeletonPose(input.pose.bundle.bones,input.pose.rest,input.pose.basis);
  expect(input.solve).toThrow();
});

it('rejects changed actual inverse, ancestor basis, selected coefficients and supplied support',()=>{
  const inverse=prepared();inverse.pose.inverse[inverse.patch.bone][12]+=.001;expect(()=>inverse.derive()).toThrow('unchanged physical inputs');
  const ancestor=prepared();ancestor.pose.basis[ancestor.contact.anatomy.upper][4]+=.001;expect(()=>ancestor.derive()).toThrow('hierarchy changed');
  const cage=prepared();cage.cage[0]+=.001;expect(()=>cage.derive()).toThrow('coefficients changed');
  const support=prepared();if(support.support.region?.kind!=='rail')throw new Error('Test requires rail');support.support.region.parameter=[1,4];expect(()=>support.derive()).toThrow('unchanged physical inputs');
});

it('requires independently actual expected patch, selection and rig at the real arm consumer',()=>{
  const input=prepared(),declaredPatch=structuredClone(input.patch);
  const alternate=preparePoolRailContactFrame(input.fixture,input.support,input.geometry,input.cage,input.pose.inverse[input.patch.bone],declaredPatch,input.contact.orientation,input.contact.parameter!);
  // This internally consistent factory declaration is not the independently required source patch.
  expect(()=>solveCertifiedPoolRail(input.pose,input.contact.anatomy.upper,input.contact.anatomy.lower,input.patch.bone,alternate,input.contact.pole,input)).toThrow('unchanged physical inputs');
  const geometry=prepared();expect(()=>solveCertifiedPoolRail(geometry.pose,geometry.contact.anatomy.upper,geometry.contact.anatomy.lower,geometry.patch.bone,geometry.frame,geometry.contact.pole,{...geometry,geometry:{...geometry.geometry}})).toThrow('unchanged physical inputs');
  const rig=prepared();rig.pose.bundle={...rig.pose.bundle,sourceSha256:'unrelated-source'};expect(rig.solve).toThrow('different actual selected rig');
});

it('rejects a changed actual rig after arm construction before derivation or proof reuse',()=>{
  const input=prepared(),proof=input.derive();input.pose.bundle={...input.pose.bundle,sourceSha256:'changed-after-construction'};
  expect(()=>input.derive()).toThrow('rig changed');
  expect(poolRailArithmeticBound(proof,proof.part,proof.surface,input.geometry,input.observation)).toBe(0);
});

it.each(['upper','spine'] as const)('rejects changed cached %s world with recomputed output before deriving or reusing a proof',ancestor=>{
  const input=prepared(),proof=input.derive(),bone=ancestor==='upper'?input.contact.anatomy.upper:input.pose.bundle.bones.findIndex(bone=>bone.name==='spine');
  input.pose.world[bone][12]+=.001;const changed=input.evaluate();
  expect(()=>input.derive(changed.surface,changed.observation)).toThrow('hierarchy changed');
  expect(poolRailArithmeticBound(proof,proof.part,proof.surface,input.geometry,input.observation)).toBe(0);
});

it('refuses forged, stale, other-part and other-surface classification, retaining unrelated physical failures',()=>{
  const input=prepared(),violation={part:input.patch.part,surface:input.support.surface!,signedClearance:-1e-9};input.observation.violations.push(violation as never);
  const proof=input.derive();expect(poolViolationsBeyondArithmetic(input.observation,[proof])).toEqual([violation]);
  expect(poolViolationsBeyondArithmetic(input.observation,[{...proof}])).toEqual([violation]);
  expect(poolViolationsBeyondArithmetic(structuredClone(input.observation),[proof])).toEqual([violation]);
  expect(poolRailArithmeticBound(proof,'Resting thumb',proof.surface,input.geometry,input.observation)).toBe(0);
  expect(poolRailArithmeticBound(proof,proof.part,'Pool ladder rail 2',input.geometry,input.observation)).toBe(0);
  input.surface.points[input.frame.activeVertex*3]+=.001;expect(poolViolationsBeyondArithmetic(input.observation,[proof])).toEqual([violation]);
  const other=prepared();other.observation.violations.push({part:'Resting thumb',surface:other.support.surface!,signedClearance:-1e-9} as never,{part:other.patch.part,surface:'Pool ladder tread 1',signedClearance:-1e-9} as never);
  const owned=other.derive();expect(poolViolationsBeyondArithmetic(other.observation,[owned])).toEqual(other.observation.violations);
});

it('rejects a newly forged nominal target and finite edge domain without inferring contact from small gaps',()=>{
  const input=prepared();expect(()=>solveCertifiedPoolRail(input.pose,input.contact.anatomy.upper,input.contact.anatomy.lower,input.patch.bone,{...input.frame,translation:[input.frame.translation[0]+Number.EPSILON,input.frame.translation[1],input.frame.translation[2]]},input.contact.pole,input)).toThrow('unchanged physical inputs');
  expect(()=>preparePoolRailContactFrame(input.fixture,input.support,input.geometry,input.cage,input.pose.inverse[input.patch.bone],input.patch,input.contact.orientation,0)).toThrow('outside the allowed edge');
});


it('requires an independently located actual observation before rail derivation',()=>{
  const input=prepared(),unlocated=observePool(input.fixture,[input.surface]);
  expect(()=>input.derive(input.surface,unlocated)).toThrow('independently owned source context');
  const differentRealContext=observePoolSource(input.fixture,[input.surface],{action:'pool_enter',phase:.5});
  expect(()=>input.derive(input.surface,differentRealContext)).toThrow('actual observation source context');
});
