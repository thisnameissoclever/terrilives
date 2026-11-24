import {expect,it,vi} from 'vitest';
import retained from './pool-interpolated-approach-input.json';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight,shapeVertices} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {canonicalPoolPreference,properPoolRotation} from '../src/render/character/pool-canonical-pose.js';
import {poolSourceRecord} from '../src/render/character/pool-source-policy.js';
import {interpolatePoolLimbState,type PoolPoseControl,type PoolIntervalLimb} from '../src/render/character/pool-contact-evaluator.js';
import {preparePoolFootRotationEndpoint,preparePoolInterpolatedFootRotation,requirePoolInterpolatedFootRotation} from '../src/render/character/pool-matrix-producer.js';
import {preparePoolInterpolatedFootReference,requirePoolInterpolatedFootReference,requirePoolFreeFootClearanceReference,requirePoolFootContactFrameInstance} from '../src/render/character/pool-foot-contact-frame.js';
import {solvePoolFreeLeg,requirePoolFreeFootConstruction} from '../src/render/character/pool-free-leg.js';
import {derivePoolApproachClearanceArithmetic,poolSupportArithmeticBound,poolViolationsBeyondArithmetic} from '../src/render/character/pool-support-arithmetic.js';
import {observePoolSource} from '../src/render/character/pool-observer.js';
import {poolSkinMatrices} from '../src/render/character/pool-contact-sample.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import * as motion from '../src/render/character/motion.js';
import {multiply,type Vec3} from '../src/render/character/math.js';

const phase=.29999999999999993,location={action:'pool_enter',phase,limb:'footL' as const};
function input(extraSolid=false){
  const manifest={...poolRig.manifest,bones:structuredClone(poolRig.manifest.bones),actions:{...poolRig.manifest.actions,pool_enter:structuredClone(poolRig.manifest.actions.pool_enter)},basisActions:{...poolRig.manifest.basisActions,pool_enter:structuredClone(poolRig.manifest.basisActions.pool_enter)}};
  for(const row of retained.sourceSamples){manifest.actions.pool_enter[row.index]=structuredClone(row.sample.bones);manifest.basisActions.pool_enter[row.index]=structuredClone(row.sample.basis);}
  const fixture=structuredClone(poolFixture);
  if(extraSolid){const other=structuredClone(fixture.solids.find(s=>s.id==='Pool outside ladder tread 3')!);other.id='Other actual solid';fixture.solids.push(other);}
  const rig={...poolRig,manifest,supplemental:{...poolRig.supplemental!,manifest}},appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(poolBase.vertices);
  const selected=new PreparedBody(poolBase,appearance).select(rig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const geometry=[selected.body,selected.extra!].map(g=>({...g,description:structuredClone(g.description),cage:g.cage.slice(),indices:g.indices.slice(),stencilRanges:g.stencilRanges.slice(),stencilWeights:g.stencilWeights.slice(0)}));
  const compiler=new PoolEntryCompiler(manifest,shape,top,geometry,fixture),anatomy=compiler.anatomy.footL,patch=anatomy.front!,cages=geometry.map(g=>shapeVertices(g.cage,shape,top)),cage=cages[0];
  const endpoints=retained.endpoints.map(e=>({...structuredClone(e),control:structuredClone(e.control) as unknown as PoolPoseControl}));
  const endpointInput=(row:typeof endpoints[number])=>({bundle:manifest,geometry,shape,top,fixture,patch,location:{action:'pool_enter',phase:row.phase,limb:'footL' as const},control:row.control,rootBasis:row.rootBasis});
  const endpoint=(row:typeof endpoints[number])=>preparePoolFootRotationEndpoint(endpointInput(row));
  const {state:from,...chain}=endpoints[0].control,control:PoolIntervalLimb={...chain,from,to:endpoints[1].control.state},amount=(phase-.275)/(.3-.275),state=interpolatePoolLimbState(control,amount),seed=canonicalPoolPreference(manifest,shape,top,'pool_enter',phase*40,geometry),support=poolSourceRecord(fixture,location).limbs.footL;
  const tokens=endpoints.map(endpoint),producer=preparePoolInterpolatedFootRotation(tokens[0],tokens[1],control,location);
  const makeReference=(target:readonly number[]=state.target,orientation:readonly number[]=state.orientation,at=location,actualProducer=producer)=>preparePoolInterpolatedFootReference(fixture,support,geometry[0],cage,seed.inverse[anatomy.end],patch,manifest,at,target,orientation,actualProducer);
  return {manifest,fixture,geometry,shape,top,compiler,anatomy,patch,cages,cage,endpoints,endpointInput,endpoint,tokens,control,amount,state,seed,support,producer,makeReference};
}
function prepared(extraSolid=false){
  const p=input(extraSolid),reference=p.makeReference(),pose=p.seed,plan=solvePoolFreeLeg(pose,p.anatomy.upper,p.anatomy.lower,p.anatomy.end,p.state.target,p.state.orientation,reference);
  const skin=poolSkinMatrices(pose.world,pose.inverse),surface={geometry:p.geometry[0],points:posedCageSurface(p.geometry[0],p.cage,skin)},garment={geometry:p.geometry[1],points:posedCageSurface(p.geometry[1],p.cages[1],skin)};
  const observation=observePoolSource(p.fixture,[surface,garment],location),derive=(actualSurface=surface,actualObservation=observation)=>derivePoolApproachClearanceArithmetic(p.fixture,actualSurface,p.cage,pose,p.patch,p.support,'footL',reference,plan,actualObservation);
  return {...p,reference,pose,plan,skin,surface,garment,observation,derive};
}

it('certifies both exact full-foot premises for the unchanged authentic interpolation',()=>{
  const p=prepared(),premise=requirePoolFreeFootClearanceReference(p.reference,p.state.target,p.state.orientation,p.pose.inverse[p.plan.end],p.manifest),proof=p.derive();
  expect('literalMinimum' in premise&&premise.literalMinimum.numerator>0n).toBe(true);
  expect('properMinimum' in premise&&premise.properMinimum.numerator.numerator>0n).toBe(true);
  expect(p.state.target).toEqual(retained.near.target);expect(p.state.orientation).toEqual(retained.near.orientation);
  expect(proof.required).toBe(false);expect(proof.contactEstablished).toBe(false);expect(poolSupportArithmeticBound(proof,proof.part,proof.surface,p.geometry[0],p.observation)).toBe(0);
  expect(()=>requirePoolFootContactFrameInstance(p.reference as never)).toThrow();
  const raw=p.observation.violations.filter(v=>v.part===p.patch.part&&v.surface===p.support.surface);expect(raw.length).toBeGreaterThan(0);
  expect(poolViolationsBeyondArithmetic(p.observation,[proof]).filter(v=>raw.includes(v))).toHaveLength(0);
});

it('returns detached immutable nested arithmetic values without certificate authority',()=>{
  const p=input(),first=requirePoolInterpolatedFootRotation(p.producer,p.manifest,p.geometry[0],p.fixture,p.patch,location,p.state.target,p.state.orientation,p.seed.inverse[p.anatomy.end]);
  const again=()=>requirePoolInterpolatedFootRotation(p.producer,p.manifest,p.geometry[0],p.fixture,p.patch,location,p.state.target,p.state.orientation,p.seed.inverse[p.anatomy.end]);
  expect(Reflect.set(first.numerators[0],'numerator',0n)).toBe(false);expect(Reflect.set(first.denominator,'numerator',1n)).toBe(false);expect(Reflect.set(first.orientationError,0,1)).toBe(false);expect(again()).toEqual(first);expect(again().numerators).not.toBe(first.numerators);
  const ref=p.makeReference(),premise=requirePoolFreeFootClearanceReference(ref,p.state.target,p.state.orientation,p.seed.inverse[p.anatomy.end],p.manifest);
  if(!('properMinimum' in premise))throw new Error('Expected interpolated premise');
  expect(Reflect.set(premise.properMinimum.denominator,'numerator',1n)).toBe(false);expect(Reflect.set(premise.properMinimum.numerator,'exponent',100)).toBe(false);expect(Reflect.set(premise.literalMinimum,'numerator',0n)).toBe(false);
  expect(requirePoolFreeFootClearanceReference(ref,p.state.target,p.state.orientation,p.seed.inverse[p.anatomy.end],p.manifest)).toEqual(premise);
});

it.each(['scale','shear','entry','amount','forged'] as const)('rejects a changed %s output or producer before a physical allowance',kind=>{
  const p=input(),orientation=[...p.state.orientation];let at=location,producer=p.producer;
  if(kind==='scale')orientation[0]*=1.01;else if(kind==='shear')orientation[4]+=.01;else if(kind==='entry')orientation[5]+=2**-40;else if(kind==='amount')at={...location,phase:.2875};else producer={...producer};
  expect(()=>p.makeReference(p.state.target,orientation,at,producer)).toThrow();
});
it('rejects another genuine endpoint and external endpoint aliases',()=>{
  const p=input(),other=p.endpoint({...p.endpoints[0],control:structuredClone(p.endpoints[0].control)});
  expect(()=>preparePoolInterpolatedFootRotation(other,p.tokens[1],p.control,location)).toThrow('ownership');
  (p.endpoints[0].control.state.orientation as number[])[0]*=1.01;expect(()=>p.makeReference()).toThrow('unchanged source');
});
it.each(['endpoint','interpolated'].flatMap(site=>['cage','indices','ranges','weights'].flatMap(field=>['mutation','replacement'].map(mode=>({site,field,mode})))))('rechecks $site $field bytes after $mode',({site,field,mode})=>{
  const p=input(),reference=p.makeReference(),geometry=p.geometry[0];let cage=p.cage;
  const guard=()=>site==='endpoint'?requirePoolInterpolatedFootRotation(p.producer,p.manifest,geometry,p.fixture,p.patch,location,p.state.target,p.state.orientation,p.seed.inverse[p.anatomy.end]):requirePoolInterpolatedFootReference(reference,p.fixture,geometry,cage,p.patch,p.support,location,p.seed.inverse[p.anatomy.end],p.manifest);
  expect(guard).not.toThrow();
  if(mode==='replacement'){
    if(field==='cage'){if(site==='endpoint')geometry.cage=geometry.cage.slice();else cage=cage.slice();}
    else if(field==='indices')geometry.indices=geometry.indices.slice();else if(field==='ranges')geometry.stencilRanges=geometry.stencilRanges.slice();else geometry.stencilWeights=geometry.stencilWeights.slice(0);
  }
  const value=field==='cage'?(site==='endpoint'?geometry.cage:cage):field==='indices'?geometry.indices:field==='ranges'?geometry.stencilRanges:new Uint8Array(geometry.stencilWeights),view=new Uint8Array(value.buffer,value.byteOffset,value.byteLength);view[view.length-1]^=0x80;
  expect(guard).toThrow(site==='endpoint'?'unchanged source owner':field==='cage'&&mode==='replacement'?'another actual observation owner':'coefficients changed');
});
it.each(['wrapper','list'] as const)('keeps original endpoint owners after caller %s replacement',kind=>{
  const p=input(),inputs=p.endpoints.map(p.endpointInput),tokens=inputs.map(preparePoolFootRotationEndpoint),producer=preparePoolInterpolatedFootRotation(tokens[0],tokens[1],p.control,location);
  const other={...p.geometry[0],cage:p.geometry[0].cage.slice()};other.cage[0]+=.25;
  if(kind==='wrapper')for(const input of inputs)input.geometry=[other,p.geometry[1]];
  else p.geometry[0]=other;
  expect(()=>preparePoolInterpolatedFootReference(p.fixture,p.support,other,p.cage,p.seed.inverse[p.anatomy.end],p.patch,p.manifest,location,p.state.target,p.state.orientation,producer)).toThrow();
});
it('rejects generic interpolation implementation drift',()=>{
  const p=input(),original=motion.interpolateTransform,spy=vi.spyOn(motion,'interpolateTransform').mockImplementation((a,b,t)=>{const result=original(a,b,t);result[0]+=.001;return result;});
  try{expect(()=>preparePoolInterpolatedFootRotation(p.tokens[0],p.tokens[1],p.control,location)).toThrow('generic interpolation');}finally{spy.mockRestore();}
});

it.each(['source','bone','indices','weights','cage','shape','inverse','solid'] as const)('rejects postconstruction %s mutation',kind=>{
  const p=prepared(),proof=p.derive();
  if(kind==='source')p.manifest.sourceSha256='changed-source';else if(kind==='bone')p.manifest.bones[p.anatomy.lower].name='changed-role';
  else if(kind==='indices'){const part=p.geometry[0].description.parts.find(r=>r.name===p.patch.part)!;p.geometry[0].indices[part.start]=0;}
  else if(kind==='weights')new Float32Array(p.geometry[0].stencilWeights)[1]+=.001;else if(kind==='cage')p.cage[0]+=.001;else if(kind==='shape')p.shape.height+=.01;
  else if(kind==='inverse')p.pose.inverse[p.plan.end][14]+=.001;else p.fixture.solids.find(s=>s.id===p.support.surface)!.vertices[0]=[0,0,2];
  expect(()=>p.derive()).toThrow();expect(poolViolationsBeyondArithmetic(p.observation,[proof])).toEqual(p.observation.violations);
});
it.each(['points','phase','wrong-foot','garment'] as const)('rejects another observed %s owner',kind=>{
  const p=prepared();
  if(kind==='points'){p.surface.points[2331*3+2]-=.001;expect(()=>p.derive()).toThrow();}
  else if(kind==='phase'){const observation=observePoolSource(p.fixture,[p.surface,p.garment],{action:'pool_enter',phase:.3});expect(()=>p.derive(p.surface,observation)).toThrow();}
  else if(kind==='wrong-foot')expect(()=>derivePoolApproachClearanceArithmetic(p.fixture,p.surface,p.cage,p.pose,p.compiler.anatomy.footR.front!,p.support,'footR',p.reference,p.plan,p.observation)).toThrow();
  else expect(()=>derivePoolApproachClearanceArithmetic(p.fixture,p.garment,p.cages[1],p.pose,p.patch,p.support,'footL',p.reference,p.plan,p.observation)).toThrow();
});
it('retains genuine other-solid and garment witnesses',()=>{
  const p=prepared(true),points=p.garment.points.slice();points.set(p.surface.points.slice(2331*3,2331*3+3),0);
  const garment={geometry:p.garment.geometry,points},observation=observePoolSource(p.fixture,[p.surface,garment],location),proof=p.derive(p.surface,observation),remaining=poolViolationsBeyondArithmetic(observation,[proof]);
  const other=observation.violations.filter(v=>v.part===p.patch.part&&v.surface==='Other actual solid');expect(other.length).toBeGreaterThan(0);expect(remaining).toEqual(expect.arrayContaining(other));
  const garmentNames=new Set(p.geometry[1].description.parts.map(p=>p.name)),garmentRaw=observation.violations.filter(v=>garmentNames.has(v.part??''));expect(garmentRaw.length).toBeGreaterThan(0);expect(remaining).toEqual(expect.arrayContaining(garmentRaw));
});

it('rejects an authentic source goal below the exact threshold even within a numerical output bound',()=>{
  const p=input(),positive=p.makeReference(),before=p.state.target[2],plan=solvePoolFreeLeg(p.seed,p.anatomy.upper,p.anatomy.lower,p.anatomy.end,p.state.target,p.state.orientation,positive),bound=Math.max(...requirePoolFreeFootConstruction(p.seed,plan,positive).worldError);
  p.manifest.actions.pool_enter[11][1][14]-=.2;
  const row=p.endpoints[0],seed=canonicalPoolPreference(p.manifest,p.shape,p.top,'pool_enter',.275*40,p.geometry);row.rootBasis=[...seed.basis[0]];row.control.state.target=seed.world[p.anatomy.end].slice(12,15) as unknown as Vec3;row.control.state.orientation=properPoolRotation(seed.world[p.anatomy.end]);
  const from=p.endpoint(row),to=p.endpoint(p.endpoints[1]),producer=preparePoolInterpolatedFootRotation(from,to,p.control,location),state=interpolatePoolLimbState(p.control,p.amount);
  expect(before-state.target[2]).toBeGreaterThan(0);expect(before-state.target[2]).toBeLessThan(bound);
  expect(()=>p.makeReference(state.target,state.orientation,location,producer)).toThrow('below its exact literal or proper nominal plane');
  expect(positive.kind).toBe('interpolated-free-foot-approach');
});

it.each(['endpoint','stationary','moving-spherical'] as const)('keeps authentic %s branch ownership',branch=>{
  const p=input();
  if(branch==='endpoint'){
    for(const at of [.275,.3]){const amount=at===.275?0:1,state=interpolatePoolLimbState(p.control,amount),producer=preparePoolInterpolatedFootRotation(p.tokens[0],p.tokens[1],p.control,{...location,phase:at});expect(requirePoolInterpolatedFootRotation(producer,p.manifest,p.geometry[0],p.fixture,p.patch,{...location,phase:at},state.target,state.orientation,p.seed.inverse[p.anatomy.end]).branch).toBe('endpoint');}return;
  }
  p.manifest.actions.pool_enter[10]=structuredClone(p.manifest.actions.pool_enter[11]);p.manifest.basisActions.pool_enter[10]=structuredClone(p.manifest.basisActions.pool_enter[11]);
  if(branch==='moving-spherical'){const a=.5,c=Math.cos(a),s=Math.sin(a),r=[1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1];p.manifest.basisActions.pool_enter[10][p.anatomy.end]=multiply(p.manifest.basisActions.pool_enter[10][p.anatomy.end],r);}
  const rows=[.25,.275].map(at=>{const seed=canonicalPoolPreference(p.manifest,p.shape,p.top,'pool_enter',at*40,p.geometry),control:PoolPoseControl={...p.endpoints[0].control,state:{...p.endpoints[0].control.state,target:seed.world[p.anatomy.end].slice(12,15) as unknown as Vec3,orientation:properPoolRotation(seed.world[p.anatomy.end])}};return {phase:at,control,rootBasis:seed.basis[0]};});
  const {state:from,...chain}=rows[0].control,control={...chain,from,to:rows[1].control.state},at={...location,phase:.26},state=interpolatePoolLimbState(control,(.26-.25)/(.275-.25)),producer=preparePoolInterpolatedFootRotation(p.endpoint(rows[0]),p.endpoint(rows[1]),control,at);
  expect(requirePoolInterpolatedFootRotation(producer,p.manifest,p.geometry[0],p.fixture,p.patch,at,state.target,state.orientation,p.seed.inverse[p.anatomy.end]).branch).toBe(branch);
});
