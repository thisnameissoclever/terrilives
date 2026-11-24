import type {PoolCycleDefinition,PoolCycleSource} from './pool-cycle-source.js';
import type {NumericFoot,NumericHand} from './pool-numeric-recipe.js';
import type {PoolConfiguredGraph,PoolContactArtifactV1,PoolFixtureV1,PoolLimb} from './pool-contact-types.js';
import {configuredPoolChainReach,poolChainReachable,type PoolReachConstraint} from './pool-entry-domain.js';
import {fitAssembly} from './contact-math.js';
import {add,sub,scale,length,multiply,inverseAffine,type Vec3} from './math.js';
import {poolIntervalPreference,poolSkinMatrices,interpolatePoolPoseProgram} from './pool-contact-sample.js';
import {properPoolRotation,translatePoolRoot} from './pool-canonical-pose.js';
import {POOL_LIMBS,poolSourceEvents,poolSourcePolicy,poolSourceRecord,requirePoolPolicyInterval,type PoolSourceLocation} from './pool-source-policy.js';
import {makePoolPoseProgram,poolIntervalProgramControls,type PoolPoseProgram} from './pool-pose-program.js';
import {validatePoolKneeOrbit,type PoolLimbState,type PoolPoseControl} from './pool-contact-evaluator.js';
import {preparePoolRailGeometry,resolvePoolRailContactFrame,type PoolPreparedRailGeometry} from './pool-rail-contact-frame.js';
import {canonicalPoolValue,poolPartKey,poolShapeIdentity} from './pool-contact-identity.js';
import {samplePoolGraph,validatePoolGraph,type PoolCanonicalGraph} from './pool-motion-graph.js';
import {preparePoolShapeExterior,type PoolShapeExterior} from './pool-shape-exterior.js';
import {prepareSplitPoolPrograms,type SplitPreparationTimes} from './pool-split-cycle.js';
import type {fitClimbPassage} from './pool-climb-passage.js';
import {fitClimbHand} from './pool-climb-hand.js';
import {captureSelectedPoolKnot,type SelectedPoolHopRoute} from './pool-selected-cycle.js';
import type {PoolContactInputV1} from './pool-contact-types.js';
export {preparePoolShapeExterior} from './pool-shape-exterior.js';

const feet=['footL','footR'] as const;
const hands=['handL','handR'] as const;
const limbs=[...feet,...hands] as const;
const point=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
const mean=(points:readonly Vec3[]):Vec3=>scale(points.reduce((sum,p)=>add(sum,p),[0,0,0] as Vec3),1/points.length);
const footLimb=(l:PoolLimb):l is NumericFoot=>l==='footL'||l==='footR';

interface SoleReference {kind:'sole';place:string;delta:Vec3;referenceOrientation:readonly number[]}
interface RailReference {kind:'rail';surface:string;parameter:number;rawOrientation:readonly number[];palmBasis:readonly number[];heldFromCrest?:boolean}
interface ShapeLimbCommand {
  /** Relative to the originating joint, expressed in units of total reach and upper segment length. */
  targetFromJoint:Vec3;poleFromJoint:Vec3;orientation:readonly number[];kneeOrbit?:number;
  contact?:SoleReference|RailReference;
}
export interface PoolShapeRouteKnot {
  action:'pool_enter'|'pool_exit_0';unit:number;
  basis:number[][];referenceHip:Vec3;referenceLegLength:number;limbs:Record<PoolLimb,ShapeLimbCommand>;
}
export interface SharedPoolRoute {
  version:1;rig:string;model:string;motion:string;referenceShape:string;entry:readonly PoolShapeRouteKnot[];climbOut:readonly PoolShapeRouteKnot[];
}
export interface SplitPoolRoute {
  version:2;rig:string;model:string;motion:string;exitReferences:readonly PoolShapeRouteKnot[];
}
function checkShapeOrbits(knots:readonly PoolShapeRouteKnot[]){
  for(const k of knots)for(const limb of limbs)validatePoolKneeOrbit(k.limbs[limb].kneeOrbit,footLimb(limb));
}
function splitExitReference(source:PoolCycleSource,route:SplitPoolRoute,binder:PoolShapeRouteBinder){
  const motion=source.definition;
  if(motion.version!==16||!motion.forwardHop?.launchFromUnit||route.rig!==source.bundle.sourceSha256||
      route.model!==source.fixture.revisions.model||route.motion!==source.fixture.revisions.poseProducer)
    throw new Error('Split-level pool route has a different physical release.');
  const units=motion.forwardHop.climbKeys.flatMap(k=>k.exitReferenceUnit===undefined?[]:[k.exitReferenceUnit]);
  if(units.length!==route.exitReferences.length||route.exitReferences.some((k,i)=>k.unit!==units[i]||k.action!=='pool_exit_0'))
    throw new Error('Split-level pool route has an inconsistent independent climb clock.');
  checkShapeOrbits(route.exitReferences);
  const refs=new Map(route.exitReferences.map(k=>[k.unit,k])),programs=new Map<number,PoolPoseProgram>();
  return (u:number)=>{
    const k=refs.get(u);if(!k)throw new Error('Missing independent exit program '+u);
    let program=programs.get(u);if(!program){program=binder.at(k);programs.set(u,program);}
    return program;
  };
}
/** Reissue the exact same configured controls for the complete offline physical compiler. */
export function selectSplitPoolHop(input:PoolContactInputV1,source:PoolCycleSource,route:SplitPoolRoute):SelectedPoolHopRoute {
  const d=source.definition;if(d.version!==16||!d.forwardHop)throw new Error('Missing split-level pool clock.');
  const exterior=preparePoolShapeExterior(source),binder=new PoolShapeRouteBinder(source,{exterior});
  const takeoffUnit=d.forwardHop.takeoffUnit;
  return prepareSplitPoolPrograms(source,exterior,splitExitReference(source,route,binder),p=>({
    kind:'hop',inputKey:input.key,takeoffUnit,entry:[...p.entry].map(([u,node])=>captureSelectedPoolKnot(source,u,node)),
    climbOut:[...p.exit].map(([u,node])=>captureSelectedPoolKnot(source,u,node,'pool_exit_0')),
  }));
}
/** Import only owned climb poses named by the destination fixture. Every input is reconfigured for the swimmer. */
export function describeSplitPoolRoute(prior:SharedPoolRoute,oldFixture:PoolFixtureV1,motion:PoolCycleDefinition,fixture:PoolFixtureV1):SplitPoolRoute {
  if(motion.version!==16||!motion.forwardHop?.launchFromUnit||prior.model!==fixture.revisions.model||
     prior.motion!==oldFixture.revisions.poseProducer||oldFixture.revisions.model!==prior.model||motion.reference.sourceRigSha256!==prior.rig)
    throw new Error('Pool exit references belong to a different physical release.');
  const refs=new Map(prior.climbOut.map(k=>[k.unit,k])),clock=motion.clockUnits;
  const exitReferences=motion.forwardHop.climbKeys.flatMap(row=>{
    const u=row.exitReferenceUnit;if(u===undefined)return [];
    const knot=refs.get(u);
    if(!knot||row.unit!==u)throw new Error('Missing named physical climb reference at '+u);
    checkShapeOrbits([knot]);
    const phase=u/clock;
    for(let origin=0;origin<12;origin++){
      const action='pool_exit_'+origin;
      if(canonicalPoolValue(poolSourcePolicy(oldFixture,action,phase))!==canonicalPoolValue(poolSourcePolicy(fixture,action,phase)))
        throw new Error('Climb reference uses a different support policy at '+u);
    }
    return [knot];
  });
  return {version:2,rig:prior.rig,model:prior.model,motion:fixture.revisions.poseProducer,exitReferences};
}
function placeFor(source:PoolCycleSource,surface:string){
  const places=Object.entries(source.definition.places).filter(([,p])=>p.surface===surface);
  if(places.length!==1)throw new Error('A shared pool contact needs one declared fixture place: '+surface);
  return places[0][0];
}
function soleAt(source:PoolCycleSource,limb:NumericFoot,place:string,unit:number,action:PoolShapeRouteKnot['action']){
  return action==='pool_enter'?source.foot(limb,place):source.primaryExitFoot(limb,place,unit);
}
function reach(source:PoolCycleSource,limb:PoolLimb){
  const a=source.anatomy[limb];return configuredPoolChainReach(source.neutral.rest,a.upper,a.lower,a.end);
}

/** Capture the fixture goal separately from the reference body's ankle or wrist coordinates. */
export function describeShapeRouteKnot(source:PoolCycleSource,node:PoolPoseProgram,unit:number,action:PoolShapeRouteKnot['action']):PoolShapeRouteKnot{
  const phase=unit/source.definition.clockUnits,policy=poolSourcePolicy(source.fixture,action,phase);
  const pose=poolIntervalPreference(source.bundle,source.neutral.rest,source.neutral.inverse,node.preferenceBasis,node.preferenceBasis,0,true);
  const out={} as Record<PoolLimb,ShapeLimbCommand>;
  for(const limb of limbs){
    const a=source.anatomy[limb],c=node.controls.find(c=>c.end===a.end),r=reach(source,limb);
    if(!c||c.upper!==a.upper||c.lower!==a.lower)throw new Error('Shared route lost its configured '+limb+' chain.');
    const upper=point(pose.world[a.upper]),state=c.state,record=policy[limb];
    validatePoolKneeOrbit(state.kneeOrbit,footLimb(limb));
    const command:ShapeLimbCommand={targetFromJoint:scale(sub(state.target,upper),1/r.maximum),
      poleFromJoint:scale(sub(state.pole,upper),1/r.lengths[0]),orientation:[...state.orientation],...(state.kneeOrbit===undefined?{}:{kneeOrbit:state.kneeOrbit})};
    if(footLimb(limb)&&record.surface&&record.region?.kind==='top-face'){
      const place=placeFor(source,record.surface),f=soleAt(source,limb,place,unit,action);
      if(record.required&&(state.target.some((v,i)=>v!==f.target[i])||state.orientation.some((v,i)=>v!==f.orientation[i])))
        throw new Error('A planted reference foot differs from its declared installed sole.');
      command.contact={kind:'sole',place,delta:scale(sub(state.target,f.target),1/r.maximum),referenceOrientation:[...f.orientation]};
    }else if(!footLimb(limb)&&record.required){
      const g=state.attached;
      if(!g||g.geometry.surface!==record.surface||g.source.limb!==limb)throw new Error('A shared wrist needs its actual finite rail attachment.');
      command.contact={kind:'rail',surface:g.geometry.surface,parameter:g.parameter,rawOrientation:[...g.rawOrientation],palmBasis:source.palmGripBasis(limb)};
    }else if(state.attached||record.required)throw new Error('Unexpected support in a shared pool command.');
    out[limb]=command;
  }
  const hip=source.bundle.bones.findIndex(b=>b.name==='hips');
  return {action,unit,basis:node.preferenceBasis.map(m=>[...m]),referenceHip:point(pose.world[hip]),
    referenceLegLength:reach(source,'footR').maximum,limbs:out};
}

/** Choose a root with positive reach margin. This considers four joint shells, never a full mesh search. */
function rootShift(request:Vec3,constraints:readonly PoolReachConstraint[]):Vec3 {
  const admitted=(p:Vec3)=>constraints.every(c=>poolChainReachable(c.reach,p,c.center));
  if(!constraints.length||admitted(request))return request;
  const solve=(reserve:number)=>{
    const spheres=constraints.map(c=>({center:c.center,radius:c.reach.maximum-reserve*Math.min(...c.reach.lengths)}));
    const lo=[0,1,2].map(i=>Math.max(...spheres.map(s=>s.center[i]-s.radius))) as unknown as Vec3;
    const hi=[0,1,2].map(i=>Math.min(...spheres.map(s=>s.center[i]+s.radius))) as unknown as Vec3;
    if(lo.some((v,i)=>v>hi[i]))return null;
    return fitAssembly(request,lo,hi,spheres);
  };
  let low=0,high=1,answer=solve(0);
  for(let i=0;i<12;i++){
    const middle=(low+high)/2,candidate=solve(middle);
    if(candidate&&admitted(candidate)){low=middle;answer=candidate;}else high=middle;
  }
  if(!answer||!admitted(answer))throw new Error('This configured pool stance has no common supported reach.');
  return answer;
}

/** Bind once per actual selected shape. Each phase reconstructs its contact from the real fixture and selected body. */
export class PoolShapeRouteBinder {
  private readonly rails=new Map<string,PoolPreparedRailGeometry>();
  private readonly lengths;
  private readonly hip;
  constructor(private readonly source:PoolCycleSource,private readonly options:{exterior?:PoolShapeExterior}={}){
    this.hip=source.bundle.bones.findIndex(b=>b.name==='hips');
    this.lengths=Object.fromEntries(limbs.map(l=>[l,reach(source,l)])) as Record<PoolLimb,ReturnType<typeof configuredPoolChainReach>>;
  }
  private rail(limb:NumericHand,knot:PoolShapeRouteKnot,command:RailReference){
    const s=this.source,location={action:knot.action,phase:knot.unit/s.definition.clockUnits,limb};
    const record=poolSourceRecord(s.fixture,location).limbs[limb],a=s.anatomy[limb];
    if(record.surface!==command.surface||record.region?.kind!=='rail')throw new Error('Shared wrist command names a different rail.');
    const key=limb+':'+canonicalPoolValue(record);
    let geometry=this.rails.get(key);
    if(!geometry){geometry=preparePoolRailGeometry(s.fixture,record,s.geometry[0],s.cages[0],s.neutral.inverse[a.end],a.patch);this.rails.set(key,geometry);}
    let raw=command.rawOrientation,parameter=command.parameter,active:number|undefined;
    const exterior=this.options.exterior;
    if(command.heldFromCrest&&exterior){
      const held=exterior.at(exterior.crestUnit).controls.find(control=>control.end===a.end)?.state.attached;
      if(!held||held.geometry.surface!==command.surface)throw new Error('Configured crest wrist has a different rail.');
      raw=held.rawOrientation;parameter=held.parameter;active=held.activeVertex;
    }else{
      const targetBasis=s.palmGripBasis(limb);
      if(!command.palmBasis.every((v,i)=>v===targetBasis[i]))
        raw=properPoolRotation(multiply(multiply(command.rawOrientation,inverseAffine(command.palmBasis)),targetBasis));
    }
    const frame=resolvePoolRailContactFrame(geometry,raw,parameter,active,location);
    const attached={source:location,geometry,rawOrientation:raw,parameter,activeVertex:frame.activeVertex};
    return {target:frame.translation,orientation:frame.orientation,attached};
  }
  at(knot:PoolShapeRouteKnot):PoolPoseProgram{
    checkShapeOrbits([knot]);
    const exterior=this.options.exterior;
    if(exterior&&knot.action==='pool_enter'&&knot.unit<=exterior.crestUnit)return exterior.at(knot.unit);
    const s=this.source,phase=knot.unit/s.definition.clockUnits,policy=poolSourcePolicy(s.fixture,knot.action,phase);
    const pose=poolIntervalPreference(s.bundle,s.neutral.rest,s.neutral.inverse,knot.basis,knot.basis,0,true);
    const fixed=new Map<PoolLimb,Omit<PoolLimbState,'pole'>>(),shifts:Vec3[]=[],soleShifts:Vec3[]=[],constraints:PoolReachConstraint[]=[];
    for(const l of limbs){
      const c=knot.limbs[l],a=s.anatomy[l],r=this.lengths[l],p=policy[l],contact=c.contact;
      if(contact?.kind==='sole'){
        if(!footLimb(l)||p.surface!==s.definition.places[contact.place]?.surface)throw new Error('Shared sole contradicts the target fixture.');
        const goal=soleAt(s,l,contact.place,knot.unit,knot.action),target=p.required?goal.target:add(goal.target,scale(contact.delta,r.maximum));
        const sameRotation=c.orientation.every((v,i)=>v===contact.referenceOrientation[i]);
        const orientation=p.required||sameRotation?goal.orientation:properPoolRotation(multiply(multiply(goal.orientation,inverseAffine(contact.referenceOrientation)),c.orientation));
        fixed.set(l,{target,orientation});
      }else if(contact?.kind==='rail'){
        if(footLimb(l)||!p.required)throw new Error('Shared rail contradicts the target fixture.');
        fixed.set(l,this.rail(l,knot,contact));
      }else if(p.required)throw new Error('Missing configured pool support.');
      const state=fixed.get(l);
      if(!state)continue;
      const center=sub(state.target,point(pose.world[a.upper]));
      constraints.push({limb:l,center,reach:r});
      if(p.required){
        const shift=sub(center,scale(c.targetFromJoint,r.maximum));shifts.push(shift);
        if(footLimb(l))soleShifts.push(shift);
      }
    }
    let requested:Vec3;
    if(soleShifts.length||shifts.length)requested=mean(soleShifts.length?soleShifts:shifts);
    else{
      const ratio=this.lengths.footR.maximum/knot.referenceLegLength,water=s.fixture.waterHeight;
      requested=sub([knot.referenceHip[0],knot.referenceHip[1],water+(knot.referenceHip[2]-water)*ratio],point(pose.world[this.hip]));
    }
    translatePoolRoot(pose,rootShift(requested,constraints));
    const controls:PoolPoseControl[]=limbs.map(l=>{
      const a=s.anatomy[l],c=knot.limbs[l],r=this.lengths[l],upper=point(pose.world[a.upper]),contact=fixed.get(l);
      let state:PoolLimbState={...(contact??{target:add(upper,scale(c.targetFromJoint,r.maximum)),orientation:c.orientation}),pole:add(upper,scale(c.poleFromJoint,r.lengths[0])),...(c.kneeOrbit===undefined?{}:{kneeOrbit:c.kneeOrbit})};
      if(!footLimb(l)&&knot.action==='pool_exit_0'&&s.definition.version===16&&s.definition.forwardHop?.launchFromUnit)
        state=fitClimbHand(s,l,upper,state);
      if(!poolChainReachable(r,upper,state.target))throw new Error('Retargeted pool goal is outside configured reach at '+knot.unit+' '+l);
      return {upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],...(footLimb(l)?{legFrame:'source-entry-0' as const}:{}),state};
    });
    return makePoolPoseProgram(pose.basis,controls,policy);
  }
}


/** Export only the configured motion controls. A template never transfers another appearance's observations. */
export function describeSharedPoolRoute(reference:PoolCycleSource,artifact:PoolContactArtifactV1):SharedPoolRoute {
  if(!artifact.graph.climbOut||reference.definition.version!==16||!reference.definition.forwardHop||
    artifact.source!==reference.bundle.sourceSha256||artifact.shapeKey!==poolShapeIdentity(reference.shape,reference.top)||
    canonicalPoolValue(artifact.partKeys)!==canonicalPoolValue(reference.geometry.map(poolPartKey)))
    throw new Error('Shared pool route does not match the measured reference body and garment.');
  const clock=reference.definition.clockUnits;
  const describe=(track:typeof artifact.graph.entry,action:PoolShapeRouteKnot['action'])=>track.keys.map(k=>{
    const unit=Math.round(k.phase*clock);
    if(unit/clock!==k.phase)throw new Error('Shared pool knot is outside the declared integer clock.');
    return describeShapeRouteKnot(reference,artifact.graph.poses[k.pose],unit,action);
  });
  const entry=describe(artifact.graph.entry,'pool_enter');
  const crestUnit=reference.definition.crestRoute.sampleUnits[0];
  const crest=entry.findIndex(k=>k.unit===crestUnit);
  if(crest<0)throw new Error('Shared pool route is missing the last exterior stance.');
  for(const hand of hands){
    const initial=entry[crest].limbs[hand].contact;
    if(initial?.kind!=='rail')throw new Error('The crest stance needs its held wrist.');
    for(const knot of entry.slice(crest+1)){
      const c=knot.limbs[hand].contact;
      if(c?.kind!=='rail'||c.surface!==initial.surface||c.parameter!==initial.parameter||
          c.rawOrientation.some((v,i)=>v!==initial.rawOrientation[i]))break;
      c.heldFromCrest=true;
    }
  }
  return {version:1,rig:artifact.source,model:reference.fixture.revisions.model,motion:reference.fixture.revisions.poseProducer,
    referenceShape:artifact.shapeKey,entry,climbOut:describe(artifact.graph.climbOut,'pool_exit_0')};
}

type ShapeNode={kind:'template';knot:PoolShapeRouteKnot}|{kind:'paddle';phase:number}|{kind:'bridge';origin:number;phase:number}|{kind:'configured';program:PoolPoseProgram};

/** Runtime and offline observers evaluate these same two configured programs for each requested sample. */
export class PoolShapeRouteSampler {
  readonly crestFitReport?:ReturnType<typeof fitClimbPassage>;
  readonly preparationTimes?:SplitPreparationTimes;
  private readonly graph:PoolCanonicalGraph<ShapeNode>;
  private readonly binder:PoolShapeRouteBinder;
  private readonly programs=new Map<number,PoolPoseProgram>();
  constructor(private readonly source:PoolCycleSource,route:SharedPoolRoute|SplitPoolRoute,options?:{exterior:PoolShapeExterior}){
    const def=source.definition;
    if(def.version!==16||!def.forwardHop||(route.version!==1&&route.version!==2)||route.rig!==source.bundle.sourceSha256||
      route.model!==source.fixture.revisions.model||route.motion!==source.fixture.revisions.poseProducer)
      throw new Error('Shared pool motion belongs to a different rig, fixture or motion revision.');
    const hop=def.forwardHop,clock=def.clockUnits;
    const check=(knots:readonly PoolShapeRouteKnot[],units:readonly number[],action:PoolShapeRouteKnot['action'])=>{
      if(knots.length!==units.length||knots.some((k,i)=>k.unit!==units[i]||k.action!==action))throw new Error('Shared pool motion differs from its declared '+action+' clock.');
      checkShapeOrbits(knots);
    };
    const climbUnits=hop.climbOutUnits.filter(u=>u>=hop.bridgeEndUnit);
    const exterior=options?.exterior??(route.version===2||route.referenceShape!==poolShapeIdentity(source.shape,source.top)?preparePoolShapeExterior(source):undefined);
    this.binder=new PoolShapeRouteBinder(source,{exterior});
    let entering:ShapeNode[],leaving:ShapeNode[];
    if(route.version===2){
      if(!exterior||!hop.launchFromUnit)throw new Error('The configured route requires its split-level climb clock.');
      const programs=prepareSplitPoolPrograms(source,exterior,splitExitReference(source,route,this.binder),p=>p);
      this.crestFitReport=programs.passage;
      this.preparationTimes=programs.times;
      entering=hop.entryUnits.map(u=>({kind:'configured',program:programs.entry.get(u)!}));
      leaving=climbUnits.map(u=>({kind:'configured',program:programs.exit.get(u)!}));
    }else{
      if(hop.launchFromUnit)throw new Error('A split-level pool hop requires its own independently authored exit.');
      check(route.entry,hop.entryUnits,'pool_enter');check(route.climbOut,climbUnits,'pool_exit_0');
      entering=route.entry.map(knot=>({kind:'template',knot}));
      leaving=route.climbOut.map(knot=>({kind:'template',knot}));
    }
    const poses:ShapeNode[]=[],addNode=(node:ShapeNode)=>poses.push(node)-1;
    const common=addNode({kind:'paddle',phase:0}),standing=addNode(entering[0]);
    const entry={keys:hop.entryUnits.map((unit,i)=>({phase:unit/clock,pose:i===0?standing:unit===clock?common:addNode(entering[i])}))};
    const climbOut={keys:climbUnits.map((unit,i)=>({phase:unit/clock,pose:i===0?common:unit===clock?standing:addNode(leaving[i])}))};
    const phases=[...new Set([...Array.from({length:13},(_,i)=>i/12),...poolSourceEvents(source.fixture,'pool_paddle')])].sort((a,b)=>a-b);
    const paddle={keys:phases.map(phase=>({phase,pose:phase===0||phase===1?common:addNode({kind:'paddle',phase})}))};
    const bridges=Array.from({length:12},(_,origin)=>{
      const initial=paddle.keys.find(k=>k.phase===origin/12)!.pose;
      const cuts=[0,...poolSourceEvents(source.fixture,'pool_exit_'+origin).filter(p=>p>0&&p<.1),.1];
      return {keys:cuts.map(phase=>({phase:phase/.1,pose:phase===0?initial:phase===.1?common:addNode({kind:'bridge',origin,phase})}))};
    });
    this.graph={poses,entry,climbOut,paddle,bridges,takeoffPhase:hop.takeoffUnit/clock};
    validatePoolGraph(this.graph);
  }
  private node(index:number):PoolPoseProgram {
    const old=this.programs.get(index);if(old)return old;
    const n=this.graph.poses[index];
    if(n.kind==='configured')return n.program;
    let pose:PoolPoseProgram;
    try{
      if(n.kind==='template')pose=this.binder.at(n.knot);
      else if(n.kind==='paddle')pose=this.source.paddle(n.phase);
      else pose=this.source.freeWaterKnot(this.source.paddle(n.origin/12),this.source.paddle(0),n.phase/.1,'pool_exit_'+n.origin,n.phase);
    }catch(cause){
      const action=n.kind==='template'?n.knot.action:n.kind==='paddle'?'pool_paddle':'pool_exit_'+n.origin;
      const phase=n.kind==='template'?n.knot.unit/this.source.definition.clockUnits:n.phase;
      throw new Error('Configured pool motion failed during '+action+' at phase '+phase+'.',{cause});
    }
    this.programs.set(index,pose);return pose;
  }
  /** The worker publishes precisely the nodes used by samplePrograms for this appearance. */
  configuredGraph():PoolConfiguredGraph {
    const g=this.graph,poses=g.poses.map((_,i)=>this.node(i));
    const track=(source:typeof g.entry,action:string,scale=1)=>{
      const keys=source.keys;
      const intervals=keys.slice(0,-1).map((key,i)=>{
        const next=keys[i+1],left=poses[key.pose],right=poses[next.pose];
        const policy=poolSourcePolicy(this.source.fixture,action,(key.phase+next.phase)*scale/2);
        const supportLimbs=POOL_LIMBS.filter(l=>left.policy[l].required||right.policy[l].required||policy[l].required);
        requirePoolPolicyInterval(left.policy,right.policy,policy,supportLimbs);
        return {policy,supportLimbs,controls:poolIntervalProgramControls(left,right)};
      });
      return {keys,intervals};
    };
    return {poses,entry:track(g.entry,'pool_enter'),paddle:track(g.paddle,'pool_paddle'),
      climbOut:track(g.climbOut!,'pool_exit_0'),takeoffPhase:g.takeoffPhase,
      bridges:g.bridges.map((b,i)=>track(b,'pool_exit_'+i,.1))};
  }
  samplePrograms(location:PoolSourceLocation,reducedMotion=false){
    const {action,phase}=location;
    const mode=action==='pool_enter'?'entry':action==='pool_paddle'?'paddle':/^pool_exit_(?:[0-9]|1[01])$/.test(action)?'exit':undefined;
    if(!mode)throw new Error('Unknown action for the shape-configured pool sampler.');
    const sample=samplePoolGraph(this.graph,mode,phase,mode==='exit'?Number(action.slice(10)):0,reducedMotion);
    return {left:this.node(sample.left),right:this.node(sample.right),amount:sample.amount};
  }
  skin(location:PoolSourceLocation,reducedMotion=false):Float32Array<ArrayBuffer>{
    const s=this.source,{left,right,amount}=this.samplePrograms(location,reducedMotion);
    const pose=interpolatePoolPoseProgram(s.bundle,s.neutral.rest,s.neutral.inverse,left,right,amount,location);
    return poolSkinMatrices(pose.world,s.neutral.inverse);
  }
}
