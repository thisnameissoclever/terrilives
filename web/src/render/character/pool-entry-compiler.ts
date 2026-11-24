import type {Bundle,Geometry} from './bundle.js';
import type {ShapeParameters} from './shape.js';
import {add,boneFrame,cross,dot,identity,inverseAffine,length,multiply,scale,sub,transform,type Vec3} from './math.js';
import {interpolateTransform} from './motion.js';
import {canonicalPoolPreference,properPoolRotation,solvePoolHierarchyLimb,translatePoolRoot,setPoolWorldRotation,type CanonicalPoolPose} from './pool-canonical-pose.js';
import {preparePoolEntryAnatomy,poolSurfacePoint,type PoolLimbAnatomy} from './pool-entry-anatomy.js';
import {derivePoolRailRegion,type PoolRailRegion} from './pool-rail-region.js';
import type {PoolFixtureV1,PoolLimb,PoolSupport} from './pool-contact-types.js';
import type {PreparedPoolPatch} from './pool-contact-patch.js';
import {configuredPoolChainReach,poolChainReachable,poolRootRayIntervals} from './pool-entry-domain.js';
import {observePoolPatchSupport,poolSupportRequired} from './pool-support-observer.js';
import {poolSkinMatrices,evaluatePoolPoseProgram,interpolatePoolPoseProgram,poolIntervalPreference} from './pool-contact-sample.js';
import {evaluatePoolLimb,resolvePoolLimbState,type PoolAttachedRailGoal} from './pool-contact-evaluator.js';
import type {CompiledPoolPose} from './pool-pose-compiler.js';
import {composeSkeletonPose} from './pose-joints.js';
import {shapeVertices} from './shape.js';
import {posedCageSurface} from './geometry-proof.js';
import {observePool,observePoolSource,type PoolObservation} from './pool-observer.js';
import {PoolSolidIndex} from './pool-solid.js';
import {derivePoolSupportArithmetic,derivePoolApproachClearanceArithmetic,poolViolationsBeyondArithmetic,type PoolContactArithmetic} from './pool-support-arithmetic.js';
import {derivePoolRailArithmetic} from './pool-rail-support-arithmetic.js';
import {preparePoolRailGeometry,bindPoolRailGeometry,resolvePoolRailContactFrame,type PoolPreparedRailGeometry,type PoolRailContactFrame} from './pool-rail-contact-frame.js';
import {solveCertifiedPoolRail} from './pool-rail-construction-arithmetic.js';
import {preparePoolFootContactFrame,preparePoolInterpolatedFootReference,requirePoolFootClearanceReference,type PoolFootContactFrame,type PoolFreeFootClearanceReference} from './pool-foot-contact-frame.js';
import {solvePoolFreeLeg,observeConstructedPoolFreeLeg} from './pool-free-leg.js';
import {solvePoolOrientedFoot,observeConstructedPoolLeg} from './pool-oriented-leg.js';
import {poolEntrySearchPlan} from './pool-entry-search-plan.js';
import {clonePoolMatrix,preparePoolFootRotationEndpoint,preparePoolInterpolatedFootRotation,type PoolFootRotationEndpoint} from './pool-matrix-producer.js';
import {canonicalPoolValue} from './pool-contact-identity.js';
import {poolSourcePolicy,poolSourceSupport,poolSourceRecord,poolSourceEvents,requirePoolPolicyEqual} from './pool-source-policy.js';
import {makePoolPoseProgram,poolIntervalProgramControls,type PoolPoseProgram} from './pool-pose-program.js';

const point=(matrix:readonly number[]):Vec3=>[matrix[12],matrix[13],matrix[14]];
const clamp=(value:number,minimum:number,maximum:number)=>Math.max(minimum,Math.min(maximum,value));
const bounds=(points:readonly Vec3[]):[Vec3,Vec3]=>[
  [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.min(...points.map(p=>p[2]))],
  [Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1])),Math.max(...points.map(p=>p[2]))],
];
interface PhaseFreeFootGoal {readonly target:Vec3;readonly orientation:readonly number[]}
interface EntryContact {attached?:PoolAttachedRailGoal;originTarget?:true;limb:PoolLimb;anatomy:PoolLimbAnatomy;target:Vec3;orientation:number[];weight:number;pole:Vec3;surface:string;patch:PreparedPoolPatch;supportBounds?:[Vec3,Vec3];domain?:{minimum:number[];maximum:number[]};frame?:PoolFootContactFrame;railFrame?:PoolRailContactFrame;parameter?:number;roll?:number;elbowBlend?:number}

/** One configured body owns anatomy, source reach preferences and immutable fixture queries. */
export class PoolEntryCompiler {
  readonly anatomy;
  private readonly rails:Record<'L'|'R',PoolRailRegion>;

  private readonly cages;
  private readonly railGeometry=new Map<string,PoolPreparedRailGeometry>();
  private readonly limbViews=new Map<PoolLimb,Geometry[]>();
  private readonly solids=new Map<string,PoolSolidIndex>();
  readonly diagnostics=new Map<number,{evaluations:number;passes:number;root:Vec3;rounding:Vec3;remaining?:PoolObservation}>();
  readonly searches=new Map<number,{planned:number;attempts:Record<string,unknown>[];stoppedAfterSuccess:boolean}>();
  private readonly footRotationEndpoints=new WeakMap<PoolPoseProgram,Map<string,PoolFootRotationEndpoint>>();
  constructor(readonly bundle:Bundle,readonly shape:ShapeParameters,readonly top:number,readonly geometry:readonly Geometry[],readonly fixture:PoolFixtureV1){
    this.anatomy=preparePoolEntryAnatomy(geometry[0],shape,top);
    this.cages=geometry.map(g=>shapeVertices(g.cage,shape,top));
    for(const solid of fixture.solids)this.solids.set(solid.id,new PoolSolidIndex(solid));
    this.rails={L:derivePoolRailRegion(fixture,'Pool ladder rail 1',[1,5],1),R:derivePoolRailRegion(fixture,'Pool ladder rail 2',[1,5],-1)};
    for(const limb of Object.keys(this.anatomy) as PoolLimb[]){
      const side=limb.endsWith('L')?'L':'R',suffix=side==='R'?'.001':'';
      const names=limb.startsWith('foot')?['Creator bare leg '+side]:['Creator upper arm skin '+side,'Forearm with elbow and wrist sections'+suffix,'Relaxed palm'+suffix,'Resting thumb'+suffix];
      this.limbViews.set(limb,geometry.map(g=>({...g,description:{...g.description,parts:g.description.parts.filter(part=>names.includes(part.name))}})));
    }

  }

  private anchorOrigin(orientation:number[],anatomy:PoolLimbAnatomy):number[] {
    const matrix=[...orientation];matrix.splice(12,3,0,0,0);
    matrix.splice(12,3,...scale(poolSurfacePoint(matrix,anatomy.anchor),-1/anatomy.anchor[3]));return matrix;
  }

  private freeLimb(pose:CanonicalPoolPose,limb:PoolLimb,support:PoolSupport,goal?:PhaseFreeFootGoal):EntryContact {
    const anatomy=this.anatomy[limb];return {limb,anatomy,originTarget:true,target:goal?.target??point(pose.world[anatomy.end]),orientation:goal?clonePoolMatrix(goal.orientation):properPoolRotation(pose.world[anatomy.end]),weight:0,pole:point(pose.world[anatomy.lower]),surface:support.surface??'free',patch:anatomy.patch};
  }

  private foot(pose:CanonicalPoolPose,limb:PoolLimb,support:PoolSupport,yawSign=0,yFraction=.75,xFraction:number|null=null):EntryContact {
    const anatomy=this.anatomy[limb],inside=support.surface?.includes('inside')??false,ground=support.surface===this.fixture.ground.id;
    const patch=ground?anatomy.patch:inside?anatomy.back!:anatomy.front!;
    let orientation=properPoolRotation(pose.rest[anatomy.end]);
    if(yawSign){
      const local=this.anchorOrigin(orientation,anatomy),patchBounds=bounds(patch.vertices.map(v=>poolSurfacePoint(local,v.coefficient)));
      const solid=this.fixture.solids.find(solid=>solid.id===support.surface);if(!solid)throw new Error('Pool yaw profile needs its finite authored tread.');
      const angle=yawSign*Math.atan2(solid.bounds[1][1]-solid.bounds[0][1],patchBounds[1][0]-patchBounds[0][0]),c=Math.cos(angle),s=Math.sin(angle);
      orientation=properPoolRotation(multiply([c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1],orientation));
    }
    const origin=this.anchorOrigin(orientation,anatomy),offsets=bounds(patch.vertices.map(v=>poolSurfacePoint(origin,v.coefficient)));
    const full=bounds(anatomy.surfaceCoefficients.map(c=>poolSurfacePoint(origin,c)));
    const preferred=poolSurfacePoint(pose.world[anatomy.end],anatomy.anchor);
    const solid=this.fixture.solids.find(s=>s.id===support.surface);
    if(!solid&&!ground)throw new Error('Pool foot contact has no named support.');
    let rectangle=ground?this.fixture.ground.bounds:solid!.bounds;
    if(support.surface==='Pool stone coping'){
      const top=support.region?.kind==='top-face'?support.region.triangles??[]:[];
      const triangles=top.map(index=>solid!.triangles[index].map(id=>solid!.vertices[id]));
      const front=triangles.filter(points=>points.every(p=>p[1]>0)&&Math.min(...points.map(p=>p[0]))<=preferred[0]&&Math.max(...points.map(p=>p[0]))>=preferred[0]);
      if(!front.length)throw new Error('Pool coping has no front support at the foot approach.');rectangle=bounds(front.flat());
    }
    const minimum=[rectangle[0][0]-offsets[0][0],rectangle[0][1]-offsets[0][1]],maximum=[rectangle[1][0]-offsets[1][0],rectangle[1][1]-offsets[1][1]];
    if(!ground){
      const left=this.fixture.solids.find(s=>s.id===this.rails.L.surface)!,right=this.fixture.solids.find(s=>s.id===this.rails.R.surface)!;
      minimum[0]=Math.max(minimum[0],left.bounds[1][0]-full[0][0]);maximum[0]=Math.min(maximum[0],right.bounds[0][0]-full[1][0]);
    }
    if(minimum.some((v,i)=>v>maximum[i]))throw new Error('Configured sole has no finite ladder support region: '+limb);
    const target:Vec3=[xFraction===null?clamp(preferred[0],minimum[0],maximum[0]):minimum[0]+(maximum[0]-minimum[0])*xFraction,
      ground?clamp(preferred[1],minimum[1],maximum[1]):minimum[1]+(maximum[1]-minimum[1])*yFraction,rectangle[1][2]];
    return {limb,anatomy,target,orientation,weight:1,pole:point(pose.world[anatomy.lower]),surface:support.surface!,patch,supportBounds:rectangle,domain:{minimum,maximum}};
  }

  private hand(pose:CanonicalPoolPose,limb:PoolLimb,phase:number,roll=0,railChoice=0,parameterOverride?:number):EntryContact {
    const weight=phase>=.1&&phase<=.48?1:clamp((phase-.025)/.075,0,1)*clamp((.6-phase)/.12,0,1);
    const anatomy=this.anatomy[limb],side=limb.endsWith('L')?'L':'R',region=this.rails[side];
    const freePhase=phase<.1?.025:.6;
    const free=canonicalPoolPreference(this.bundle,this.shape,this.top,'pool_enter',freePhase*(this.bundle.actions.pool_enter.length-1),this.geometry);
    const freeBasis=pose.basis.map(matrix=>[...matrix]);
    if(weight>0)for(const bone of [anatomy.upper,anatomy.lower,anatomy.end])freeBasis[bone]=free.basis[bone];
    const freeWorld=composeSkeletonPose(this.bundle.bones,pose.rest,freeBasis);
    const preferred=poolSurfacePoint(freeWorld[anatomy.end],anatomy.anchor);
    if(weight===0)return {limb,anatomy,target:preferred,orientation:properPoolRotation(freeWorld[anatomy.end]),weight,pole:point(freeWorld[anatomy.lower]),surface:'free',patch:anatomy.patch};
    const solid=this.fixture.solids.find(s=>s.id===region.surface)!,sourceParameter=5-clamp((phase-.1)/.55,0,1)*4;
    const parameter=parameterOverride??(railChoice===3?3:clamp(sourceParameter+(railChoice===1?-1:railChoice===2?1:0),1,5));
    const edge=region.edges.find(edge=>parameter>=edge.fromParameter&&parameter<=edge.toParameter)??region.edges.at(-1)!;
    const amount=clamp((parameter-edge.fromParameter)/(edge.toParameter-edge.fromParameter),0,1);
    const rail=add(solid.vertices[edge.from],scale(sub(solid.vertices[edge.to],solid.vertices[edge.from]),amount));
    const inverse=[...pose.inverse[anatomy.end]];inverse.splice(12,3,0,0,0);
    const localNormal=transform(inverse,[0,1,0]),thumb=anatomy.thumb!,thumbDirection=sub([thumb[0],thumb[1],thumb[2]],scale([anatomy.anchor[0],anatomy.anchor[1],anatomy.anchor[2]],thumb[3]/anatomy.anchor[3]));
    const reference=identity();reference.splice(0,3,...thumbDirection);
    const local=boneFrame([0,0,0],localNormal,reference),normal:Vec3=side==='L'?[1,0,0]:[-1,0,0];
    const transverse=cross(normal,sub(solid.vertices[edge.to],solid.vertices[edge.from]));
    const sourceWrist=sub(point(freeWorld[anatomy.end]),preferred);
    const choices=[transverse,scale(transverse,-1)].map(direction=>{
      const worldReference=identity();worldReference.splice(0,3,...direction);
      const rotation=properPoolRotation(multiply(boneFrame([0,0,0],normal,worldReference),inverseAffine(local)));
      return {rotation,score:dot(point(this.anchorOrigin(rotation,anatomy)),sourceWrist)};
    }).sort((a,b)=>b.score-a.score);
    const aligned=choices[roll].rotation;
    const orientation=interpolateTransform(properPoolRotation(freeWorld[anatomy.end]),aligned,weight);
    const target=add(scale(preferred,1-weight),scale(rail,weight));
    return {limb,anatomy,target,orientation,weight,pole:point(freeWorld[anatomy.lower]),surface:region.surface,patch:anatomy.patch,parameter,roll};
  }

  private handNode(pose:CanonicalPoolPose,limb:PoolLimb,phase:number,roll:number,railChoice=0):EntryContact {
    if(phase<=.48||phase>=.6)return this.hand(pose,limb,phase,roll,railChoice);
    const start=this.hand(pose,limb,.48,roll,railChoice),progress=(phase-.48)/(.6-.48),anatomy=start.anatomy;
    const anchor=scale([anatomy.anchor[0],anatomy.anchor[1],anatomy.anchor[2]],1/anatomy.anchor[3]);
    const radius=Math.max(...anatomy.completeHandCoefficients!.map(c=>length(sub(scale([c[0],c[1],c[2]],1/c[3]),anchor))));
    // Translate the complete hand out before rotating. The swept radius comes from every
    // selected palm and thumb coefficient, rather than whichever witness failed last.
    const normal:Vec3=limb==='handL'?[1,0,0]:[-1,0,0],distance=2*radius*Math.min(1,progress*2);
    const free=this.hand(pose,limb,.6,roll),orientation=progress<=.5?start.orientation:interpolateTransform(start.orientation,free.orientation,(progress-.5)*2);
    return {...start,target:add(start.target,scale(normal,distance)),orientation,weight:1-progress};
  }

  private endTarget(contact:EntryContact):Vec3 {
    if(contact.frame)return contact.frame.translation;
    if(contact.railFrame)return contact.railFrame.translation;
    if(contact.originTarget)return contact.target;
    const rotation=[...contact.orientation];rotation.splice(12,3,0,0,0);
    return scale(sub(contact.target,poolSurfacePoint(rotation,contact.anatomy.anchor)),1/contact.anatomy.anchor[3]);
  }

  /** Coverage belongs to the program output; selection poses are only domain diagnostics. */
  private observeProgram(program:PoolPoseProgram,selection:CanonicalPoolPose,contacts:EntryContact[],source:Record<PoolLimb,PoolSupport>,phase:number){
    const location={action:'pool_enter',phase},actual=evaluatePoolPoseProgram(this.bundle,selection.rest,selection.inverse,program,location);
    const replay=poolIntervalPreference(this.bundle,selection.rest,selection.inverse,program.preferenceBasis,program.preferenceBasis,0,program.controls.some(control=>Boolean(control.legFrame))),knees=[];
    const approaches:{contact:EntryContact;frame:PoolFootContactFrame;plan:ReturnType<typeof solvePoolFreeLeg>;patch:PreparedPoolPatch}[]=[];
    for(const [index,contact] of contacts.entries()){
      const {upper,lower,end}=contact.anatomy;
      if(contact.frame){const plan=solvePoolOrientedFoot(replay,upper,lower,end,contact.frame,program.controls[index].state.kneeOrbit);knees.push(observeConstructedPoolLeg(replay,contact.frame,plan));}
      else if(contact.limb.startsWith('foot')){
        const control=program.controls[index],support=source[contact.limb],patch=support.surface?.includes('inside')?contact.anatomy.back!:contact.anatomy.front!;
        let reference:PoolFootContactFrame|undefined;
        if(support.mode==='approach'&&!poolSupportRequired(support,phase))try{
          const frame=preparePoolFootContactFrame(this.fixture,support,this.geometry[0],this.cages[0],replay.inverse[end],patch,properPoolRotation(replay.rest[end]),control.state.target.slice(0,2) as [number,number]);
          requirePoolFootClearanceReference(frame,control.state.target,control.state.orientation,replay.inverse[end]);reference=frame;
        }catch{/* An unproved free orientation or height retains ordinary collision rejection. */}
        const plan=solvePoolFreeLeg(replay,upper,lower,end,control.state.target,control.state.orientation,reference,control.state.kneeOrbit);knees.push(observeConstructedPoolFreeLeg(replay,plan));
        if(reference)approaches.push({contact,frame:reference,plan,patch});
      }
      else if(contact.railFrame){
        const control=program.controls[index],{railFrame}=resolvePoolLimbState({...control,from:control.state,to:control.state},0,location);
        if(!railFrame)throw new Error('Pool required hand has no owned rail goal.');contact.railFrame=railFrame;
        solveCertifiedPoolRail(replay,upper,lower,end,railFrame,contact.pole,{fixture:this.fixture,geometry:this.geometry[0],cage:this.cages[0],patch:this.anatomy[contact.limb].patch,support:source[contact.limb]});
      }
      else{
        const {anchor,state}=program.controls[index],lengths=[length(point(multiply(replay.inverse[upper],replay.rest[lower]))),length(point(multiply(replay.inverse[lower],replay.rest[end])))] as const;
        const prepared=evaluatePoolLimb({start:point(replay.world[upper]),target:state.target,pole:state.pole,lengths,orientation:state.orientation,anchor,upperReference:replay.world[upper],lowerReference:replay.world[lower]});
        solvePoolHierarchyLimb(replay,upper,lower,end,prepared.end,state.pole,state.orientation);
      }
    }
    if(actual.world.some((matrix,bone)=>matrix.some((value,at)=>value!==replay.world[bone][at])))throw new Error('Pool node program differs from its certified producer replay.');
    const pose=Object.assign(replay,{source:selection.source,rawTranslations:selection.rawTranslations,positionDeviations:selection.positionDeviations});
    const skin=poolSkinMatrices(actual.world,actual.inverse),surfaces=this.geometry.map((geometry,index)=>({geometry,points:posedCageSurface(geometry,this.cages[index],skin)})),observation=observePoolSource(this.fixture,surfaces,location);
    const arithmetic=contacts.flatMap<PoolContactArithmetic>(contact=>contact.frame?[derivePoolSupportArithmetic(this.fixture,surfaces[0],this.cages[0],pose,contact.patch,source[contact.limb],contact.frame,observation)]
      :contact.railFrame?[derivePoolRailArithmetic(this.fixture,surfaces[0],this.cages[0],pose,this.anatomy[contact.limb].patch,source[contact.limb],contact.railFrame,observation)]:[]);
    arithmetic.push(...approaches.map(({contact,frame,plan,patch})=>derivePoolApproachClearanceArithmetic(this.fixture,surfaces[0],this.cages[0],pose,patch,source[contact.limb],contact.limb as 'footL'|'footR',frame,plan,observation)));
    const supports=contacts.map(contact=>observePoolPatchSupport(this.fixture,surfaces,contact.patch,source[contact.limb],phase,observation,arithmetic));
    return {pose,skin,knees,observation,arithmetic,supports,unresolvedViolations:poolViolationsBeyondArithmetic(observation,arithmetic)};
  }

  /** Preparation alone reconstructs interval proof owners; normal runtime sampling stays unchanged. */
  observeInterval(left:{phase:number;program:PoolPoseProgram},right:{phase:number;program:PoolPoseProgram},phase:number){
    if(!(left.phase<right.phase)||phase<left.phase||phase>right.phase||poolSourceEvents(this.fixture,'pool_enter').some(event=>event>left.phase&&event<right.phase))throw new Error('Pool interval observation must preserve its actual source cuts.');
    for(const endpoint of [left,right])requirePoolPolicyEqual(endpoint.program.policy,poolSourcePolicy(this.fixture,'pool_enter',endpoint.phase));
    const location={action:'pool_enter',phase},source=poolSourceRecord(this.fixture,location).limbs,controls=poolIntervalProgramControls(left.program,right.program),amount=(phase-left.phase)/(right.phase-left.phase);
    const limbFor=(control:typeof controls[number]):PoolLimb=>{
      const name=this.bundle.bones[control.end]?.name,limb=name?.replace('.','') as PoolLimb,anatomy=this.anatomy[limb];
      if(!anatomy||anatomy.upper!==control.upper||anatomy.lower!==control.lower||anatomy.end!==control.end)throw new Error('Pool interval names another configured limb chain.');return limb;
    };
    if(controls.length!==4||new Set(controls.map(limbFor)).size!==4)throw new Error('Pool interval observation requires all four actual limbs.');
    const seed=canonicalPoolPreference(this.bundle,this.shape,this.top,'pool_enter',phase*(this.bundle.actions.pool_enter.length-1),this.geometry),{rest,inverse}=seed;
    for(const endpoint of [left,right])for(const control of endpoint.program.controls){
      const goal=control.state.attached;if(!goal)continue;const limb=limbFor({...control,from:control.state,to:control.state}),anatomy=this.anatomy[limb],support=poolSourceSupport(this.fixture,{action:'pool_enter',phase:endpoint.phase,limb}).support;
      bindPoolRailGeometry(goal.geometry,this.fixture,support,this.geometry[0],this.cages[0],inverse[control.end],anatomy.patch,goal.source);
    }
    const actual=interpolatePoolPoseProgram(this.bundle,rest,inverse,left.program,right.program,amount,location),resolved=controls.map(control=>resolvePoolLimbState(control,amount,location));
    const replay=poolIntervalPreference(this.bundle,rest,inverse,left.program.preferenceBasis,right.program.preferenceBasis,amount,true),knees=[];
    const constructed:{limb:PoolLimb;patch:PreparedPoolPatch;frame?:PoolFootContactFrame;railFrame?:PoolRailContactFrame;reference?:PoolFreeFootClearanceReference;plan?:ReturnType<typeof solvePoolFreeLeg>}[]=[];
    const endpointRotation=(endpoint:typeof left,limb:'footL'|'footR')=>{
      const root=this.bundle.bones.findIndex(b=>b.name==='root'),authored=canonicalPoolPreference(this.bundle,this.shape,this.top,'pool_enter',endpoint.phase*(this.bundle.actions.pool_enter.length-1),this.geometry);
      if(endpoint.program.preferenceBasis[root].some((v,i)=>v!==authored.basis[root][i]))throw new Error('Pool interval endpoint has unreconstructed root travel.');
      const key=endpoint.phase+':'+limb,saved=this.footRotationEndpoints.get(endpoint.program)??new Map<string,PoolFootRotationEndpoint>();let token=saved.get(key);
      if(!token){const end=this.anatomy[limb].end,control=endpoint.program.controls.find(c=>c.end===end);if(!control)throw new Error('Pool interval endpoint omits its actual foot.');
        token=preparePoolFootRotationEndpoint({bundle:this.bundle,geometry:this.geometry,shape:this.shape,top:this.top,fixture:this.fixture,patch:this.anatomy[limb].front!,location:{action:'pool_enter',phase:endpoint.phase,limb},control,rootBasis:endpoint.program.preferenceBasis[this.bundle.bones.findIndex(b=>b.name==='root')]});saved.set(key,token);this.footRotationEndpoints.set(endpoint.program,saved);}return token;
    };
    for(const [index,control] of controls.entries()){
      const limb=limbFor(control),anatomy=this.anatomy[limb],state=resolved[index].state,support=source[limb],required=poolSupportRequired(support,phase),patch=limb.startsWith('foot')?(support.surface?.includes('inside')?anatomy.back!:anatomy.front!):anatomy.patch;
      if(limb==='footL'||limb==='footR'){
        if(required){const frame=preparePoolFootContactFrame(this.fixture,support,this.geometry[0],this.cages[0],inverse[control.end],patch,properPoolRotation(rest[control.end]),state.target.slice(0,2) as [number,number]);
          if(frame.translation.some((v,i)=>v!==state.target[i])||frame.orientation.some((v,i)=>!Object.is(v,state.orientation[i])))throw new Error('Pool required interval foot differs from its literal exact frame.');
          const plan=solvePoolOrientedFoot(replay,control.upper,control.lower,control.end,frame,state.kneeOrbit);knees.push(observeConstructedPoolLeg(replay,frame,plan));constructed.push({limb,patch,frame});
        }else{
          let reference:PoolFreeFootClearanceReference|undefined;
          if(support.mode==='approach'){
            const producer=preparePoolInterpolatedFootRotation(endpointRotation(left,limb),endpointRotation(right,limb),control,{...location,limb});
            reference=preparePoolInterpolatedFootReference(this.fixture,support,this.geometry[0],this.cages[0],inverse[control.end],patch,this.bundle,{...location,limb},state.target,state.orientation,producer);
          }
          const plan=solvePoolFreeLeg(replay,control.upper,control.lower,control.end,state.target,state.orientation,reference,state.kneeOrbit);knees.push(observeConstructedPoolFreeLeg(replay,plan));constructed.push({limb,patch,reference,plan});
        }
      }else if(required){const frame=resolved[index].railFrame;if(!frame)throw new Error('Pool required interval hand has no actual rail construction.');solveCertifiedPoolRail(replay,control.upper,control.lower,control.end,frame,state.pole,{fixture:this.fixture,geometry:this.geometry[0],cage:this.cages[0],patch,support});constructed.push({limb,patch,railFrame:frame});}
      else {const lengths=[length(point(multiply(inverse[control.upper],rest[control.lower]))),length(point(multiply(inverse[control.lower],rest[control.end])))] as const;
        const prepared=evaluatePoolLimb({start:point(replay.world[control.upper]),target:state.target,pole:state.pole,lengths,orientation:state.orientation,anchor:control.anchor,upperReference:replay.world[control.upper],lowerReference:replay.world[control.lower]});solvePoolHierarchyLimb(replay,control.upper,control.lower,control.end,prepared.end,state.pole,state.orientation);constructed.push({limb,patch});}
    }
    if(actual.world.some((m,bone)=>m.some((v,i)=>!Object.is(v,replay.world[bone][i]))))throw new Error('Pool certified interval replay differs from normal WORLD.');
    const skin=poolSkinMatrices(actual.world,inverse),replaySkin=poolSkinMatrices(replay.world,inverse),skinBytes=new Uint8Array(skin.buffer),replayBytes=new Uint8Array(replaySkin.buffer);
    if(skinBytes.some((v,i)=>v!==replayBytes[i]))throw new Error('Pool certified interval replay differs from normal binary skin.');
    if(amount===0||amount===1){const endpoint=amount===0?left:right,key=evaluatePoolPoseProgram(this.bundle,rest,inverse,endpoint.program,location);if(actual.world.some((m,bone)=>m.some((v,i)=>!Object.is(v,key.world[bone][i]))))throw new Error('Pool interval forced endpoint differs from its actual key.');}
    const pose=Object.assign(replay,{source:seed.source,rawTranslations:seed.rawTranslations,positionDeviations:seed.positionDeviations}),surfaces=this.geometry.map((geometry,index)=>({geometry,points:posedCageSurface(geometry,this.cages[index],skin)})),observation=observePoolSource(this.fixture,surfaces,location);
    const arithmetic=constructed.flatMap<PoolContactArithmetic>(c=>c.frame?[derivePoolSupportArithmetic(this.fixture,surfaces[0],this.cages[0],pose,c.patch,source[c.limb],c.frame,observation)]:c.railFrame?[derivePoolRailArithmetic(this.fixture,surfaces[0],this.cages[0],pose,c.patch,source[c.limb],c.railFrame,observation)]
      :c.reference&&c.plan?[derivePoolApproachClearanceArithmetic(this.fixture,surfaces[0],this.cages[0],pose,c.patch,source[c.limb],c.limb as 'footL'|'footR',c.reference,c.plan,observation)]:[]);
    const supports=constructed.map(c=>({limb:c.limb,...observePoolPatchSupport(this.fixture,surfaces,c.patch,source[c.limb],phase,observation,arithmetic)}));
    return {pose,skin,knees,observation,arithmetic,supports,unresolvedViolations:poolViolationsBeyondArithmetic(observation,arithmetic),states:resolved.map(r=>r.state),exactReplayWorldAndBinarySkin:true as const};
  }

  /** Close a hand after the supported legs/root, using every actual allowed mesh edge. */
  private closeHand(pose:CanonicalPoolPose,limb:'handL'|'handR',phase:number,support:PoolSupport,preferredRoll:number,railChoice:number,preferredElbow:number,diagnostics:Record<string,unknown>):EntryContact|null {
    const anatomy=this.anatomy[limb],side=limb==='handL'?'L':'R',region=this.rails[side],solid=this.fixture.solids.find(solid=>solid.id===region.surface)!;
    const sourceParameter=5-clamp((phase-.1)/.55,0,1)*4,preferredParameter=railChoice===3?3:clamp(sourceParameter+(railChoice===1?-1:railChoice===2?1:0),1,5);
    const reach=configuredPoolChainReach(pose.rest,anatomy.upper,anatomy.lower,anatomy.end),start=point(pose.world[anatomy.upper]);
    const options:{contact:EntryContact;distance:number;edge:number}[]=[],reachable:Record<string,unknown>[]=[];
    if(poolSupportRequired(support,phase))for(const roll of [preferredRoll,1-preferredRoll])for(const [index,edge] of region.edges.entries()){
      const midpoint=(edge.fromParameter+edge.toParameter)/2,contact=this.hand(pose,limb,phase,roll,0,midpoint),rotation=[...contact.orientation];rotation.splice(12,3,0,0,0);
      const offset=poolSurfacePoint(rotation,anatomy.anchor),from=scale(sub(solid.vertices[edge.from],offset),1/anatomy.anchor[3]),direction=scale(sub(solid.vertices[edge.to],solid.vertices[edge.from]),1/anatomy.anchor[3]);
      const intervals=poolRootRayIntervals(direction,[{limb,center:sub(start,from),reach}]);
      for(const interval of intervals){
        const low=Math.max(0,interval.minimum),high=Math.min(1,interval.maximum);if(low>=high)continue;
        const wanted=(preferredParameter-edge.fromParameter)/(edge.toParameter-edge.fromParameter),amount=clamp(wanted,low+(high-low)/4,high-(high-low)/4);
        const parameter=edge.fromParameter+(edge.toParameter-edge.fromParameter)*amount,selected=this.hand(pose,limb,phase,roll,0,parameter);
        if(!poolChainReachable(reach,start,this.endTarget(selected)))continue;
        reachable.push({edge:index,parameter,roll,interval:[low,high]});options.push({contact:selected,distance:Math.abs(parameter-preferredParameter),edge:index});
      }
    }
    else {const contact=this.handNode(pose,limb,phase,preferredRoll,railChoice);if(contact.weight>0)options.push({contact,distance:0,edge:-1});}
    options.sort((a,b)=>a.distance-b.distance||(a.contact.roll===preferredRoll?0:1)-(b.contact.roll===preferredRoll?0:1)||a.edge-b.edge);
    const baseline=pose.basis.map(clonePoolMatrix),trials:Record<string,unknown>[]=[];
    diagnostics[limb]={preferredParameter,reachable,trials};
    const selectedOptions=[...options.filter(option=>option.contact.roll===preferredRoll).slice(0,3),...options.filter(option=>option.contact.roll!==preferredRoll).slice(0,3)];
    for(const {contact,edge} of selectedOptions)for(const blend of [...new Set([preferredElbow,0,.5,1])]){
      pose.basis=baseline.map(clonePoolMatrix);pose.world=composeSkeletonPose(this.bundle.bones,pose.rest,pose.basis);
      const original=contact.pole,inner:Vec3=[(this.fixture.rails[0].points[0].point[0]+this.fixture.rails[1].points[0].point[0])/2,start[1],start[2]],pole=add(scale(original,1-blend),scale(inner,blend));
      solvePoolHierarchyLimb(pose,anatomy.upper,anatomy.lower,anatomy.end,this.endTarget(contact),pole,contact.orientation);
      const skin=poolSkinMatrices(pose.world,pose.inverse),surfaces=this.geometry.map((_,index)=>({geometry:this.limbViews.get(limb)![index],points:posedCageSurface(this.geometry[index],this.cages[index],skin)}));
      const observation=observePool(this.fixture,surfaces);trials.push({edge,parameter:contact.parameter,roll:contact.roll,elbowBlend:blend,violations:observation.violations,observation,basis:pose.basis.map(matrix=>[...matrix])});
      if(!observation.violations.length)return {...contact,pole,elbowBlend:blend};
    }
    pose.basis=baseline;pose.world=composeSkeletonPose(this.bundle.bones,pose.rest,pose.basis);return null;
  }

  supportKey(phase:number):CompiledPoolPose {
    const candidates=this.compileNodeCandidates(phase);
    const accepted=candidates.find(candidate=>candidate.unresolvedViolations.length===0&&candidate.supports.every(support=>support.satisfied));
    if(!accepted)throw new Error('Pool entry node search remains unresolved at phase '+phase);
    return {skin:accepted.skin,basis:accepted.pose.basis,rest:accepted.pose.rest};
  }

  /** Own authored free-foot intent before optional pelvis/contact profile selection. */
  private phasePreference(seed:CanonicalPoolPose,phase:number){
    const policy=poolSourcePolicy(this.fixture,'pool_enter',phase),freeFeet:Partial<Record<'footL'|'footR',PhaseFreeFootGoal>>={};
    for(const limb of ['footL','footR'] as const)if(!policy[limb].required){
      const end=this.anatomy[limb].end;
      freeFeet[limb]=Object.freeze({target:Object.freeze(point(seed.world[end])),orientation:Object.freeze(properPoolRotation(seed.world[end]))});
    }
    const frame=(name:string)=>Object.freeze([...seed.world[this.bundle.bones.findIndex(bone=>bone.name===name)]]);
    return Object.freeze({action:'pool_enter' as const,phase,policy,pelvis:frame('hips'),trunk:frame('spine'),freeFeet:Object.freeze(freeFeet)});
  }

  prepareLegDomain(phase:number,request:ReturnType<typeof poolEntrySearchPlan>[number]){
    const source=this.fixture.clips.pool_enter.samples.find(sample=>sample.phase===phase);
    if(!source)throw new Error('Entry support key is not an authored source boundary.');
    const seed=canonicalPoolPreference(this.bundle,this.shape,this.top,'pool_enter',phase*(this.bundle.actions.pool_enter.length-1),this.geometry);
    const phasePreference=this.phasePreference(seed,phase),hips=this.bundle.bones.findIndex(b=>b.name==='hips'),spine=this.bundle.bones.findIndex(b=>b.name==='spine');
    const preference=canonicalPoolPreference(this.bundle,this.shape,this.top,'pool_enter',request.posture*(this.bundle.actions.pool_enter.length-1),this.geometry);
    const node={...seed,basis:seed.basis.map(clonePoolMatrix),world:seed.world.map(matrix=>[...matrix])};
    setPoolWorldRotation(node,hips,preference.world[hips]);setPoolWorldRotation(node,spine,seed.world[spine]);
    const footContacts=(['footL','footR'] as const).map(limb=>poolSupportRequired(source.limbs[limb],phase)
      ?this.foot(node,limb,source.limbs[limb],limb==='footL'?request.yawL:request.yawR,request.footY,limb==='footL'?request.xL:request.xR)
      :this.freeLimb(seed,limb,source.limbs[limb],phasePreference.freeFeet[limb]));
    for(const contact of footContacts){
      if(!poolSupportRequired(source.limbs[contact.limb],phase))continue;
      const orientation=[...contact.orientation];orientation.splice(12,3,0,0,0);
      const target=scale(sub(contact.target,poolSurfacePoint(orientation,contact.anatomy.anchor)),1/contact.anatomy.anchor[3]);
      contact.frame=preparePoolFootContactFrame(this.fixture,source.limbs[contact.limb],this.geometry[0],this.cages[0],seed.inverse[contact.anatomy.end],contact.patch,orientation,[target[0],target[1]]);
      contact.orientation=[...contact.frame.orientation];
    }
    const contacts=footContacts.filter(contact=>contact.frame);
    const targetFor=(contact:EntryContact)=>{
      if(contact.frame)return contact.frame.translation;
      const rotation=[...contact.orientation];rotation.splice(12,3,0,0,0);
      return scale(sub(contact.target,poolSurfacePoint(rotation,contact.anatomy.anchor)),1/contact.anatomy.anchor[3]);
    };
    const constraints=contacts.map(contact=>({limb:contact.limb,center:sub(targetFor(contact),point(node.world[contact.anatomy.upper])),
      reach:configuredPoolChainReach(seed.rest,contact.anatomy.upper,contact.anatomy.lower,contact.anatomy.end)}));
    return {source,seed,node,phasePreference,footContacts,constraints,cages:this.cages};
  }

  evaluateLegDomain(domain:ReturnType<PoolEntryCompiler['prepareLegDomain']>,root:Vec3,_request:ReturnType<typeof poolEntrySearchPlan>[number]){
    const {node,footContacts}=domain,pose={...node,basis:node.basis.map(clonePoolMatrix),world:node.world.map(matrix=>[...matrix])};translatePoolRoot(pose,root);
    const preferenceBasis=pose.basis.map(clonePoolMatrix);
    const legs=footContacts.map(input=>{
      const contact={...input},{upper,lower,end}=contact.anatomy;
      if(contact.frame){const plan=solvePoolOrientedFoot(pose,upper,lower,end,contact.frame);return {contact,plan,knee:observeConstructedPoolLeg(pose,contact.frame,plan)};}
      const goal=domain.phasePreference.freeFeet[contact.limb as 'footL'|'footR'];
      if(!goal)throw new Error('Pool free foot has no owned phase-local preference.');
      // Root travel is explicit and applied once; pelvis alternatives cannot rotate the authored goal.
      contact.target=add(goal.target,root);contact.orientation=clonePoolMatrix(goal.orientation);
      const plan=solvePoolFreeLeg(pose,upper,lower,end,contact.target,contact.orientation);contact.pole=[...plan.pole];
      return {contact,plan,knee:observeConstructedPoolFreeLeg(pose,plan)};
    });
    const plans=legs.map(leg=>leg.plan),knees=legs.map(leg=>leg.knee);
    const skin=poolSkinMatrices(pose.world,pose.inverse),points=this.geometry.map((geometry,index)=>posedCageSurface(geometry,this.cages[index],skin));
    const surfaces=this.geometry.flatMap((_,index)=>(['footL','footR'] as const).map(limb=>({geometry:this.limbViews.get(limb)![index],points:points[index]})));
    const legContacts=legs.map(({contact,plan})=>({...contact,pole:plan.pole,legFrame:'source-entry-0' as const}));
    return {pose,preferenceBasis,knees,legPlans:plans,legContacts,legObservation:observePool(this.fixture,surfaces)};
  }

  /** One explicit authored articulation, independent of the pelvis and its leg frame. */
  applyAuthoredTrunkControl(domain:ReturnType<PoolEntryCompiler['prepareLegDomain']>,pitchDegrees:number):void {
    if(!Number.isFinite(pitchDegrees))throw new Error('Pool authored trunk control needs a finite source pitch.');
    const reference=canonicalPoolPreference(this.bundle,this.shape,this.top,'pool_enter',0,this.geometry),spine=this.bundle.bones.findIndex(bone=>bone.name==='spine');
    const angle=pitchDegrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),rotation=[1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1];
    setPoolWorldRotation(domain.node,spine,multiply(rotation,reference.world[spine]));
  }

  applyAuthoredHeadSource(domain:ReturnType<PoolEntryCompiler['prepareLegDomain']>,phase:number):void {
    if(!Number.isFinite(phase)||phase<0||phase>1)throw new Error('Pool authored head source is outside its clip.');
    const reference=canonicalPoolPreference(this.bundle,this.shape,this.top,'pool_enter',phase*(this.bundle.actions.pool_enter.length-1),this.geometry);
    const head=this.bundle.bones.findIndex(bone=>bone.name==='head');setPoolWorldRotation(domain.node,head,reference.world[head]);
  }

  /** Expose the actual full-grip rail segments for root/reach diagnostics without fitting a hand. */
  railRootDomain(domain:ReturnType<PoolEntryCompiler['prepareLegDomain']>){
    const {source,node}=domain;
    return (['handL','handR'] as const).map(limb=>{
      const anatomy=this.anatomy[limb],region=this.rails[limb==='handL'?'L':'R'],solid=this.fixture.solids.find(solid=>solid.id===region.surface)!;
      const reach=configuredPoolChainReach(node.rest,anatomy.upper,anatomy.lower,anatomy.end),start=point(node.world[anatomy.upper]);
      const segments=[0,1].flatMap(roll=>region.edges.map((edge,index)=>{
        const contact=this.hand(node,limb,source.phase,roll,0,(edge.fromParameter+edge.toParameter)/2);
        if(contact.weight!==1)throw new Error('Pool rail/root diagnostic requires its full-grip source interval.');
        const orientation=[...contact.orientation];orientation.splice(12,3,0,0,0);
        const offset=poolSurfacePoint(orientation,anatomy.anchor),end=(vertex:Vec3)=>scale(sub(vertex,offset),1/anatomy.anchor[3]);
        return {edge:index,roll,parameter:[edge.fromParameter,edge.toParameter],from:end(solid.vertices[edge.from]),to:end(solid.vertices[edge.to]),orientation};
      }));
      return {limb,surface:region.surface,allowedFacets:region.triangles,start,reach,segments};
    });
  }

  /** Contacts, real reach rays and independently owned anatomical branches form one node domain. */
  compileNodeCandidates(phase:number,witness?:{requestId:number;root:Vec3;trunkPitchDegrees?:number;headSourcePhase?:number}){
    const source=this.fixture.clips.pool_enter.samples.find(sample=>sample.phase===phase);
    if(!source)throw new Error('Entry support key is not an authored source boundary.');
    const seed=canonicalPoolPreference(this.bundle,this.shape,this.top,'pool_enter',phase*(this.bundle.actions.pool_enter.length-1),this.geometry);
    const hips=this.bundle.bones.findIndex(b=>b.name==='hips'),spine=this.bundle.bones.findIndex(b=>b.name==='spine');
    const scheduled=poolEntrySearchPlan(phase),plan=witness?scheduled.filter(request=>request.id===witness.requestId):scheduled;
    if(witness&&(!plan.length||witness.root.length!==3||witness.root.some(value=>!Number.isFinite(value))))throw new Error('Pool explicit root witness has no declared finite domain request.');
    const search={planned:plan.length,attempts:[] as Record<string,unknown>[],stoppedAfterSuccess:false};this.searches.set(phase,search);
    const records=[];
    for(const request of plan){
      const attempt:Record<string,unknown>={...request,status:'constructing'};search.attempts.push(attempt);
      try{
        const domain=this.prepareLegDomain(phase,request),{node,footContacts,constraints}=domain,contacts=[...footContacts];
        if(witness?.trunkPitchDegrees!==undefined){this.applyAuthoredTrunkControl(domain,witness.trunkPitchDegrees);attempt.authoredTrunk={referencePhase:0,pitchDegrees:witness.trunkPitchDegrees};}
        if(witness?.headSourcePhase!==undefined){this.applyAuthoredHeadSource(domain,witness.headSourcePhase);attempt.authoredHead={sourcePhase:witness.headSourcePhase};}
        attempt.constraints=constraints;
        let root:Vec3=[0,0,0];
        if(witness){root=witness.root;attempt.rootSource='explicit observed oriented-domain witness';}
        else if(request.ray!==0){
          const intervals=poolRootRayIntervals(request.direction,constraints);attempt.feasibleRayIntervals=intervals;
          if(!intervals.length){attempt.status='rejected';attempt.reason='no feasible interior on this declared root ray';continue;}
          const interval=intervals[0],amount=interval.minimum+(interval.maximum-interval.minimum)*request.rayFraction;root=scale(request.direction,amount);attempt.rayAmount=amount;
        }
        attempt.requestedRoot=root;attempt.actualRoot=root;
        const failed=constraints.filter(constraint=>!poolChainReachable(constraint.reach,root,constraint.center));
        if(failed.length){attempt.status='rejected';attempt.reason='root request violates actual chain reach';attempt.rejectedConstraints=failed;continue;}
        const evaluated=this.evaluateLegDomain(domain,root,request),{pose,preferenceBasis,knees,legObservation}=evaluated;
        contacts.splice(0,footContacts.length,...evaluated.legContacts);attempt.legFrame='source-entry-0';
        attempt.sourcePointBlendDiagnostic={left:request.kneeL,right:request.kneeR,usedForConstruction:false};
        attempt.knees=knees;attempt.basis=pose.basis.map(matrix=>[...matrix]);attempt.rest=pose.rest;attempt.footFrames=footContacts.map(contact=>contact.frame);
        const actualHips=point(pose.world[hips]),authoredHips=point(seed.source.source[hips]),sourceDisplacement=sub(actualHips,authoredHips);
        const projection={requested:root,projected:root,actualHips,authoredHips,sourceDisplacement,sourceDisplacementLength:length(sourceDisplacement),active:[],sourceRegionPolicy:'preference-only',
          sourceDeviation:[0,1,2].map(axis=>Math.max(0,source.rootRegion.minimum[axis]-sourceDisplacement[axis],sourceDisplacement[axis]-source.rootRegion.maximum[axis]))};
        attempt.projection=projection;attempt.postureFrames={hips:pose.world[hips],spine:pose.world[spine]};
        attempt.legViolations=legObservation.violations;
        if(legObservation.violations.length){attempt.status='rejected';attempt.reason='prepared leg intersects a fixture solid';continue;}
        const handDiagnostics:Record<string,unknown>={};attempt.handClosures=handDiagnostics;
        let handFailure=false;
        if(phase<.6)for(const limb of ['handL','handR'] as const){
          if(source.limbs[limb].mode==='free'||!poolSupportRequired(source.limbs[limb],phase)&&this.handNode(pose,limb,phase,0).weight===0)continue;
          const beforeHand=pose.basis.map(clonePoolMatrix);
          const contact=this.closeHand(pose,limb,phase,source.limbs[limb],limb==='handL'?request.rollL:request.rollR,limb==='handL'?request.railL:request.railR,limb==='handL'?request.elbowL:request.elbowR,handDiagnostics);
          if(!contact){handFailure=true;continue;}
          const reference=poolSupportRequired(source.limbs[limb],phase)?pose.basis:beforeHand;
          for(const bone of [contact.anatomy.upper,contact.anatomy.lower,contact.anatomy.end])preferenceBasis[bone]=clonePoolMatrix(reference[bone]);
          if(poolSupportRequired(source.limbs[limb],phase)){
            const anatomy=this.anatomy[limb],patch=anatomy.patch,support=source.limbs[limb];
            const key=canonicalPoolValue({limb,support,inverse:pose.inverse[anatomy.end]});let geometry=this.railGeometry.get(key);
            if(!geometry){geometry=preparePoolRailGeometry(this.fixture,support,this.geometry[0],this.cages[0],pose.inverse[anatomy.end],patch);this.railGeometry.set(key,geometry);}
            const rawOrientation=Object.freeze([...contact.orientation]),parameter=contact.parameter!,location=Object.freeze({action:'pool_enter',phase,limb}),railFrame=resolvePoolRailContactFrame(geometry,rawOrientation,parameter,undefined,location);
            contact.attached=Object.freeze({source:location,geometry,parameter,rawOrientation,activeVertex:railFrame.activeVertex});
            solveCertifiedPoolRail(pose,anatomy.upper,anatomy.lower,anatomy.end,railFrame,contact.pole,{fixture:this.fixture,geometry:this.geometry[0],cage:this.cages[0],patch,support});
            contacts.push({...contact,patch,railFrame,orientation:[...railFrame.orientation],target:railFrame.targetPoint});
          }else contacts.push(contact);
        }
        if(handFailure){attempt.status='rejected';attempt.reason='bounded independent reachable rail closure remains unresolved';continue;}
        for(const limb of ['handL','handR'] as const)if(!contacts.some(contact=>contact.limb===limb))contacts.push(this.freeLimb(pose,limb,source.limbs[limb]));
        const program=makePoolPoseProgram(preferenceBasis,contacts.map(contact=>({upper:contact.anatomy.upper,lower:contact.anatomy.lower,end:contact.anatomy.end,
          anchor:[0,0,0,1],...(contact.limb.startsWith('foot')?{legFrame:'source-entry-0' as const}:{}),
          state:{target:this.endTarget(contact),pole:contact.pole,orientation:contact.orientation,...(contact.attached?{attached:contact.attached}:{})}})),poolSourcePolicy(this.fixture,'pool_enter',phase));
        const observed=this.observeProgram(program,pose,contacts,source.limbs,phase),{supports,unresolvedViolations}=observed;
        attempt.status='observed';attempt.materialViolations=unresolvedViolations;attempt.supportOutcomes=supports;attempt.observedRecord=records.length;
        records.push({phase,planId:request.id,posture:request.posture,fraction:request.rayFraction,legFrame:'source-entry-0',roll:{left:request.rollL,right:request.rollR},
          projection,...observed,program,contacts});
        if(!unresolvedViolations.length&&supports.every(support=>support.satisfied)){search.stoppedAfterSuccess=true;return records;}
      }catch(error){attempt.status='rejected';attempt.reason=error instanceof Error?error.message:String(error);}
    }
    return records;
  }
}
