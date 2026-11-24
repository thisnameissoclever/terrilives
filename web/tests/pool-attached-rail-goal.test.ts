import {beforeAll,expect,it} from 'vitest';
import key from '../../assets/models/sims/character-creator/pool_activity_key_v2.json';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {poolEntrySearchPlan} from '../src/render/character/pool-entry-search-plan.js';
import {resolvePoolRailContactFrame,bindPoolRailGeometry} from '../src/render/character/pool-rail-contact-frame.js';
import {resolvePoolLimbState,interpolatePoolLimbState} from '../src/render/character/pool-contact-evaluator.js';
import {makePoolPoseProgram} from '../src/render/character/pool-pose-program.js';
import {evaluatePoolPoseProgram,interpolatePoolPoseProgram,poolSkinMatrices,bindPoolContacts,requirePoolPose,PoolContactNotReadyError} from '../src/render/character/pool-contact-sample.js';
import {multiply,type Vec3} from '../src/render/character/math.js';
import {POOL_SOLVER_REVISION,POOL_INTERPOLATION_REVISION,POOL_OBSERVER_REVISION,type PoolContactArtifactV1,type PoolPreparedTrack} from '../src/render/character/pool-contact-types.js';
import {poolPartKey,poolShapeIdentity,poolContactAppearanceKey} from '../src/render/character/pool-contact-identity.js';
import {poolSourcePolicy,requirePoolSourceSupport,poolSourceSupport,poolSourceRecord} from '../src/render/character/pool-source-policy.js';
import {poolIntervalProgramControls} from '../src/render/character/pool-pose-program.js';
import {observePoolSource} from '../src/render/character/pool-observer.js';
import {observePoolPatchSupport} from '../src/render/character/pool-support-observer.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';

function setup(){
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const compiler=new PoolEntryCompiler(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),[selected.body,selected.extra!],poolFixture);
  const domain=compiler.prepareLegDomain(key.phase,poolEntrySearchPlan(key.phase)[key.requestId]);
  const candidate=compiler.compileNodeCandidates(key.phase,{requestId:key.requestId,root:key.rootDelta as unknown as Vec3,trunkPitchDegrees:key.trunk.worldPitchDegrees,headSourcePhase:key.head.sourcePhase})[0];
  return {compiler,candidate,domain,geometry:selected.body};
}
let actual:ReturnType<typeof setup>;beforeAll(()=>{actual=setup();});
const hand=()=>actual.candidate.program.controls.find(control=>control.state.attached)!;

it('captures actual raw rail inputs and preserves constant keys, forced sides and shared-node skin exactly',()=>{
  const node=actual.candidate.program,{pose}=actual.candidate;
  expect(node.controls.filter(control=>control.state.attached)).toHaveLength(2);
  const skin=poolSkinMatrices(evaluatePoolPoseProgram(poolRig.manifest,pose.rest,pose.inverse,node).world,pose.inverse);
  expect(skin).toEqual(actual.candidate.skin);
  for(const amount of [0,Number.EPSILON,.5,1-Number.EPSILON,1])expect(poolSkinMatrices(interpolatePoolPoseProgram(poolRig.manifest,pose.rest,pose.inverse,node,node,amount).world,pose.inverse)).toEqual(skin);
  const control=hand(),goal=control.state.attached!,nextGoal={...goal,parameter:goal.parameter-.01},frame=resolvePoolRailContactFrame(goal.geometry,goal.rawOrientation,nextGoal.parameter,goal.activeVertex);
  const other=makePoolPoseProgram(node.preferenceBasis,node.controls.map(value=>value===control?{...value,state:{...value.state,target:frame.translation,orientation:frame.orientation,attached:nextGoal}}:value),node.policy);
  const otherSkin=poolSkinMatrices(evaluatePoolPoseProgram(poolRig.manifest,pose.rest,pose.inverse,other).world,pose.inverse);
  for(const [from,to,amount,expected] of [[node,other,0,skin],[node,other,1,otherSkin],[other,node,0,otherSkin],[other,node,1,skin]] as const)expect(poolSkinMatrices(interpolatePoolPoseProgram(poolRig.manifest,pose.rest,pose.inverse,from,to,amount).world,pose.inverse)).toEqual(expected);
  expect(Object.isFrozen(hand().state.attached!.rawOrientation)).toBe(true);
  expect(Object.isFrozen(hand().state.attached!.geometry.coefficients[0][0])).toBe(true);
});

it('follows both actual incident edge endpoints instead of the wrist chord',()=>{
  const control=hand(),goal=control.state.attached!,boundary=4.75;
  const from={...control.state,attached:{...goal,parameter:boundary+.02}},to={...control.state,attached:{...goal,parameter:boundary-.02}};
  const frames=[.25,.5,.75].map(amount=>resolvePoolLimbState({...control,from,to},amount).railFrame!);
  expect(frames[1].targetPoint).toEqual(goal.geometry.edges.find(({edge})=>edge.toParameter===boundary)!.to);
  expect(frames[0].edge.from).not.toBe(frames[2].edge.from);
  expect(frames.every(frame=>frame.activeVertex===goal.activeVertex)).toBe(true);
});

it('uses the existing moving raw orientation interpolation before one shared frame construction',()=>{
  const control=hand(),goal=control.state.attached!,angle=.001,c=Math.cos(angle),s=Math.sin(angle);
  const raw=multiply([1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1],goal.rawOrientation);
  const interval={...control,from:control.state,to:{...control.state,attached:{...goal,rawOrientation:raw}}};
  const input=interpolatePoolLimbState(interval,.5).attached!,direct=resolvePoolRailContactFrame(input.geometry,input.rawOrientation,input.parameter,input.activeVertex);
  expect(resolvePoolLimbState(interval,.5).railFrame).toEqual(direct);
});

it('rejects stale literal targets, changed ownership, out-of-domain parameters and unresolved extrema',()=>{
  const control=hand(),state=control.state,goal=state.attached!;
  expect(()=>resolvePoolLimbState({...control,from:{...state,target:[state.target[0]+1e-9,state.target[1],state.target[2]]},to:state},0)).toThrow('literal rail construction');
  expect(()=>resolvePoolLimbState({...control,end:control.end+1,from:state,to:state},0)).toThrow('anatomical owner');
  expect(()=>resolvePoolRailContactFrame(goal.geometry,goal.rawOrientation,0)).toThrow('allowed edge');
  expect(()=>resolvePoolRailContactFrame(goal.geometry,goal.rawOrientation,goal.parameter,goal.activeVertex+1)).toThrow('active-extremum');
  expect(()=>resolvePoolRailContactFrame(goal.geometry,Array(16).fill(NaN),goal.parameter)).toThrow('not finite');
  const singular=Array(16).fill(0);singular[15]=1;expect(()=>resolvePoolRailContactFrame(goal.geometry,singular,goal.parameter)).toThrow('singular');
});

it('binds serialized data to independent actual patch, coefficient, edge, fixture and inverse inputs',()=>{
  const control=hand(),goal=control.state.attached!,contact=actual.candidate.contacts.find(contact=>contact.anatomy.end===control.end)!,support=actual.domain.source.limbs[contact.limb];
  const bind=(data:typeof goal.geometry)=>bindPoolRailGeometry(data,poolFixture,support,actual.geometry,actual.domain.cages[0],actual.candidate.pose.inverse[control.end],contact.patch,goal.source);
  const copy=structuredClone(goal.geometry);expect(()=>makePoolPoseProgram(actual.candidate.program.preferenceBasis,[{...control,state:{...control.state,attached:{...goal,geometry:copy}}}],actual.candidate.program.policy)).toThrow('immutable physical geometry');expect(()=>resolvePoolRailContactFrame(copy,goal.rawOrientation,goal.parameter)).toThrow('no bound');
  bind(copy);expect(resolvePoolRailContactFrame(copy,goal.rawOrientation,goal.parameter)).toEqual(resolvePoolRailContactFrame(goal.geometry,goal.rawOrientation,goal.parameter));
  for(const change of [(data:any)=>data.edges[0].from[1]+=.01,(data:any)=>data.edges[0].incidentFacets[0]++,
    (data:any)=>data.inverse[12]+=.01,(data:any)=>data.patch.vertices[0].id++,
    (data:any)=>data.coefficients[0][3].numerator='0',(data:any)=>data.sourceKey+='changed']){
    const corrupted=structuredClone(goal.geometry);change(corrupted);expect(()=>bind(corrupted)).toThrow('actual physical geometry');
  }
});

it('keeps free approach and release goals in the existing bone-origin convention',()=>{
  const control=hand(),free={target:[.1,.2,.3] as const,pole:[0,0,1] as const,orientation:control.state.orientation};
  const interval={...control,from:control.state,to:free};
  expect(resolvePoolLimbState(interval,0).railFrame).toBeDefined();expect(resolvePoolLimbState(interval,.5).railFrame).toBeUndefined();expect(resolvePoolLimbState(interval,1).state).toBe(free);
  const node=makePoolPoseProgram(actual.candidate.program.preferenceBasis,[{...control,state:free}],actual.candidate.program.policy);
  expect(node.controls[0].anchor).toEqual([0,0,0,1]);expect(node.controls[0].state.attached).toBeUndefined();
});

it('binds the same point construction to exact key, immediate interior and legitimate shared source locations',()=>{
  const control=hand(),goal=control.state.attached!,key={action:'pool_enter',phase:.2},interior={action:'pool_enter',phase:.20000000000000004};
  expect(poolSourceRecord(poolFixture,key).kind).toBe('key');expect(poolSourceRecord(poolFixture,interior).kind).toBe('interior');
  expect(poolSourceSupport(poolFixture,{...key,limb:'footL'}).required).toBe(true);expect(poolSourceSupport(poolFixture,{...interior,limb:'footL'}).required).toBe(false);
  const node=resolvePoolLimbState({...control,from:control.state,to:control.state},0,key).railFrame!;
  const resolved=resolvePoolLimbState({...control,from:control.state,to:control.state},0,interior).railFrame!;expect(resolved).toEqual(node);
  const support=poolSourceSupport(poolFixture,{...interior,limb:'handL'}).support,rebound=structuredClone(goal.geometry);
  bindPoolRailGeometry(rebound,poolFixture,support,actual.geometry,actual.domain.cages[0],actual.candidate.pose.inverse[control.end],actual.compiler.anatomy.handL.patch,goal.source);
});


it('rejects another real same-rail fixture record at the actual .2 observation',()=>{
  const control=hand(),release=poolFixture.clips.pool_enter.samples.find(sample=>sample.phase===.5)!.limbs.handL;
  expect(release.mode).toBe('release');expect(release.interval).toEqual([.48,.6]);
  expect(()=>requirePoolSourceSupport(poolFixture,{action:'pool_enter',phase:.2,limb:'handL'},release)).toThrow('actual observation source context');
  const surfaces=actual.compiler.geometry.map((geometry,index)=>({geometry,points:posedCageSurface(geometry,actual.domain.cages[index],actual.candidate.skin)}));
  expect(()=>observePoolPatchSupport(poolFixture,surfaces,actual.compiler.anatomy.handL.patch,release,.2,actual.candidate.observation,actual.candidate.arithmetic)).toThrow('actual observation source context');
  // Recomputed point arrays do not own the original observation's constructive bound.
  const foreignOwner=observePoolPatchSupport(poolFixture,surfaces,actual.compiler.anatomy.handL.patch,actual.domain.source.limbs.handL,.2,actual.candidate.observation,actual.candidate.arithmetic);
  expect(foreignOwner.required).toBe(true);expect(foreignOwner.arithmeticBound).toBe(0);expect(foreignOwner.satisfied).toBe(false);expect(foreignOwner.reasons).toContain('support contact is lost');
  const owned=actual.candidate.supports.find(support=>support.patchPart===actual.compiler.anatomy.handL.patch.part)!;
  expect(owned.required).toBe(true);expect(owned.satisfied).toBe(true);expect(owned.arithmeticBound).toBeGreaterThan(0);
});

function publicAttachedFixture(){
  // Mechanical public-lifecycle fixture. Its observations are synthetic and do not admit a shipped graph.
  const fixture=structuredClone(poolFixture),source=poolFixture.clips.pool_enter.samples.find(sample=>sample.phase===.2)!.limbs;
  const free=poolFixture.clips.pool_enter.samples.find(sample=>sample.phase===.225)!.limbs.footL;
  for(const clip of Object.values(fixture.clips))for(const row of [...clip.samples,...clip.intervals])row.limbs={handL:structuredClone(source.handL),handR:structuredClone(source.handR),footL:structuredClone(free),footR:structuredClone(free)};
  const policy=poolSourcePolicy(fixture,'pool_enter',0),program=makePoolPoseProgram(actual.candidate.program.preferenceBasis,actual.candidate.program.controls,policy),nodes=[program,program];
  const track=(keys:{phase:number;pose:number}[]):PoolPreparedTrack=>({keys,intervals:keys.slice(1).map((_,index)=>({policy,controls:poolIntervalProgramControls(nodes[keys[index].pose],nodes[keys[index+1].pose]),supportLimbs:['handL','handR'],
    observations:[0,.5,1].map(fraction=>({fraction,minimumObservedClearance:0,minimumClassifiedClearance:0,arithmeticContacts:[],airwayMinimum:1,rootReachSatisfied:true,supports:[{limb:'handL',satisfied:true},{limb:'handR',satisfied:true}]})),observerRevision:POOL_OBSERVER_REVISION,interpolationRevision:POOL_INTERPOLATION_REVISION,status:'measured'}))});
  const appearance=defaultAppearance('feminine'),{shape,top}=actual.compiler,geometry=actual.geometry,extras=[actual.compiler.geometry[1]];
  const artifact:PoolContactArtifactV1={version:1,solverRevision:POOL_SOLVER_REVISION,key:'pool-v1:'+'a'.repeat(64),appearanceKey:poolContactAppearanceKey(appearance),revisions:{body:'1'.repeat(64),garments:'2'.repeat(64),clips:'3'.repeat(64),fixture:'4'.repeat(64),observer:POOL_OBSERVER_REVISION,interpolation:POOL_INTERPOLATION_REVISION},source:geometry.manifest.sourceSha256,partKeys:[geometry,...extras].map(poolPartKey),shapeKey:poolShapeIdentity(shape,top),top,waterHeight:.82,
    graph:{poses:nodes,entry:track([{phase:0,pose:0},{phase:1,pose:1}]),paddle:track(Array.from({length:13},(_,index)=>({phase:index/12,pose:1}))),bridges:Array.from({length:12},()=>track([{phase:0,pose:1},{phase:1,pose:1}]))},coverage:{observerRevision:POOL_OBSERVER_REVISION,samples:75,interpolationSamples:25,minimumObservedClearance:0,minimumClassifiedClearance:0,continuousBound:false}};
  return {artifact:structuredClone(artifact),fixture,shape,top,geometry,extras};
}

it('samples public bound keys and interiors with aliased, cloned and JSON-equivalent interval references',()=>{
  for(const representation of ['aliased','cloned','json']){
    const input=publicAttachedFixture();let artifact=input.artifact;
    if(representation==='json')artifact=JSON.parse(JSON.stringify(artifact));
    if(representation==='cloned')for(const track of [artifact.graph.entry,artifact.graph.paddle,...artifact.graph.bridges])for(const interval of track.intervals)interval.controls=structuredClone(interval.controls);
    bindPoolContacts(artifact,input.geometry,input.shape,input.top,input.extras,input.fixture);
    const count=poolRig.manifest.actions.pool_enter.length,key=requirePoolPose(artifact,input.geometry,input.shape,input.top,'pool_enter',0);
    for(const phase of [0,Number.EPSILON,.5,1-Number.EPSILON,1])expect(requirePoolPose(artifact,input.geometry,input.shape,input.top,'pool_enter',phase*(count-1))).toEqual(key);
    for(const amount of [0,1])expect(poolSkinMatrices(interpolatePoolPoseProgram(poolRig.manifest,actual.candidate.pose.rest,actual.candidate.pose.inverse,artifact.graph.poses[0],artifact.graph.poses[1],amount).world,actual.candidate.pose.inverse)).toEqual(key);
  }
});

it('rejects interval-only serialized corruption before publishing a public binding',()=>{
  const input=publicAttachedFixture(),interval=input.artifact.graph.entry.intervals[0];interval.controls=structuredClone(interval.controls);
  interval.controls.find(control=>control.from.attached)!.from.attached!.parameter+=.001;
  expect(()=>bindPoolContacts(input.artifact,input.geometry,input.shape,input.top,input.extras,input.fixture)).toThrow('authoritative node programs');
  expect(()=>requirePoolPose(input.artifact,input.geometry,input.shape,input.top,'pool_enter',0)).toThrow(PoolContactNotReadyError);
});


function sourceEventFixture(cut:boolean){
  const input=publicAttachedFixture(),{fixture,artifact}=input;
  const release=structuredClone(poolFixture.clips.pool_enter.samples.find(sample=>sample.phase===.2)!.limbs.footL);
  release.interval=[.4,.6];release.intervalSpace='clip-phase';
  for(const clip of Object.values(fixture.clips))for(const row of [...clip.samples,...clip.intervals])row.limbs.footL=structuredClone(release);
  for(const node of artifact.graph.poses)node.policy=poolSourcePolicy(fixture,'pool_enter',0);
  if(cut){
    const event=structuredClone(artifact.graph.poses[0]);event.policy=poolSourcePolicy(fixture,'pool_enter',.4);artifact.graph.poses.push(event);
    artifact.graph.entry.keys.splice(1,0,{phase:.4,pose:2});artifact.graph.paddle.keys.push({phase:.4,pose:2});artifact.graph.paddle.keys.sort((a,b)=>a.phase-b.phase);
  }
  let count=0;
  for(const {track,action,scale} of [{track:artifact.graph.entry,action:'pool_enter',scale:1},{track:artifact.graph.paddle,action:'pool_paddle',scale:1},...artifact.graph.bridges.map((track,index)=>({track,action:'pool_exit_'+index,scale:.1}))]){
    track.intervals=track.keys.slice(1).map((right,index)=>{
      count++;const left=track.keys[index],a=artifact.graph.poses[left.pose],b=artifact.graph.poses[right.pose],policy=poolSourcePolicy(fixture,action,(left.phase+right.phase)/2*scale);
      const supportLimbs=(['handL','handR','footL','footR'] as const).filter(limb=>a.policy[limb].required||b.policy[limb].required||policy[limb].required);
      return {policy,controls:poolIntervalProgramControls(a,b),supportLimbs,observerRevision:POOL_OBSERVER_REVISION,interpolationRevision:POOL_INTERPOLATION_REVISION,status:'measured',observations:[0,.5,1].map(fraction=>{
        const declared=fraction===0?a.policy:fraction===1?b.policy:policy;
        return {fraction,minimumObservedClearance:0,minimumClassifiedClearance:0,arithmeticContacts:[],airwayMinimum:1,rootReachSatisfied:true,supports:supportLimbs.filter(limb=>declared[limb].required).map(limb=>({limb,satisfied:true}))};
      })};
    });
  }
  artifact.coverage.samples=count*3;artifact.coverage.interpolationSamples=count;return input;
}

it('rejects an unsampled required source event and accepts explicit shared event cuts',()=>{
  const missing=sourceEventFixture(false);
  expect(()=>bindPoolContacts(missing.artifact,missing.geometry,missing.shape,missing.top,missing.extras,missing.fixture)).toThrow('explicit graph cut');
  const valid=sourceEventFixture(true);expect(()=>bindPoolContacts(valid.artifact,valid.geometry,valid.shape,valid.top,valid.extras,valid.fixture)).not.toThrow();
  const frame=.4*(poolRig.manifest.actions.pool_enter.length-1);expect(()=>requirePoolPose(valid.artifact,valid.geometry,valid.shape,valid.top,'pool_enter',frame)).not.toThrow();
});

it('authenticates a retained observation against the actual event policy before binding',()=>{
  const input=publicAttachedFixture(),sample=input.fixture.clips.pool_enter.samples.find(sample=>sample.phase===.5)!;
  sample.limbs.handL=structuredClone(poolFixture.clips.pool_enter.samples.find(sample=>sample.phase===.5)!.limbs.handL);
  expect(()=>bindPoolContacts(input.artifact,input.geometry,input.shape,input.top,input.extras,input.fixture)).toThrow('source contact policy');
});


it('authenticates each captured source locator even when its geometry was already bound at another key',()=>{
  const input=publicAttachedFixture(),first=input.artifact.graph.poses[0],second=structuredClone(first);
  second.controls.forEach((control,index)=>{if(control.state.attached)control.state.attached.geometry=first.controls[index].state.attached!.geometry;});
  second.controls.find(control=>control.state.attached?.source.limb==='handL')!.state.attached!.source={action:'pool_enter',phase:.6,limb:'handL'};
  input.fixture.clips.pool_enter.samples.find(sample=>sample.phase===.6)!.limbs.handL=structuredClone(poolFixture.clips.pool_enter.samples.find(sample=>sample.phase===.6)!.limbs.handL);
  input.artifact.graph.poses[1]=second;
  for(const track of [input.artifact.graph.entry,input.artifact.graph.paddle,...input.artifact.graph.bridges])track.intervals.forEach((interval,index)=>{interval.controls=poolIntervalProgramControls(input.artifact.graph.poses[track.keys[index].pose],input.artifact.graph.poses[track.keys[index+1].pose]);});
  expect(()=>bindPoolContacts(input.artifact,input.geometry,input.shape,input.top,input.extras,input.fixture)).toThrow('actual observation source context');
});
