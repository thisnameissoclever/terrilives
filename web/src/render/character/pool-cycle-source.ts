import type {Bundle,Geometry} from './bundle.js';
import type {ShapeParameters} from './shape.js';
import {shapeVertices} from './shape.js';
import type {Vec3} from './math.js';
import {add,sub,scale,unit,cross,dot,length,multiply,inverseAffine,transform,identity,boneFrame} from './math.js';
import {canonicalPoolPreference,properPoolRotation,setPoolWorldRotation,translatePoolRoot} from './pool-canonical-pose.js';
import {preparePoolEntryAnatomy,poolSurfacePoint} from './pool-entry-anatomy.js';
import {preparePoolFootContactFrame} from './pool-foot-contact-frame.js';
import {preparePoolRailGeometry,resolvePoolRailContactFrame,type PoolPreparedRailGeometry,type PoolRailContactFrame} from './pool-rail-contact-frame.js';
import {configuredPoolChainReach,poolRootRayIntervals,poolChainReachable} from './pool-entry-domain.js';
import {poolIntervalPreference} from './pool-contact-sample.js';
import {poolSourceRecord,poolSourcePolicy} from './pool-source-policy.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import type {PoolPoseControl,PoolLimbState} from './pool-contact-evaluator.js';
import type {PoolFixtureV1,PoolLimb,PoolSupport} from './pool-contact-types.js';
import {clonePoolMatrix} from './pool-matrix-producer.js';
import {canonicalPoolValue} from './pool-contact-identity.js';
import {interpolateTransform} from './motion.js';
import {projectedTrianglePatch,type Triangle} from './pool-solid.js';
import {posedCageSurface} from './geometry-proof.js';
import {solvePoolOrientedFoot,observeConstructedPoolLeg} from './pool-oriented-leg.js';
import {fitPoolWaterTarget,poolStrokeAirwayRise,poolWaterBounds} from './pool-water-retarget.js';
import {fitPoolFirstRungHips,fitPoolGroundGrip} from './pool-ground-grip.js';
import {poolCrestExteriorY,poolCrestReachY,poolCrestYaw} from './pool-crest-fit.js';

export type PoolFoot='footL'|'footR';
export type PoolHand='handL'|'handR';
interface Anchor {unit:number;phase:number;name:string;feet:[string,string];body:string;trunkPitchDegrees:number}
interface Transfer {limb:PoolFoot;from:string;to:string;start:number;end:number;startUnit:number;endUnit:number}
interface PlantedBodyPath {fromUnit:number;toUnit:number;limb:PoolFoot;place:string;boundaryUnits:number[];sampleUnits:number[]}
interface CrestElbowPole {fromUnit:number;peakUnit:number;toUnit:number;peakUpperArmFraction:number}
interface PoolHandDefinition {approach:[number,number];release:Record<PoolHand,[number,number]>;region:[number,number];outsideBranch:[number,number];crestBranch:[number,number];insideBranch:[number,number]}
interface PoolWaterStrokeDefinition {
 airwayFreeboardFraction:number;
 foot:{rearReachFraction:number;dropReachFraction:number;kickReachFraction:number};
 hand:{forwardReachFraction:number;dropReachFraction:number;sweepReachFraction:number;liftReachFraction:number;spreadReachFraction:number};
}
interface PoolGroundGripDefinition {acquisitionUnit:number;firstRungUnit:number;secondRungUnit:number;clearance:'crest-exterior-and-planted-shin'}
interface CrestRoute {handTransferUnits:[number,number,number,number];footSwingUnits:[number,number];rightStepUnits:[number,number];sampleUnits:number[]}
interface PoolCrestFitDefinition {
 outerShift:number;innerShift:number;shinReferenceUnit:number;outerParameter:number;innerParameter:number;frameBasis:'held-exterior';
 earlyClearance:{rightShinX:number;leftUpperArmX:number};
}
export type PoolCycleDefinition = {
 clockUnits:number;nativeTicks:{enter:number;paddle:number;exit:number;tickHz:number};
 reference:{neutralSample:{basis:number[][]};sourceRigSha256:string};
 ground:{pelvisXY:[number,number];bounds:Vec3[]};anchors:Anchor[];footTransitions:Transfer[];transferPercentages:number[];bodyProgressFraction:number;
 places:Record<string,{surface:string;patch:'front'|'back'|'full'}>;
 legFlexionDegrees:{low:number;high:number;crestLeading:number};
 paddle:{centre:Vec3;hipPitchDegrees:number;headPitchDegrees:number;footSoleZ:number;footY:number;kickAmplitude:number;palmY:number;palmZ:number;palmWaveY:number;palmWaveZ:number;palmHalfWidth:number;palmWaveX:number;handPitchDegrees:number;samples:number};
 waterCorridor:{initialCentre:Vec3;finalCentre:Vec3};
 plantedBodyPaths:PlantedBodyPath[];
} & (
 {version:13;hand:PoolHandDefinition & {crestElbowPole?:never};waterStroke?:never;groundGrip?:never;crestFit?:never} |
 {version:14;hand:PoolHandDefinition & {crestElbowPole:CrestElbowPole};waterStroke?:never;groundGrip?:never;crestFit?:never} |
 {version:15;hand:PoolHandDefinition & {crestElbowPole:CrestElbowPole};waterStroke:PoolWaterStrokeDefinition;groundGrip?:PoolGroundGripDefinition;crestFit?:PoolCrestFitDefinition} |
 {version:16;hand:PoolHandDefinition & {crestElbowPole:CrestElbowPole};waterStroke:PoolWaterStrokeDefinition;groundGrip:PoolGroundGripDefinition;crestFit:PoolCrestFitDefinition;crestRoute:CrestRoute}
);
export function validatePoolCycleDefinition(value:unknown):asserts value is PoolCycleDefinition {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Pool source definition is missing');const source=value as Partial<PoolCycleDefinition>;
 if(source.version!==13&&source.version!==14&&source.version!==15&&source.version!==16)throw new Error('Pool source motion version is unsupported');
 if(source.clockUnits!==100000||source.nativeTicks?.enter!==20||source.nativeTicks.paddle!==60||source.nativeTicks.exit!==20||source.nativeTicks.tickHz!==10||source.paddle?.samples!==12)throw new Error('Pool source has another native clock');
 const paths=[{fromUnit:22000,toUnit:32000,limb:'footR',place:'outside2',boundaryUnits:[21999,22001,31999,32001],sampleUnits:[25125]},
  {fromUnit:32000,toUnit:42000,limb:'footL',place:'outside3',boundaryUnits:[31999,32001,41999,42001],sampleUnits:[35125,36250,37375]}];
 if(canonicalPoolValue(source.plantedBodyPaths)!==canonicalPoolValue(paths))throw new Error('Pool planted body paths differ from their two authored segments');
 if(!Array.isArray(source.anchors)||!source.anchors.length||!Array.isArray(source.footTransitions)||!source.places||!source.hand||typeof source.hand!=='object'||Array.isArray(source.hand)||!source.legFlexionDegrees||!source.waterCorridor||!source.ground||!source.reference)throw new Error('Pool source is incomplete');
 if(source.version===13&&'crestElbowPole' in source.hand)throw new Error('Pool source v13 cannot author a crest elbow pole');
 if(source.version!==13){
  const pole=source.hand.crestElbowPole;
  if(!pole||typeof pole!=='object'||Array.isArray(pole)
    ||Object.keys(pole).sort().join(',')!=='fromUnit,peakUnit,peakUpperArmFraction,toUnit'
    ||pole.fromUnit!==48000||pole.peakUnit!==49600||pole.toUnit!==53200
    ||!Number.isFinite(pole.peakUpperArmFraction)||pole.peakUpperArmFraction<=0||pole.peakUpperArmFraction>1)
   throw new Error('Pool source v'+source.version+' crest elbow pole is invalid');
 }
 const fitted=source.version===15||source.version===16;
 if(!fitted&&'waterStroke' in source)throw new Error('Pool source v'+source.version+' cannot author a water stroke');
 if('groundGrip' in source&&(!fitted||canonicalPoolValue(source.groundGrip)!==canonicalPoolValue({
  acquisitionUnit:5000,firstRungUnit:12000,secondRungUnit:22000,clearance:'crest-exterior-and-planted-shin'
 })))throw new Error('Pool source grounded acquisition does not match its authored anchors');
 if('crestFit' in source&&(!fitted||canonicalPoolValue(source.crestFit)!==canonicalPoolValue({
  outerShift:.004,innerShift:-.024,shinReferenceUnit:35125,outerParameter:47/12,innerParameter:1.5,frameBasis:'held-exterior',
  earlyClearance:{rightShinX:-.25201815907410885,leftUpperArmX:-.75572270154953}
 })))throw new Error('Pool source crest fit is invalid');
 if(source.version===16){
  const route=source.crestRoute;
  if(!route||!source.crestFit||!source.groundGrip||canonicalPoolValue(route)!==canonicalPoolValue({
   handTransferUnits:[42400,42800,43600,44800],footSwingUnits:[44800,53200],rightStepUnits:[53200,64000],
   sampleUnits:[42000,42400,42800,43600,44800,47950,50050,53200,64000],
  }))throw new Error('Pool source v16 crest support sequence is invalid');
 }else if('crestRoute' in source)throw new Error('Pool crest support sequence requires motion v16');
 if(fitted){
  const stroke=source.waterStroke;
  const fraction=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<1;
  const fractions=(value:unknown,keys:readonly string[])=>value!==null&&typeof value==='object'&&!Array.isArray(value)
    &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)&&fraction((value as Record<string,unknown>)[key]));
  if(!stroke||typeof stroke!=='object'||Object.keys(stroke).sort().join(',')!=='airwayFreeboardFraction,foot,hand'
    ||!fraction(stroke.airwayFreeboardFraction)
    ||!fractions(stroke.foot,['rearReachFraction','dropReachFraction','kickReachFraction'])
    ||!fractions(stroke.hand,['forwardReachFraction','dropReachFraction','sweepReachFraction','liftReachFraction','spreadReachFraction'])
    ||stroke.foot.kickReachFraction>=Math.min(stroke.foot.rearReachFraction,stroke.foot.dropReachFraction)
    ||stroke.hand.sweepReachFraction>=stroke.hand.forwardReachFraction)
   throw new Error('Pool source v15 water stroke is invalid');
 }
 const numbers=(values:unknown,count:number)=>Array.isArray(values)&&values.length===count&&values.every(v=>typeof v==='number'&&Number.isFinite(v));
 if(!numbers(source.ground.pelvisXY,2)||!numbers(source.paddle.centre,3)||!numbers(source.waterCorridor.initialCentre,3)||!numbers(source.waterCorridor.finalCentre,3)||!numbers(source.hand.region,2)||!numbers(source.hand.approach,2)||!numbers(source.hand.release.handL,2)||!numbers(source.hand.release.handR,2)||!numbers(source.transferPercentages,5)||source.transferPercentages![0]!==0||source.transferPercentages!.at(-1)!==100||!(source.bodyProgressFraction!>0&&source.bodyProgressFraction!<=1))throw new Error('Pool source has invalid authored coordinates');
 const kinds=['ground','outside-pair','crest-leading','crest','descent','water-corridor','water-centre','paddle'];
 source.anchors.forEach((a,i)=>{if(!a||!Number.isSafeInteger(a.unit)||a.phase!==a.unit/source.clockUnits!||a.phase<0||a.phase>1||i>0&&a.phase<=source.anchors![i-1].phase||!kinds.includes(a.body)||!numbers([a.trunkPitchDegrees],1)||!Array.isArray(a.feet)||a.feet.length!==2||a.feet.some(p=>p!=='free'&&!source.places![p]))throw new Error('Pool source anchor is invalid');});
 for(const limb of ['footL','footR'] as const){let place='ground',end=0;for(const t of source.footTransitions.filter(t=>t.limb===limb)){if(t.from!==place||t.start<end||t.start>=t.end||t.start!==t.startUnit/source.clockUnits!||t.end!==t.endUnit/source.clockUnits!||t.to!=='free'&&!source.places[t.to])throw new Error('Pool source foot sequence is discontinuous');place=t.to;end=t.end;}if(place!=='free')throw new Error('Pool source foot sequence never releases into water');}
 if(source.footTransitions.some(t=>t.limb!=='footL'&&t.limb!=='footR')||source.anchors[0].phase!==0||source.anchors.at(-1)!.phase!==1)throw new Error('Pool source has invalid endpoints');
}
const vector=(v:readonly number[]):Vec3=>{if(v.length!==3||v.some(x=>!Number.isFinite(x)))throw new Error('Pool source vector is not finite.');return [v[0],v[1],v[2]];};
const point=(m:readonly number[])=>vector(m.slice(12,15));
const same=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const lerp=(a:Vec3,b:Vec3,t:number):Vec3=>t===0?a:t===1?b:vector(a.map((v,i)=>v+(b[i]-v)*t));
const mix=(a:number,b:number,t:number)=>t===0?a:t===1?b:a+(b-a)*t;
const smooth=(t:number)=>t*t*(3-2*t);
const rotationMix=(a:readonly number[],b:readonly number[],t:number):number[]=>t===0||same(a,b)?[...a]:t===1?[...b]:interpolateTransform([...a],[...b],t);
const pitch=(degrees:number)=>{const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1];};
const yaw=(a:number)=>{const c=Math.cos(a),s=Math.sin(a);return [c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1];};
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const bounds=(points:readonly Vec3[]):[Vec3,Vec3]=>[vector([0,1,2].map(i=>Math.min(...points.map(p=>p[i])))),vector([0,1,2].map(i=>Math.max(...points.map(p=>p[i]))))];
interface FootGoal {place:string;support:PoolSupport;target:Vec3;orientation:readonly number[];plane:number;bounds:[Vec3,Vec3];height:number;lift:number}
interface BodyIntent {hips:Vec3;hipPitch:number;trunkPitch:number;headPitch:number;trunkYaw?:number}
interface CrestNode {phase:number;body:BodyIntent;grips:readonly [number,number]}
interface BodyPathEndpoint {upper:readonly number[];lower:readonly number[];hipRotation:readonly number[];branch:number;flexion:number;hips:Vec3;knee:Vec3;ankle:Vec3}

/** This source owns one explicit action recipe; it never searches after observing a failure. */
export class PoolCycleSource {
 readonly neutral;readonly anatomy;readonly cages;readonly rawFeet:Record<PoolFoot,number[]>;readonly flatFeet:Record<PoolFoot,readonly number[]>;
 private readonly footGoals=new Map<string,FootGoal>();private readonly footFrames=new Map<string,ReturnType<typeof preparePoolFootContactFrame>>();private readonly railReferences=new Map<string,PoolRailContactFrame>();private readonly bodies=new Map<number,BodyIntent>();
 private readonly railInputs=new Map<string,PoolPreparedRailGeometry>();private readonly grips=new Map<string,PoolLimbState>();
 private readonly hip:number;private readonly spine:number;private readonly head:number;
 private readonly limbReach;private readonly sourceHands:Record<PoolHand,{wrist:Vec3;elbow:Vec3;rotation:number[]}>;
 private readonly legBounds:Record<PoolFoot,[Vec3,Vec3]>;
 private readonly plantedEndpoints=new Map<string,readonly [BodyPathEndpoint,BodyPathEndpoint]>();
 private readonly plantedWitnesses=new Map<string,{hips:Vec3;knee:Vec3;ankle:Vec3;amount:number;endpointExact:boolean}>();
 private waterFit?:{pose:ReturnType<PoolCycleSource['body']>['pose'];bounds:ReturnType<typeof poolWaterBounds>};
 private waterJoin?:PoolPoseProgram;
 private groundGripFit?:{offset:Vec3;hands?:Record<PoolHand,PoolLimbState>};
 private crestOutward?:Vec3;
 private crestTorso?:readonly Triangle[];
 private crestArmCap?:number;
 private crestLeadingReference?:BodyIntent;
 private crestNodes?:readonly CrestNode[];
 private crestTailNodes?:readonly CrestNode[];
 private routeLandingGrips?:readonly [number,number];
 private replantParameter?:number;
 constructor(readonly bundle:Bundle,readonly shape:ShapeParameters,readonly top:number,readonly geometry:readonly Geometry[],readonly fixture:PoolFixtureV1,readonly definition:PoolCycleDefinition){
  validatePoolCycleDefinition(definition);
  if(canonicalPoolValue(bundle.basisActions.pool_enter[0])!==canonicalPoolValue(definition.reference.neutralSample.basis))throw new Error('Pool source changed its anatomical reference.');
  if(!definition.anchors.length||definition.anchors[0].phase!==0||definition.anchors.at(-1)!.phase!==1||definition.anchors.some((a,i)=>a.phase!==a.unit/definition.clockUnits||i>0&&a.phase<=definition.anchors[i-1].phase))throw new Error('Pool source anchor clock is invalid.');
  this.neutral=canonicalPoolPreference(bundle,shape,top,'pool_enter',0,geometry);this.anatomy=preparePoolEntryAnatomy(geometry[0],shape,top);this.cages=geometry.map(g=>shapeVertices(g.cage,shape,top));
  const restSkin=new Float32Array(bundle.bones.length*16);bundle.bones.forEach((_,bone)=>restSkin.set(identity(),bone*16));
  const restSurface=posedCageSurface(geometry[0],this.cages[0],restSkin);
  if(definition.crestFit){
   const torso=geometry[0].description.parts.find(part=>part.name==='Creator bare torso');
   if(!torso)throw new Error('Pool crest fit needs the complete selected torso.');
   const spine=bundle.bones.findIndex(bone=>bone.name==='spine'),pivot=point(this.neutral.rest[spine]);
   const at=(index:number)=>sub(vector(Array.from(restSurface.subarray(index*3,index*3+3))),pivot);
   const triangles:Triangle[]=[];
   for(let i=torso.start;i<torso.start+torso.count;i+=3)triangles.push([at(geometry[0].indices[i]),at(geometry[0].indices[i+1]),at(geometry[0].indices[i+2])]);
   if(poolCrestYaw(triangles,this.crestRails(),definition.ground.pelvisXY[0])>0){
    this.crestTorso=triangles;
    const arm=geometry[0].description.parts.find(part=>part.name==='Creator upper arm skin L');
    if(!arm)throw new Error('Pool crest fit needs the complete leading upper arm.');
    const armInverse=this.neutral.inverse[this.anatomy.handL.upper];
    const vertices=new Set(geometry[0].indices.subarray(arm.start,arm.start+arm.count));
    this.crestArmCap=Math.max(...[...vertices].map(index=>{
     const [x,y,z]=transform(armInverse,vector(Array.from(restSurface.subarray(index*3,index*3+3))));
     return Math.hypot(x,Math.min(y,0),z);
    }));
   }
  }
  this.legBounds=Object.fromEntries((['footL','footR'] as const).map(limb=>{
   const name='Creator bare leg '+limb.at(-1),part=geometry[0].description.parts.find(p=>p.name===name);if(!part)throw new Error('Pool source has no complete selected leg: '+name);
   const ids=[...new Set(geometry[0].indices.subarray(part.start,part.start+part.count))];
   return [limb,bounds(ids.map(id=>vector(Array.from(restSurface.subarray(id*3,id*3+3)))))];
  })) as Record<PoolFoot,[Vec3,Vec3]>;
  this.hip=bundle.bones.findIndex(b=>b.name==='hips');this.spine=bundle.bones.findIndex(b=>b.name==='spine');this.head=bundle.bones.findIndex(b=>b.name==='head');
  this.rawFeet={footL:properPoolRotation(this.neutral.rest[this.anatomy.footL.end]),footR:properPoolRotation(this.neutral.rest[this.anatomy.footR.end])};
  this.limbReach=Object.fromEntries((['footL','footR','handL','handR'] as const).map(limb=>{const a=this.anatomy[limb];return [limb,configuredPoolChainReach(this.neutral.rest,a.upper,a.lower,a.end)];})) as Record<PoolLimb,ReturnType<typeof configuredPoolChainReach>>;
  this.flatFeet={footL:this.foot('footL','ground').orientation,footR:this.foot('footR','ground').orientation};
  const inverse=inverseAffine(this.neutral.world[this.spine]);
  const handReference=(limb:PoolHand)=>{const a=this.anatomy[limb];return {wrist:transform(inverse,point(this.neutral.world[a.end])),elbow:transform(inverse,point(this.neutral.world[a.lower])),rotation:properPoolRotation(multiply(inverse,this.neutral.world[a.end]))};};
  this.sourceHands={handL:handReference('handL'),handR:handReference('handR')};
 }
 patch(limb:PoolLimb,support:PoolSupport){
  const a=this.anatomy[limb];if(limb.startsWith('hand'))return a.patch;
  const name=Object.values(this.definition.places).find(p=>p.surface===support.surface)?.patch??'full';return name==='front'?a.front!:name==='back'?a.back!:a.patch;
 }
 frame(limb:PoolFoot,support:PoolSupport,xy:[number,number]){
  const key=limb+':'+canonicalPoolValue([support,xy]),old=this.footFrames.get(key);if(old)return old;const a=this.anatomy[limb];
  const frame=preparePoolFootContactFrame(this.fixture,support,this.geometry[0],this.cages[0],this.neutral.inverse[a.end],this.patch(limb,support),this.rawFeet[limb],xy);this.footFrames.set(key,frame);return frame;
 }
 private support(surface:string):PoolSupport {
  if(surface===this.fixture.ground.id)return {mode:'support',surface,interval:null,intervalSpace:'clip-phase',region:{kind:'top-face'}};
  const solid=this.fixture.solids.find(s=>s.id===surface);if(!solid)throw new Error('Pool source names an absent physical support: '+surface);
  const triangles=solid.triangles.flatMap((t,i)=>{const [a,b,c]=t.map(v=>solid.vertices[v]),n=cross(sub(b,a),sub(c,a));return n[2]>0&&n[0]===0&&n[1]===0?[i]:[];});
  if(!triangles.length)throw new Error('Pool source has no actual horizontal support: '+surface);
  return {mode:'support',surface,interval:null,intervalSpace:'clip-phase',region:{kind:'top-face',triangles}};
 }
 foot(limb:PoolFoot,place:string):FootGoal {
  const key=limb+':'+place,saved=this.footGoals.get(key);if(saved)return saved;
  const declared=this.definition.places[place];if(!declared)throw new Error('Pool source foot place is unknown: '+place);
  const a=this.anatomy[limb],support=this.support(declared.surface),patch=this.patch(limb,support),ground=place==='ground',solid=this.fixture.solids.find(s=>s.id===support.surface),rectangle=ground?this.fixture.ground.bounds:solid!.bounds;
  const raw=this.rawFeet[limb],reference=preparePoolFootContactFrame(this.fixture,support,this.geometry[0],this.cages[0],this.neutral.inverse[a.end],patch,raw,[0,0]);
  const rows=a.surfaceCoefficients.map(c=>({p:poolSurfacePoint(reference.orientation,c),w:c[3]})),patchRows=patch.vertices.map(v=>({p:poolSurfacePoint(reference.orientation,v.coefficient),w:v.coefficient[3]}));
  const lo=[0,1].map(i=>Math.max(...patchRows.map(r=>(rectangle[0][i]-r.p[i])/r.w))),hi=[0,1].map(i=>Math.min(...patchRows.map(r=>(rectangle[1][i]-r.p[i])/r.w)));
  let x=point(this.neutral.world[a.end])[0],y=this.definition.ground.pelvisXY[1];
  if(!ground){
   const left=this.fixture.solids.find(s=>s.id===this.fixture.rails[0].id)!,right=this.fixture.solids.find(s=>s.id===this.fixture.rails[1].id)!,middle=this.definition.ground.pelvisXY[0];
   const lane=limb==='footL'?[left.bounds[1][0],middle]:[middle,right.bounds[0][0]];
   lo[0]=Math.max(lo[0],...rows.map(r=>(lane[0]-r.p[0])/r.w));hi[0]=Math.min(hi[0],...rows.map(r=>(lane[1]-r.p[0])/r.w));
   if(place.startsWith('outside')){
    const wall=this.fixture.solids.find(s=>s.id==='Pool wall')!,planes=wall.triangles.flatMap(t=>{const [a,b,c]=t.map(i=>wall.vertices[i]),n=cross(sub(b,a),sub(c,a));return n[1]>0&&n[0]===0&&n[2]===0&&a[1]>0?[a[1]]:[];});
    if(!planes.length)throw new Error('Pool toe recess has no actual backing plane');const back=Math.min(...planes);
    lo[1]=Math.max(lo[1],...rows.map(r=>(back-r.p[1])/r.w));
   }
   if(lo.some((v,i)=>v>=hi[i]))throw new Error('Complete configured foot has no compact support domain: '+limb+' '+place);
   x=(lo[0]+hi[0])/2;y=(lo[1]+hi[1])/2;
  }else if(x<lo[0]||x>hi[0]||y<lo[1]||y>hi[1])throw new Error('Configured grounded foot leaves its actual landing');
  const frame=preparePoolFootContactFrame(this.fixture,support,this.geometry[0],this.cages[0],this.neutral.inverse[a.end],patch,raw,[x,y]),matrix=[...frame.orientation];matrix.splice(12,3,...frame.translation);
  const footPoints=a.surfaceCoefficients.map(c=>poolSurfacePoint(matrix,c)),full=bounds(footPoints),part=this.geometry[0].description.parts.find(p=>p.name===a.patch.part)!;
  const indices=this.geometry[0].indices.subarray(part.start,part.start+part.count),ids=[...new Set(indices)],vertices=new Map(ids.map((id,i)=>[id,footPoints[i]]));
  const footTriangles:Triangle[]=[];for(let i=0;i<indices.length;i+=3)footTriangles.push([vertices.get(indices[i])!,vertices.get(indices[i+1])!,vertices.get(indices[i+2])!]);
  let ceiling=Infinity,verticalClearance=Infinity;
  for(const obstacle of this.fixture.solids)if(obstacle.id!==support.surface)for(const triangle of obstacle.triangles){
   const points:Triangle=[obstacle.vertices[triangle[0]],obstacle.vertices[triangle[1]],obstacle.vertices[triangle[2]]],n=cross(sub(points[1],points[0]),sub(points[2],points[0]));if(n[2]>=0||n[0]!==0||n[1]!==0||points[0][2]<=frame.planeHeight)continue;
   const b=bounds(points);if(b[0][0]>=full[1][0]||b[1][0]<=full[0][0]||b[0][1]>=full[1][1]||b[1][1]<=full[0][1])continue;
   for(const footTriangle of footTriangles){
    const overlap=projectedTrianglePatch(footTriangle,points);if(!overlap.length)continue;
    const clearance=points[0][2]-Math.max(...overlap.map(p=>p[2]));
    if(clearance<verticalClearance){ceiling=points[0][2];verticalClearance=clearance;}
   }
  }
  const maxW=Math.max(...rows.map(r=>r.w)),lift=Math.min(.25/4,verticalClearance/(2*maxW));if(!(lift>0))throw new Error('Complete configured foot has no withdrawal height: '+limb+' '+place,{cause:{ceiling,verticalClearance,full,plane:frame.planeHeight,target:frame.translation}});
  const result={place,support,target:frame.translation,orientation:frame.orientation,plane:frame.planeHeight,bounds:full,height:full[1][2]-frame.planeHeight,lift};this.footGoals.set(key,result);return result;
 }
 private chord(limb:PoolFoot,degrees:number):number {
  const a=this.anatomy[limb],m=this.neutral.basis[a.lower],axis=unit([m[6]-m[9],m[8]-m[2],m[1]-m[4]]),angle=degrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),v=1-c,[x,y,z]=axis;
  const rotation=[c+x*x*v,y*x*v+z*s,z*x*v-y*s,0,x*y*v-z*s,c+y*y*v,z*y*v+x*s,0,x*z*v+y*s,y*z*v-x*s,c+z*z*v,0,0,0,0,1];
  const lower=multiply(this.neutral.inverse[a.upper],this.neutral.rest[a.lower]),first=point(lower),last=point(multiply(this.neutral.inverse[a.lower],this.neutral.rest[a.end]));lower.splice(12,3,0,0,0);
  return length(add(first,transform(lower,transform(rotation,last))));
 }
 private anchorIntent(anchor:Anchor):BodyIntent {
  const saved=this.bodies.get(anchor.unit);if(saved)return saved;
  const spec=this.definition,neutralHip=point(this.neutral.world[this.hip]);let hips:Vec3,hipPitch=0,headPitch=anchor.trunkPitchDegrees?10:0;
  if(anchor.body==='water-corridor'||anchor.body==='water-centre'||anchor.body==='paddle'){
   hips=anchor.body==='water-corridor'?spec.waterCorridor.initialCentre:anchor.body==='water-centre'?spec.waterCorridor.finalCentre:spec.paddle.centre;hipPitch=spec.paddle.hipPitchDegrees;headPitch=spec.paddle.headPitchDegrees;
  }else if(anchor.body==='ground'){
   const g=this.foot('footR','ground');hips=[...spec.ground.pelvisXY,g.target[2]+neutralHip[2]-this.neutral.world[this.anatomy.footR.end][14]];
  }else {
   const left=this.foot('footL',anchor.feet[0]),right=this.foot('footR',anchor.feet[1]),x=spec.ground.pelvisXY[0];
   const offset=(limb:PoolFoot)=>sub(point(this.neutral.world[this.anatomy[limb].upper]),neutralHip);
   if(anchor.body==='crest')hips=[x,(left.target[1]+right.target[1])/2,(left.target[2]+right.target[2])/2+neutralHip[2]-(this.neutral.world[this.anatomy.footL.end][14]+this.neutral.world[this.anatomy.footR.end][14])/2];
   else if(anchor.body==='descent'){
    const limb:PoolFoot=left.plane<right.plane?'footL':'footR',goal=limb==='footL'?left:right;
    const rear=this.legBounds[limb][1][1]-this.neutral.rest[this.anatomy[limb].upper][13],y=goal.target[1]-rear,o=offset(limb),r=this.chord(limb,spec.legFlexionDegrees.low),dx=goal.target[0]-x-o[0],dy=goal.target[1]-y-o[1],vertical=r*r-dx*dx-dy*dy;if(vertical<=0)throw new Error('Pool descent source has no real planted height');hips=[x,y,goal.target[2]+Math.sqrt(vertical)-o[2]];
   }else {
    const lowLeft=left.plane<right.plane,highFlex=anchor.body==='crest-leading'?spec.legFlexionDegrees.crestLeading:spec.legFlexionDegrees.high;
    const circles=([['footL',left,lowLeft?spec.legFlexionDegrees.low:highFlex],['footR',right,lowLeft?highFlex:spec.legFlexionDegrees.low]] as const).map(([limb,goal,flex])=>{const o=offset(limb),r=this.chord(limb,flex),dx=goal.target[0]-x-o[0];if(r*r<=dx*dx)throw new Error('Pool authored leg chord has no sagittal radius');return {y:goal.target[1]-o[1],z:goal.target[2]-o[2],r:Math.sqrt(r*r-dx*dx)};});
    const [a,b]=circles,dy=b.y-a.y,dz=b.z-a.z,d=Math.hypot(dy,dz),along=(a.r*a.r-b.r*b.r+d*d)/(2*d),heightSquared=a.r*a.r-along*along;
    if(!Number.isFinite(along)||heightSquared<=0)throw new Error('Pool authored alternating stance has no real two-leg intersection');
    const h=Math.sqrt(heightSquared),solutions=[1,-1].map(sign=>[a.y+along*dy/d+sign*h*dz/d,a.z+along*dz/d-sign*h*dy/d]);solutions.sort((a,b)=>b[0]-a[0]);hips=[x,solutions[0][0],solutions[0][1]];
   }
  }
  const result={hips,hipPitch,trunkPitch:anchor.trunkPitchDegrees,headPitch},groundGrip=spec.groundGrip;
  if(groundGrip&&(anchor.unit===groundGrip.acquisitionUnit||anchor.unit===groundGrip.firstRungUnit)){
   const fit=this.fitGroundGrip(result,groundGrip.acquisitionUnit/spec.clockUnits);
   if(fit.hands){
    result.hips=add(result.hips,fit.offset);
    if(anchor.unit===groundGrip.firstRungUnit)result.hips=this.firstRungHips(result,groundGrip,fit.hands);
   }
  }
  if(this.crestTorso&&anchor.body==='crest-leading'){
   this.crestLeadingReference={...result};
   result.hips=this.crestLeadingHips(result);
  }
  if(spec.version===16&&anchor.unit===spec.crestRoute.rightStepUnits[1]){
   const pose=this.placeBody(result),phase=anchor.phase;
   const preferred=(['handL','handR'] as const).map(limb=>this.preferredGrip(limb,phase,pose)?.attached?.parameter);
   const parameters:[number,number]=[preferred[0]??spec.hand.insideBranch[0],preferred[1]??spec.hand.insideBranch[0]];
   this.routeLandingGrips=parameters;
   const targets={footL:this.foot('footL',anchor.feet[0]).target,footR:this.foot('footR',anchor.feet[1]).target,
    handL:this.crestGrip('handL',phase,pose,parameters[0]).target,handR:this.crestGrip('handR',phase,pose,parameters[1]).target};
   const constraints=(['handL','handR','footL','footR'] as const).map(limb=>({
    limb,center:sub(targets[limb],point(pose.world[this.anatomy[limb].upper])),reach:this.limbReach[limb],
   }));
   result.hips=add(result.hips,[0,poolCrestReachY(constraints,-Infinity,Infinity,0),0]);
  }
  this.bodies.set(anchor.unit,result);return result;
 }
 private placeBody(intent:BodyIntent){
  const author=canonicalPoolPreference(this.bundle,this.shape,this.top,'pool_enter',0,this.geometry);
  for(const [bone,degrees] of [[this.hip,intent.hipPitch],[this.spine,intent.trunkPitch],[this.head,intent.headPitch]]){
   const rotation=pitch(degrees),turned=intent.trunkYaw&&bone!==this.hip?multiply(yaw(intent.trunkYaw),rotation):rotation;
   setPoolWorldRotation(author,bone,multiply(turned,this.neutral.world[bone]));
  }
  translatePoolRoot(author,sub(intent.hips,point(author.world[this.hip])));return author;
 }
 private bodyPathKey(path:PlantedBodyPath){return [path.fromUnit,path.toUnit,path.limb,path.place].join(':');}
 private plantedPaths():readonly PlantedBodyPath[]{
  const grip=this.definition.groundGrip,paths=this.definition.plantedBodyPaths;
  if(!grip||!this.groundGripFit?.hands)return paths;
  return [{fromUnit:grip.firstRungUnit,toUnit:grip.secondRungUnit,limb:'footL',place:'outside1',boundaryUnits:[],sampleUnits:[]},...paths];
 }
 private plantedBodyIntent(path:PlantedBodyPath,phase:number,intent:BodyIntent,amount:number,reference?:readonly [BodyIntent,BodyIntent]):BodyIntent {
  const key=this.bodyPathKey(path)+(reference?':reference':''),a=this.anatomy[path.limb],goal=this.foot(path.limb,path.place),index=path.limb==='footL'?0:1,anchors=[path.fromUnit,path.toUnit].map(unit=>this.definition.anchors.find(a=>a.unit===unit));
  const firstRung=this.definition.groundGrip?.firstRungUnit===path.fromUnit&&path.limb==='footL'&&path.place==='outside1';
  if(anchors.some((anchor,i)=>!anchor||anchor.feet[index]!==path.place||
   anchor.body!=='outside-pair'&&anchor.body!=='crest-leading'&&!(this.definition.version===16&&anchor.body==='descent')&&!(firstRung&&i===0&&anchor.body==='ground')))
   throw new Error('Pool planted body path lost its unchanged supporting foot');
  let endpoints=this.plantedEndpoints.get(key);
  if(!endpoints){
   const frame=this.frame(path.limb,goal.support,goal.target.slice(0,2) as [number,number]);
   endpoints=Object.freeze(anchors.map((anchor,index)=>{
    const pose=this.placeBody(reference?.[index]??this.anchorIntent(anchor!)),plan=solvePoolOrientedFoot(pose,a.upper,a.lower,a.end,frame),check=observeConstructedPoolLeg(pose,frame,plan),rotation=[...pose.world[this.hip]];rotation.splice(12,3,0,0,0);
    if(!check.admitted)throw new Error('Pool planted body endpoint has no maintained anatomical construction');
    const ownedPoint=(bone:number)=>Object.freeze(point(pose.world[bone])) as unknown as Vec3;
    return Object.freeze({upper:Object.freeze([...pose.basis[a.upper]]),lower:Object.freeze([...pose.basis[a.lower]]),hipRotation:Object.freeze(rotation),branch:plan.branch,flexion:plan.flexion,hips:ownedPoint(this.hip),knee:ownedPoint(a.lower),ankle:ownedPoint(a.end)});
   })) as unknown as readonly [BodyPathEndpoint,BodyPathEndpoint];this.plantedEndpoints.set(key,endpoints);
  }
  const [start,end]=endpoints;if(!same(start.hipRotation,end.hipRotation)||start.branch!==end.branch)throw new Error('Pool planted body endpoints changed their hips frame or maintained branch');
  const upper=rotationMix(start.upper,end.upper,amount),lower=rotationMix(start.lower,end.lower,amount),hu=multiply(this.neutral.inverse[this.hip],this.neutral.rest[a.upper]),ul=multiply(this.neutral.inverse[a.upper],this.neutral.rest[a.lower]),le=multiply(this.neutral.inverse[a.lower],this.neutral.rest[a.end]);
  const kneeChain=multiply(multiply(hu,upper),ul),ankleChain=multiply(multiply(kneeChain,lower),le),hips=amount===0||amount===1?intent.hips:sub(goal.target,transform(start.hipRotation,point(ankleChain)));
  if(!reference)this.plantedWitnesses.set(key+':'+phase,{hips,knee:add(hips,transform(start.hipRotation,point(kneeChain))),ankle:add(hips,transform(start.hipRotation,point(ankleChain))),amount,endpointExact:amount===0||amount===1});
  return {...intent,hips};
 }
 bodyPathDiagnostic(phase:number,world:readonly number[][]){
  const paths=this.plantedPaths().flatMap(path=>{
   const key=this.bodyPathKey(path),witness=this.plantedWitnesses.get(key+':'+phase),endpoints=this.plantedEndpoints.get(key);if(!witness||!endpoints)return [];const a=this.anatomy[path.limb];
   return [{segment:path,endpoints,...witness,actualHips:point(world[this.hip]),actualKnee:point(world[a.lower]),actualAnkle:point(world[a.end]),
    residual:{hips:length(sub(witness.hips,point(world[this.hip]))),knee:length(sub(witness.knee,point(world[a.lower]))),ankle:length(sub(witness.ankle,point(world[a.end])))}}];
  });return paths.length?{paths}:undefined;
 }
 body(phase:number){
  const anchors=this.definition.anchors;let intent=this.anchorIntent(anchors[0]);
  if(phase!==0)for(let i=1;i<anchors.length;i++)if(phase<=anchors[i].phase){const a=anchors[i-1],b=anchors[i],u=phase===b.phase?1:(phase-a.phase)/(b.phase-a.phase),movingFeet=a.feet.some((place,index)=>place!==b.feet[index]),t=smooth(clamp(u/(movingFeet?this.definition.bodyProgressFraction:1),0,1)),left=this.anchorIntent(a),right=this.anchorIntent(b);intent={hips:lerp(left.hips,right.hips,t),hipPitch:mix(left.hipPitch,right.hipPitch,t),trunkPitch:mix(left.trunkPitch,right.trunkPitch,t),headPitch:mix(left.headPitch,right.headPitch,t)};break;}
  for(const path of this.plantedPaths()){const from=path.fromUnit/this.definition.clockUnits,to=path.toUnit/this.definition.clockUnits;
   if(phase>=from&&phase<=to)intent=this.plantedBodyIntent(path,phase,intent,smooth(clamp((phase-from)/(to-from)/this.definition.bodyProgressFraction,0,1)));
  }
  if(this.definition.version===16&&phase>.42&&phase<=.656)intent=this.transferBody(phase);
  else if(this.definition.version===15&&this.crestTorso&&phase>.42&&phase<.56)intent=this.crestNodeAt(phase).body;
  const author=this.placeBody(intent);
  return {intent,basis:author.basis,pose:poolIntervalPreference(this.bundle,author.rest,author.inverse,author.basis,author.basis,0,true)};
 }
 private transferBody(phase:number):BodyIntent {
  const spec=this.definition;
  if(spec.version!==16)throw new Error('Pool crest transfer needs the staged support clock.');
  const [release,,,replant]=spec.crestRoute.handTransferUnits.map(unit=>unit/spec.clockUnits);
  const [plant,landing]=spec.crestRoute.rightStepUnits.map(unit=>unit/spec.clockUnits);
  const from=phase<=plant?.42:plant,to=phase<=plant?plant:landing;
  const anchor=(p:number)=>this.anchorIntent(spec.anchors.find(row=>row.phase===p)!);
  const start=anchor(from),end=anchor(to);
  if(phase>=landing)return end;
  const amount=smooth(clamp((phase-(phase<=plant?replant:from))/(to-(phase<=plant?replant:from)),0,1));
  const limb=phase<=plant?'footR':'footL',place=phase<=plant?'crest':'inside3';
  const path:PlantedBodyPath={fromUnit:Math.round(from*spec.clockUnits),toUnit:Math.round(to*spec.clockUnits),limb,place,boundaryUnits:[],sampleUnits:[]};
  const turn=this.crestTorso?poolCrestYaw(this.crestTorso,this.crestRails(),start.hips[0],this.fixture.rails[0].radius/16):0;
  const yawAmount=phase<=replant?smooth(clamp((phase-release)/(replant-release),0,1)):1-amount;
  const intent:BodyIntent={hips:lerp(start.hips,end.hips,amount),hipPitch:mix(start.hipPitch,end.hipPitch,amount),
   trunkPitch:mix(start.trunkPitch,end.trunkPitch,amount),headPitch:mix(start.headPitch,end.headPitch,amount),
   trunkYaw:phase<plant?turn*yawAmount:0};
  return this.plantedBodyIntent(path,phase,intent,amount);
 }
 private waterFoot(limb:PoolFoot,centre:Vec3,wave:number,corridor:boolean):Vec3 {
  const a=this.anatomy[limb],ground=this.foot(limb,'ground'),normalHip=point(this.neutral.world[this.hip]),x=centre[0]+this.neutral.world[a.end][12]-normalHip[0];
  if(!corridor)return [x,this.definition.paddle.footY+this.definition.paddle.kickAmplitude*Math.sin(wave),ground.target[2]+this.definition.paddle.footSoleZ+this.definition.paddle.kickAmplitude*Math.cos(wave)];
  const low=this.fixture.solids.find(s=>s.id===this.definition.places.inside1.surface)!,rows=a.surfaceCoefficients.map(c=>({p:poolSurfacePoint(this.flatFeet[limb],c),w:c[3]})),p=a.patch.vertices.map(v=>poolSurfacePoint(this.flatFeet[limb],v.coefficient)),depth=Math.max(...p.map(v=>v[1]))-Math.min(...p.map(v=>v[1]));
  return [x,Math.min(...rows.map(r=>(low.bounds[0][1]-depth/2-r.p[1])/r.w)),ground.target[2]+this.definition.paddle.footSoleZ];
 }
 private freeFootGoal(limb:PoolFoot,phase:number,placed?:BodyIntent):Vec3 {
  const spec=this.definition,body=placed??this.body(phase).intent,wave=limb==='footL'?0:Math.PI;
  if(phase>=.88){const corridor=this.waterFoot(limb,body.hips,wave,true);if(phase<=.94)return corridor;return lerp(corridor,this.waterFoot(limb,body.hips,wave,false),clamp((phase-.94)/.06,0,1));}
  let place='ground';
  for(const row of spec.footTransitions.filter(r=>r.limb===limb)){
   if(phase<row.start)break;if(phase>=row.end){place=row.to;continue;}
   const from=this.foot(limb,row.from),to=row.to==='free'?null:this.foot(limb,row.to),u=(phase-row.start)/(row.end-row.start),target=to?.target??this.waterFoot(limb,spec.waterCorridor.initialCentre,wave,true),arrivalLift=to?.lift??.025;
   if(u===0)return from.target;if(u===1)return target;
   const a=this.anatomy[limb],rows=a.surfaceCoefficients.map(c=>({p:poolSurfacePoint(this.flatFeet[limb],c),w:c[3]})),outside=row.from==='ground'||row.from.startsWith('outside')||row.to.startsWith('outside'),gap=2*this.fixture.rails[0].radius;
   if(spec.version===16&&row.from==='outside3'&&row.to==='inside3'){
    const landing=this.fixture.solids.find(s=>s.id===spec.places.crest.surface)!;
    const outer=Math.max(...rows.map(r=>(landing.bounds[1][1]+gap-r.p[1])/r.w));
    const inner=Math.min(...rows.map(r=>(landing.bounds[0][1]-gap-r.p[1])/r.w));
    const raised=Math.max(...rows.map(r=>(landing.bounds[1][2]+gap-r.p[2])/r.w));
    const knots:[number,Vec3][]=[[0,from.target],[.2,[from.target[0],outer,from.target[2]+from.lift]],
     [.375,[from.target[0],outer,raised]],[.625,[target[0],inner,raised]],[.85,[target[0],inner,target[2]+arrivalLift]],[1,target]];
    for(let i=1;i<knots.length;i++)if(u<=knots[i][0])return lerp(knots[i-1][1],knots[i][1],(u-knots[i-1][0])/(knots[i][0]-knots[i-1][0]));
   }
   let corridor:number;
   if(outside){const edge=Math.max(...this.fixture.solids.map(s=>s.bounds[1][1]));corridor=Math.max(...rows.map(r=>(edge+gap-r.p[1])/r.w));}
   else {const minimum=to?.plane??0,obstacles=Object.entries(spec.places).filter(([name])=>name==='crest'||name.startsWith('inside')).map(([,p])=>this.fixture.solids.find(s=>s.id===p.surface)!).filter(s=>s.id!==to?.support.surface&&s.bounds[1][2]>minimum&&s.bounds[1][2]<=from.plane);if(!obstacles.length)throw new Error('Pool descent has no authored outgoing edge');const edge=Math.min(...obstacles.map(s=>s.bounds[0][1]));corridor=Math.min(...rows.map(r=>(edge-gap-r.p[1])/r.w));}
   const retractY=row.from==='ground'?from.target[1]:corridor,above:Vec3=[target[0],corridor,target[2]+arrivalLift];
   const knots:[number,Vec3][]=[[0,from.target],[.2,[from.target[0],retractY,from.target[2]+from.lift]],[.65,above],[.85,lerp(above,target,(.85-.65)/(1-.65))],[1,target]];
   for(let i=1;i<knots.length;i++)if(u<=knots[i][0]){
    const point=lerp(knots[i-1][1],knots[i][1],(u-knots[i-1][0])/(knots[i][0]-knots[i-1][0]));
    if(spec.version===15&&this.crestTorso&&limb==='footL'&&phase>.48&&phase<.548){
     const inset=this.crestRails()[0].bounds[1][0]+(this.neutral.rest[this.anatomy.footL.upper][12]-this.legBounds.footL[0][0]);
     const blend=phase<=.496?smooth((phase-.48)/.016):1-smooth((phase-.496)/.052);
     return [mix(point[0],Math.min(body.hips[0],Math.max(point[0],inset)),blend),point[1],point[2]];
    }
    return point;
   }
  }
  if(place==='free')return this.waterFoot(limb,body.hips,wave,true);
  return this.foot(limb,place).target;
 }
 private elbow(limb:PoolHand,pose:ReturnType<PoolCycleSource['body']>['pose']):Vec3 {
  const a=this.anatomy[limb],shoulder=point(pose.world[a.upper]),hips=point(pose.world[this.hip]),distance=this.limbReach[limb].lengths[0];return [shoulder[0]+Math.sign(hips[0]-shoulder[0])*distance,shoulder[1],shoulder[2]-distance];
 }
 private gripRail(limb:PoolHand,phase:number){
  const a=this.anatomy[limb],support=poolSourceRecord(this.fixture,{action:'pool_enter',phase}).limbs[limb],geometryKey=limb+':'+canonicalPoolValue(support);let physical=this.railInputs.get(geometryKey);
  if(!physical){physical=preparePoolRailGeometry(this.fixture,support,this.geometry[0],this.cages[0],this.neutral.inverse[a.end],a.patch);this.railInputs.set(geometryKey,physical);}
  const inverse=[...this.neutral.inverse[a.end]];inverse.splice(12,3,0,0,0);const localNormal=transform(inverse,[0,1,0]),thumb=a.thumb!,thumbDirection=sub(vector(thumb.slice(0,3)),scale(vector(a.anchor.slice(0,3)),thumb[3]/a.anchor[3])),reference=identity();reference.splice(0,3,...thumbDirection);const local=inverseAffine(boneFrame([0,0,0],localNormal,reference));
  return {physical,geometryKey,local,location:{action:'pool_enter',phase,limb}};
 }
 private gripRailReference(rail:ReturnType<PoolCycleSource['gripRail']>,entry:PoolPreparedRailGeometry['edges'][number],shoulder:Vec3){
  const {physical,geometryKey,local,location}=rail;
  const normal:Vec3=[physical.side,0,0],tangent=sub(entry.to,entry.from);let transverse=cross(normal,tangent);
  if(transverse[2]<0||transverse[2]===0&&transverse[1]*(shoulder[1]-entry.from[1])<0)transverse=scale(transverse,-1);
  const world=identity();world.splice(0,3,...transverse);
  const raw=properPoolRotation(multiply(boneFrame([0,0,0],normal,world),local)),referenceKey=geometryKey+':'+canonicalPoolValue(raw);
  let frame=this.railReferences.get(referenceKey);
  if(!frame){frame=resolvePoolRailContactFrame(physical,raw,entry.edge.fromParameter,undefined,location);this.railReferences.set(referenceKey,frame);}
  return {raw,frame};
 }
 private exactGrip(rail:ReturnType<PoolCycleSource['gripRail']>,pose:ReturnType<PoolCycleSource['body']>['pose'],parameter:number,raw:readonly number[],active:number):PoolLimbState {
  const {location,physical}=rail,frame=resolvePoolRailContactFrame(physical,raw,parameter,active,location);
  return {target:frame.translation,orientation:frame.orientation,pole:this.elbow(location.limb,pose),
   attached:{source:location,geometry:physical,parameter,rawOrientation:raw,activeVertex:frame.activeVertex}};
 }
 private crestRails(){
  return this.fixture.rails.map(rail=>{
   const solid=this.fixture.solids.find(s=>s.id===rail.id);
   if(!solid)throw new Error('Pool crest fit needs its actual rail solid.');
   return solid;
  });
 }
 private crestGrip(limb:PoolHand,phase:number,pose:ReturnType<PoolCycleSource['body']>['pose'],parameter:number,exterior?:ReturnType<PoolCycleSource['body']>['pose']):PoolLimbState {
  const rail=this.gripRail(limb,phase),edge=rail.physical.edges.find(({edge})=>parameter>=edge.fromParameter&&parameter<=edge.toParameter);
  if(!edge)throw new Error('Pool crest grip is outside its actual rail.');
  const {raw,frame}=this.gripRailReference(rail,edge,point((exterior??pose).world[this.anatomy[limb].upper]));
  return this.exactGrip(rail,pose,parameter,raw,frame.activeVertex);
 }
 private crestGripParameters(phase:number,intent:BodyIntent):readonly [number,number] {
  const pose=this.placeBody(intent);
  const parameter=(limb:PoolHand)=>{
   const grip=this.preferredGrip(limb,phase,pose)?.attached;
   if(!grip)throw new Error('Pool crest is missing its reachable reference grip: '+limb+' '+phase);
   return grip.parameter;
  };
  return [parameter('handL'),parameter('handR')];
 }
 private crestLeadingHips(intent:BodyIntent):Vec3 {
  const authored=this.definition.crestFit!,phase=authored.shinReferenceUnit/this.definition.clockUnits;
  const path=this.definition.plantedBodyPaths.find(p=>p.limb==='footL'&&p.place==='outside3');
  const start=this.definition.anchors.find(a=>a.unit===path?.fromUnit);
  if(!path||!start)throw new Error('Pool crest fit needs its configured planted reference path.');
  const first=this.anchorIntent(start),amount=smooth((phase-start.phase)/(.42-start.phase)/this.definition.bodyProgressFraction);
  const clear=this.placeBody(this.plantedBodyIntent(path,phase,intent,amount,[first,intent]));
  const placed=this.placeBody(intent),a=this.anatomy.footL,goal=this.foot('footL','outside3');
  const frame=this.frame('footL',goal.support,goal.target.slice(0,2) as [number,number]);
  solvePoolOrientedFoot(clear,a.upper,a.lower,a.end,frame);
  const relative=(limb:PoolLimb)=>sub(point(placed.world[this.anatomy[limb].upper]),intent.hips);
  const reference=this.crestGripParameters(.42,intent);
  const targets={footR:this.foot('footR','crest').target,handL:this.crestGrip('handL',.42,placed,reference[0]).target,
   handR:this.crestGrip('handR',.42,placed,reference[1]).target};
  const constraints=(['footR','handL','handR'] as const).map(limb=>({limb,center:sub(targets[limb],relative(limb)),reach:this.limbReach[limb]}));
  return fitPoolFirstRungHips(intent.hips,sub(point(clear.world[a.lower]),relative('footL')),this.limbReach.footL.lengths[0],constraints);
 }
 private buildCrestNodes(until:number,tail:boolean):readonly CrestNode[] {
  const spec=this.definition.crestFit!,torso=this.crestTorso!,rails=this.crestRails(),radius=this.fixture.rails[0].radius;
  const anchor=(phase:number)=>this.anchorIntent(this.definition.anchors.find(a=>a.phase===phase)!);
  const start=anchor(.42),crest=anchor(.48),end=anchor(.56);
  const reference=this.crestGripParameters(.42,this.crestLeadingReference!),crestGrips=this.crestGripParameters(.48,crest),endGrips=this.crestGripParameters(.56,end);
  const nodes:CrestNode[]=tail?[]:[{phase:.42,body:start,grips:reference}];
  if(until<=.42)return nodes;
  const heldExterior=this.placeBody(this.crestLeadingReference!);
  const x=crest.hips[0],outsideX=x+spec.outerShift,insideX=x+spec.innerShift;
  const exteriorYaw=poolCrestYaw(torso,rails,outsideX,radius/16),interiorYaw=poolCrestYaw(torso,rails,insideX,radius/16);
  const zero=this.placeBody(crest),shoulderHeight=zero.world[this.anatomy.handR.upper][14]-crest.hips[2];
  const rise=(phase:number,parameter:number,pose=zero)=>this.crestGrip('handR',phase,pose,parameter).target[2]-shoulderHeight;
  const placed=(x:number,y:number,z:number,turn:number):BodyIntent=>({...crest,hips:[x,y,z],trunkYaw:turn});
  const crestAnkle=this.foot('footR','crest');
  const targets=(phase:number,body:BodyIntent,pose:typeof zero,grips:readonly [number,number],exterior?:typeof zero)=>({
   handL:this.crestGrip('handL',phase,pose,grips[0],exterior).target,handR:this.crestGrip('handR',phase,pose,grips[1],exterior).target,
   footL:this.freeFootGoal('footL',phase,body),footR:crestAnkle.target,
  });
  const fit=(phase:number,body:BodyIntent,grips:readonly [number,number],minimum:number,preferred:number,exterior?:typeof zero):BodyIntent=>{
   const pose=this.placeBody(body),goals=targets(phase,body,pose,grips,exterior);
   const constraints=(['handL','handR','footL','footR'] as const).map(limb=>({
    limb,center:add(sub(goals[limb],point(pose.world[this.anatomy[limb].upper])),[0,body.hips[1],0]),reach:this.limbReach[limb],
   }));
   try{return {...body,hips:[body.hips[0],poolCrestReachY(constraints,minimum,Infinity,preferred),body.hips[2]]};}
   catch(error){throw new Error('Pool crest fit refused its stage at '+phase,{cause:error instanceof Error?error.cause:error});}
  };
  if(!tail){
   const priorTurn=exteriorYaw*3/4,turnHeight=rise(.432,reference[1],heldExterior);
   const unturned=this.placeBody(placed(outsideX,0,turnHeight,0));
   const leftShoulder=point(unturned.world[this.anatomy.handL.upper]),rightShoulder=point(unturned.world[this.anatomy.handR.upper]);
   const rightGrip=this.crestGrip('handR',.432,unturned,reference[1],heldExterior).target;
   const rightReach=this.limbReach.handR.maximum,dx=rightGrip[0]-rightShoulder[0],dz=rightGrip[2]-rightShoulder[2];
   const forwardSquared=rightReach*rightReach-dx*dx-dz*dz;
   const leftExterior=rails[0].bounds[1][1]+this.crestArmCap!+radius/16;
   if(forwardSquared<=0)throw new Error('Pool crest opening has no exterior right grip depth.');
   const available=rightGrip[1]+Math.sqrt(forwardSquared)-leftExterior;
   const turnStart=Math.min(priorTurn,Math.asin(clamp(available/(rightShoulder[0]-leftShoulder[0]),0,1)));
   const origin=this.placeBody(placed(outsideX,0,turnHeight,turnStart));
   const shoulderDepth=leftExterior-origin.world[this.anatomy.handL.upper][13];
   const startDepth=Math.max(shoulderDepth,poolCrestExteriorY(torso,rails,outsideX,turnStart));
   const turnBody=fit(.432,placed(outsideX,start.hips[1],turnHeight,turnStart),reference,startDepth,start.hips[1],heldExterior);
   nodes.push({phase:.432,body:turnBody,grips:reference});
   if(until<=.432)return nodes;
   const outer:readonly [number,number]=[spec.outerParameter,spec.outerParameter];
   const exteriorDepth=poolCrestExteriorY(torso,rails,outsideX,poolCrestYaw(torso,rails,outsideX,-radius/4));
   const oldOutside=fit(.459,placed(outsideX,crest.hips[1],rise(.459,spec.outerParameter),exteriorYaw),outer,exteriorDepth,start.hips[1]);
   const priorBody=fit(.432,placed(outsideX,start.hips[1],turnHeight,priorTurn),reference,
    poolCrestExteriorY(torso,rails,outsideX,priorTurn),start.hips[1],heldExterior);
   const clear=this.placeBody(priorBody),leg=this.anatomy.footR;
   const frame=this.frame('footR',crestAnkle.support,crestAnkle.target.slice(0,2) as [number,number]);
   solvePoolOrientedFoot(clear,leg.upper,leg.lower,leg.end,frame);
   const medialX=outsideX+rails[1].bounds[0][0]-spec.earlyClearance.rightShinX-radius/16;
   const measured=placed(medialX,oldOutside.hips[1],oldOutside.hips[2],exteriorYaw),measuredPose=this.placeBody(measured);
   const goals=targets(.459,measured,measuredPose,outer);
   const relative=(limb:PoolLimb)=>sub(point(measuredPose.world[this.anatomy[limb].upper]),measured.hips);
   const constraints=(['handL','handR','footL'] as const).map(limb=>({limb,center:sub(goals[limb],relative(limb)),reach:this.limbReach[limb]}));
   const outside={...measured,hips:fitPoolFirstRungHips(measured.hips,sub(point(clear.world[leg.lower]),relative('footR')),
    this.limbReach.footR.lengths[0],constraints)};
   nodes.push({phase:.459,body:outside,grips:outer});
   if(until<=.459)return nodes;
   const topX=outsideX+rails[0].bounds[1][0]-spec.earlyClearance.leftUpperArmX+radius/16;
   const topYaw=poolCrestYaw(torso,rails,topX,radius/16);
   const crestBody=fit(.48,placed(topX,crest.hips[1],crest.hips[2],topYaw),crestGrips,0,crest.hips[1]);
   const middle:BodyIntent={...crestBody,hips:lerp(outside.hips,crestBody.hips,4/7),trunkYaw:mix(exteriorYaw,topYaw,4/7)};
   nodes.push({phase:.471,body:middle,grips:crestGrips},{phase:.48,body:crestBody,grips:crestGrips});
  }
  const progress=smooth((.496-.48)/(.56-.48)/this.definition.bodyProgressFraction);
  const nominal:BodyIntent={hips:lerp(crest.hips,end.hips,progress),hipPitch:mix(crest.hipPitch,end.hipPitch,progress),
   trunkPitch:mix(crest.trunkPitch,end.trunkPitch,progress),headPitch:mix(crest.headPitch,end.headPitch,progress)};
  const innerLeft=this.crestGripParameters(.496,nominal)[0],split:readonly [number,number]=[innerLeft,crestGrips[1]];
  nodes.push({phase:.496,body:placed(outsideX,nominal.hips[1],nominal.hips[2],exteriorYaw),grips:split});
  if(until<=.496)return nodes;
  const inner:readonly [number,number]=[spec.innerParameter,spec.innerParameter];
  const innerHeight=rise(.532,spec.innerParameter)+3*radius;
  const innerDepth=Math.min(...rails.map(rail=>rail.bounds[0][1]))-this.limbReach.handL.lengths[1]/2;
  const basin=fit(.532,placed(insideX,innerDepth,innerHeight,interiorYaw),inner,0,innerDepth);
  nodes.push({phase:.532,body:basin,grips:inner},{phase:.548,body:placed(insideX,end.hips[1],innerHeight,0),grips:inner},
   {phase:.56,body:end,grips:endGrips});
  return nodes;
 }
 private crestNodeAt(phase:number):CrestNode {
  const tail=phase>=.496,cached=tail?this.crestTailNodes:this.crestNodes;
  const nodes=cached&&cached.at(-1)!.phase>=phase?cached:this.buildCrestNodes(phase,tail);
  if(tail)this.crestTailNodes=nodes;else this.crestNodes=nodes;
  const index=nodes.findIndex(node=>phase<=node.phase),right=nodes[index];
  if(!right)throw new Error('Pool crest source is outside its authored keys.');
  if(right.phase===phase||index===0)return right;
  const left=nodes[index-1],amount=(phase-left.phase)/(right.phase-left.phase);
  return {phase,body:{hips:lerp(left.body.hips,right.body.hips,amount),hipPitch:mix(left.body.hipPitch,right.body.hipPitch,amount),
   trunkPitch:mix(left.body.trunkPitch,right.body.trunkPitch,amount),headPitch:mix(left.body.headPitch,right.body.headPitch,amount),
   trunkYaw:mix(left.body.trunkYaw??0,right.body.trunkYaw??0,amount)},
   grips:[mix(left.grips[0],right.grips[0],amount),mix(left.grips[1],right.grips[1],amount)]};
 }
 private preferredGrip(limb:PoolHand,phase:number,pose:ReturnType<PoolCycleSource['body']>['pose'],inside=false):PoolLimbState|undefined {
  const rail=this.gripRail(limb,phase),{physical}=rail;
  const shoulder=point(pose.world[this.anatomy[limb].upper]),upper=this.limbReach[limb].lengths[0];
  const outside=!inside&&phase<=.42,crest=!inside&&phase>.42&&phase<=.48,branch=outside?this.definition.hand.outsideBranch:crest?this.definition.hand.crestBranch:this.definition.hand.insideBranch;
  const desired:Vec3=[shoulder[0],crest?Math.max(shoulder[1],this.fixture.rails[0].points[3].point[1]):shoulder[1]-upper,shoulder[2]+(outside?upper/2:crest?-upper:-upper)];
  const choices:{parameter:number;raw:number[];active:number;distance:number}[]=[];
  for(const entry of physical.edges){if(entry.edge.toParameter<=branch[0]||entry.edge.fromParameter>=branch[1])continue;
   const {raw,frame}=this.gripRailReference(rail,entry,shoulder);
   const coefficient=physical.coefficients[physical.vertices.indexOf(frame.activeVertex)][3],w=Number(coefficient.numerator)*2**coefficient.exponent;
   const from=vector(entry.from.map((v,i)=>frame.translation[i]+(v-frame.targetPoint[i])/w)),direction=scale(sub(entry.to,entry.from),1/w),wanted=dot(sub(desired,from),direction)/dot(direction,direction);
   for(const interval of poolRootRayIntervals(direction,[{limb,center:sub(shoulder,from),reach:this.limbReach[limb]}])){
    let low=Math.max(0,interval.minimum,(branch[0]-entry.edge.fromParameter)/(entry.edge.toParameter-entry.edge.fromParameter)),high=Math.min(1,interval.maximum,(branch[1]-entry.edge.fromParameter)/(entry.edge.toParameter-entry.edge.fromParameter));
    if(outside)for(const [axis,sign] of [[1,-1],[2,1]] as const){const slope=direction[axis]*sign,offset=(from[axis]-shoulder[axis])*sign;if(slope===0){if(offset<=0)high=low;}else if(slope>0)low=Math.max(low,-offset/slope);else high=Math.min(high,-offset/slope);}
    if(!(low<high))continue;const amount=clamp(wanted,low+(high-low)/4,high-(high-low)/4),target=add(from,scale(direction,amount));choices.push({parameter:entry.edge.fromParameter+(entry.edge.toParameter-entry.edge.fromParameter)*amount,raw,active:frame.activeVertex,distance:length(sub(target,desired))});
   }
  }
  choices.sort((a,b)=>a.distance-b.distance||a.parameter-b.parameter);
  const chosen=choices[0];return chosen&&this.exactGrip(rail,pose,chosen.parameter,chosen.raw,chosen.active);
 }
 private fitGroundGrip(intent:BodyIntent,phase:number):NonNullable<PoolCycleSource['groundGripFit']>{
  if(this.groundGripFit)return this.groundGripFit;
  const pose=this.placeBody(intent);
  if((['handL','handR'] as const).every(limb=>this.preferredGrip(limb,phase,pose)))
   return this.groundGripFit={offset:[0,0,0]};
  const parameter=this.definition.hand.outsideBranch[1];
  const start=(limb:PoolLimb)=>point(pose.world[this.anatomy[limb].upper]);
  const hand=(limb:PoolHand)=>{
   const rail=this.gripRail(limb,phase),edge=rail.physical.edges.find(e=>e.edge.fromParameter<parameter&&e.edge.toParameter===parameter);
   if(!edge)throw new Error('Pool acquisition has no actual low exterior rail edge.');
   const {raw,frame}=this.gripRailReference(rail,edge,start(limb));
   return this.exactGrip(rail,pose,parameter,raw,frame.activeVertex);
  };
  const hands={handL:hand('handL'),handR:hand('handR')},feet={footL:this.foot('footL','ground').target,footR:this.foot('footR','ground').target};
  const targets={handL:hands.handL.target,handR:hands.handR.target,...feet};
  const constraints=(['handL','handR','footL','footR'] as const).map(limb=>({limb,center:sub(targets[limb],start(limb)),reach:this.limbReach[limb]}));
  const offset=fitPoolGroundGrip(constraints,intent.hips[2]-Math.max(feet.footL[2],feet.footR[2]));
  return this.groundGripFit={offset,hands};
 }
 private firstRungHips(intent:BodyIntent,grip:PoolGroundGripDefinition,hands:Record<PoolHand,PoolLimbState>):Vec3 {
  const phase=grip.firstRungUnit/this.definition.clockUnits,policy=poolSourcePolicy(this.fixture,'pool_enter',phase);
  const left=this.foot('footL','outside1'),right=this.foot('footR','ground');
  if(!policy.footL.required||policy.footL.surface!==left.support.surface||!policy.footR.required||policy.footR.surface!==right.support.surface)
   throw new Error('Pool first rung fit lost its actual two required supports.');
  const endpoint=this.definition.anchors.find(anchor=>anchor.unit===grip.secondRungUnit);
  if(!endpoint)throw new Error('Pool first rung fit needs the actual second rung body.');
  const clear=this.placeBody(this.anchorIntent(endpoint)),a=this.anatomy.footL;
  const frame=this.frame('footL',left.support,left.target.slice(0,2) as [number,number]);
  solvePoolOrientedFoot(clear,a.upper,a.lower,a.end,frame);
  const placed=this.placeBody(intent);
  const relative=(limb:PoolLimb)=>sub(point(placed.world[this.anatomy[limb].upper]),intent.hips);
  const knee=point(clear.world[a.lower]),circle=sub(knee,relative('footL'));
  const goals={footR:right.target,handL:hands.handL.target,handR:hands.handR.target};
  const constraints=(['footR','handL','handR'] as const).map(limb=>({limb,center:sub(goals[limb],relative(limb)),reach:this.limbReach[limb]}));
  return fitPoolFirstRungHips(intent.hips,circle,this.limbReach.footL.lengths[0],constraints);
 }
 private exteriorCrestNormal():Vec3 {
  if(this.crestOutward)return this.crestOutward;
  const landing=this.fixture.solids.find(solid=>solid.id===this.definition.places.crest.surface);
  if(!landing)throw new Error('Pool opening has no actual crest landing.');
  for(const triangle of landing.triangles){
   const [a,b,c]=triangle.map(vertex=>landing.vertices[vertex]);
   if([a,b,c].some(vertex=>vertex[1]!==landing.bounds[1][1]))continue;
   const normal=cross(sub(b,a),sub(c,a));
   if(normal[0]===0&&normal[1]>0&&normal[2]===0)return this.crestOutward=unit(normal);
  }
  throw new Error('Pool opening has no outward crest face.');
 }
 private openingGrip(limb:PoolHand,phase:number,pose:ReturnType<PoolCycleSource['body']>['pose']):PoolLimbState|undefined {
  const authored=this.definition.groundGrip,initial=this.groundGripFit?.hands?.[limb].attached;
  if(!authored||!initial)return;
  const first=authored.firstRungUnit/this.definition.clockUnits,second=authored.secondRungUnit/this.definition.clockUnits;
  if(phase>second)return;
  let progress=0,parameter=initial.parameter;
  if(phase>first){
   const destination=this.preferredGrip(limb,second,this.body(second).pose)?.attached;
   if(!destination||destination.activeVertex!==initial.activeVertex||!same(destination.rawOrientation,initial.rawOrientation))
    throw new Error('Pool acquisition cannot continue its actual attachment to the second rung: '+limb);
   progress=smooth(clamp((phase-first)/(second-first)/this.definition.bodyProgressFraction,0,1));
   parameter=mix(initial.parameter,destination.parameter,progress);
  }
  const state=this.exactGrip(this.gripRail(limb,phase),pose,parameter,initial.rawOrientation,initial.activeVertex);
  if(progress===1)return state;
  const shoulder=point(pose.world[this.anatomy[limb].upper]);
  const outward=add(shoulder,scale(this.exteriorCrestNormal(),this.limbReach[limb].lengths[0]));
  return {...state,pole:lerp(outward,state.pole,progress)};
 }
 private grip(limb:PoolHand,phase:number):PoolLimbState {
  const key=limb+':'+phase,old=this.grips.get(key);if(old)return old;
  const {pose}=this.body(phase);
  const state=this.definition.version===16&&phase>=.42&&phase<=.648?this.transferGrip(limb,phase,pose)
   :this.definition.version===15&&this.crestTorso&&phase>=.42&&phase<.56
   ?this.crestGrip(limb,phase,pose,this.crestNodeAt(phase).grips[limb==='handL'?0:1],
    phase<=.432?this.placeBody(this.crestLeadingReference!):undefined)
   :this.openingGrip(limb,phase,pose)??this.preferredGrip(limb,phase,pose);
  if(!state)throw new Error('Pool source has no forward/reachable actual grip: '+limb+' '+phase);
  this.grips.set(key,state);return state;
 }
 private transferGrip(limb:PoolHand,phase:number,pose:ReturnType<PoolCycleSource['body']>['pose']):PoolLimbState {
  const spec=this.definition;
  if(spec.version!==16)throw new Error('Pool regrip needs the staged support clock.');
  const replant=spec.crestRoute.handTransferUnits[3]/spec.clockUnits;
  const [plant,landing]=spec.crestRoute.rightStepUnits.map(unit=>unit/spec.clockUnits);
  const slot=limb==='handL'?0:1;
  const beginning=this.body(.42);
  const reference=this.crestLeadingReference??beginning.intent;
  const outside=this.crestGripParameters(.42,reference)[slot];
  if(phase<replant||phase===replant&&limb==='handR')return this.crestGrip(limb,phase,pose,outside,this.placeBody(reference));
  const atPlant=this.body(plant),interior=this.crestGripParameters(plant,atPlant.intent)[slot];
  if(phase>=plant){
   if(phase===plant)return this.crestGrip(limb,phase,pose,interior);
   this.anchorIntent(spec.anchors.find(row=>row.phase===landing)!);
   const parameter=mix(interior,this.routeLandingGrips![slot],smooth(clamp((phase-plant)/(landing-plant),0,1)));
   return this.crestGrip(limb,phase,pose,parameter);
  }
  if(limb==='handL'&&this.replantParameter===undefined){
   const selected=this.preferredGrip(limb,replant,this.body(replant).pose,true);
   if(!selected?.attached)throw new Error('Pool left hand cannot reach the inner branch from both planted soles.');
   this.replantParameter=selected.attached.parameter;
  }
  const parameter=mix(limb==='handL'?this.replantParameter!:outside,interior,smooth((phase-replant)/(plant-replant)));
  return this.crestGrip(limb,phase,pose,parameter);
 }
 private neutralHand(limb:PoolHand,body:ReturnType<PoolCycleSource['body']>):PoolLimbState {
  const source=this.sourceHands[limb],spine=body.pose.world[this.spine];return {target:transform(spine,source.wrist),pole:transform(spine,source.elbow),orientation:properPoolRotation(multiply(spine,source.rotation))};
 }
 private paddleHand(limb:PoolHand,body:ReturnType<PoolCycleSource['body']>,phase:number):PoolLimbState {
  const a=this.anatomy[limb],spec=this.definition.paddle,side=limb==='handL'?-1:1,wave=phase*2*Math.PI+(side===-1?0:Math.PI),hips=body.intent.hips;
  const palm:Vec3=[hips[0]+side*(spec.palmHalfWidth+spec.palmWaveX*Math.sin(wave)),hips[1]+spec.palmY-spec.centre[1]-spec.palmWaveY*Math.sin(wave),hips[2]+spec.palmZ-spec.centre[2]+spec.palmWaveZ*Math.cos(wave)];
  const orientation=properPoolRotation(multiply(pitch(spec.handPitchDegrees),this.neutral.rest[a.end])),offset=poolSurfacePoint(orientation,a.anchor);return {target:scale(sub(palm,offset),1/a.anchor[3]),orientation,pole:this.elbow(limb,body.pose)};
 }
 private fittedStroke(stroke:PoolWaterStrokeDefinition,phase:number,action:'pool_enter'|'pool_paddle'):PoolPoseProgram {
  if(!this.waterFit){
   const body=this.body(1),bounds=poolWaterBounds(this.fixture);
   const rise=poolStrokeAirwayRise(this.geometry[0],this.cages[0],body.pose.world,this.neutral.inverse,bounds.surface,stroke.airwayFreeboardFraction);
   let pose=body.pose;
   if(rise>0){
    const author=this.placeBody({...body.intent,hips:add(body.intent.hips,[0,0,rise])});
    pose=poolIntervalPreference(this.bundle,author.rest,author.inverse,author.basis,author.basis,0,true);
   }
   this.waterFit={pose,bounds};
  }
  const {pose,bounds}=this.waterFit,controls:PoolPoseControl[]=[];
  for(const limb of ['footL','footR'] as const){
   const a=this.anatomy[limb],reach=this.limbReach[limb],wave=phase*2*Math.PI+(limb==='footL'?0:Math.PI);
   const direction=scale([0,stroke.foot.rearReachFraction+stroke.foot.kickReachFraction*Math.sin(wave),
    -stroke.foot.dropReachFraction+stroke.foot.kickReachFraction*Math.cos(wave)],reach.maximum);
   const orientation=this.flatFeet[limb],target=fitPoolWaterTarget(bounds,limb,point(pose.world[a.upper]),reach,direction,orientation,a.surfaceCoefficients);
   controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],legFrame:'source-entry-0',state:{target,orientation,pole:point(pose.world[a.lower])}});
  }
  for(const limb of ['handL','handR'] as const){
   const a=this.anatomy[limb],reach=this.limbReach[limb],side=limb==='handL'?-1:1,wave=phase*2*Math.PI+(side===-1?0:Math.PI);
   const direction=scale([side*stroke.hand.spreadReachFraction*Math.sin(wave),-stroke.hand.forwardReachFraction-stroke.hand.sweepReachFraction*Math.sin(wave),
    -stroke.hand.dropReachFraction+stroke.hand.liftReachFraction*Math.cos(wave)],reach.maximum);
   const orientation=properPoolRotation(multiply(pitch(this.definition.paddle.handPitchDegrees),this.neutral.rest[a.end]));
   const target=fitPoolWaterTarget(bounds,limb,point(pose.world[a.upper]),reach,direction,orientation,a.completeHandCoefficients!);
   controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],state:{target,orientation,pole:this.elbow(limb,pose)}});
  }
  return makePoolPoseProgram(pose.basis.map(clonePoolMatrix),controls,poolSourcePolicy(this.fixture,action,action==='pool_enter'?1:phase));
 }
 private hand(limb:PoolHand,phase:number,body:ReturnType<PoolCycleSource['body']>):PoolLimbState {
  const policy=poolSourcePolicy(this.fixture,'pool_enter',phase)[limb];
  if(policy.required){
   const grip=this.grip(limb,phase),crest=this.definition.hand.crestElbowPole,unit=phase*this.definition.clockUnits;
   if(this.definition.version===16&&phase>=.42&&phase<=.648)return grip;
   if(this.crestTorso&&limb==='handL'&&phase>.42&&phase<=.48){
    const shoulder=point(body.pose.world[this.anatomy[limb].upper]),upper=this.limbReach[limb].lengths[0];
    if(phase<.459){
     const amount=phase<=.432?smooth((phase-.42)/.012):1-smooth((phase-.432)/.027);
     return {...grip,pole:lerp(grip.pole,add(shoulder,scale(this.exteriorCrestNormal(),upper)),amount)};
    }
    const amount=smooth(clamp((phase-.459)/(.471-.459),0,1));
    return {...grip,pole:lerp(grip.pole,add(shoulder,[upper,0,0]),amount)};
   }
   if(!crest||unit<=crest.fromUnit||unit>=crest.toUnit||this.crestTorso&&phase>=.42&&phase<.56)return grip;
   const progress=unit<=crest.peakUnit?(unit-crest.fromUnit)/(crest.peakUnit-crest.fromUnit):(crest.toUnit-unit)/(crest.toUnit-crest.peakUnit);
   const offset=this.limbReach[limb].lengths[0]*crest.peakUpperArmFraction*smooth(progress);
   return {...grip,pole:[grip.pole[0],grip.pole[1]-offset,grip.pole[2]]};
  }
  const spec=this.definition,neutral=this.neutralHand(limb,body),approach=spec.hand.approach,release=spec.hand.release[limb];
  if(spec.version===16&&limb==='handL'){
   const [depart,free,approachInner,plant]=spec.crestRoute.handTransferUnits.map(unit=>unit/spec.clockUnits);
   if(phase>depart&&phase<plant){
    const outside=this.grip(limb,depart),inside=this.grip(limb,plant);
    const offset:Vec3=[2*this.fixture.rails[0].radius,0,0];
    const p=clamp((phase-free)/(approachInner-free),0,1);
    const clearance=phase<free?(phase-depart)/(free-depart):phase>approachInner?(plant-phase)/(plant-approachInner):1;
    return {target:add(lerp(outside.target,inside.target,p),scale(offset,clearance)),
     pole:lerp(outside.pole,inside.pole,p),orientation:rotationMix(outside.orientation,inside.orientation,p)};
   }
  }
  if(phase<approach[0])return neutral;
  if(phase<approach[1]){const end=this.grip(limb,approach[1]),u=(phase-approach[0])/(approach[1]-approach[0]);return {target:lerp(neutral.target,end.target,u),pole:lerp(neutral.pole,end.pole,u),orientation:rotationMix(neutral.orientation,end.orientation,u)};}
  if(phase<release[1]){const begin=this.grip(limb,release[0]),u=(phase-release[0])/(release[1]-release[0]),a=this.anatomy[limb],radius=Math.max(...a.completeHandCoefficients!.map(c=>length(sub(scale(vector(c.slice(0,3)),1/c[3]),scale(vector(a.anchor.slice(0,3)),1/a.anchor[3]))))),side=begin.attached!.geometry.side,withdraw:Vec3=[begin.target[0]+side*2*radius,begin.target[1],begin.target[2]];
   return u<=.5?{target:lerp(begin.target,withdraw,u*2),pole:begin.pole,orientation:begin.orientation}:{target:lerp(withdraw,neutral.target,(u-.5)*2),pole:lerp(begin.pole,neutral.pole,(u-.5)*2),orientation:rotationMix(begin.orientation,neutral.orientation,(u-.5)*2)};
  }
  if(phase<=.78)return neutral;
  const paddle=this.paddleHand(limb,body,0),a=this.anatomy[limb],shoulder=point(body.pose.world[a.upper]),bodyRotation=pitch(body.intent.trunkPitch),fore=this.limbReach[limb].lengths[1],middle:PoolLimbState={target:add(shoulder,transform(bodyRotation,[0,-fore,-fore])),pole:this.elbow(limb,body.pose),orientation:paddle.orientation};
  const from=phase<.88?neutral:middle,to=phase<.88?middle:paddle,u=phase<.88?(phase-.78)/.10:clamp((phase-.88)/.06,0,1);return {target:lerp(from.target,to.target,u),pole:lerp(from.pole,to.pole,u),orientation:rotationMix(from.orientation,to.orientation,u)};
 }
 entry(phase:number):PoolPoseProgram {
  if(phase===1&&this.definition.waterStroke)return this.waterJoin??=this.fittedStroke(this.definition.waterStroke,0,'pool_enter');
  const body=this.body(phase),controls:PoolPoseControl[]=[];
  for(const limb of ['footL','footR'] as const){const a=this.anatomy[limb];controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],legFrame:'source-entry-0',state:{target:this.freeFootGoal(limb,phase),orientation:this.flatFeet[limb],pole:point(body.pose.world[a.lower])}});}
  for(const limb of ['handL','handR'] as const){const a=this.anatomy[limb];controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],state:this.hand(limb,phase,body)});}
  for(const control of controls){const limb=this.bundle.bones[control.end].name.replace('.','') as PoolLimb;if(!poolChainReachable(this.limbReach[limb],point(body.pose.world[control.upper]),control.state.target))throw new Error('Pool authored source exceeds actual '+limb+' reach at '+phase);}
  return makePoolPoseProgram(body.basis.map(clonePoolMatrix),controls,poolSourcePolicy(this.fixture,'pool_enter',phase));
 }
 paddle(phase:number):PoolPoseProgram {
  if(phase===0||phase===1)return this.entry(1);
  if(this.definition.waterStroke)return this.fittedStroke(this.definition.waterStroke,phase,'pool_paddle');
  const body=this.body(1),controls:PoolPoseControl[]=[];
  for(const limb of ['footL','footR'] as const){const a=this.anatomy[limb],wave=phase*Math.PI*2+(limb==='footL'?0:Math.PI);controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],legFrame:'source-entry-0',state:{target:this.waterFoot(limb,body.intent.hips,wave,false),orientation:this.flatFeet[limb],pole:point(body.pose.world[a.lower])}});}
  for(const limb of ['handL','handR'] as const){const a=this.anatomy[limb];controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],state:this.paddleHand(limb,body,phase)});}
  return makePoolPoseProgram(body.basis.map(clonePoolMatrix),controls,poolSourcePolicy(this.fixture,'pool_paddle',phase));
 }
}
