import {freePoolPolicy,syntheticPoolPolicyFixture} from './pool-policy-fixture.js';
import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {identity,length,multiply,sub} from '../src/render/character/math.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {configuredJointSetup} from '../src/render/character/pose-joints.js';
import {poolContactAppearanceKey,poolPartKey,poolShapeIdentity} from '../src/render/character/pool-contact-identity.js';
import {freezePoolContactArtifact,freezePoolPlayback,makePoolContactInput,validatePoolArtifactForInput,validatePoolContactArtifact} from '../src/render/character/pool-contact-protocol.js';
import {bindPoolContacts,PoolContactNotReadyError,preparePoolRendererBinding,requirePoolPose} from '../src/render/character/pool-contact-sample.js';
import {POOL_INTERPOLATION_REVISION,POOL_OBSERVER_REVISION,POOL_SOLVER_REVISION,type PoolContactArtifactV1,type PoolContactInputDataV1,type PoolPreparedTrack,type PoolArithmeticContactRecord} from '../src/render/character/pool-contact-types.js';
import {observePoolInput,poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';
import {poolSourcePolicy,poolPolicySupportLimbs} from '../src/render/character/pool-source-policy.js';
import {poolIntervalProgramControls} from '../src/render/character/pool-pose-program.js';
import type {PoolIntervalLimb} from '../src/render/character/pool-contact-evaluator.js';

const appearance=defaultAppearance('masculine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(poolBase.vertices);
const surfaces=observePoolInput(appearance,'pool_enter',0).surfaces,geometry=surfaces[0].geometry,extras=surfaces.slice(1).map(surface=>surface.geometry);
const revisions={body:'1'.repeat(64),garments:'2'.repeat(64),clips:'3'.repeat(64),fixture:'4'.repeat(64),observer:POOL_OBSERVER_REVISION,interpolation:POOL_INTERPOLATION_REVISION};
function artifact():PoolContactArtifactV1 {
  const left=Array.from({length:17},identity),right=Array.from({length:17},identity);
  right[0][12]=.1;right[0][13]=.2;right[0][14]=.3;
  right[5]=[0,0,-1,0,0,1,0,0,1,0,0,0,0,0,0,1];
  return {version:1,solverRevision:POOL_SOLVER_REVISION,key:'pool-v1:'+'a'.repeat(64),appearanceKey:poolContactAppearanceKey(appearance),revisions:{...revisions},
    source:poolRig.manifest.sourceSha256,partKeys:[geometry,...extras].map(poolPartKey),shapeKey:poolShapeIdentity(shape,top),top,waterHeight:.82,
    graph:{poses:[{preferenceBasis:left,controls:[],policy:freePoolPolicy()},{preferenceBasis:right,controls:[],policy:freePoolPolicy()}],entry:track([{phase:0,pose:0},{phase:1,pose:1}]),
      paddle:track(Array.from({length:13},(_,index)=>({phase:index/12,pose:1}))),
      bridges:Array.from({length:12},()=>track([{phase:0,pose:1},{phase:1,pose:1}]))},
    coverage:{observerRevision:POOL_OBSERVER_REVISION,samples:75,interpolationSamples:25,minimumObservedClearance:0,minimumClassifiedClearance:0,continuousBound:false}};
}
function track(keys:{phase:number;pose:number}[]):PoolPreparedTrack{return {keys,intervals:keys.slice(1).map(()=>({controls:[],supportLimbs:[],policy:freePoolPolicy(),
  observations:[0,.5,1].map(fraction=>({fraction,minimumObservedClearance:0,minimumClassifiedClearance:0,arithmeticContacts:[],airwayMinimum:1,rootReachSatisfied:true as const,supports:[]})),
  observerRevision:POOL_OBSERVER_REVISION,interpolationRevision:POOL_INTERPOLATION_REVISION,status:'measured' as const}))};}

it('rejects a missing, unbound or physically stale trajectory before sampling',()=>{
  expect(()=>requirePoolPose(undefined,geometry,shape,top,'pool_enter',0)).toThrow(PoolContactNotReadyError);
  const value=artifact();expect(()=>requirePoolPose(value,geometry,shape,top,'pool_enter',0)).toThrow(PoolContactNotReadyError);
  for(const field of ['source','shapeKey'] as const){const stale=structuredClone(value);stale[field]+='stale';expect(()=>bindPoolContacts(stale,geometry,shape,top,extras,syntheticPoolPolicyFixture())).toThrow(PoolContactNotReadyError);}
  expect(()=>bindPoolContacts(value,geometry,shape,top,[],syntheticPoolPolicyFixture())).toThrow(PoolContactNotReadyError);
  const stale=structuredClone(value);stale.partKeys[1]+='stale';expect(()=>bindPoolContacts(stale,geometry,shape,top,extras,syntheticPoolPolicyFixture())).toThrow(PoolContactNotReadyError);
  bindPoolContacts(value,geometry,shape,top,extras,syntheticPoolPolicyFixture());expect(requirePoolPose(value,geometry,shape,top,'pool_enter',0).length).toBe(272);
  expect(()=>requirePoolPose(value,geometry,{...shape,height:shape.height+1},top,'pool_enter',0)).toThrow(PoolContactNotReadyError);
});

it('freezes nested observations even when the received artifact was already shallow-frozen',()=>{
  const value=Object.freeze(artifact());
  expect(freezePoolContactArtifact(value)).toBe(value);
  const observation=value.graph.entry.intervals[0].observations[1];
  expect(Object.isFrozen(observation)).toBe(true);
  expect(()=>{observation.minimumClassifiedClearance=-1;}).toThrow();
  const changed=structuredClone(value);
  changed.graph.entry.intervals[0].observations[1].minimumClassifiedClearance=-1;
  expect(()=>freezePoolContactArtifact(changed)).toThrow('failed physical observation');
});

it('keeps configured target motion separate from measured graph evidence',()=>{
  const measured=artifact();
  const configured={...measured,kind:'configured-shape',family:'a'.repeat(64)};
  expect(()=>freezePoolPlayback(configured)).toThrow('Invalid shape-configured pool route');
  expect(()=>validatePoolContactArtifact(configured)).toThrow('does not carry measured interval evidence');
});

it('only publishes a completed renderer binding for a matching body, outfit and fixture',async()=>{
  const a=artifact(),fixture=syntheticPoolPolicyFixture();
  const cancelled=new AbortController();cancelled.abort();
  await expect(preparePoolRendererBinding(cancelled.signal,a,geometry,shape,top,extras,fixture)).rejects.toMatchObject({name:'AbortError'});
  expect(()=>requirePoolPose(a,geometry,shape,top,'pool_enter',0)).toThrow(PoolContactNotReadyError);
  await preparePoolRendererBinding(new AbortController().signal,a,geometry,shape,top,extras,fixture);
  const other={...geometry,indices:geometry.indices.slice()};
  bindPoolContacts(a,other,shape,top,extras,fixture);
  expect(requirePoolPose(a,other,shape,top,'pool_enter',0)).toEqual(requirePoolPose(a,geometry,shape,top,'pool_enter',0));
  expect(()=>bindPoolContacts(a,other,shape,top,[],fixture)).toThrow(PoolContactNotReadyError);
  const wrong=structuredClone(fixture);wrong.clips.pool_enter.samples[0].limbs.handL.mode='support';
  expect(()=>bindPoolContacts(a,other,shape,top,extras,wrong)).toThrow();
});

it('retains raw negative observations separately from explicitly classified horizontal contacts',()=>{
  const value=artifact(),observation=value.graph.entry.intervals[0].observations[1];
  observation.minimumObservedClearance=-3e-7;value.coverage.minimumObservedClearance=-3e-7;
  expect(()=>validatePoolContactArtifact(value)).toThrow('no matching constructive classification');
  observation.arithmeticContacts=[{method:'constructive-horizontal-foot-v1',part:'Creator bare foot L',surface:'ground:approach',rawClearance:-3e-7,bound:8e-7,activeVertex:0,planeHeight:0}];
  expect(()=>validatePoolContactArtifact(value)).not.toThrow();expect(observation.minimumObservedClearance).toBe(-3e-7);
  const hand=structuredClone(value);hand.graph.entry.intervals[0].observations[1].arithmeticContacts[0].part='Relaxed palm';
  expect(()=>validatePoolContactArtifact(hand)).toThrow('constructive contact classification');
});

it('retains four distinct foot and rail records without treating schema metadata as a physical proof',()=>{
  const value=artifact(),observation=value.graph.entry.intervals[0].observations[1];
  const common={rawClearance:-3e-7,bound:8e-7,activeVertex:0};
  observation.arithmeticContacts=[
    {method:'constructive-horizontal-foot-v1',part:'Creator bare foot L',surface:'tread1',planeHeight:0,...common},
    {method:'constructive-horizontal-foot-v1',part:'Creator bare foot R',surface:'tread2',planeHeight:0,...common},
    {method:'constructive-rail-edge-v1',part:'Relaxed palm',surface:'rail1',planeX:-.66,edge:[1,2],incidentFacets:[3,4],activePointResidual:1e-8,...common},
    {method:'constructive-rail-edge-v1',part:'Relaxed palm.001',surface:'rail2',planeX:-.33,edge:[5,6],incidentFacets:[7,8],activePointResidual:2e-8,...common},
  ];
  observation.minimumObservedClearance=-3e-7;value.coverage.minimumObservedClearance=-3e-7;
  expect(()=>validatePoolContactArtifact(value)).not.toThrow();expect(observation.arithmeticContacts[2].rawClearance).toBe(-3e-7);
  for(const invalid of [
    {...observation.arithmeticContacts[2],part:'Resting thumb'},
    {...observation.arithmeticContacts[2],method:'constructive-horizontal-foot-v1',planeHeight:0},
    {...observation.arithmeticContacts[2],edge:[1,1]},
    {...observation.arithmeticContacts[2],edge:[1,1.5]},
    {...observation.arithmeticContacts[2],incidentFacets:[]},
    {...observation.arithmeticContacts[2],incidentFacets:[3,3]},
    {...observation.arithmeticContacts[2],activePointResidual:9e-7},
    {...observation.arithmeticContacts[2],rawClearance:-9e-7},
    {...observation.arithmeticContacts[2],planeX:Infinity},
  ]){const broken=structuredClone(value);broken.graph.entry.intervals[0].observations[1].arithmeticContacts[2]=invalid as PoolArithmeticContactRecord;expect(()=>validatePoolContactArtifact(broken)).toThrow();}
  const duplicate=structuredClone(value);duplicate.graph.entry.intervals[0].observations[1].arithmeticContacts[3]=duplicate.graph.entry.intervals[0].observations[1].arithmeticContacts[2];
  expect(()=>validatePoolContactArtifact(duplicate)).toThrow('constructive contact classification');
});

it('rejects child translations, scale, shear and reflected bases',()=>{
  expect(()=>validatePoolContactArtifact(artifact())).not.toThrow();
  for(const [at,value] of [[12,.01],[0,1.1],[1,.1],[0,-1],[15,2]]){
    const broken=artifact();broken.graph.poses[0].preferenceBasis[5][at]=value;
    expect(()=>validatePoolContactArtifact(broken)).toThrow();
  }
});

it('rejects old postsolve nodes, stale revision and rewritten endpoint programs',()=>{
  const old=artifact(),node=old.graph.poses[0] as unknown as Record<string,unknown>;
  node.basis=node.preferenceBasis;delete node.preferenceBasis;delete node.controls;
  expect(()=>validatePoolContactArtifact(old)).toThrow('pre-control preference');
  const stale=artifact();stale.revisions.interpolation='pool-canonical-contact-v3';expect(()=>validatePoolContactArtifact(stale)).toThrow('revision');
  const value=artifact(),state={target:[.1,.2,1.1] as const,pole:[0,1,0] as const,orientation:identity()};
  value.graph.poses.forEach(pose=>{pose.controls=[{upper:4,lower:5,end:6,anchor:[0,0,0,1],state}];});
  for(const track of [value.graph.entry,value.graph.paddle,...value.graph.bridges])track.intervals.forEach((interval,index)=>{interval.controls=poolIntervalProgramControls(value.graph.poses[track.keys[index].pose],value.graph.poses[track.keys[index+1].pose]);});
  expect(()=>validatePoolContactArtifact(value)).not.toThrow();
  const changed=structuredClone(value),endpoint=changed.graph.entry.intervals[0].controls[0];endpoint.to={...endpoint.to,target:[.2,.2,1.1]};
  expect(()=>validatePoolContactArtifact(changed)).toThrow('authoritative node programs');
  const missing=structuredClone(value);missing.graph.entry.intervals[0].controls=[];expect(()=>validatePoolContactArtifact(missing)).toThrow('authoritative node programs');
  const incompatible=structuredClone(value);incompatible.graph.poses[1].controls[0].anchor=[.1,0,0,1];expect(()=>validatePoolContactArtifact(incompatible)).toThrow('incompatible');
});

it('requires the current oriented control for every declared supported foot at binding',()=>{
  const value=artifact(),interval=value.graph.entry.intervals[0],bones=geometry.manifest.bones;
  const policy=freePoolPolicy();policy.footL={mode:'support',surface:'ground:approach',region:{kind:'top-face'},required:true};
  value.graph.poses.forEach(pose=>{pose.policy=structuredClone(policy);});
  for(const track of [value.graph.entry,value.graph.paddle,...value.graph.bridges])for(const interval of track.intervals){interval.policy=structuredClone(policy);interval.supportLimbs=['footL'];interval.observations.forEach(observation=>{observation.supports=[{limb:'footL',satisfied:true}];});}
  expect(()=>bindPoolContacts(value,geometry,shape,top,extras,syntheticPoolPolicyFixture(policy))).toThrow(PoolContactNotReadyError);
  const state={target:[0,0,0] as const,pole:[0,1,0] as const,orientation:identity()};
  const control={upper:bones.findIndex(bone=>bone.name==='thigh.L'),lower:bones.findIndex(bone=>bone.name==='shin.L'),end:bones.findIndex(bone=>bone.name==='foot.L'),anchor:[0,0,0,1] as const,from:state,to:state};
  const program=(artifact:PoolContactArtifactV1,control:PoolIntervalLimb)=>{
    const {from,to,...chain}=control;artifact.graph.poses.forEach(pose=>{pose.controls=[{...chain,state:from}];});
    for(const track of [artifact.graph.entry,artifact.graph.paddle,...artifact.graph.bridges])track.intervals.forEach((interval,index)=>{interval.controls=poolIntervalProgramControls(artifact.graph.poses[track.keys[index].pose],artifact.graph.poses[track.keys[index+1].pose]);});
  };
  const missing=structuredClone(value);program(missing,control);
  expect(()=>bindPoolContacts(missing,geometry,shape,top,extras,syntheticPoolPolicyFixture(policy))).toThrow(PoolContactNotReadyError);
  const valid=structuredClone(value);program(valid,{...control,legFrame:'source-entry-0'});
  expect(()=>bindPoolContacts(valid,geometry,shape,top,extras,syntheticPoolPolicyFixture(policy))).not.toThrow();
  const stale=structuredClone(valid);(stale.graph.entry.intervals[0].controls[0] as {legFrame:string}).legFrame='old-point-policy';
  expect(()=>validatePoolContactArtifact(stale)).toThrow('oriented leg frame');
  const revision=structuredClone(valid);revision.revisions.interpolation='pool-canonical-contact-v2';
  expect(()=>validatePoolContactArtifact(revision)).toThrow('revision');
});

it('keeps every child rest offset and segment length through actual fractional sampling',()=>{
  const value=artifact();bindPoolContacts(value,geometry,shape,top,extras,syntheticPoolPolicyFixture());
  const {rest}=configuredJointSetup(poolRig.manifest,shape,'pool_enter',0,top),count=poolRig.manifest.actions.pool_enter.length;
  for(const fraction of [0,.001,.125,.3,.5,.73,.999,1]){
    const matrices=requirePoolPose(value,geometry,shape,top,'pool_enter',fraction*(count-1));
    const posed=rest.map((r,index)=>multiply(matrices.subarray(index*16,index*16+16),r));
    for(let index=1;index<17;index++){
      const parent=poolRig.manifest.bones[index].parent;
      const actual=length(sub(posed[index].slice(12,15) as [number,number,number],posed[parent].slice(12,15) as [number,number,number]));
      const expected=length(sub(rest[index].slice(12,15) as [number,number,number],rest[parent].slice(12,15) as [number,number,number]));
      expect(actual,`${fraction}: ${poolRig.manifest.bones[index].name}`).toBeCloseTo(expected,6);
    }
  }
});

it('freezes all bound graph data and rejects missing, stale or failed interval evidence',()=>{
  const original=artifact();bindPoolContacts(original,geometry,shape,top,extras,syntheticPoolPolicyFixture());
  expect(Object.isFrozen(original.graph.poses[0].preferenceBasis[0])).toBe(true);
  expect(()=>{original.graph.poses[0].preferenceBasis[0][12]=1;}).toThrow();
  const invalid=[
    (value:PoolContactArtifactV1)=>value.graph.entry.intervals.pop(),
    (value:PoolContactArtifactV1)=>value.graph.entry.intervals[0].observations.splice(1,1),
    (value:PoolContactArtifactV1)=>{value.graph.entry.intervals[0].observations[1].minimumObservedClearance=-.001;},
    (value:PoolContactArtifactV1)=>{value.graph.bridges[0].keys[0].pose=0;},
    (value:PoolContactArtifactV1)=>{value.coverage.samples++;},
    (value:PoolContactArtifactV1)=>{value.graph.entry.intervals[0].supportLimbs=['handL'];},
    (value:PoolContactArtifactV1)=>{value.graph.paddle.intervals[0].observations[1].airwayMinimum=null;},
    (value:PoolContactArtifactV1)=>{value.graph.bridges[0].intervals[0].observations[1].airwayMinimum=.81;},
  ];
  for(const mutate of invalid){const value=artifact();mutate(value);expect(()=>validatePoolContactArtifact(value)).toThrow();}
});

it('samples exact shared paddle, bridge and reverse-entry endpoints from one pose',()=>{
  const value=artifact();bindPoolContacts(value,geometry,shape,top,extras,syntheticPoolPolicyFixture());
  const end=requirePoolPose(value,geometry,shape,top,'pool_enter',poolRig.manifest.actions.pool_enter.length-1);
  for(let origin=0;origin<12;origin++){
    const action='pool_exit_'+origin,count=poolRig.manifest.actions[action].length;
    expect(requirePoolPose(value,geometry,shape,top,action,0)).toEqual(end);
    expect(requirePoolPose(value,geometry,shape,top,action,.1*(count-1))).toEqual(end);
    expect(requirePoolPose(value,geometry,shape,top,action,(count-1),true)).toEqual(requirePoolPose(value,geometry,shape,top,'pool_enter',0));
  }
});

it('keys each physical source and keeps uniform palette changes outside the physical key',async()=>{
  const data:PoolContactInputDataV1={version:1 as const,solverRevision:POOL_SOLVER_REVISION,appearance,appearanceKey:poolContactAppearanceKey(appearance),revisions};
  const original=await makePoolContactInput(data);
  const prepared=artifact();prepared.key=original.key;
  expect(()=>validatePoolArtifactForInput(prepared,original)).not.toThrow();
  for(const field of ['body','garments','clips','fixture'] as const){
    const changed=await makePoolContactInput({...data,revisions:{...revisions,[field]:'f'.repeat(64)}});
    expect(changed.key).not.toBe(original.key);
    expect(()=>validatePoolArtifactForInput(prepared,changed)).toThrow();
  }
  const changed=await makePoolContactInput({...data,appearance:{...appearance,body:{...appearance.body,height:99}}});expect(changed.key).not.toBe(original.key);
  const palette=structuredClone(appearance);palette.colors.trousers=[235,16,50];palette.colors.shirt=[80,100,240];
  expect((await makePoolContactInput({...data,appearance:palette})).key).toBe(original.key);
});


it('rejects coherent interval support removal from authoritative endpoint source policy',()=>{
  const value=artifact(),source=poolFixture.clips.pool_enter.samples.find(sample=>sample.phase===.2)!;
  const policy=Object.fromEntries(Object.entries(source.limbs).map(([limb,support])=>[limb,{mode:support.mode,surface:support.surface,region:structuredClone(support.region),required:true}]));
  for(const pose of value.graph.poses)(pose as unknown as Record<string,unknown>).policy=structuredClone(policy);
  for(const track of [value.graph.entry,value.graph.paddle,...value.graph.bridges])for(const interval of track.intervals){
    (interval as unknown as Record<string,unknown>).policy=structuredClone(policy);interval.supportLimbs=['handL','handR','footL','footR'];
    interval.observations.forEach(observation=>{observation.supports=interval.supportLimbs.map(limb=>({limb,satisfied:true}));});
  }
  expect(()=>validatePoolContactArtifact(value)).not.toThrow();
  const removed=structuredClone(value),interval=removed.graph.entry.intervals[0];interval.supportLimbs=interval.supportLimbs.filter(limb=>limb!=='handL');interval.observations.forEach(observation=>{observation.supports=observation.supports.filter(support=>support.limb!=='handL');});
  expect(()=>validatePoolContactArtifact(removed)).toThrow('source contact policy');
});


it('binds source policy to the independently supplied fixture and rejects coherent mode rewriting',()=>{
  const value=artifact(),policy=freePoolPolicy(),bones=geometry.manifest.bones;
  policy.footL={mode:'support',surface:'ground:approach',region:{kind:'top-face'},required:true};
  const actualSource=syntheticPoolPolicyFixture(policy),state={target:[0,0,0] as const,pole:[0,1,0] as const,orientation:identity()};
  for(const node of value.graph.poses){node.policy=structuredClone(policy);node.controls=[{upper:bones.findIndex(bone=>bone.name==='thigh.L'),lower:bones.findIndex(bone=>bone.name==='shin.L'),end:bones.findIndex(bone=>bone.name==='foot.L'),anchor:[0,0,0,1],legFrame:'source-entry-0',state}];}
  for(const track of [value.graph.entry,value.graph.paddle,...value.graph.bridges])track.intervals.forEach((interval,index)=>{
    interval.policy=structuredClone(policy);interval.controls=poolIntervalProgramControls(value.graph.poses[track.keys[index].pose],value.graph.poses[track.keys[index+1].pose]);interval.supportLimbs=['footL'];interval.observations.forEach(observation=>{observation.supports=[{limb:'footL',satisfied:true}];});
  });
  expect(()=>validatePoolContactArtifact(value)).not.toThrow();expect(()=>bindPoolContacts(value,geometry,shape,top,extras,actualSource)).not.toThrow();
  const removed=structuredClone(value);removed.graph.entry.intervals[0].supportLimbs=[];removed.graph.entry.intervals[0].observations.forEach(observation=>{observation.supports=[];});
  expect(()=>validatePoolContactArtifact(removed)).toThrow('source contact policy');expect(()=>bindPoolContacts(removed,geometry,shape,top,extras,actualSource)).toThrow('source contact policy');
  const rewritten=structuredClone(value);for(const node of rewritten.graph.poses)node.policy=freePoolPolicy();
  for(const track of [rewritten.graph.entry,rewritten.graph.paddle,...rewritten.graph.bridges])for(const interval of track.intervals){interval.policy=freePoolPolicy();interval.supportLimbs=[];interval.observations.forEach(observation=>{observation.supports=[];});}
  expect(()=>validatePoolContactArtifact(rewritten)).not.toThrow();expect(()=>bindPoolContacts(rewritten,geometry,shape,top,extras,actualSource)).toThrow('source contact policy');
  const hidden=structuredClone(actualSource);hidden.clips.pool_enter.intervals[4].limbs.footL={mode:'free',surface:null,region:null,interval:null};
  expect(()=>bindPoolContacts(structuredClone(value),geometry,shape,top,extras,hidden)).toThrow('source contact policy');
  const mode=structuredClone(value);mode.graph.poses[0].policy.footL.mode='release';expect(()=>validatePoolContactArtifact(mode)).toThrow('source contact policy');
});


it('requires a release-start outcome while allowing its legitimate noncontact interior',()=>{
  const value=artifact(),left=poolSourcePolicy(poolFixture,'pool_enter',.2),right=poolSourcePolicy(poolFixture,'pool_enter',.225),middle=poolSourcePolicy(poolFixture,'pool_enter',.2125);
  value.graph.poses[0].policy=left;value.graph.poses[1].policy=right;
  for(const track of [value.graph.entry,value.graph.paddle,...value.graph.bridges])track.intervals.forEach((interval,index)=>{
    const a=value.graph.poses[track.keys[index].pose].policy,b=value.graph.poses[track.keys[index+1].pose].policy;
    interval.policy=track===value.graph.entry?middle:right;interval.supportLimbs=(['handL','handR','footL','footR'] as const).filter(limb=>a[limb].required||b[limb].required||interval.policy[limb].required);
    for(const observation of interval.observations)observation.supports=poolPolicySupportLimbs(observation.fraction===0?a:observation.fraction===1?b:interval.policy).map(limb=>({limb,satisfied:true}));
  });
  expect(value.graph.entry.intervals[0].observations[0].supports.map(support=>support.limb)).toContain('footL');
  expect(value.graph.entry.intervals[0].observations[1].supports.map(support=>support.limb)).not.toContain('footL');
  expect(()=>validatePoolContactArtifact(value)).not.toThrow();
  const lost=structuredClone(value);lost.graph.entry.intervals[0].observations[0].supports=lost.graph.entry.intervals[0].observations[0].supports.filter(support=>support.limb!=='footL');expect(()=>validatePoolContactArtifact(lost)).toThrow('support outcomes');
});


it('rejects a required hand whose source policy and numerical controls omit the actual rail goal',()=>{
  const value=artifact(),policy=freePoolPolicy(),bones=geometry.manifest.bones;
  policy.handL={mode:'support',surface:'Pool ladder rail 1',region:{kind:'rail',parameter:[1,5]},required:true};
  const state={target:[0,0,0] as const,pole:[0,1,0] as const,orientation:identity()};
  for(const node of value.graph.poses){node.policy=structuredClone(policy);node.controls=[{upper:bones.findIndex(bone=>bone.name==='upper_arm.L'),lower:bones.findIndex(bone=>bone.name==='forearm.L'),end:bones.findIndex(bone=>bone.name==='hand.L'),anchor:[0,0,0,1],state}];}
  for(const track of [value.graph.entry,value.graph.paddle,...value.graph.bridges])track.intervals.forEach((interval,index)=>{
    interval.policy=structuredClone(policy);interval.controls=poolIntervalProgramControls(value.graph.poses[track.keys[index].pose],value.graph.poses[track.keys[index+1].pose]);interval.supportLimbs=['handL'];interval.observations.forEach(observation=>{observation.supports=[{limb:'handL',satisfied:true}];});
  });
  expect(()=>validatePoolContactArtifact(value)).not.toThrow();expect(()=>bindPoolContacts(value,geometry,shape,top,extras,syntheticPoolPolicyFixture(policy))).toThrow(PoolContactNotReadyError);
});
