import type {Bundle,Geometry} from './bundle.js';
import type {ShapeParameters} from './shape.js';
import type {PoolFixtureV1,PoolContactInputV1,PoolContactArtifactV1,PoolPreparedTrack,PoolPreparedInterval,PoolIntervalObservation,PoolArithmeticContactRecord,PoolLimb} from './pool-contact-types.js';
import {POOL_SOLVER_REVISION,POOL_OBSERVER_REVISION,POOL_INTERPOLATION_REVISION} from './pool-contact-types.js';
import {PoolCycleSource,type PoolCycleDefinition,type PoolFoot} from './pool-cycle-source.js';
import {poolIntervalProgramControls,makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {poolIntervalPreference,interpolatePoolPoseProgram,evaluatePoolPoseProgram,poolSkinMatrices} from './pool-contact-sample.js';
import {resolvePoolLimbState,evaluatePoolLimb} from './pool-contact-evaluator.js';
import {preparePoolFootContactFrame,requirePoolFootClearanceReference,type PoolFootContactFrame} from './pool-foot-contact-frame.js';
import {solvePoolOrientedFoot,observeConstructedPoolLeg} from './pool-oriented-leg.js';
import {solvePoolFreeLeg,observeConstructedPoolFreeLeg} from './pool-free-leg.js';
import {solveCertifiedPoolRail} from './pool-rail-construction-arithmetic.js';
import {solvePoolHierarchyLimb} from './pool-canonical-pose.js';
import {configuredPoolChainReach} from './pool-entry-domain.js';
import {posedCageSurface} from './geometry-proof.js';
import {observePoolSource,type PoolSurfaceInput} from './pool-observer.js';
import {derivePoolSupportArithmetic,derivePoolApproachClearanceArithmetic,poolViolationsBeyondArithmetic,type PoolContactArithmetic} from './pool-support-arithmetic.js';
import {derivePoolRailArithmetic} from './pool-rail-support-arithmetic.js';
import {observePoolPatchSupport} from './pool-support-observer.js';
import {poolSourceRecord,poolSourcePolicy,poolSourceEvents,requirePoolPolicyEqual,requirePoolPolicyInterval,POOL_LIMBS,type PoolSourceLocation} from './pool-source-policy.js';
import {poolPartKey,poolShapeIdentity} from './pool-contact-identity.js';
import {validatePoolContactArtifact} from './pool-contact-protocol.js';
import type {PoolRailContactFrame} from './pool-rail-contact-frame.js';
import type {PreparedPoolPatch} from './pool-contact-patch.js';
import type {Vec3} from './math.js';

export interface PoolCycleDiagnostic {action:string;phase:number;stage:string;passed:boolean;program?:PoolPoseProgram;world?:number[][];basis?:number[][];skin?:Float32Array<ArrayBuffer>;raw?:unknown;unresolved?:unknown;supports?:unknown;knees?:unknown;error?:{message:string;stack?:string}}
const point=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
const same=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((v,i)=>v===b[i]);
interface Constructed {limb:PoolLimb;patch:PreparedPoolPatch;frame?:PoolFootContactFrame;rail?:PoolRailContactFrame;approach?:{frame:PoolFootContactFrame;plan:ReturnType<typeof solvePoolFreeLeg>}}

/** One evaluation feeds both physical observation and the returned immutable trajectory. */
function observe(source:PoolCycleSource,left:PoolPoseProgram,right:PoolPoseProgram,amount:number,location:PoolSourceLocation){
 const {bundle,fixture,geometry,cages,neutral}=source,{rest,inverse}=neutral,controls=poolIntervalProgramControls(left,right),actual=interpolatePoolPoseProgram(bundle,rest,inverse,left,right,amount,location);
 const replay=poolIntervalPreference(bundle,rest,inverse,left.preferenceBasis,right.preferenceBasis,amount,true),record=poolSourceRecord(fixture,location),policy=poolSourcePolicy(fixture,location.action,location.phase),constructed:Constructed[]=[],knees=[];
 for(const control of controls){
  const limb=bundle.bones[control.end].name.replace('.','') as PoolLimb,a=source.anatomy[limb];if(!a||control.upper!==a.upper||control.lower!==a.lower||control.end!==a.end)throw new Error('Pool program changed its configured limb owner');
  const support=record.limbs[limb],patch=source.patch(limb,support),resolved=resolvePoolLimbState(control,amount,location),state=resolved.state;
  if(limb==='footL'||limb==='footR'){
   if(policy[limb].required){
    const frame=source.frame(limb,support,state.target.slice(0,2) as [number,number]);
    if(!same(frame.translation,state.target)||!same(frame.orientation,state.orientation))throw new Error('Required authored foot differs from its actual physical frame');
    const plan=solvePoolOrientedFoot(replay,a.upper,a.lower,a.end,frame);knees.push(observeConstructedPoolLeg(replay,frame,plan));constructed.push({limb,patch,frame});
   }else {
    let frame:PoolFootContactFrame|undefined;
    if(support.mode==='approach'){
     if(!same(control.from.orientation,control.to.orientation))throw new Error('Compact source does not authorize a changing free-foot orientation');
     frame=source.frame(limb,support,state.target.slice(0,2) as [number,number]);
     requirePoolFootClearanceReference(frame,state.target,state.orientation,inverse[a.end],bundle);
    }
    const plan=solvePoolFreeLeg(replay,a.upper,a.lower,a.end,state.target,state.orientation,frame);knees.push(observeConstructedPoolFreeLeg(replay,plan));constructed.push({limb,patch,...(frame?{approach:{frame,plan}}:{})});
   }
  }else if(policy[limb].required){
   if(!resolved.railFrame)throw new Error('Required authored hand has no actual rail frame');
   solveCertifiedPoolRail(replay,a.upper,a.lower,a.end,resolved.railFrame,state.pole,{fixture,geometry:geometry[0],cage:cages[0],patch,support});constructed.push({limb,patch,rail:resolved.railFrame});
  }else {
   const lengths=configuredPoolChainReach(rest,a.upper,a.lower,a.end).lengths,prepared=evaluatePoolLimb({start:point(replay.world[a.upper]),target:state.target,pole:state.pole,lengths,orientation:state.orientation,anchor:control.anchor,upperReference:replay.world[a.upper],lowerReference:replay.world[a.lower]});
   solvePoolHierarchyLimb(replay,a.upper,a.lower,a.end,prepared.end,state.pole,state.orientation);constructed.push({limb,patch});
  }
 }
 if(actual.world.some((m,i)=>!same(m,replay.world[i])))throw new Error('Pool complete producer differs from its runtime replay');
 const skin=poolSkinMatrices(actual.world,inverse),surfaces:PoolSurfaceInput[]=geometry.map((g,i)=>({geometry:g,points:posedCageSurface(g,cages[i],skin)})),observation=observePoolSource(fixture,surfaces,location);
 const arithmetic:PoolContactArithmetic[]=constructed.flatMap<PoolContactArithmetic>(c=>c.frame?[derivePoolSupportArithmetic(fixture,surfaces[0],cages[0],replay,c.patch,record.limbs[c.limb],c.frame,observation)]:c.rail?[derivePoolRailArithmetic(fixture,surfaces[0],cages[0],replay,c.patch,record.limbs[c.limb],c.rail,observation)]:c.approach?[derivePoolApproachClearanceArithmetic(fixture,surfaces[0],cages[0],replay,c.patch,record.limbs[c.limb],c.limb as PoolFoot,c.approach.frame,c.approach.plan,observation)]:[]);
 const supports=constructed.map(c=>({limb:c.limb,...observePoolPatchSupport(fixture,surfaces,c.patch,record.limbs[c.limb],location.phase,observation,arithmetic)})),unresolved=poolViolationsBeyondArithmetic(observation,arithmetic);
 const minimum=Math.min(...observation.parts.map(p=>p.worstObserved?.signedClearance??Infinity)),airway=observation.parts.filter(p=>/nose|smile/i.test(p.name)),airwayMinimum=airway.length?Math.min(...airway.map(p=>p.minimum[2])):null;
 const passed=knees.length===2&&knees.every(k=>k.admitted)&&supports.every(s=>s.satisfied)&&!unresolved.length&&Number.isFinite(minimum)&&(location.action==='pool_enter'||airwayMinimum!==null&&airwayMinimum>=fixture.waterHeight);
 return {pose:replay,skin,surfaces,observation,arithmetic,supports,unresolved,knees,constructed,minimum,airwayMinimum,passed};
}
type Observation=ReturnType<typeof observe>;
function receipt(result:Observation,fraction:number):PoolIntervalObservation {
 if(!result.passed)throw new Error('Unadmitted pool observation cannot become coverage');
 const arithmeticContacts:PoolArithmeticContactRecord[]=[];
 for(const proof of result.arithmetic){
  const raw=result.observation.violations.find(w=>w.part===proof.part&&w.surface===proof.surface)?.signedClearance??0;
  if('kind' in proof){if(raw<0)throw new Error('A free-foot classification requires an explicit artifact method before publication');continue;}
  if('method' in proof)arithmeticContacts.push({method:'constructive-rail-edge-v1',part:proof.part,surface:proof.surface,rawClearance:raw,bound:proof.maximumOutputError,activeVertex:proof.activeVertex,planeX:proof.planeX,edge:proof.edge,incidentFacets:proof.incidentFacets,activePointResidual:proof.actualActivePointResidual});
  else {const frame=result.constructed.find(c=>c.frame?.part===proof.part)?.frame;if(!frame)throw new Error('Foot coverage lost its physical frame');arithmeticContacts.push({method:'constructive-horizontal-foot-v1',part:proof.part,surface:proof.surface,rawClearance:raw,bound:proof.maximumOutputError,activeVertex:proof.activeVertex,planeHeight:frame.planeHeight});}
 }
 return {fraction,minimumObservedClearance:result.minimum,minimumClassifiedClearance:Math.max(0,result.minimum),airwayMinimum:result.airwayMinimum,arithmeticContacts,rootReachSatisfied:true,supports:result.supports.filter(s=>s.required).map(s=>({limb:s.limb,satisfied:true}))};
}

/** Compile all entry, paddle and exit-bridge events before publishing any pool artifact. */
export function compilePoolCycle(input:PoolContactInputV1,bundle:Bundle,shape:ShapeParameters,top:number,geometry:readonly Geometry[],fixture:PoolFixtureV1,definition:PoolCycleDefinition,diagnostic?:(row:PoolCycleDiagnostic)=>void):PoolContactArtifactV1 {
 const source=new PoolCycleSource(bundle,shape,top,geometry,fixture,definition),poses:PoolPoseProgram[]=[],entry:PoolPreparedTrack={keys:[],intervals:[]},paddle:PoolPreparedTrack={keys:[],intervals:[]},bridges:PoolPreparedTrack[]=[],failures:string[]=[];
 const measured=new Map<string,Observation>();
 const assess=(left:PoolPoseProgram,right:PoolPoseProgram,amount:number,location:PoolSourceLocation,stage:string)=>{
  try{const result=observe(source,left,right,amount,location);diagnostic?.({...location,stage,passed:result.passed,...(amount===0||amount===1?{program:amount===0?left:right}:{}),world:result.pose.world,basis:result.pose.basis,skin:result.skin,raw:result.observation.violations,unresolved:result.unresolved,supports:result.supports,knees:result.knees});if(!result.passed)failures.push(location.action+' '+location.phase+' has '+result.unresolved.length+' unresolved crossings or lost support');return result;
  }catch(error){const cause=error instanceof Error?error:new Error(String(error));failures.push(location.action+' '+location.phase+': '+cause.message);diagnostic?.({...location,stage,passed:false,error:{message:cause.message,stack:cause.stack}});return undefined;}
 };
 for(const phase of poolSourceEvents(fixture,'pool_enter')){
  try{const program=source.entry(phase),pose=poses.length;poses.push(program);entry.keys.push({phase,pose});const result=assess(program,program,0,{action:'pool_enter',phase},'entry-key');if(result)measured.set('pool_enter:'+phase,result);}
  catch(error){const cause=error instanceof Error?error:new Error(String(error));failures.push('pool_enter '+phase+': '+cause.message);diagnostic?.({action:'pool_enter',phase,stage:'entry-source',passed:false,error:{message:cause.message,stack:cause.stack}});}
 }
 const common=entry.keys.at(-1)?.pose;if(common===undefined||entry.keys.at(-1)!.phase!==1)throw new Error('Pool complete source has no paddle join: '+failures.slice(0,8).join('; '));
 for(let i=0;i<12;i++){
  const phase=i/12;
  try{const program=i===0?poses[common]:source.paddle(phase),pose=i===0?common:poses.length;if(i)poses.push(program);paddle.keys.push({phase,pose});const result=assess(program,program,0,{action:'pool_paddle',phase},'paddle-key');if(result)measured.set('pool_paddle:'+phase,result);}
  catch(error){const cause=error instanceof Error?error:new Error(String(error));failures.push('pool_paddle '+phase+': '+cause.message);diagnostic?.({action:'pool_paddle',phase,stage:'paddle-source',passed:false,error:{message:cause.message,stack:cause.stack}});}
 }
 paddle.keys.push({phase:1,pose:common});if(measured.has('pool_paddle:0'))measured.set('pool_paddle:1',measured.get('pool_paddle:0')!);
 if(failures.length)throw new Error('Pool complete source key admission failed: '+failures.slice(0,12).join('; '));
 const complete=(track:PoolPreparedTrack,action:string,timeScale=1)=>{
  for(let i=0;i<track.keys.length-1;i++){
   const a=track.keys[i],b=track.keys[i+1],left=poses[a.pose],right=poses[b.pose],start=a.phase*timeScale,end=b.phase*timeScale,phase=start+(end-start)/2,policy=poolSourcePolicy(fixture,action,phase);
   const supportLimbs=POOL_LIMBS.filter(limb=>left.policy[limb].required||right.policy[limb].required||policy[limb].required);requirePoolPolicyInterval(left.policy,right.policy,policy,supportLimbs);
   const observations=[];
   for(const fraction of [0,.25,.5,.75,1]){const at=fraction===0?start:fraction===1?end:start+(end-start)*fraction,key=action+':'+at;let result=(fraction===0||fraction===1)?measured.get(key):undefined;
    result??=assess(left,right,fraction,{action,phase:at},'interval');if(result?.passed)observations.push(receipt(result,fraction));
   }
   if(observations.length!==5)continue;
   const interval:PoolPreparedInterval={policy,controls:poolIntervalProgramControls(left,right),supportLimbs,observations,observerRevision:POOL_OBSERVER_REVISION,interpolationRevision:POOL_INTERPOLATION_REVISION,status:'measured'};track.intervals.push(interval);
  }
 };
 complete(entry,'pool_enter');complete(paddle,'pool_paddle');
 for(let origin=0;origin<12;origin++){
  const first=paddle.keys.find(k=>k.phase===origin/12);if(!first)throw new Error('Pool bridge lost its actual paddle origin');
  const track:PoolPreparedTrack={keys:[{phase:0,pose:first.pose},{phase:1,pose:common}],intervals:[]};bridges.push(track);complete(track,'pool_exit_'+origin,.1);
 }
 if(failures.length||entry.intervals.length!==entry.keys.length-1||paddle.intervals.length!==paddle.keys.length-1||bridges.some(t=>t.intervals.length!==1))throw new Error('Pool complete source interval admission failed: '+failures.slice(0,12).join('; '));
 // Exit tails share exactly the measured entry path; each action must retain those physical obligations and outputs.
 for(let origin=0;origin<12;origin++)for(let i=0;i<entry.keys.length-1;i++){
  const a=entry.keys[i],b=entry.keys[i+1],left=poses[a.pose],right=poses[b.pose];
  for(const amount of [0,.5,1]){
   const travel=amount===0?a.phase:amount===1?b.phase:a.phase+(b.phase-a.phase)*amount,phase=travel===1?.1:travel===0?1:1-.9*travel,action='pool_exit_'+origin;
   const forward=poolSourcePolicy(fixture,'pool_enter',travel),reverse=poolSourcePolicy(fixture,action,phase);
   for(const limb of POOL_LIMBS){const expected=forward[limb],actual=reverse[limb];if(actual.required!==expected.required||actual.surface!==expected.surface||JSON.stringify(actual.region)!==JSON.stringify(expected.region))throw new Error('Pool exit tail changes its shared physical obligation: '+action+' '+phase);}
   const expected=interpolatePoolPoseProgram(bundle,source.neutral.rest,source.neutral.inverse,left,right,amount,{action:'pool_enter',phase:travel}),actual=interpolatePoolPoseProgram(bundle,source.neutral.rest,source.neutral.inverse,left,right,amount,{action,phase});
   if(actual.world.some((m,bone)=>!same(m,expected.world[bone])))throw new Error('Pool exit source context changes its shared actual pose');
  }
 }
 const all=[entry,paddle,...bridges].flatMap(track=>track.intervals.flatMap(interval=>interval.observations));
 const artifact:PoolContactArtifactV1={version:1,solverRevision:POOL_SOLVER_REVISION,key:input.key,appearanceKey:input.appearanceKey,revisions:input.revisions,source:bundle.sourceSha256,partKeys:geometry.map(poolPartKey),shapeKey:poolShapeIdentity(shape,top),top,waterHeight:fixture.waterHeight,graph:{poses,entry,paddle,bridges},coverage:{observerRevision:POOL_OBSERVER_REVISION,samples:all.filter(o=>o.fraction===0||o.fraction===1).length,interpolationSamples:all.filter(o=>o.fraction!==0&&o.fraction!==1).length,minimumObservedClearance:Math.min(...all.map(o=>o.minimumObservedClearance)),minimumClassifiedClearance:Math.min(...all.map(o=>o.minimumClassifiedClearance)),continuousBound:false}};
 validatePoolContactArtifact(artifact);return artifact;
}
