import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {poolEntrySearchPlan} from '../src/render/character/pool-entry-search-plan.js';
import {properPoolRotation} from '../src/render/character/pool-canonical-pose.js';
import {poolIntervalPreference,poolSkinMatrices} from '../src/render/character/pool-contact-sample.js';
import {preparePoolFootContactFrame,requirePoolFootContactFrame,requirePoolFootContactFrameInstance,requirePoolFootClearanceReference} from '../src/render/character/pool-foot-contact-frame.js';
import {solvePoolFreeLeg,requirePoolFreeFootConstruction} from '../src/render/character/pool-free-leg.js';
import {derivePoolApproachClearanceArithmetic,derivePoolSupportArithmetic,poolSupportArithmeticBound,poolViolationsBeyondArithmetic} from '../src/render/character/pool-support-arithmetic.js';
import {observePoolSource,poolObservationOwnsWitness,type PoolObservation} from '../src/render/character/pool-observer.js';
import {poolSourceRecord} from '../src/render/character/pool-source-policy.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {observePoolPatchSupport} from '../src/render/character/pool-support-observer.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';
import type {Vec3} from '../src/render/character/math.js';
import {poolExact} from '../src/render/character/pool-exact-number.js';
import retained from './pool-approach-input.json';
import {solvePoolOrientedFoot} from '../src/render/character/pool-oriented-leg.js';

const phase=.29999999999999993;
function input(abovePlane=false,mutablePatch=false,near=false,selectedMismatch?:'source'|'bones',groundApproach=false){
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const geometry={...selected.body,indices:selected.body.indices.slice(),stencilRanges:selected.body.stencilRanges.slice(),stencilWeights:selected.body.stencilWeights.slice(0),description:structuredClone(selected.body.description)};
  const fixture=structuredClone(poolFixture),compiler=new PoolEntryCompiler(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),[geometry],fixture);
  const seedPhase=groundApproach?0:.2,domain=compiler.prepareLegDomain(seedPhase,poolEntrySearchPlan(seedPhase)[0]);
  if(near){expect(poolRig.manifest.sourceSha256).toBe(retained.provenance.baseSourceSha256);expect(poolRig.manifest.basisActions.pool_enter[0]).toEqual(retained.standingBasis);}
  const pose=poolIntervalPreference(poolRig.manifest,domain.seed.rest,domain.seed.inverse,near?retained.leftPreferenceBasis:domain.node.basis,near?retained.rightPreferenceBasis:domain.node.basis,near?retained.fraction:0,true),anatomy=compiler.anatomy.footL,cage=domain.cages[0],patch=mutablePatch?{...anatomy.front!}:anatomy.front!;
  const support=poolSourceRecord(fixture,{action:'pool_enter',phase}).limbs.footL,flat=properPoolRotation(pose.rest[anatomy.end]);
  if(groundApproach){
    support.surface=fixture.ground.id;
    support.region={kind:'top-face'};
  }
  if(abovePlane)(fixture.solids.find(solid=>solid.id===support.surface)!.vertices[0] as unknown as [number,number,number])[2]=1;
  if(selectedMismatch)geometry.manifest={...geometry.manifest,...(selectedMismatch==='source'?{sourceSha256:'selected-only-change'}:{bones:geometry.manifest.bones.map((bone,i)=>i===anatomy.lower?{...bone,name:'wrong-selected-shin'}:bone)})};
  const frame=preparePoolFootContactFrame(fixture,support,geometry,cage,pose.inverse[anatomy.end],patch,flat,(near?retained.target:domain.footContacts[0].frame!.translation).slice(0,2) as [number,number]);
  const target:Vec3=near?retained.target as unknown as Vec3:[frame.translation[0],frame.translation[1],frame.translation[2]+.001];
  const plan=solvePoolFreeLeg(pose,anatomy.upper,anatomy.lower,anatomy.end,target,frame.orientation,frame);
  const evaluate=(at=phase)=>{const surface={geometry,points:posedCageSurface(geometry,cage,poolSkinMatrices(pose.world,pose.inverse))};return {surface,observation:observePoolSource(fixture,[surface],{action:'pool_enter',phase:at})};};
  const {surface,observation}=evaluate();
  const derive=(actualSurface=surface,actualObservation=observation)=>derivePoolApproachClearanceArithmetic(fixture,actualSurface,cage,pose,patch,support,'footL',frame,plan,actualObservation);
  return {fixture,geometry,cage,pose,patch,support,frame,target,plan,anatomy,surface,observation,evaluate,derive};
}

it('authenticates the ground during a free-foot approach and detects a change to its finite bounds',()=>{
  const p=input(false,false,false,undefined,true);
  expect(p.frame.surface).toBe(p.fixture.ground.id);
  expect(p.derive()).toMatchObject({surface:p.fixture.ground.id,required:false,contactEstablished:false});
  const below:Vec3=[p.target[0],p.target[1],p.frame.translation[2]-.001];
  expect(()=>requirePoolFootClearanceReference(p.frame,below,p.frame.orientation)).toThrow('below its exact nominal');
  const high=p.fixture.ground.bounds[1];
  p.fixture.ground.bounds[1]=[high[0]+.1,high[1],high[2]];
  expect(()=>requirePoolFootClearanceReference(p.frame,p.target,p.frame.orientation)).toThrow('Pool free foot reference solid changed.');
});

it.each(['points','recomputed'] as const)('authenticates same-phase observation surfaces: %s',mode=>{
  const p=input(false,false,true),bound=p.derive().maximumOutputError;
  let points:Float32Array<ArrayBuffer>;
  if(mode==='recomputed'){
    const world=p.pose.world.map(matrix=>[...matrix]);world[p.plan.end][14]-=bound/8;points=posedCageSurface(p.geometry,p.cage,poolSkinMatrices(world,p.pose.inverse));
  }else{points=p.surface.points.slice();points[retained.rawFootWitness.bodyVertex*3+2]=Math.fround(p.frame.planeHeight-bound/2);}
  const other={geometry:p.geometry,points},observation=observePoolSource(p.fixture,[other],{action:'pool_enter',phase});
  expect(observation.violations.some(v=>v.part===p.patch.part&&v.surface===p.support.surface&&v.signedClearance>=-bound)).toBe(true);
  expect(()=>p.derive(p.surface,observation)).toThrow();
});

it.each([false,true])('authenticates witness geometry when selected surfaces share a part name, same geometry=%s',sameGeometry=>{
  const p=input(false,false,true),bound=p.derive().maximumOutputError,world=p.pose.world.map(matrix=>[...matrix]);world[p.plan.end][14]-=bound/8;
  const other={geometry:sameGeometry?p.geometry:{...p.geometry},points:posedCageSurface(p.geometry,p.cage,poolSkinMatrices(world,p.pose.inverse))},observation=observePoolSource(p.fixture,[p.surface,other],{action:'pool_enter',phase});
  const raw=observation.violations.filter(v=>v.part===p.patch.part&&v.surface===p.support.surface);expect(raw).toHaveLength(2);
  const proof=p.derive(p.surface,observation),remaining=poolViolationsBeyondArithmetic(observation,[proof]).filter(v=>v.part===p.patch.part&&v.surface===p.support.surface);
  expect(remaining).toHaveLength(1);expect(remaining[0]).toBe(raw[1]);
});

it('authenticates original witness fields before allowing their collision classification',()=>{
  const p=input(false,false,true),witness=p.observation.violations.find(v=>v.part===p.patch.part&&v.surface===p.support.surface)!;
  expect(witness).toBeDefined();expect(poolObservationOwnsWitness(p.fixture,p.observation,p.surface,witness)).toBe(true);
  for(const [field,value] of Object.entries({part:'Creator bare leg L',signedClearance:witness.signedClearance/2,bodyVertex:witness.bodyVertex!+1,surfaceTriangle:witness.surfaceTriangle+1,point:[0,0,0]})){
    const old=Reflect.get(witness,field);Reflect.set(witness,field,value);expect(poolObservationOwnsWitness(p.fixture,p.observation,p.surface,witness)).toBe(false);Reflect.set(witness,field,old);
  }
  witness.signedClearance=-p.derive().maximumOutputError/2;const proof=p.derive();expect(poolViolationsBeyondArithmetic(p.observation,[proof])).toContain(witness);
});

it('keeps witness owner stable when a caller replaces its surface wrapper',()=>{
  const p=input(false,false,true),support=poolSourceRecord(p.fixture,{action:'pool_enter',phase:.3}).limbs.footL;
  const frame=preparePoolFootContactFrame(p.fixture,support,p.geometry,p.cage,p.pose.inverse[p.plan.end],p.patch,properPoolRotation(p.pose.rest[p.plan.end]),p.target.slice(0,2) as [number,number]);
  solvePoolOrientedFoot(p.pose,p.anatomy.upper,p.anatomy.lower,p.anatomy.end,frame);
  const {surface}=p.evaluate(.3),other={geometry:{...p.geometry},points:surface.points},observation=observePoolSource(p.fixture,[surface,other],{action:'pool_enter',phase:.3});
  const raw=observation.violations.filter(v=>v.part===p.patch.part&&v.surface===support.surface);expect(raw).toHaveLength(2);
  const proof=derivePoolSupportArithmetic(p.fixture,surface,p.cage,p.pose,p.patch,support,frame,observation);surface.geometry=other.geometry;
  const remaining=poolViolationsBeyondArithmetic(observation,[proof]).filter(v=>v.part===p.patch.part&&v.surface===support.surface);
  expect(remaining).toHaveLength(1);expect(remaining[0]).toBe(raw[1]);
});

it('authenticates the part selection and topology actually consumed by observation',()=>{
  const p=input(false,false,true),part=p.geometry.description.parts.find(part=>part.name===p.patch.part)!,footVertices=new Set(p.geometry.indices.subarray(part.start,part.start+part.count));
  const outside=Array.from(p.geometry.indices).find(vertex=>!footVertices.has(vertex))!,original=Array.from(p.geometry.indices.subarray(part.start,part.start+3)),count=part.count,points=p.surface.points.slice();
  expect(outside).toBeDefined();points.set(retained.rawFootWitness.point,outside*3);let observation:PoolObservation;
  try{p.geometry.indices.set([outside,outside,outside],part.start);part.count=3;observation=observePoolSource(p.fixture,[{geometry:p.geometry,points}],{action:'pool_enter',phase});}
  finally{p.geometry.indices.set(original,part.start);part.count=count;}
  const surface={geometry:p.geometry,points},witness=observation!.violations.find(v=>v.part===p.patch.part&&v.surface===p.support.surface)!;
  expect(witness.bodyVertex).toBe(outside);expect(footVertices.has(witness.bodyVertex!)).toBe(false);expect(witness.signedClearance).toBe(retained.rawFootWitness.signedClearance);
  let reason:string|undefined,remaining:PoolObservation['violations']=[];try{remaining=poolViolationsBeyondArithmetic(observation!,[p.derive(surface,observation!)]);}catch(error){reason=(error as Error).message;}
  expect(Boolean(reason)||remaining.includes(witness)).toBe(true);
});

it.each([false,true])('rejects ambiguous same-name parts inside one observed geometry, restored=%s',restored=>{
  const p=input(false,false,true),part=p.geometry.description.parts.filter(part=>part.name===p.patch.part)[0];p.geometry.description.parts.push({...part});
  const observation=observePoolSource(p.fixture,[p.surface],{action:'pool_enter',phase});
  expect(observation.violations.filter(v=>v.part===p.patch.part&&v.surface===p.support.surface)).toHaveLength(2);
  if(restored)p.geometry.description.parts.pop();
  expect(()=>p.derive(p.surface,observation)).toThrow();
});

it('rejects a fixture restored after observation instead of assigning its later index source',()=>{
  const p=input(false,false,true),solid=p.fixture.solids.find(solid=>solid.id==='Pool outside ladder tread 4')!,original=structuredClone(solid);
  solid.vertices=solid.vertices.map(v=>[v[0]+10,v[1],v[2]]);solid.bounds=solid.bounds.map(v=>[v[0]+10,v[1],v[2]]) as unknown as [Vec3,Vec3];
  const observation=observePoolSource(p.fixture,[p.surface],{action:'pool_enter',phase});Object.assign(solid,original);
  expect(()=>p.derive(p.surface,observation)).toThrow('actual acceleration source');
});

it('keeps certificate authority inaccessible through every public guard return',()=>{
  const p=input(false,false,true),below=[p.target[0],p.target[1],p.frame.translation[2]];
  expect(()=>requirePoolFootClearanceReference(p.frame,below,p.frame.orientation)).toThrow('below its exact nominal');
  const returns:unknown[]=[requirePoolFootContactFrame(p.frame,p.fixture,p.geometry,p.cage,p.patch,p.pose.inverse[p.plan.end],p.support),requirePoolFootContactFrameInstance(p.frame),requirePoolFootClearanceReference(p.frame,p.target,p.frame.orientation),requirePoolFreeFootConstruction(p.pose,p.plan,p.frame),p.frame.exactVerticalTarget];
  for(const value of returns)if(value&&typeof value==='object')Reflect.set(value,'target',{numerator:poolExact(0),denominator:poolExact(1)});
  expect(()=>requirePoolFootClearanceReference(p.frame,below,p.frame.orientation)).toThrow('below its exact nominal');
});

it.each(['source','bones'] as const)('matches selected manifest %s at construction',mode=>{
  expect(()=>input(false,false,true,mode)).toThrow();
});

it.each(['source','bones'] as const)('guards selected manifest %s on derivation and reuse with recomputed observations',mode=>{
  const p=input(false,false,true),proof=p.derive();
  p.geometry.manifest={...p.geometry.manifest,...(mode==='source'?{sourceSha256:'selected-only-change'}:{bones:p.geometry.manifest.bones.map((bone,i)=>i===p.anatomy.lower?{...bone,name:'wrong-selected-shin'}:bone)})};
  const changed=p.evaluate();let rejected=false;try{p.derive(changed.surface,changed.observation);}catch{rejected=true;}
  const own=poolViolationsBeyondArithmetic(p.observation,[proof]).some(v=>v.part===p.patch.part&&v.surface===p.support.surface);
  expect({rejected,own}).toEqual({rejected:true,own:true});
});

it('proves a separated nonrequired foot without granting tangent contact or changing the pose',()=>{
  const p=input(),before=JSON.stringify(p.pose.world),proof=p.derive();
  expect(proof.contactEstablished).toBe(false);expect(proof.required).toBe(false);
  expect(proof.exactTargetMargin.numerator.startsWith('-')).toBe(false);
  expect(poolSupportArithmeticBound(proof,proof.part,proof.surface,p.geometry,p.observation)).toBe(0);
  const atEnd=p.evaluate(.3),required=poolSourceRecord(p.fixture,{action:'pool_enter',phase:.3}).limbs.footL,outcome=observePoolPatchSupport(p.fixture,[atEnd.surface],p.patch,required,.3,atEnd.observation,[proof]);
  expect(outcome.satisfied).toBe(false);expect(outcome.arithmeticBound).toBe(0);expect(JSON.stringify(p.pose.world)).toBe(before);
  const bounds=requirePoolFreeFootConstruction(p.pose,p.plan,p.frame);expect(Object.isFrozen(bounds.worldError)).toBe(true);
  expect(Reflect.set(bounds.worldError,0,1)).toBe(false);expect(requirePoolFreeFootConstruction(p.pose,p.plan,p.frame).worldError).toEqual(bounds.worldError);
});

it('rejects the first exact-below-threshold free goal even inside a forward error bound',()=>{
  const p=input(),a=new Float64Array([p.frame.translation[2]]),bits=new BigUint64Array(a.buffer);let rejected=false;
  for(let step=0;step<4;step++){
    const goal=[p.target[0],p.target[1],a[0]];
    try{requirePoolFootClearanceReference(p.frame,goal,p.frame.orientation);bits[0]--;}
    catch(error){expect((error as Error).message).toContain('below its exact nominal');expect(Math.abs(a[0]-p.frame.translation[2])).toBeLessThan(p.derive().maximumOutputError);rejected=true;break;}
  }
  expect(rejected).toBe(true);
});

it('rejects changed target, rotation, copied frame and a reference omitted from the actual free solve',()=>{
  const p=input(),rotation=[...p.frame.orientation];rotation[0]+=Number.EPSILON;
  expect(()=>requirePoolFootClearanceReference(p.frame,[p.target[0]+.001,p.target[1],p.target[2]],p.frame.orientation)).toThrow('plane coordinates');
  expect(()=>requirePoolFootClearanceReference(p.frame,p.target,rotation)).toThrow('rotation');
  expect(()=>requirePoolFootClearanceReference({...p.frame},p.target,p.frame.orientation)).toThrow('not constructed');
  const q=input(),plain=solvePoolFreeLeg(q.pose,q.anatomy.upper,q.anatomy.lower,q.anatomy.end,q.target,q.frame.orientation),actual=q.evaluate();
  expect(()=>derivePoolApproachClearanceArithmetic(q.fixture,actual.surface,q.cage,q.pose,q.patch,q.support,'footL',q.frame,plain,actual.observation)).toThrow('clearance reference');
});

it.each(['parent','basis','rest','inverse','source','bone-role','end'] as const)('rejects changed %s even with recomputed observed output',mutation=>{
  const p=input(false,false,true),proof=p.derive(),witness=p.observation.violations.find(v=>v.part===p.patch.part&&v.surface===p.support.surface)!;
  expect(witness).toBeDefined();expect(poolViolationsBeyondArithmetic(p.observation,[proof])).not.toContain(witness);
  if(mutation==='parent')p.pose.world[p.plan.body][12]+=.001;
  if(mutation==='basis')p.pose.basis[p.plan.body][0]+=.001;
  if(mutation==='rest')p.pose.rest[p.plan.body][0]+=.001;
  if(mutation==='inverse')p.pose.inverse[p.plan.end][12]+=.001;
  if(mutation==='source')p.pose.bundle={...p.pose.bundle,sourceSha256:'changed'};
  if(mutation==='bone-role')p.pose.bundle={...p.pose.bundle,bones:p.pose.bundle.bones.map((bone,i)=>i===p.plan.lower?{...bone,name:'wrong'}:bone)};
  if(mutation==='end')p.pose.world[p.plan.end][14]-=.001;
  const altered=p.evaluate();expect(()=>p.derive(altered.surface,altered.observation)).toThrow();
  expect(poolViolationsBeyondArithmetic(p.observation,[proof])).toContainEqual(expect.objectContaining({part:proof.part,surface:proof.surface}));
});

it.each(['cage','stencil','indices','points','facet','upper-vertex'] as const)('rejects changed %s at derivation and proof reuse',mutation=>{
  const p=input(false,false,true),proof=p.derive(),record=p.observation.violations.find(v=>v.part===p.patch.part&&v.surface===p.support.surface)!;
  expect(record).toBeDefined();expect(poolViolationsBeyondArithmetic(p.observation,[proof])).not.toContain(record);
  if(mutation==='cage')p.cage[0]+=.001;
  if(mutation==='stencil')new Float32Array(p.geometry.stencilWeights)[1]+=.001;
  if(mutation==='indices')p.geometry.indices[0]++;
  if(mutation==='points'){const part=p.geometry.description.parts.find(part=>part.name===p.patch.part)!;p.surface.points[p.geometry.indices[part.start]*3]+=.001;}
  const solid=p.fixture.solids.find(s=>s.id===p.support.surface)!;
  if(mutation==='facet')solid.triangles[0]=[...solid.triangles[0]].reverse() as [number,number,number];
  if(mutation==='upper-vertex')(solid.vertices[0] as unknown as [number,number,number])[2]=p.frame.planeHeight+.01;
  expect(()=>p.derive()).toThrow();
  // A fresh derivation above must not rebase the retained owner after mutation.
  expect(poolViolationsBeyondArithmetic(p.observation,[proof])).toContainEqual(record);
});

it('rejects wrong actual source phase, real fixture record, wrong limb and copied observation',()=>{
  const p=input(),atEnd=p.evaluate(.3);
  expect(()=>p.derive(atEnd.surface,atEnd.observation)).toThrow();
  const old=poolSourceRecord(p.fixture,{action:'pool_enter',phase:.2}).limbs.footL;
  expect(()=>derivePoolApproachClearanceArithmetic(p.fixture,p.surface,p.cage,p.pose,p.patch,old,'footL',p.frame,p.plan,p.observation)).toThrow('actual observation');
  expect(()=>derivePoolApproachClearanceArithmetic(p.fixture,p.surface,p.cage,p.pose,p.patch,p.support,'footR',p.frame,p.plan,p.observation)).toThrow();
  expect(()=>p.derive(p.surface,structuredClone(p.observation))).toThrow('actual observed');
});

it('rejects an initially protruding solid even when its named top facets still define the plane',()=>{
  const p=input(true);expect(()=>p.derive()).toThrow('not wholly at or below');
});

it('rejects a mutable declared patch changing its complete part after reference construction',()=>{
  const p=input(false,true,true),proof=p.derive(),witness=p.observation.violations.find(v=>v.part===p.patch.part&&v.surface===p.support.surface)!;
  expect(witness).toBeDefined();expect(poolViolationsBeyondArithmetic(p.observation,[proof])).not.toContain(witness);
  (p.patch as {part:string}).part='Creator bare leg L';
  expect(()=>p.derive()).toThrow('another limb or part');expect(poolViolationsBeyondArithmetic(p.observation,[proof])).toContainEqual(witness);
});

it('keeps other-solid, non-foot and garment crossings, and rejects copied clearance proofs',()=>{
  const p=input(false,false,true),own=p.observation.violations.find(v=>v.part===p.patch.part&&v.surface===p.support.surface)!;expect(own).toBeDefined();
  const other={...own,surface:'Pool outside ladder tread 2'},leg={...own,part:'Creator bare leg L'},garment={...own,part:'Two-piece garment'};
  p.observation.violations.push(...[other,leg,garment] as PoolObservation['violations']);const proof=p.derive();
  expect(poolViolationsBeyondArithmetic(p.observation,[proof])).toEqual(expect.arrayContaining([other,leg,garment]));
  expect(poolViolationsBeyondArithmetic(p.observation,[proof])).not.toContainEqual(own);
  expect(poolViolationsBeyondArithmetic(p.observation,[{...proof}])).toContainEqual(own);
});
