import {expect,it} from 'vitest';
import {identity,multiply,inverseAffine} from '../src/render/character/math.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {observePool,type PoolObservation} from '../src/render/character/pool-observer.js';
import {preparePoolFootContactFrame} from '../src/render/character/pool-foot-contact-frame.js';
import {solveCertifiedPoolFoot} from '../src/render/character/pool-limb-construction-arithmetic.js';
import {derivePoolSupportArithmetic,poolViolationsBeyondArithmetic,poolSupportArithmeticBound} from '../src/render/character/pool-support-arithmetic.js';
import {poolFootConstructionFixture} from './pool-foot-construction-fixture.js';
import {solvePoolHierarchyLimb} from '../src/render/character/pool-canonical-pose.js';
import {composeSkeletonPose} from '../src/render/character/pose-joints.js';
import retained from './pool-entry-defect-witnesses.json';
import {observePoolPatchSupport} from '../src/render/character/pool-support-observer.js';

function prepared(){
  const input=poolFootConstructionFixture(),{fixture,support,geometry,cage,pose,patch}=input;
  const frame=preparePoolFootContactFrame(fixture,support,geometry,cage,pose.inverse[3],patch,identity(),[.5,.25]);
  solveCertifiedPoolFoot(pose,1,2,3,frame,[0,0,1]);
  const evaluate=()=>{
    const skin=new Float32Array(64);pose.world.forEach((matrix,index)=>skin.set(multiply(matrix,pose.inverse[index]),index*16));
    const surface={geometry,points:posedCageSurface(geometry,cage,skin)},observation=observePool(fixture,[surface]);
    return {surface,observation};
  };
  const {surface,observation}=evaluate();
  const derive=(actual=surface,report=observation)=>derivePoolSupportArithmetic(fixture,actual,cage,pose,patch,support,frame,report);
  return {...input,frame,surface,observation,evaluate,derive};
}

it.each([false,true])('required contact allowance authenticates the measured row, both rows observed=%s',both=>{
  const p=prepared(),bound=p.derive().maximumOutputError;
  const world=p.pose.world.map(matrix=>[...matrix]);world[3][14]+=bound/2;
  const skin=new Float32Array(64);world.forEach((matrix,index)=>skin.set(multiply(matrix,p.pose.inverse[index]),index*16));
  const other={geometry:p.geometry,points:posedCageSurface(p.geometry,p.cage,skin)};
  const observation=both?observePool(p.fixture,[p.surface,other]):p.observation,proof=p.derive(p.surface,observation);
  const positive=observePoolPatchSupport(p.fixture,[p.surface],p.patch,p.support,0,observation,[proof]);
  expect(observation.violations).toHaveLength(0);expect(positive.satisfied).toBe(true);expect(positive.arithmeticBound).toBe(bound);
  const negative=observePoolPatchSupport(p.fixture,[other],p.patch,p.support,0,observation,[proof]);
  expect(negative.minimumGap).toBeGreaterThan(0);expect(negative.minimumGap).toBeLessThan(bound);
  expect(negative.arithmeticBound).toBe(0);expect(negative.satisfied).toBe(false);
  const raw=observePoolPatchSupport(p.fixture,[other],p.patch,p.support,0,structuredClone(observation));
  expect(raw.arithmeticBound).toBe(0);expect(raw.satisfied).toBe(false);expect(raw.minimumGap).toBe(negative.minimumGap);
});

it('authenticates required-foot observations against their actual surface points',()=>{
  const p=prepared(),bound=p.derive().maximumOutputError,points=p.surface.points.slice();points[2]=Math.fround(p.frame.planeHeight-bound/2);
  const observation=observePool(p.fixture,[{geometry:p.geometry,points}]);
  expect(observation.violations.some(v=>v.part===p.patch.part&&v.signedClearance>=-bound)).toBe(true);
  expect(()=>p.derive(p.surface,observation)).toThrow();
});

it('authenticates required-foot witness geometry across duplicate part names',()=>{
  const p=prepared(),bound=p.derive().maximumOutputError,points=p.surface.points.slice();points[2]=Math.fround(p.frame.planeHeight-bound/2);
  const observation=observePool(p.fixture,[p.surface,{geometry:{...p.geometry},points}]),raw=observation.violations;
  expect(raw.length).toBeGreaterThan(0);const proof=p.derive(p.surface,observation);
  expect(poolViolationsBeyondArithmetic(observation,[proof])).toEqual(raw);
});

it.each(['source','bones'] as const)('binds established-foot rig %s at construction',kind=>{
  const p=poolFootConstructionFixture(),frame=preparePoolFootContactFrame(p.fixture,p.support,p.geometry,p.cage,p.pose.inverse[3],p.patch,identity(),[.5,.25]);
  p.pose.bundle={...p.pose.bundle,...(kind==='source'?{sourceSha256:'changed-pose'}:{bones:p.pose.bundle.bones.map((bone,i)=>i===2?{...bone,name:'changed-role'}:bone)})};
  expect(()=>solveCertifiedPoolFoot(p.pose,1,2,3,frame,[0,0,1])).toThrow();
});

it.each(['source','bones'] as const)('binds established-foot selected rig %s at construction',kind=>{
  const p=poolFootConstructionFixture();p.geometry.manifest={...p.geometry.manifest,...(kind==='source'?{sourceSha256:'changed-selection'}:{bones:p.geometry.manifest.bones.map((bone,i)=>i===2?{...bone,name:'changed-role'}:bone)})};
  const frame=preparePoolFootContactFrame(p.fixture,p.support,p.geometry,p.cage,p.pose.inverse[3],p.patch,identity(),[.5,.25]);
  expect(()=>solveCertifiedPoolFoot(p.pose,1,2,3,frame,[0,0,1])).toThrow();
});

it.each(['source','bones'] as const)('guards established-foot rig %s at derivation and reuse',kind=>{
  const p=prepared(),proof=p.derive();p.pose.bundle={...p.pose.bundle,...(kind==='source'?{sourceSha256:'changed-pose'}:{bones:p.pose.bundle.bones.map((bone,i)=>i===2?{...bone,name:'changed-role'}:bone)})};
  const changed=p.evaluate();let rejected=false;try{p.derive(changed.surface,changed.observation);}catch{rejected=true;}
  expect({rejected,bound:poolSupportArithmeticBound(proof,proof.part,proof.surface,p.geometry,p.observation)}).toEqual({rejected:true,bound:0});
});

it('derives a complete construction-to-output proof and preserves raw observations',()=>{
  const input=prepared(),raw=JSON.stringify(input.observation),proof=input.derive();
  expect(proof.contactEstablished).toBe(true);expect(proof.activeVertex).toBe(input.frame.activeVertex);
  expect(Number.isFinite(proof.maximumOutputError)).toBe(true);expect(proof.maximumOutputError).toBeGreaterThan(0);
  expect(poolViolationsBeyondArithmetic(input.observation,[proof])).toEqual([]);
  expect(JSON.stringify(input.observation)).toBe(raw);
});

it.each([-.001,-Number.EPSILON/2,Number.EPSILON/2,.001])('rejects an intended contact shift %s without interval-zero inference',shift=>{
  const input=prepared(),target=[...input.frame.translation];target[2]+=shift;
  const forged={...input.frame,translation:target as unknown as typeof input.frame.translation};
  expect(()=>solveCertifiedPoolFoot(input.pose,1,2,3,forged,[0,0,1])).toThrow('not constructed');
});

it('rejects changed observed coordinates, changed matrices and recomputed corrupt outputs',()=>{
  const first=prepared();first.surface.points[2]=Math.fround(first.surface.points[2]-.001);
  expect(()=>first.derive()).toThrow('does not match');
  for(const recompute of [false,true]){
    const input=prepared();input.pose.world[3][14]-=.001;
    const altered=recompute?input.evaluate():{surface:input.surface,observation:input.observation};
    expect(()=>input.derive(altered.surface,altered.observation)).toThrow('matching');
  }
  const inverse=prepared();inverse.pose.inverse[3][14]+=.001;expect(()=>inverse.derive()).toThrow('different configured inverse');
});

it.each([0,1,2])('rejects changed cached foot ancestor %s world despite unchanged rigid foot output',ancestor=>{
  const input=prepared(),proof=input.derive();input.pose.world[ancestor][12]+=.001;const changed=input.evaluate();
  expect(()=>input.derive(changed.surface,changed.observation)).toThrow('hierarchy changed');
  expect(poolSupportArithmeticBound(proof,proof.part,proof.surface,input.geometry,input.observation)).toBe(0);
});

it.each([-.001,-(2**-50),2**-50,.001])('rejects a recomputed hierarchy using an uncertified intended target shift %s',shift=>{
  const input=prepared(),target=[...input.frame.translation] as [number,number,number];target[2]+=shift;
  solvePoolHierarchyLimb(input.pose,1,2,3,target,[0,0,1],input.frame.orientation);
  const changed=input.evaluate();expect(()=>input.derive(changed.surface,changed.observation)).toThrow();
});

it('rejects mixed-bone coefficients, changed full-foot geometry and a shifted fixture plane',()=>{
  const mixed=prepared();mixed.cage[6]=2;expect(()=>mixed.derive()).toThrow('changed physical coefficients');
  const outside=prepared();outside.cage[3*16+2]=-.01;expect(()=>outside.derive()).toThrow('changed physical coefficients');
  const plane=prepared();plane.fixture.ground.bounds[1]=[1,1,.6];expect(()=>plane.derive()).toThrow('actual acceleration source');
});

it('binds proofs to the exact fixture, point snapshot and observation and refuses forged proofs',()=>{
  const input=prepared(),proof=input.derive(),newObservation=structuredClone(input.observation);
  // Reusing a proof must refuse the ownership check even when a copied report has no collisions.
  const witness={surface:'ground',part:proof.part,signedClearance:-proof.maximumOutputError/2};
  newObservation.violations.push(witness as never);
  expect(poolViolationsBeyondArithmetic(newObservation,[proof])).toHaveLength(1);
  const owned=prepared();owned.observation.violations.push(witness as never);const ownedProof=owned.derive();
  expect(poolViolationsBeyondArithmetic(owned.observation,[ownedProof])).toHaveLength(1);
  owned.surface.points[0]+=.01;expect(poolViolationsBeyondArithmetic(owned.observation,[ownedProof])).toHaveLength(1);
  const stale=prepared();stale.observation.violations.push(witness as never);const staleProof=stale.derive();stale.fixture.ground.bounds[1]=[1,1,.6];
  expect(poolViolationsBeyondArithmetic(stale.observation,[staleProof])).toHaveLength(1);
  expect(poolViolationsBeyondArithmetic(owned.observation,[{...ownedProof}])).toHaveLength(1);
});

it('keeps retained shin/rail defects, same-foot other-solid and other-part own-solid violations',()=>{
  const input=prepared(),defects=retained.records.reduce<PoolObservation['violations']>((all,record)=>[...all,...record.violations as unknown as PoolObservation['violations']],[]);
  input.observation.violations.push(...defects as unknown as PoolObservation['violations'],
    {surface:'other-solid',part:input.patch.part,signedClearance:-1e-10} as never,{surface:'ground',part:'other-part',signedClearance:-1e-10} as never);
  const proof=input.derive();expect(poolViolationsBeyondArithmetic(input.observation,[proof])).toEqual(input.observation.violations);
});

it.each([false,true])('rejects an end inverse changed before certified solving, recompute=%s',recompute=>{
  const input=poolFootConstructionFixture(),{fixture,support,geometry,cage,pose,patch}=input;
  const frame=preparePoolFootContactFrame(fixture,support,geometry,cage,pose.inverse[3],patch,identity(),[.5,.25]);
  pose.inverse[3][14]+=.001;
  expect(()=>solveCertifiedPoolFoot(pose,1,2,3,frame,[0,0,1])).toThrow('different configured inverse');
  const skin=new Float32Array(64);pose.world.forEach((matrix,index)=>skin.set(multiply(matrix,recompute?pose.inverse[index]:inverseAffine(pose.rest[index])),index*16));
  const surface={geometry,points:posedCageSurface(geometry,cage,skin)},observation=observePool(fixture,[surface]);
  expect(()=>derivePoolSupportArithmetic(fixture,surface,cage,pose,patch,support,frame,observation)).toThrow('different configured inverse');
});

it('rejects a different same-height surface, finite region and nearby support plane',()=>{
  for(const change of ['surface','region','plane']){
    const input=prepared();
    const support=structuredClone(input.support);
    if(change==='region')support.region={kind:'top-face',triangles:[0]};
    else{
      const height=change==='plane'?.5+2**-40:.5;support.surface='other';
      input.fixture.solids.push({id:'other',kind:'floor',bounds:[[0,0,height],[1,1,height]],vertices:[[0,0,height],[1,0,height],[0,1,height]],triangles:[[0,1,2]]});
    }
    expect(()=>derivePoolSupportArithmetic(input.fixture,input.surface,input.cage,input.pose,input.patch,support,input.frame,input.observation)).toThrow(change==='region'?'different finite support descriptor':'actual acceleration source');
  }
});

it.each(['rest-scale','rest-shear','basis-scale','basis-shear'])('rejects pre-solve %s at the legitimate matrix-producer boundary',kind=>{
  for(const beforeFrame of [true,false]){
    const input=poolFootConstructionFixture(),{fixture,support,geometry,cage,pose,patch}=input;
    const prepare=()=>preparePoolFootContactFrame(fixture,support,geometry,cage,pose.inverse[3],patch,identity(),[.5,.25]);
    let frame=beforeFrame?undefined:prepare();
    const target=kind.startsWith('rest')?pose.rest[3]:pose.basis[1];
    if(kind.endsWith('scale'))target[0]*=1.01;else target[4]+=.01;
    pose.inverse=pose.rest.map(inverseAffine);pose.world=composeSkeletonPose(pose.bundle.bones,pose.rest,pose.basis);
    frame??=prepare();
    expect(()=>solveCertifiedPoolFoot(pose,1,2,3,frame!,[0,0,1])).toThrow(beforeFrame?'legitimate producer':kind.startsWith('rest')?'different configured inverse':'legitimate producer');
  }
});
