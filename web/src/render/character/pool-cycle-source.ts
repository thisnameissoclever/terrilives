import type {SelectedPoolKnot} from './pool-selected-cycle.js';
import {poolWithdrawalStart,poolWithdrawalEnd,poolWithdrawalBody,poolFreeWithdrawalHand,poolHeldWithdrawalHand} from './pool-late-withdrawal.js';
import type {PlantedStep,PlantedEndpoint} from './pool-planted-step.js';
import {composeSkeletonPose} from './pose-joints.js';
import type {ExteriorToe,OpeningGeometry,ParsedOpening} from './pool-opening-flight.js';
import {installedPoolSupport} from './pool-installed-support.js';
import {openingPolicy,requireOpeningDefinition,type PoolOpeningRequest} from './pool-opening-flight.js';
import {heldPlace,parseNumericStages,readParsedStages,type ParsedNumericStages} from './pool-numeric-stages.js';
import type {Bundle,Geometry} from './bundle.js';
import {bodyInput,finiteRow,graspInput,rotationInput,numericFeet,numericHands,numericLimbReachable,numericalGroundOffset,numericalWrist,validateNumericKnot,type NumericBody,type NumericFootGoal,type NumericGrasp,type NumericHandGoal,type NumericKnot,type NumericKnotChoices,type NumericPoseShape,type NumericProposalInput,type NumericRailEdge,type NumericStageRequest} from './pool-numeric-recipe.js';
import {PoolTrialRefusal,type PoolTrialWork} from './pool-trial-work.js';
import type {ShapeParameters} from './shape.js';
import {shapeVertices} from './shape.js';
import type {Vec3} from './math.js';
import {add,sub,scale,unit,cross,dot,length,multiply,inverseAffine,transform,identity,boneFrame} from './math.js';
import {canonicalPoolPreference,properPoolRotation,setPoolWorldRotation,translatePoolRoot,type PoolHierarchy} from './pool-canonical-pose.js';
import {preparePoolEntryAnatomy,poolSurfacePoint} from './pool-entry-anatomy.js';
import {preparePoolFootContactFrame} from './pool-foot-contact-frame.js';
import type {PreparedPoolPatch} from './pool-contact-patch.js';
import {outwardSoleChoices} from './pool-outward-sole.js';
import {insetPaddleOffset,translateInsetPaddle} from './pool-inset-water.js';
import {fitClimbHand} from './pool-climb-hand.js';
import {preparePoolRailGeometry,resolvePoolRailContactFrame,type PoolPreparedRailGeometry,type PoolRailContactFrame} from './pool-rail-contact-frame.js';
import {configuredPoolChainReach,poolRootRayIntervals,poolChainReachable} from './pool-entry-domain.js';
import {poolIntervalPreference,poolSkinMatrices} from './pool-contact-sample.js';
import {paddleRimSides,poolPaddleArm,poolPaddleTorsoRise} from './pool-paddle-visibility.js';
import {makeSupportedCrestTurn,type SupportedCrestTurn} from './pool-supported-crest-turn.js';
import {poolSourceRecord,poolSourcePolicy} from './pool-source-policy.js';
import {makePoolPoseProgram,poolIntervalProgramControls,type PoolPoseProgram} from './pool-pose-program.js';
import {requireLiteralPoolRailFrame,resolvePoolLimbState,validatePoolKneeOrbit,type PoolPoseControl,type PoolLimbState} from './pool-contact-evaluator.js';
import type {PoolFixtureV1,PoolLimb,PoolSupport} from './pool-contact-types.js';
import {clonePoolMatrix,registerPoolRootTravel} from './pool-matrix-producer.js';
import {canonicalPoolValue} from './pool-contact-identity.js';
import {interpolateTransform} from './motion.js';
import {projectedTrianglePatch,type Triangle} from './pool-solid.js';
import {poolPatchProjectionContained} from './pool-exact-projection.js';
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
interface CrestRoute {path?:'supported-turn'|'supported-early-plant';insideHandTransferUnits?:[number,number,number,number];handTransferUnits:[number,number,number,number];footSwingUnits:[number,number];rightStepUnits:[number,number];sampleUnits:number[]}
export interface PoolForwardHop {
 insetEntry?:{steps:{limb:PoolFoot;fromPlace:string;toPlace:string;start:number;release:number;high:number;across:number;approach:number;land:number}[];grip:{start:number;end:number}};
 kind:'separate-climb-out'; takeoffUnit:60000; bridgeEndUnit:10000; standingUnit:100000;
 exitTicks?:40;
 launchFromUnit?:42000;waterContactUnit?:87000;
 outerGripTransfer?:{kind:'right-first';rightContactUnit:number;leftApproachUnit:number;leftContactUnit:number};
 outwardDescent?:{kind:'walk-out';startUnit:number;rightCrestUnit:number;leftOutside3Unit:number;rightOutside2Unit:number;rightDryUnit:number;leftDryUnit:number;rightTurnUnit:number};
 platformTurn?:{kind:'stepping-turn';startUnit:number;quarterUnit:number;leftTurnUnit:number;rightTurnUnit:number;exteriorUnit:number;
  loadedSteps?:{limb:PoolFoot;fromPlace:string;toPlace:string;start:number;lift:number;free:number;approach:number;land:number}[]};
 entryUnits:number[]; climbOutUnits:number[];
 climbKeys:{unit:number;authoredUnit:number;entryUnit?:number;poseEntryUnit?:number;exitReferenceUnit?:number}[];
 footTransitions:Pick<Transfer,'limb'|'from'|'to'|'startUnit'|'endUnit'>[];
}
interface PoolCrestFitDefinition {
 outerShift:number;innerShift:number;shinReferenceUnit:number;outerParameter:number;innerParameter:number;frameBasis:'held-exterior';
 earlyClearance:{rightShinX:number;leftUpperArmX:number};
}
export type PoolCycleDefinition = {
 dryBay?:{outer:[number,number,number];liner:[number,number,number];water:[number,number,number];inset:number};
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
 {version:16;hand:PoolHandDefinition & {crestElbowPole:CrestElbowPole};waterStroke:PoolWaterStrokeDefinition;groundGrip:PoolGroundGripDefinition;crestFit:PoolCrestFitDefinition;crestRoute:CrestRoute;forwardHop?:PoolForwardHop}
);
export function validatePoolCycleDefinition(value:unknown):asserts value is PoolCycleDefinition {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Pool source definition is missing');const source=value as Partial<PoolCycleDefinition>;
 if(source.version!==13&&source.version!==14&&source.version!==15&&source.version!==16)throw new Error('Pool source motion version is unsupported');
 if('forwardHop' in source&&(source.version!==16||!source.forwardHop||typeof source.forwardHop!=='object'))
  throw new Error('The independent pool hop requires a version 16 motion and a defined clock.');
 const exitTicks=source.version===16&&source.forwardHop?.exitTicks===40?40:20;
 if(source.clockUnits!==100000||source.nativeTicks?.enter!==20||source.nativeTicks.paddle!==60||source.nativeTicks.exit!==exitTicks||source.nativeTicks.tickHz!==10||source.paddle?.samples!==12)throw new Error('Pool source has another native clock');
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
  if(source.forwardHop){
   const h=source.forwardHop,ordered=(units:number[])=>Array.isArray(units)&&units[0]===0&&units.at(-1)===100000&&units.every((u,i)=>Number.isSafeInteger(u)&&(!i||u>units[i-1]));
   if(h.kind!=='separate-climb-out'||h.takeoffUnit!==60000||h.bridgeEndUnit!==10000||h.standingUnit!==100000||
     !ordered(h.entryUnits)||!ordered(h.climbOutUnits)||!h.entryUnits.includes(h.takeoffUnit)||!h.climbOutUnits.includes(h.bridgeEndUnit))
    throw new Error('Pool hop lacks its takeoff or independent climb-out clock.');
   const exterior=source.footTransitions.filter(t=>t.endUnit<=42000).map(({limb,from,to,startUnit,endUnit})=>({limb,from,to,startUnit,endUnit}));
   const split=h.launchFromUnit===42000,wet=split?87000:75000;
   if(h.outwardDescent){
    const d=h.outwardDescent,events=[d.startUnit,d.rightCrestUnit,d.leftOutside3Unit,d.rightOutside2Unit,d.rightDryUnit,d.leftDryUnit,d.rightTurnUnit];
    if(!split||h.outerGripTransfer||d.kind!=='walk-out'||h.exitTicks!==40||events.some((u,i)=>!h.climbOutUnits.includes(u)||i>0&&u<=events[i-1])||
      d.startUnit<=h.bridgeEndUnit||d.rightTurnUnit>=h.standingUnit||h.climbKeys.some(k=>k.unit>d.startUnit&&(k.entryUnit!==undefined||k.exitReferenceUnit!==undefined||k.poseEntryUnit!==undefined)))
      throw new Error('Invalid independent outward stair and ground-turn clock.');
   }
   if(h.platformTurn!==undefined){
    const t=h.platformTurn;
    if(!split||h.outwardDescent||h.outerGripTransfer||!t||t.kind!=='stepping-turn'||
     [t.startUnit,t.quarterUnit,t.leftTurnUnit,t.rightTurnUnit,t.exteriorUnit].join(',')!=='45000,51000,57000,64000,77000'||
     ![t.startUnit,t.quarterUnit,t.leftTurnUnit,t.rightTurnUnit,t.exteriorUnit].every(u=>h.climbOutUnits.includes(u)))
     throw new Error('Invalid supported turning-platform clock.');
   }
   if(h.outerGripTransfer!==undefined){
    const t=h.outerGripTransfer;
    if(!split||!t||t.kind!=='right-first'||Object.keys(t).sort().join(',')!=='kind,leftApproachUnit,leftContactUnit,rightContactUnit'||
      ![t.rightContactUnit,t.leftApproachUnit,t.leftContactUnit].every(u=>Number.isSafeInteger(u)&&h.climbOutUnits.includes(u))||
      !(h.bridgeEndUnit<t.rightContactUnit&&t.rightContactUnit<t.leftApproachUnit&&t.leftApproachUnit<t.leftContactUnit&&t.leftContactUnit<h.standingUnit))
      throw new Error('Invalid independent climb hand transfer.');
   }
   if((h.launchFromUnit!==undefined||h.waterContactUnit!==undefined)&&(!split||h.waterContactUnit!==wet||!h.entryUnits.includes(wet)))throw new Error('Invalid split-level launch clock.');
   const flights=[{limb:'footL',from:'outside3',to:'free',startUnit:split?44000:42000,endUnit:wet},
    {limb:'footR',from:'crest',to:'free',startUnit:h.takeoffUnit,endUnit:wet}];
   const inset=h.insetEntry;
   if(inset&&(!Array.isArray(inset.steps)||inset.steps.length!==5||inset.steps.some((s,i)=>
    ![s.start,s.release,s.high,s.across,s.approach,s.land].every((n,j,all)=>Number.isSafeInteger(n)&&h.entryUnits.includes(n)&&(!j||n>all[j-1]))||
    s.start!==(i?inset.steps[i-1].land:0)||s.limb!==(['footR','footL','footR','footL','footR'] as const)[i]||
    s.fromPlace!==['ground','ground','ground','outside1','outside2'][i]||s.toPlace!==['ground','outside1','outside2','outside3','crest'][i])||
    inset.steps.at(-1)!.land!==42000||!h.entryUnits.includes(inset.grip.start)||!h.entryUnits.includes(inset.grip.end)||inset.grip.start>=inset.grip.end))
    throw new Error('The inset pool approach must carry one foot at a time from the ground to the landing.');
   const installed=inset?inset.steps.map(s=>({limb:s.limb,from:s.fromPlace,to:s.toPlace,startUnit:s.start,endUnit:s.land})):exterior;
   if(exterior.length!==4||canonicalPoolValue(h.footTransitions)!==canonicalPoolValue([...installed,...flights]))
    throw new Error('The pool hop must load the crest sole until takeoff and land in open water.');
   if(!Array.isArray(h.climbKeys)||canonicalPoolValue(h.climbKeys.map(r=>r.unit))!==canonicalPoolValue(h.climbOutUnits)||
    h.climbKeys.some((r,i)=>!Number.isSafeInteger(r.authoredUnit)||r.authoredUnit<0||r.authoredUnit>100000||
     (r.exitReferenceUnit!==undefined&&(!split||r.exitReferenceUnit!==r.unit||r.entryUnit!==undefined||r.poseEntryUnit!==undefined))||
     (r.poseEntryUnit!==undefined&&(split||!Number.isSafeInteger(r.poseEntryUnit)||r.poseEntryUnit>=h.takeoffUnit||r.entryUnit!==undefined))||
     (r.entryUnit!==undefined&&(!Number.isSafeInteger(r.entryUnit)||r.entryUnit<0||r.entryUnit>=h.takeoffUnit||split&&r.entryUnit>42000||
      (i>0&&h.climbKeys[i-1].entryUnit!==undefined&&r.entryUnit>=h.climbKeys[i-1].entryUnit!)))))
    throw new Error('The climb-out clock lost an authored exterior step.');
  }
  const route=source.crestRoute;
  if(!route||!source.crestFit||!source.groundGrip)throw new Error('Pool source v16 crest support sequence is missing');
  if(route.path==='supported-turn'||route.path==='supported-early-plant'){
   const units=route.sampleUnits;
   const early=route.path==='supported-early-plant',leftPlant=early?50800:53200,rightDeparture=early?51000:53200;
   if(Object.keys(route).some(k=>!['path','handTransferUnits','footSwingUnits','rightStepUnits','sampleUnits','insideHandTransferUnits'].includes(k)))
     throw new Error('Unknown supported pool turn control.');
   if(route.insideHandTransferUnits!==undefined&&canonicalPoolValue(route.insideHandTransferUnits)!==canonicalPoolValue([50668,50787,51143,51381]))
     throw new Error('Invalid inside pool wrist regrip clock.');
   if(!Array.isArray(units)||units.length>256||units[0]!==42000||units.at(-1)!==64000||
      units.some((u,i)=>!Number.isSafeInteger(u)||i>0&&u<=units[i-1])||
      ![42001,42101,43200,43875,45225,45900,46278,46467,46656,leftPlant,rightDeparture,51940,53200,62380,...(route.insideHandTransferUnits??[])].every(u=>units.includes(u))||
      canonicalPoolValue(route.handTransferUnits)!==canonicalPoolValue([43200,43875,45225,45900])||
      canonicalPoolValue(route.footSwingUnits)!==canonicalPoolValue([42000,leftPlant])||
      canonicalPoolValue(route.rightStepUnits)!==canonicalPoolValue([rightDeparture,64000])||
      !source.footTransitions?.some(t=>t.limb==='footL'&&t.from==='outside3'&&t.to==='inside3'&&t.startUnit===42000&&t.endUnit===leftPlant)||
      !source.footTransitions?.some(t=>t.limb==='footR'&&t.from==='crest'&&t.to==='inside2'&&t.startUnit===rightDeparture&&t.endUnit===64000))
    throw new Error('Supported pool turn differs from its authored release, replant or landing clock');
  }else if(canonicalPoolValue(route)!==canonicalPoolValue({
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
 private readonly paddleElbowLimit:Record<PoolHand,number>={handL:Infinity,handR:Infinity};
 private readonly plantedEndpoints=new Map<string,readonly [BodyPathEndpoint,BodyPathEndpoint]>();
 private readonly plantedWitnesses=new Map<string,{hips:Vec3;knee:Vec3;ankle:Vec3;amount:number;endpointExact:boolean}>();
 private waterFit?:{pose:ReturnType<PoolCycleSource['body']>['pose'];bounds:ReturnType<typeof poolWaterBounds>};
 private waterJoin?:PoolPoseProgram;
 private corridorJoin?:PoolPoseProgram;
 private groundGripFit?:{offset:Vec3;hands?:Record<PoolHand,PoolLimbState>};
 private crestOutward?:Vec3;
 private crestTorso?:readonly Triangle[];
 private crestArmCap?:number;
 private crestLeadingReference?:BodyIntent;
 private crestNodes?:readonly CrestNode[];
 private crestTailNodes?:readonly CrestNode[];
 private routeLandingGrips?:readonly [number,number];
 private replantParameter?:number;
 constructor(readonly bundle:Bundle,readonly shape:ShapeParameters,readonly top:number,readonly geometry:readonly Geometry[],readonly fixture:PoolFixtureV1,readonly definition:PoolCycleDefinition,private readonly numericWork?:PoolTrialWork){
  validatePoolCycleDefinition(definition);
  if(canonicalPoolValue(bundle.basisActions.pool_enter[0])!==canonicalPoolValue(definition.reference.neutralSample.basis))throw new Error('Pool source changed its anatomical reference.');
  if(!definition.anchors.length||definition.anchors[0].phase!==0||definition.anchors.at(-1)!.phase!==1||definition.anchors.some((a,i)=>a.phase!==a.unit/definition.clockUnits||i>0&&a.phase<=definition.anchors[i-1].phase))throw new Error('Pool source anchor clock is invalid.');
  this.numericWork?.reserve('construct neutral pool geometry',{expansions:1});
  this.neutral=canonicalPoolPreference(bundle,shape,top,'pool_enter',0,geometry);
  this.numericWork?.reserve('prepare configured pool limb anatomy',{expansions:1});
  this.anatomy=preparePoolEntryAnatomy(geometry[0],shape,top);this.cages=geometry.map(g=>{this.numericWork?.reserve('shape selected pool cage',{expansions:1});return shapeVertices(g.cage,shape,top);});
  const restSkin=new Float32Array(bundle.bones.length*16);bundle.bones.forEach((_,bone)=>restSkin.set(identity(),bone*16));
  this.numericWork?.reserve('pose selected pool reference surface',{expansions:1});
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
  if(definition.version===16&&definition.forwardHop){
   const sides=paddleRimSides(fixture);
   for(const [i,limb] of (['handL','handR'] as const).entries()){
    const arm=geometry[0].description.parts.find(part=>part.name==='Creator upper arm skin '+limb.slice(-1));
    if(!arm)throw new Error('The pool stroke needs the selected upper arm.');
    const inverse=this.neutral.inverse[this.anatomy[limb].upper],upperLength=this.limbReach[limb].lengths[0];
    let radius=0;
    for(const vertex of new Set(geometry[0].indices.subarray(arm.start,arm.start+arm.count))){
     const position=vector(Array.from(restSurface.subarray(3*vertex,3*vertex+3)));
     const [x,y,z]=transform(inverse,position);
     radius=Math.max(radius,Math.hypot(x,y-clamp(y,0,upperLength),z));
    }
    this.paddleElbowLimit[limb]=(i===0?-sides[0]:sides[1])-radius;
   }
  }
  this.flatFeet={footL:this.foot('footL','ground').orientation,footR:this.foot('footR','ground').orientation};
  const inverse=inverseAffine(this.neutral.world[this.spine]);
  const handReference=(limb:PoolHand)=>{const a=this.anatomy[limb];return {wrist:transform(inverse,point(this.neutral.world[a.end])),elbow:transform(inverse,point(this.neutral.world[a.lower])),rotation:properPoolRotation(multiply(inverse,this.neutral.world[a.end]))};};
  this.sourceHands={handL:handReference('handL'),handR:handReference('handR')};
 }
 patch(limb:PoolLimb,support:PoolSupport,location?:{action:string;phase:number}){
  const a=this.anatomy[limb];if(limb.startsWith('hand'))return a.patch;
  const d=this.definition;
  if(d.version===16&&d.forwardHop?.outwardDescent&&location?.action.startsWith('pool_exit_')){
   const place=Object.entries(d.places).find(([,p])=>p.surface===support.surface)?.[0];
   if(place?.startsWith('outside'))return this.outwardExitFoot(limb as PoolFoot,place,location.phase*d.clockUnits).patch;
  }
  const name=Object.values(this.definition.places).find(p=>p.surface===support.surface)?.patch??'full';return name==='front'?a.front!:name==='back'?a.back!:a.patch;
 }
 frame(limb:PoolFoot,support:PoolSupport,xy:[number,number],work=this.numericWork,facesInsideLadder=false){
  const key=limb+':'+canonicalPoolValue([support,xy])+(facesInsideLadder?':inside-facing':''),old=this.footFrames.get(key);if(old)return old;const a=this.anatomy[limb];
  work?.reserve('prepare phase sole contact frame',{expansions:1});
  const frame=preparePoolFootContactFrame(this.fixture,support,this.geometry[0],this.cages[0],this.neutral.inverse[a.end],this.patch(limb,support),this.orientedRawFoot(limb,facesInsideLadder),xy);this.footFrames.set(key,frame);return frame;
 }
 private insideFacingExitFoot(limb:PoolFoot,place:string,unit:number):boolean {
  const outward=this.definition.version===16?this.definition.forwardHop?.outwardDescent:undefined;
  if(outward)return place!=='ground'||unit<(limb==='footR'?outward.rightTurnUnit:this.definition.clockUnits);
  const release=this.definition.version===16?this.definition.forwardHop?.climbKeys.find(k=>k.authoredUnit===59000)?.unit:undefined;
  return place.startsWith('inside')||(place==='crest'&&limb==='footL'&&release!==undefined&&unit<=release);
 }
 private orientedRawFoot(limb:PoolFoot,inside:boolean){
  return inside?multiply([-1,0,0,0,0,-1,0,0,0,0,1,0,0,0,0,1],this.rawFeet[limb]):this.rawFeet[limb];
 }
 phaseFootFrame(limb:PoolFoot,support:PoolSupport,xy:[number,number],location:{action:string;phase:number},work=this.numericWork){
  const exit=this.definition.version===16&&this.definition.forwardHop&&location.action.startsWith('pool_exit_');
  const place=exit?Object.entries(this.definition.places).find(([,p])=>p.surface===support.surface)?.[0]:undefined;
  const platform=place==='crest'&&this.definition.version===16&&this.definition.forwardHop?.platformTurn;
  if(place&&this.definition.version===16&&(this.definition.forwardHop?.outwardDescent||platform)){
   const facingPhase=support.mode==='approach'&&support.intervalSpace==='clip-phase'&&support.interval?support.interval[1]:location.phase;
   const u=facingPhase*this.definition.clockUnits,f=platform?this.turnLandingFoot(limb,u):this.outwardExitFoot(limb,place,u),key=limb+':directed-foot:'+canonicalPoolValue([support,xy,f.raw]);
   let frame=this.footFrames.get(key);if(!frame){work?.reserve('prepare phase sole contact frame',{expansions:1});
    frame=preparePoolFootContactFrame(this.fixture,support,this.geometry[0],this.cages[0],this.neutral.inverse[this.anatomy[limb].end],f.patch,f.raw,xy);
    this.footFrames.set(key,frame);}
   return frame;
  }
  return this.frame(limb,support,xy,work,!!place&&this.insideFacingExitFoot(limb,place,location.phase*this.definition.clockUnits));
 }
 primaryExitFoot(limb:PoolFoot,place:string,unit:number):FootGoal {
  if(place==='crest'&&this.definition.version===16&&this.definition.forwardHop?.platformTurn)return this.turnLandingFoot(limb,unit);
  if(this.definition.version===16&&this.definition.forwardHop?.outwardDescent)return this.outwardExitFoot(limb,place,unit);
  return this.foot(limb,place,this.numericWork,this.insideFacingExitFoot(limb,place,unit));
 }
 private readonly walkSoles=new Map<string,FootGoal&{patch:PreparedPoolPatch;raw:readonly number[];frame:ReturnType<typeof preparePoolFootContactFrame>}>();
 private readonly turningFeet=new Map<string,FootGoal&{patch:PreparedPoolPatch;raw:readonly number[]}>();
 turnLandingFoot(limb:PoolFoot,unit:number){
  const def=this.definition;if(def.version!==16||!def.forwardHop?.platformTurn)throw new Error('Missing stepping turn on the landing.');
  const turn=def.forwardHop.platformTurn,a=this.anatomy[limb],patch=a.patch;
  const nearest=Math.round(unit),keyUnit=Math.abs(nearest-unit)<=2*Number.EPSILON*def.clockUnits?nearest:unit;
  const facing=limb==='footL'?(keyUnit<turn.leftTurnUnit?Math.PI:0):(keyUnit<turn.rightTurnUnit?Math.PI/2:0);
  const key=limb+':'+facing,saved=this.turningFeet.get(key);if(saved)return saved;
  const raw=facing===0?this.rawFeet[limb]:properPoolRotation(multiply(yaw(facing),this.rawFeet[limb]));
  if(limb==='footR'&&facing===0){
   const g={...this.foot(limb,'crest'),patch,raw};this.turningFeet.set(key,g);return g;
  }
  const deck=this.fixture.solids.find(s=>s.id===def.places.crest.surface)!,rails=this.fixture.rails.map(r=>this.fixture.solids.find(s=>s.id===r.id)!);
  const margin=this.fixture.rails[0].radius,lo=[rails[0].bounds[1][0]+margin,deck.bounds[0][1]+margin],
   hi=[rails[1].bounds[0][0]-margin,deck.bounds[1][1]-margin],middle=(lo[0]+hi[0])/2;
  const rows=a.surfaceCoefficients.map(c=>({v:poolSurfacePoint(raw,c),w:c[3]}));
  const lower=[0,1].map(i=>Math.max(...rows.map(r=>(lo[i]-r.v[i])/r.w)));
  const upper=[0,1].map(i=>Math.min(...rows.map(r=>(hi[i]-r.v[i])/r.w)));
  if(lower.some((v,i)=>v>upper[i]))throw new PoolTrialRefusal('The whole turning foot exceeds its landing.');
  const x=limb==='footR'?middle:middle+(facing===0?-1:1)*(hi[0]-lo[0])/4;
  const xy:[number,number]=[clamp(x,lower[0],upper[0]),limb==='footR'?upper[1]:lower[1]];
  const g={...this.foot(limb,'crest',this.numericWork,false,{raw,patch,xy,platform:true}),patch,raw};
  this.turningFeet.set(key,g);return g;
 }
 outwardExitFoot(limb:PoolFoot,place:string,unit:number):FootGoal&{patch:PreparedPoolPatch;raw:readonly number[];frame:ReturnType<typeof preparePoolFootContactFrame>} {
  const d=this.definition;if(d.version!==16||!d.forwardHop?.outwardDescent)throw new Error('The installed pool does not declare its outward descent.');
  const outward=this.insideFacingExitFoot(limb,place,unit),key=limb+':'+place+':'+outward,saved=this.walkSoles.get(key);if(saved)return saved;
  const a=this.anatomy[limb];let patch=a.patch,raw:readonly number[]=this.orientedRawFoot(limb,outward),goal:FootGoal|undefined;
  if(place.startsWith('outside')){
   let last:unknown;
   for(const choice of outwardSoleChoices(this,limb,place)){
    try{goal=this.foot(limb,place,this.numericWork,true,choice);patch=choice.patch;raw=choice.raw;break;}
    catch(error){if(!(error instanceof PoolTrialRefusal))throw error;last=error;}
   }
   if(!goal)throw new PoolTrialRefusal('No supported outward heel on '+place+' for '+limb,{cause:last});
  }else if(place==='ground'&&outward){
   const standing=this.foot(limb,place),x=2*d.ground.pelvisXY[0]-standing.target[0];
   let y=standing.target[1]-(standing.bounds[1][1]-standing.bounds[0][1])/2;
   if(limb==='footL'){
    const clear=this.foot('footR','ground').bounds[1][1]+this.fixture.rails[0].radius;
    y=Math.max(...a.surfaceCoefficients.map(c=>(clear-poolSurfacePoint(raw,c)[1])/c[3]));
   }
   goal=this.foot(limb,place,this.numericWork,true,{raw,patch,xy:[x,y]});
   if([0,1].some(i=>goal!.bounds[0][i]<this.fixture.ground.bounds[0][i]||goal!.bounds[1][i]>this.fixture.ground.bounds[1][i]))
    throw new Error('The outward landing leaves the dry ground.');
  }else if(place==='crest'){
   const support=installedPoolSupport(this.fixture,d.places.crest.surface);
   const solid=this.fixture.solids.find(s=>s.id===support.surface)!;
   if(support.region?.kind!=='top-face'||!support.region.triangles?.length)throw new Error('The outward crest needs finite landing faces.');
   const faces=support.region.triangles.map((i):Triangle=>{
    const [a,b,c]=solid.triangles[i];return [solid.vertices[a],solid.vertices[b],solid.vertices[c]];
   });
   // The notch ends at the last interior Y level. Beyond it, both feet fit side by side on the dry strip.
   const levels=[...new Set(faces.flatMap(face=>face.map(p=>p[1])))].sort((a,b)=>a-b);
   if(levels.length<2)throw new Error('The outward crest has no landing depth.');
   const dryStripY=levels[levels.length-2],radius=this.fixture.rails[0].radius;
   const right=limb==='footL'?this.outwardExitFoot('footR',place,unit):undefined;
   goal=this.foot(limb,place,this.numericWork,true,{raw,patch,crest:{dryStripY,medialMinX:right&&right.bounds[1][0]+radius/4}});
   const matrix=[...goal.orientation];matrix.splice(12,3,...goal.target);
   const vertices=patch.vertices.map(v=>poolSurfacePoint(matrix,v.coefficient));
   const footprint=patch.triangles.map(([a,b,c]):Triangle=>[vertices[a],vertices[b],vertices[c]]);
   if(!poolPatchProjectionContained(footprint,faces))throw new PoolTrialRefusal('The outward crest sole leaves its finite landing facets.');
  }else goal=this.foot(limb,place,this.numericWork,outward);
  const frame=preparePoolFootContactFrame(this.fixture,goal.support,this.geometry[0],this.cages[0],this.neutral.inverse[a.end],patch,raw,[goal.target[0],goal.target[1]]);
  const value={...goal,patch,raw,frame};this.walkSoles.set(key,value);return value;
 }
 foot(limb:PoolFoot,place:string,work=this.numericWork,facesInsideLadder=false,sole?:{patch:PreparedPoolPatch;raw:readonly number[];xy?:readonly [number,number];crest?:{dryStripY:number;medialMinX?:number};platform?:boolean}):FootGoal {
  const key=limb+':'+place+(facesInsideLadder?':inside-facing':''),saved=sole?undefined:this.footGoals.get(key);if(saved)return saved;
  work?.reserve('construct fixed sole '+place,{expansions:1});
  const declared=this.definition.places[place];if(!declared)throw new Error('Pool source foot place is unknown: '+place);
  const a=this.anatomy[limb],support=installedPoolSupport(this.fixture,declared.surface),patch=sole?.patch??this.patch(limb,support),ground=place==='ground',solid=this.fixture.solids.find(s=>s.id===support.surface),rectangle=ground?this.fixture.ground.bounds:solid!.bounds;
  work?.reserve('prepare sole reference frame '+place,{expansions:1});
  const raw=sole?.raw??this.orientedRawFoot(limb,facesInsideLadder),failure=sole?(message:string)=>new PoolTrialRefusal(message):undefined;
  const reference=preparePoolFootContactFrame(this.fixture,support,this.geometry[0],this.cages[0],this.neutral.inverse[a.end],patch,raw,[0,0],failure);
  const rows=a.surfaceCoefficients.map(c=>({p:poolSurfacePoint(reference.orientation,c),w:c[3]})),patchRows=patch.vertices.map(v=>({p:poolSurfacePoint(reference.orientation,v.coefficient),w:v.coefficient[3]}));
  const lo=[0,1].map(i=>Math.max(...patchRows.map(r=>(rectangle[0][i]-r.p[i])/r.w))),hi=[0,1].map(i=>Math.min(...patchRows.map(r=>(rectangle[1][i]-r.p[i])/r.w)));
  let x=sole?.xy?.[0]??point(this.neutral.world[a.end])[0],y=sole?.xy?.[1]??this.definition.ground.pelvisXY[1];
  if(!ground){
   const left=this.fixture.solids.find(s=>s.id===this.fixture.rails[0].id)!,right=this.fixture.solids.find(s=>s.id===this.fixture.rails[1].id)!,middle=this.definition.ground.pelvisXY[0];
   const leftLane=(limb==='footL')!==facesInsideLadder;
   const lane=leftLane?[left.bounds[1][0],middle]:[middle,right.bounds[0][0]];
   if(sole?.platform&&place==='crest'){lane[0]=left.bounds[1][0];lane[1]=right.bounds[0][0];}
   if(sole?.crest?.medialMinX!==undefined)lane[0]=Math.max(lane[0],sole.crest.medialMinX);
   if(facesInsideLadder&&place==='crest'&&limb==='footL'&&!(this.definition.version===16&&this.definition.forwardHop?.outwardDescent)){
    const arriving=this.foot('footR','crest',work);
    lane[0]=left.bounds[1][0];lane[1]=arriving.bounds[0][0]-this.fixture.rails[1].radius;
   }
   lo[0]=Math.max(lo[0],...rows.map(r=>(lane[0]-r.p[0])/r.w));hi[0]=Math.min(hi[0],...rows.map(r=>(lane[1]-r.p[0])/r.w));
   if(!sole&&!facesInsideLadder&&place==='crest'&&limb==='footR'&&this.definition.version===16&&this.definition.forwardHop?.platformTurn){
    // Step onto the dry-side footprint. Additional deck behind the toes is room for the exit turn.
    const points=rows.map(r=>r.p[1]/r.w),depth=Math.max(...points)-Math.min(...points);
    const inner=rectangle[1][1]-depth;
    lo[1]=Math.max(lo[1],...patchRows.map(r=>(inner-r.p[1])/r.w));
   }
   if(sole?.crest)lo[1]=Math.max(lo[1],...patchRows.map(r=>(sole.crest!.dryStripY-r.p[1])/r.w));
   if(place.startsWith('outside')){
    const wall=this.fixture.solids.find(s=>s.id==='Pool wall')!,planes=wall.triangles.flatMap(t=>{const [a,b,c]=t.map(i=>wall.vertices[i]),n=cross(sub(b,a),sub(c,a));return n[1]>0&&n[0]===0&&n[2]===0&&a[1]>0?[a[1]]:[];});
    if(!planes.length)throw new Error('Pool toe recess has no actual backing plane');const back=Math.min(...planes);
    lo[1]=Math.max(lo[1],...rows.map(r=>(back-r.p[1])/r.w));
   }
   if(lo.some((v,i)=>v>=hi[i]))throw new (sole?PoolTrialRefusal:Error)('Complete configured foot has no compact support domain: '+limb+' '+place);
   x=(lo[0]+hi[0])/2;y=(lo[1]+hi[1])/2;
   if(sole?.platform&&sole.xy){[x,y]=sole.xy;if(x<lo[0]||x>hi[0]||y<lo[1]||y>hi[1])throw new PoolTrialRefusal('The turning sole leaves its platform.');}
   if(facesInsideLadder&&place==='crest'&&limb==='footL'){
    if(sole?.crest)x=lo[0]+Math.min(this.fixture.rails[0].radius/4,(hi[0]-lo[0])/2);
    else{x=hi[0];y=hi[1];}
   }
  }else if(x<lo[0]||x>hi[0]||y<lo[1]||y>hi[1])throw new Error('Configured grounded foot leaves its actual landing');
  work?.reserve('prepare installed sole frame '+place,{expansions:1});
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
  const maxW=Math.max(...rows.map(r=>r.w)),lift=Math.min(.25/4,verticalClearance/(2*maxW));if(!(lift>0))throw new (sole?PoolTrialRefusal:Error)('Complete configured foot has no withdrawal height: '+limb+' '+place,{cause:{ceiling,verticalClearance,full,plane:frame.planeHeight,target:frame.translation}});
  const result={place,support,target:frame.translation,orientation:frame.orientation,plane:frame.planeHeight,bounds:full,height:full[1][2]-frame.planeHeight,lift};if(!sole)this.footGoals.set(key,result);return result;
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
 private elbow(limb:PoolHand,pose:Pick<PoolHierarchy,'world'>):Vec3 {
  const a=this.anatomy[limb],shoulder=point(pose.world[a.upper]),hips=point(pose.world[this.hip]),distance=this.limbReach[limb].lengths[0];return [shoulder[0]+Math.sign(hips[0]-shoulder[0])*distance,shoulder[1],shoulder[2]-distance];
 }
 private gripRail(limb:PoolHand,phase:number,work=this.numericWork,action='pool_enter'){
  work?.reserve('construct phase rail basis '+limb,{expansions:1});
  const a=this.anatomy[limb],support=poolSourceRecord(this.fixture,{action,phase}).limbs[limb],geometryKey=limb+':'+canonicalPoolValue(support);let physical=this.railInputs.get(geometryKey);
  if(!physical){work?.reserve('prepare actual rail geometry '+limb,{expansions:1});physical=preparePoolRailGeometry(this.fixture,support,this.geometry[0],this.cages[0],this.neutral.inverse[a.end],a.patch);this.railInputs.set(geometryKey,physical);}
  return {physical,geometryKey,local:this.palmGripBasis(limb),location:{action,phase,limb}};
 }
 palmGripBasis(limb:PoolHand):number[]{
  const a=this.anatomy[limb],inverse=[...this.neutral.inverse[a.end]];
  inverse.splice(12,3,0,0,0);
  const localNormal=transform(inverse,[0,1,0]),thumb=a.thumb!;
  const thumbDirection=sub(vector(thumb.slice(0,3)),scale(vector(a.anchor.slice(0,3)),thumb[3]/a.anchor[3]));
  const reference=identity();reference.splice(0,3,...thumbDirection);
  return inverseAffine(boneFrame([0,0,0],localNormal,reference));
 }
 private gripRailReference(rail:ReturnType<PoolCycleSource['gripRail']>,entry:PoolPreparedRailGeometry['edges'][number],shoulder:Vec3,work=this.numericWork){
  const {physical,geometryKey,local,location}=rail;
  const normal:Vec3=[physical.side,0,0],tangent=sub(entry.to,entry.from);let transverse=cross(normal,tangent);
  if(transverse[2]<0||transverse[2]===0&&transverse[1]*(shoulder[1]-entry.from[1])<0)transverse=scale(transverse,-1);
  const world=identity();world.splice(0,3,...transverse);
  const raw=properPoolRotation(multiply(boneFrame([0,0,0],normal,world),local)),referenceKey=geometryKey+':'+canonicalPoolValue(raw);
  let frame=this.railReferences.get(referenceKey);
  if(!frame){work?.reserve('resolve actual reference palm frame',{expansions:1});frame=resolvePoolRailContactFrame(physical,raw,entry.edge.fromParameter,undefined,location);this.railReferences.set(referenceKey,frame);}
  return {raw,frame};
 }
 private exactGrip(rail:ReturnType<PoolCycleSource['gripRail']>,pose:Pick<PoolHierarchy,'world'>,parameter:number,raw:readonly number[],active:number,work=this.numericWork):PoolLimbState {
  work?.reserve('resolve actual attached palm frame',{expansions:1});
  const {location,physical}=rail,frame=resolvePoolRailContactFrame(physical,raw,parameter,active,location);
  return {target:frame.translation,orientation:frame.orientation,pole:this.elbow(location.limb,pose),
   attached:{source:location,geometry:physical,parameter,rawOrientation:raw,activeVertex:frame.activeVertex}};
 }
 /** Materialize an authored supported turn from its two literal, already selected outer programs. */
 supportedCrestTurn(left:PoolPoseProgram,right:PoolPoseProgram,turn:SupportedCrestTurn):PoolPoseProgram {
  return makeSupportedCrestTurn({bundle:this.bundle,rest:this.neutral.rest,inverse:this.neutral.inverse,fixture:this.fixture,
   anatomy:this.anatomy,clockUnits:this.definition.clockUnits,
   grip:(limb,phase,pose,parameter,raw,active)=>this.exactGrip(this.gripRail(limb,phase),pose,parameter,raw,active)},
   left,right,turn);
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
 climbBody(intent:NumericBody,facing:number){
  const pose=this.placeBody(intent);
  setPoolWorldRotation(pose,this.hip,multiply(yaw(facing),pose.world[this.hip]));
  return pose;
 }
 climbGrip(limb:PoolHand,phase:number,pose:PoolHierarchy,maintained?:PoolLimbState['attached']){
  const grip=this.preferredGrip(limb,phase,pose,true,'pool_exit_0',maintained);
  if(!grip)throw new PoolTrialRefusal('No reachable inside ladder grip for '+limb+' at '+phase);
  return grip;
 }
 insetEntryGrip(limb:PoolHand,unit:number,pose:PoolHierarchy,maintained?:PoolLimbState['attached'],fitThumb=true){
  const state=this.preferredGrip(limb,unit/this.definition.clockUnits,pose,false,'pool_enter',maintained,true,true);
  return state&&fitThumb?fitClimbHand(this,limb,point(pose.world[this.anatomy[limb].upper]),state,[3,6]):state;
 }
 insetGroundFoot(limb:PoolFoot){
  const foot=this.foot(limb,'ground');
  const y=foot.target[1]+this.fixture.ground.bounds[0][1]+this.fixture.rails[0].radius-foot.bounds[0][1];
  return this.foot(limb,'ground',this.numericWork,false,{patch:this.anatomy[limb].patch,raw:this.rawFeet[limb],xy:[foot.target[0],y]});
 }
 exteriorClimbGrip(limb:PoolHand,unit:number,pose:PoolHierarchy){
  const selected=this.preferredGrip(limb,unit/this.definition.clockUnits,pose,true,'pool_exit_0',undefined,false,true);
  if(!selected)throw new PoolTrialRefusal('The exterior landing grip exceeds '+limb+' reach at '+unit);
  return selected;
 }
 private preferredGrip(limb:PoolHand,phase:number,pose:Pick<PoolHierarchy,'world'>,inside=false,action='pool_enter',maintained?:PoolLimbState['attached'],allowLowerExterior=false,exitingOutside=false):PoolLimbState|undefined {
  const rail=this.gripRail(limb,phase,this.numericWork,action),{physical}=rail;
  const shoulder=point(pose.world[this.anatomy[limb].upper]),upper=this.limbReach[limb].lengths[0];
  const outside=!inside&&phase<=.42,crest=!inside&&phase>.42&&phase<=.48,branch=exitingOutside?[3,6]:outside?this.definition.hand.outsideBranch:crest?this.definition.hand.crestBranch:this.definition.hand.insideBranch;
  const desired:Vec3=action==='pool_exit_0'?[shoulder[0],shoulder[1]+upper,shoulder[2]+upper/3]:[shoulder[0],crest?Math.max(shoulder[1],this.fixture.rails[0].points[3].point[1]):shoulder[1]-upper,shoulder[2]+(outside?upper/2:crest?-upper:-upper)];
  const choices:{parameter:number;raw:number[];active:number;distance:number}[]=[];
  for(const entry of physical.edges){if(entry.edge.toParameter<=branch[0]||entry.edge.fromParameter>=branch[1])continue;
   const {raw,frame}=maintained?{raw:[...maintained.rawOrientation],frame:resolvePoolRailContactFrame(physical,maintained.rawOrientation,entry.edge.fromParameter,maintained.activeVertex,rail.location)}:this.gripRailReference(rail,entry,shoulder);
   const coefficient=physical.coefficients[physical.vertices.indexOf(frame.activeVertex)][3],w=Number(coefficient.numerator)*2**coefficient.exponent;
   const from=vector(entry.from.map((v,i)=>frame.translation[i]+(v-frame.targetPoint[i])/w)),direction=scale(sub(entry.to,entry.from),1/w),wanted=dot(sub(desired,from),direction)/dot(direction,direction);
   for(const interval of poolRootRayIntervals(direction,[{limb,center:sub(shoulder,from),reach:this.limbReach[limb]}])){
    let low=Math.max(0,interval.minimum,(branch[0]-entry.edge.fromParameter)/(entry.edge.toParameter-entry.edge.fromParameter)),high=Math.min(1,interval.maximum,(branch[1]-entry.edge.fromParameter)/(entry.edge.toParameter-entry.edge.fromParameter));
    if(outside&&!allowLowerExterior)for(const [axis,sign] of [[1,-1],[2,1]] as const){const slope=direction[axis]*sign,offset=(from[axis]-shoulder[axis])*sign;if(slope===0){if(offset<=0)high=low;}else if(slope>0)low=Math.max(low,-offset/slope);else high=Math.min(high,-offset/slope);}
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
   :this.openingGrip(limb,phase,pose)??this.preferredGrip(limb,phase,pose)??(
    this.definition.version===16&&this.definition.forwardHop?.platformTurn&&phase<.42
     ?this.preferredGrip(limb,phase,pose,false,'pool_enter',undefined,true):undefined);
  if(!state)throw new Error('Pool source has no forward/reachable actual grip: '+limb+' '+phase);
  this.grips.set(key,state);return state;
 }
 private transferGrip(limb:PoolHand,phase:number,pose:ReturnType<PoolCycleSource['body']>['pose']):PoolLimbState {
  const spec=this.definition;
  if(spec.version!==16)throw new Error('Pool regrip needs the staged support clock.');
  const replant=spec.crestRoute.handTransferUnits[3]/spec.clockUnits;
  const [plant,landing]=spec.crestRoute.rightStepUnits.map(unit=>unit/spec.clockUnits);
  const slot=limb==='handL'?0:1;
  let outside:number|undefined;
  if(phase<replant||limb==='handR'&&phase<plant){
   const beginning=this.body(.42);
   const reference=this.crestLeadingReference??beginning.intent;
   outside=this.crestGripParameters(.42,reference)[slot];
   if(phase<=replant)return this.crestGrip(limb,phase,pose,outside,this.placeBody(reference));
  }
  const plantIntent=this.anchorIntent(spec.anchors.find(anchor=>anchor.unit===spec.crestRoute.rightStepUnits[0])!);
  const interior=this.crestGripParameters(plant,plantIntent)[slot];
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
  const parameter=mix(limb==='handL'?this.replantParameter!:outside!,interior,smooth((phase-replant)/(plant-replant)));
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
 private fittedPaddleArm(limb:PoolHand,phase:number,pose:ReturnType<PoolCycleSource['body']>['pose'],bounds:ReturnType<typeof poolWaterBounds>):PoolLimbState {
  const a=this.anatomy[limb],orientation=properPoolRotation(multiply(pitch(this.definition.paddle.handPitchDegrees),this.neutral.rest[a.end]));
  return poolPaddleArm(bounds,limb,phase,point(pose.world[a.upper]),this.limbReach[limb],orientation,a.completeHandCoefficients!,this.paddleElbowLimit[limb]);
 }
 private insetPaddleTranslation?:Vec3;
 private fittedStroke(stroke:PoolWaterStrokeDefinition,phase:number,action:'pool_enter'|'pool_paddle'):PoolPoseProgram {
  const pose=this.rawFittedStroke(stroke,phase,action);
  if(!this.definition.dryBay)return pose;
  this.insetPaddleTranslation??=insetPaddleOffset(this,p=>this.rawFittedStroke(stroke,p,'pool_paddle'));
  return translateInsetPaddle(this,pose,this.insetPaddleTranslation);
 }
 private rawFittedStroke(stroke:PoolWaterStrokeDefinition,phase:number,action:'pool_enter'|'pool_paddle'):PoolPoseProgram {
  if(!this.waterFit){
   const body=this.body(1),bounds=poolWaterBounds(this.fixture);
   const airwayRise=poolStrokeAirwayRise(this.geometry[0],this.cages[0],body.pose.world,this.neutral.inverse,bounds.surface,stroke.airwayFreeboardFraction);
   const rise=this.definition.version===16?poolPaddleTorsoRise(this.geometry[0],
    posedCageSurface(this.geometry[0],this.cages[0],poolSkinMatrices(body.pose.world,this.neutral.inverse)),bounds.surface,airwayRise):airwayRise;
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
   if(this.definition.version===16){
    const state=this.fittedPaddleArm(limb,phase,pose,bounds);
    controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],state});
    continue;
   }
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
  const spec=this.definition;
  if(spec.version===16&&phase===.94)return this.fittedPaddleArm(limb,0,body.pose,poolWaterBounds(this.fixture));
  const neutral=this.neutralHand(limb,body),approach=spec.hand.approach,release=spec.hand.release[limb];
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
 private numericAttachment(l:PoolHand,phase:number,g:NumericGrasp,expected:{target?:Vec3;orientation?:readonly number[]},work=this.numericWork,action='pool_enter'){
  const rail=this.gripRail(l,phase,work,action),attached={source:rail.location,geometry:rail.physical,parameter:g.parameter,rawOrientation:g.rawOrientation,activeVertex:g.activeVertex};
  work?.reserve('resolve literal numeric wrist '+l,{expansions:1});
  const frame=requireLiteralPoolRailFrame(attached,expected);
  return {attached,target:frame.translation,orientation:frame.orientation};
 }
 /** Rebuild a maintained physical grasp on this phase's complete fixture support record. */
 heldClimbWrist(limb:PoolHand,action:string,phase:number,previous:PoolLimbState):PoolLimbState {
  const g=previous.attached,record=poolSourceRecord(this.fixture,{action,phase}).limbs[limb];
  if(!g||g.source.limb!==limb||g.geometry.surface!==record.surface||!poolSourcePolicy(this.fixture,action,phase)[limb].required)
   throw new Error('A maintained pool grasp requires its matching rail and hand at this phase.');
  const grasp={surface:g.geometry.surface,parameter:g.parameter,rawOrientation:g.rawOrientation,activeVertex:g.activeVertex};
  return {...this.numericAttachment(limb,phase,grasp,previous,this.numericWork,action),pole:previous.pole};
 }
 outwardRail(limb:PoolHand,unit:number):PoolPreparedRailGeometry {
  return this.gripRail(limb,unit/this.definition.clockUnits,this.numericWork,'pool_exit_0').physical;
 }
 alignDescendingWrist(limb:PoolHand,unit:number,previous:PoolLimbState,shoulder:Vec3):PoolLimbState {
  const g=previous.attached,action='pool_exit_0',phase=unit/this.definition.clockUnits;
  if(!g)throw new Error('The sloping rail requires an installed palm.');
  const rail=this.gripRail(limb,phase,this.numericWork,action),edge=rail.physical.edges.find(e=>g.parameter>=e.edge.fromParameter&&g.parameter<=e.edge.toParameter);
  if(!edge)throw new Error('The descending wrist lost its finite rail facet.');
  const {raw}=this.gripRailReference(rail,edge,shoulder);
  // Either transverse direction lies across the tube. Keep the one which
  // continues the installed wrist rather than rolling 180 degrees at a vertical tangent.
  const alternate=properPoolRotation(multiply([1,0,0,0,0,-1,0,0,0,0,-1,0,0,0,0,1],raw));
  const distance=(m:readonly number[])=>m.reduce((sum,v,i)=>sum+(v-g.rawOrientation[i])**2,0);
  const orientation=distance(alternate)<distance(raw)?alternate:raw;
  const grasp={surface:rail.physical.surface,parameter:g.parameter,rawOrientation:orientation,activeVertex:g.activeVertex};
  return {...this.numericAttachment(limb,phase,grasp,{},this.numericWork,action),pole:previous.pole};
 }
 slideClimbWrist(limb:PoolHand,unit:number,previous:PoolLimbState,parameter:number,pole:Vec3):PoolLimbState {
  const g=previous.attached,phase=unit/this.definition.clockUnits,action='pool_exit_0';
  const p=poolSourcePolicy(this.fixture,action,phase)[limb];
  if(!g||!p.required||p.surface!==g.geometry.surface||g.source.limb!==limb)throw new Error('The sliding wrist must remain on its declared rail.');
  const grasp={surface:g.geometry.surface,parameter,rawOrientation:g.rawOrientation,activeVertex:g.activeVertex};
  return {...this.numericAttachment(limb,phase,grasp,{},this.numericWork,action),pole};
 }
 /** Geometry capture for the bounded v16 diagnostic. It never requests a candidate body, entry, first-rung fit or nominal crest. */
 captureNumericExterior(raw:readonly NumericStageRequest[],work:PoolTrialWork,opening?:PoolOpeningRequest,fitPlatformGrips=false):NumericProposalInput {
  return this.captureParsedNumericExterior(parseNumericStages(raw,this.definition,this.fixture,work,opening),work,fitPlatformGrips);
 }
 captureParsedNumericExterior(parsed:ParsedNumericStages,work:PoolTrialWork,fitPlatformGrips=false):NumericProposalInput {
  const stages=readParsedStages(parsed,this.definition,this.fixture);
  const spec=this.definition;
  if(spec.version!==16)throw new Error('Numeric exterior preparation requires v16.');
  const ground=spec.groundGrip;
  const upright=point(this.neutral.world[this.hip]),foot=this.foot('footR','ground',work);
  const groundAnchor=this.definition.anchors.find(a=>a.unit===ground.acquisitionUnit);
  if(!groundAnchor)throw new Error('Pool motion lacks its acquisition anchor.');
  const nominal:NumericBody={hips:[...spec.ground.pelvisXY,foot.target[2]+upright[2]-this.neutral.world[this.anatomy.footR.end][14]],
   hipPitch:0,trunkPitch:groundAnchor.trunkPitchDegrees,headPitch:groundAnchor.trunkPitchDegrees?10:0};
  const shape=(body:NumericBody):NumericPoseShape=>{
   work.reserve('place a configured numerical body',{expansions:1});
   // Joint and elbow offsets belong to the configured shape, independent of the stance's world position.
   const p=this.placeBody({...body,hips:[0,0,0]}),pelvis=point(p.world[this.hip]);
   const off=(l:PoolLimb)=>sub(point(p.world[this.anatomy[l].upper]),pelvis);
   const elbow=(l:PoolHand)=>sub(this.elbow(l,p),point(p.world[this.anatomy[l].upper]));
   return {offsets:{footL:off('footL'),footR:off('footR'),handL:off('handL'),handR:off('handR')},
    elbows:{handL:elbow('handL'),handR:elbow('handR')}};
  };
  const edges=(l:PoolHand,phase:number,domain:readonly [number,number]|null,maintained?:NumericGrasp):NumericRailEdge[]=>{
   if(!domain)return [];
   const rail=this.gripRail(l,phase,work),[lo,hi]=domain,out:NumericRailEdge[]=[];
   for(const edge of rail.physical.edges){
    const single=lo===hi;
    if(single&&(lo<edge.edge.fromParameter||lo>edge.edge.toParameter))continue;
    const from=single?edge.edge.fromParameter:Math.max(edge.edge.fromParameter,lo),to=single?edge.edge.toParameter:Math.min(edge.edge.toParameter,hi);
    if(from>=to)continue;
    const addFrame=(raw:readonly number[],frame:ReturnType<typeof resolvePoolRailContactFrame>,side:number|null)=>{
     const index=rail.physical.vertices.indexOf(frame.activeVertex);
     const c=rail.physical.coefficients[index][3],w=Number(c.numerator)*2**c.exponent;
     if(!(w>0)||!Number.isFinite(w))throw new Error('Invalid configured palm coefficient.');
     const full=scale(sub(edge.to,edge.from),1/w),origin=vector(edge.from.map((v,i)=>frame.translation[i]+(v-frame.targetPoint[i])/w));
     const width=edge.edge.toParameter-edge.edge.fromParameter;
     out.push({surface:rail.physical.surface,from,to,...(single?{onlyParameter:lo}:{}),frameY:edge.from[1],side,rawOrientation:[...raw],activeVertex:frame.activeVertex,
      origin:add(origin,scale(full,(from-edge.edge.fromParameter)/width)),direction:scale(full,(to-from)/width)});
    };
    if(maintained){
     // The shoulder side chooses an authored preference. A held palm already has its exact rotation.
     if(rail.physical.surface!==maintained.surface)throw new Error('Opening slide changed the acquired rail surface.');
     work.reserve('certify acquired '+l+' orientation on its destination facet',{expansions:1});
     const parameter=single?lo:from+(to-from)/2;
     try{
      const frame=resolvePoolRailContactFrame(rail.physical,maintained.rawOrientation,parameter,maintained.activeVertex,rail.location);
      addFrame(maintained.rawOrientation,frame,null);
     }catch(error){if(!(error instanceof PoolTrialRefusal))throw error;}
    }else for(const side of [-1,0,1]){
     work.reserve('prepare finite '+l+' rail frame',{expansions:1});
     try{
      const {raw,frame}=this.gripRailReference(rail,edge,[edge.from[0],edge.from[1]+side,edge.from[2]],work);
      addFrame(raw,frame,side);
     }catch(error){if(!(error instanceof PoolTrialRefusal))throw error;}
    }
   }
   return out;
  };
  const footGoal=(l:PoolFoot,place:string):NumericFootGoal=>{
   const g=this.foot(l,place,work);if(!g.support.surface)throw new Error('Pool numerical sole has no physical surface.');
   return {place,surface:g.support.surface,target:[...g.target],orientation:[...g.orientation]};
  };
  const phase=ground.acquisitionUnit/spec.clockUnits,acquireEdges={handL:edges('handL',phase,stages[0].regions.handL),handR:edges('handR',phase,stages[0].regions.handR)};
  work.reserve('place the neutral acquisition preference',{expansions:1});
  const acquirePose=this.placeBody(nominal),wrists={} as Record<PoolHand,NumericGrasp>;
  let ordinary=true;
  for(const l of numericHands){
   const p=point(acquirePose.world[this.anatomy[l].upper]);
   const g=numericalWrist(l,p,this.limbReach[l],acquireEdges[l],work,undefined,undefined,true);
   if(g)wrists[l]=g;else ordinary=false;
  }
  let body=nominal;
  if(!ordinary){
   work.reserve('place acquisition fallback',{expansions:1});const posed=this.placeBody(nominal);
   const targets={} as Record<PoolLimb,Vec3>;
   for(const l of numericHands){
    const p=point(posed.world[this.anatomy[l].upper]),parameter=stages[0].regions[l]![1];
    const e=acquireEdges[l].find(e=>(e.to===parameter||e.onlyParameter===parameter)&&e.side===Math.sign(p[1]-e.frameY));
    if(!e)throw new PoolTrialRefusal('No usable exterior acquisition edge for '+l);
    wrists[l]={surface:e.surface,parameter,rawOrientation:e.rawOrientation,activeVertex:e.activeVertex};
    targets[l]=this.numericAttachment(l,phase,wrists[l],{},work).target;
   }
   for(const l of numericFeet)targets[l]=this.foot(l,'ground',work).target;
   const cs=(['handL','handR','footL','footR'] as const).map(l=>({limb:l,reach:this.limbReach[l],center:sub(targets[l],point(posed.world[this.anatomy[l].upper]))}));
   const offset=numericalGroundOffset(cs,nominal.hips[2]-Math.max(targets.footL[2],targets.footR[2]),work);
   if(!offset)throw new PoolTrialRefusal('Both grounds and both acquisition grips have no common pelvis placement.');
   body={...nominal,hips:add(nominal.hips,offset)};
  }
  work.reserve('resolve both numerical acquisition attachments',{expansions:1});
  const author=this.placeBody(body),placed=poolIntervalPreference(this.bundle,author.rest,author.inverse,author.basis,author.basis,0,true);
  const hands={} as NumericProposalInput['acquisition']['hands'];
  for(const l of numericHands){
   const shoulder=point(placed.world[this.anatomy[l].upper]);
   const g=ordinary?numericalWrist(l,shoulder,this.limbReach[l],acquireEdges[l],work,undefined,undefined,true):wrists[l];
   if(!g)throw new PoolTrialRefusal('The configured acquisition basis has no reachable '+l);
   const actual=this.numericAttachment(l,phase,g,{},work);
   if(!poolChainReachable(this.limbReach[l],shoulder,actual.target))throw new PoolTrialRefusal('Configured acquisition cannot reach '+l);
   const elbow=ordinary?this.elbow(l,placed):add(shoulder,scale(this.exteriorCrestNormal(),this.limbReach[l].lengths[0]));
   hands[l]={grasp:g,poleOffset:sub(elbow,shoulder),heldTarget:[...actual.target],heldOrientation:[...actual.orientation]};
  }
  const configured:NumericKnotChoices[]=stages.map(stage=>{
   work.reserve('capture selected exterior knot',{expansions:1});
   const p=stage.unit/spec.clockUnits,sliding=stage.role==='second-rung'&&(parsed.opening?.flight.kind==='second-exterior-step'||!!parsed.opening?.next);
   const stageEdges=(hand:PoolHand)=>{
    if(p===phase)return acquireEdges[hand];
    // A crest literal is certified only after its complete stance chain has been selected.
    return stage.role==='crest-leading'?[]:edges(hand,p,stage.regions[hand],sliding?hands[hand].grasp:undefined);
   };
   const feet={footL:footGoal('footL',stage.places.footL),footR:footGoal('footR',stage.places.footR)};
   const railEdges={handL:stageEdges('handL'),handR:stageEdges('handR')};
   return {unit:stage.unit,role:stage.role,feet,edges:railEdges,
    choices:stage.choices.map(c=>{
     let configuredBody=c.body??body;const skeleton=shape(configuredBody);
     const held=(hand:PoolHand)=>{
      if(stage.role==='first-rung')return hands[hand].heldTarget;
      const command=c.hands[hand];
      if(!sliding||command.kind!=='rail'||!command.keepFrame||command.parameter===undefined)return undefined;
      const at=command.parameter,edge=railEdges[hand].find(e=>e.side===null&&at>=e.from&&at<=e.to);
      return edge&&add(edge.origin,scale(edge.direction,(at-edge.from)/(edge.to-edge.from)));
     };
     const handL=held('handL'),handR=held('handR');
     if(fitPlatformGrips&&spec.forwardHop?.platformTurn&&c.relativeToUnit===undefined&&handL&&handR){
      const targets={footL:feet.footL.target,footR:feet.footR.target,handL,handR};
      const limits=([...numericFeet,...numericHands] as PoolLimb[]).map(limb=>({
       limb,center:sub(sub(targets[limb],skeleton.offsets[limb]),configuredBody.hips),reach:this.limbReach[limb]}));
      if(limits.some(v=>!poolChainReachable(v.reach,[0,0,0],v.center))){
       const toward=scale(add(limits[2].center,limits[3].center),.5);
       const directions:Vec3[]=stage.role==='second-rung'?[[0,0,1],toward]:[toward];
       for(const direction of directions){
        if(!length(direction))continue;
        work.reserve('fit held wrists and installed soles on the wider ladder',{expansions:1});
        const valid=poolRootRayIntervals(direction,limits)[0];
        if(!valid)continue;
        configuredBody={...configuredBody,hips:add(configuredBody.hips,scale(direction,valid.minimum+(valid.maximum-valid.minimum)/4))};
        break;
       }
      }
     }
     return {...c,body:configuredBody,shape:skeleton};
    })};
  });
  const opening=parsed.opening;
  const flight=opening?this.captureOpeningGeometry(opening,work):undefined;
  return structuredClone({acquisition:{body,hands,branch:ordinary?'ordinary':'fallback'},reach:this.limbReach,stages:configured,parameterDomain:spec.hand.outsideBranch,...(flight?{opening:flight}:{})});
 }

 captureOpeningGeometry(opening:ParsedOpening,work:PoolTrialWork):OpeningGeometry {
   work.reserve('measure selected opening foot envelope',{expansions:1});
   const l=opening.flight.limb,from=this.foot(l,opening.flight.from,work),to=this.foot(l,opening.flight.to,work);
   const edge=Math.max(...this.fixture.solids.map(s=>s.bounds[1][1])),gap=2*this.fixture.rails[0].radius;
   const corridorY=Math.max(...this.anatomy[l].surfaceCoefficients.map(c=>(edge+gap-poolSurfacePoint(from.orientation,c)[1])/c[3]));
   if(!Number.isFinite(corridorY)||!(from.lift>0&&to.lift>0))throw new Error('Opening foot has invalid configured clearance geometry.');
   const {next,...segment}=opening;
   return {...segment,departureLift:from.lift,arrivalLift:to.lift,corridorY,...(next?{next:this.captureOpeningGeometry(next,work)}:{})};
 }

 materializeExteriorToe(start:PoolPoseProgram,contract:ExteriorToe,unitAt:number,work:PoolTrialWork):PoolPoseProgram {
  if(unitAt===contract.startUnit)return start;
  if(unitAt!==contract.firstUnit&&unitAt!==contract.secondUnit)throw new Error('Toe knot is not declared by the selected route.');
  work.reserve('construct selected outgoing toe '+unitAt,{expansions:1});
  const phase=unitAt/this.definition.clockUnits,amount=(unitAt-contract.startUnit)/(contract.releaseEnd-contract.startUnit);
  const a=this.anatomy.footL,goal=this.foot('footL',contract.place,work),crest=this.foot('footR','crest',work);
  if(!same(start.controls[0].state.target,goal.target)||!same(start.controls[1].state.target,crest.target))throw new Error('Toe release lost its installed feet.');
  const edge=Math.max(...this.fixture.solids.map(s=>s.bounds[1][1])),radius=this.fixture.rails[0].radius;
  const clear=Math.max(...a.surfaceCoefficients.map(c=>(edge+2*radius-poolSurfacePoint(goal.orientation,c)[1])/c[3]));
  const dy=clear-goal.target[1],normal=unit(this.exteriorCrestNormal());
  if(!Number.isFinite(dy)||dy<=0||normal[1]<=0||goal.lift<=0)throw new Error('Invalid measured toe withdrawal.');
  const travel=add(scale(normal,dy*amount),[0,0,goal.lift*contract.liftScale*amount*amount]);
  const basis=start.preferenceBasis.map(clonePoolMatrix),{bundle,neutral:{rest,inverse}}=this;
  const pose={bundle,rest,inverse,basis,world:composeSkeletonPose(bundle.bones,rest,basis)};
  translatePoolRoot(pose,travel);
  const controls=start.controls.map((c,i)=>{
   const held=c.state;
   if(i===0)return {...c,state:{...held,target:add(goal.target,travel),pole:add(held.pole,travel)}};
   if(i===1)return {...c,state:{...held,pole:point(pose.world[c.lower])}};
   const l=i===2?'handL':'handR',g=held.attached;if(!g)throw new Error('Toe release has no literal wrist.');
   const actual=this.exactGrip(this.gripRail(l,phase,work),pose,g.parameter,g.rawOrientation,g.activeVertex,work);
   if(!same(actual.target,held.target)||!same(actual.orientation,held.orientation))throw new Error('Outgoing toe moved a held wrist.');
   return {...c,state:{...actual,pole:add(held.pole,travel)}};
  });
  return makePoolPoseProgram(basis,controls,poolSourcePolicy(this.fixture,'pool_enter',phase));
 }

 preparePlantedStep(segment:ParsedOpening,knots:readonly NumericKnot[],work:PoolTrialWork):PlantedStep {
  const {startUnit:fromUnit,endUnit:toUnit,limb:moving}=segment.flight,limb=moving==='footR'?'footL':'footR';
  const path=this.definition.plantedBodyPaths.find(p=>p.fromUnit===fromUnit&&p.toUnit===toUnit&&p.limb===limb);
  if(!path)throw new Error('Missing configured exterior planted body path.');
  const a=this.anatomy[limb],goal=this.foot(limb,path.place,work);
  const frame=this.frame(limb,goal.support,[goal.target[0],goal.target[1]],work);
  const endpoint=(unit:number):PlantedEndpoint=>{
   work.reserve('solve selected planted endpoint '+unit+' '+limb,{expansions:1});
   const knot=knots.find(k=>k.unit===unit),foot=knot?.feet[limb];
   if(!knot||!foot||'flight' in foot||foot.place!==path.place||!same(foot.target,goal.target)||!same(foot.orientation,goal.orientation))
    throw new Error('Selected planted endpoint differs from its installed sole.');
   const pose=this.placeBody(knot.body);
   if(segment.flight.kind==='crest-landing-step'&&unit===toUnit){
    for(const hand of numericHands){
     const arm=knot.hands[hand];
     if(!('grasp' in arm))throw new Error('Selected crest wrist has no acquired rail.');
     const g=arm.grasp,rail=this.gripRail(hand,unit/this.definition.clockUnits,work);
     if(g.surface!==rail.physical.surface)throw new Error('Selected crest wrist has a different rail surface.');
     work.reserve('certify selected crest literal '+hand,{expansions:1});
     const actual=resolvePoolRailContactFrame(rail.physical,g.rawOrientation,g.parameter,g.activeVertex,rail.location);
     const shoulder=point(pose.world[this.anatomy[hand].upper]);
     if(!numericLimbReachable(this.limbReach[hand],shoulder,actual.translation))throw new PoolTrialRefusal('Selected crest wrist cannot reach its chosen rail: '+hand);
    }
   }
   if(!numericLimbReachable(this.limbReach[limb],point(pose.world[a.upper]),goal.target))throw new PoolTrialRefusal('Selected planted leg cannot reach '+unit);
   const plan=solvePoolOrientedFoot(pose,a.upper,a.lower,a.end,frame);
   observeConstructedPoolLeg(pose,frame,plan);
   const rotation=[...pose.world[this.hip]];rotation.splice(12,3,0,0,0);
   return {upper:[...pose.basis[a.upper]],lower:[...pose.basis[a.lower]],hipRotation:rotation,branch:plan.branch};
  };
  const railRecord=(unit:number,hand:PoolHand)=>{
   const arm=knots.find(k=>k.unit===unit)?.hands[hand];
   if(!arm||!('grasp' in arm))throw new Error('Selected planted path is missing a wrist attachment.');
   if(segment.flight.kind!=='crest-landing-step'||unit!==toUnit)
    this.numericAttachment(hand,unit/this.definition.clockUnits,arm.grasp,{target:arm.heldTarget,orientation:arm.heldOrientation},work);
   return arm.grasp;
  };
  const first=endpoint(fromUnit),last=endpoint(toUnit);
  for(const hand of numericHands){
   const first=railRecord(fromUnit,hand),last=railRecord(toUnit,hand);
   if(first.surface!==last.surface||first.activeVertex!==last.activeVertex)
    throw new PoolTrialRefusal('Selected exterior path needs a different physical palm contact: '+hand);
  }
  if(!same(first.hipRotation,last.hipRotation)||first.branch!==last.branch)throw new PoolTrialRefusal('Selected exterior planted endpoints have incompatible pelvis rotation or knee branch.');
  const chain=(parent:number,child:number)=>multiply(this.neutral.inverse[parent],this.neutral.rest[child]);
  return {first,last,fromUnit,toUnit,sole:[...goal.target],hipToUpper:chain(this.hip,a.upper),upperToLower:chain(a.upper,a.lower),lowerToEnd:chain(a.lower,a.end)};
 }

 /** Materialize only detached commands. Phase-owned frames and the pre-control basis belong to this source. */
 materializeNumericKnot(knot:NumericKnot,fittedCrest=false):PoolPoseProgram {
  if(this.definition.version!==16)throw new Error('Invalid numeric pool version.');
  validateNumericKnot(knot,this.definition.clockUnits,this.definition.hand.outsideBranch);
  const phase=knot.unit/this.definition.clockUnits,loc={action:'pool_enter',phase},body=this.placeBody(knot.body);
  if(fittedCrest&&knot.unit!==this.definition.crestRoute.sampleUnits[0])throw new Error('Fitted crest control pose needs its literal landing.');
  const controlPose=fittedCrest?poolIntervalPreference(this.bundle,body.rest,body.inverse,body.basis,body.basis,0,true):body;
  const support=poolSourceRecord(this.fixture,loc).limbs,policy=poolSourcePolicy(this.fixture,loc.action,phase),controls:PoolPoseControl[]=[];
  let unreachable:PoolTrialRefusal|undefined;
  const checkReach=(limb:PoolLimb,upper:Vec3,target:Vec3)=>{
   const reach=this.limbReach[limb];
   if(!numericLimbReachable(reach,upper,target))unreachable??=new PoolTrialRefusal('Cannot reach numeric '+(limb.startsWith('foot')?'sole ':'wrist ')+limb,
    {cause:{unit:knot.unit,limb,upper,target,distance:length(sub(upper,target)),minimum:reach.minimum,maximum:reach.maximum}});
  };
  for(const l of numericFeet){
   const goal=knot.feet[l],a=this.anatomy[l];
   if('flight' in goal){
    requireOpeningDefinition(goal.flight,this.definition);openingPolicy(goal.flight,this.fixture,this.definition,phase);
    if(l!==goal.flight.limb||policy[l].required||knot.unit<=goal.flight.startUnit||knot.unit>=goal.flight.endUnit)
     throw new Error('Numeric free sole contradicts its transfer or phase: '+l);
    if(!same(goal.orientation,this.flatFeet[l]))throw new Error('Opening sole rotation differs from its installed foot.');
   }else{
    if(!policy[l].required||support[l].surface!==goal.surface)throw new Error('Numeric sole does not match this phase: '+l);
    const place=heldPlace(this.definition,l,knot.unit);
    if(place!==goal.place)throw new Error('Numeric sole differs from the declared place: '+l);
    const installed=this.foot(l,place);
    if(!same(installed.target,goal.target)||!same(installed.orientation,goal.orientation))
     throw new Error('Numeric sole differs from the originally installed sole: '+l);
    const frame=this.frame(l,support[l],[installed.target[0],installed.target[1]]);
    if(!same(frame.translation,goal.target)||!same(frame.orientation,goal.orientation))throw new Error('Numeric sole differs from its installed frame: '+l);
   }
   checkReach(l,point(controlPose.world[a.upper]),goal.target);
   controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],legFrame:'source-entry-0',
    state:{target:goal.target,orientation:goal.orientation,pole:point(controlPose.world[a.lower])}});
  }
  for(const l of numericHands){
   const h=knot.hands[l],a=this.anatomy[l],shoulder=point(controlPose.world[a.upper]);
   let state:PoolLimbState;
   if('freeTarget' in h){
    if(policy[l].required)throw new Error('Numeric free wrist contradicts required support: '+l);
    state={target:h.freeTarget,orientation:h.orientation,pole:add(shoulder,h.poleOffset)};
   }else{
    if(!policy[l].required||support[l].surface!==h.grasp.surface)throw new Error('Numeric wrist contradicts the active rail record: '+l);
    const actual=this.numericAttachment(l,phase,h.grasp,{target:h.heldTarget,orientation:h.heldOrientation});
    state={...actual,pole:add(shoulder,h.poleOffset)};
   }
   checkReach(l,shoulder,state.target);
   controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],state});
  }
  if(unreachable)throw unreachable;
  return makePoolPoseProgram(body.basis,controls,policy);
 }
 /** Approach the selected first grasp from the actual standing pose on the authored opening clock. */
 acquireFromStanding(unitAt:number,acquisition:NumericKnot,arrived:PoolPoseProgram):PoolPoseProgram {
  const spec=this.definition;
  if(spec.version!==16||acquisition.unit!==spec.groundGrip.acquisitionUnit||unitAt<0||unitAt>acquisition.unit)throw new Error('Invalid selected pool acquisition range.');
  if(unitAt===acquisition.unit)return arrived;
  const phase=unitAt/spec.clockUnits,weight=smooth(unitAt/acquisition.unit);
  const standing=this.anchorIntent(spec.anchors[0]),chosen=acquisition.body;
  const intent:BodyIntent={hips:lerp(standing.hips,chosen.hips,weight),hipPitch:mix(standing.hipPitch,chosen.hipPitch,weight),
   trunkPitch:mix(standing.trunkPitch,chosen.trunkPitch,weight),headPitch:mix(standing.headPitch,chosen.headPitch,weight)};
  const basis=this.placeBody(intent),body={intent,basis:basis.basis,pose:poolIntervalPreference(this.bundle,basis.rest,basis.inverse,basis.basis,basis.basis,0,true)};
  const controls:PoolPoseControl[]=[],policy=poolSourcePolicy(this.fixture,'pool_enter',phase);
  for(const limb of numericFeet){
   const a=this.anatomy[limb],foot=this.foot(limb,'ground');
   controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],legFrame:'source-entry-0',state:{target:foot.target,orientation:foot.orientation,pole:point(body.pose.world[a.lower])}});
  }
  const [start,end]=spec.hand.approach;
  for(const limb of numericHands){
   const a=this.anatomy[limb],neutral=this.neutralHand(limb,body),selected=arrived.controls.find(c=>c.end===a.end)?.state;
   if(!selected?.attached||policy[limb].required||end!==acquisition.unit/spec.clockUnits)throw new Error('Selected wrist approach contradicts its authored acquisition.');
   const t=clamp((phase-start)/(end-start),0,1);
   const state=t===0?neutral:{target:lerp(neutral.target,selected.target,t),pole:lerp(neutral.pole,selected.pole,t),orientation:rotationMix(neutral.orientation,selected.orientation,t)};
   controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],state});
  }
  return makePoolPoseProgram(body.basis,controls,policy);
 }

 /** Rebuild detached route controls against this source's installed soles and rail facets. */
 materializeSelectedKnot(knot:SelectedPoolKnot,action:'pool_enter'|'pool_exit_0'='pool_enter'):PoolPoseProgram {
  const phase=knot.unit/this.definition.clockUnits,location={action,phase};
  const policy=poolSourcePolicy(this.fixture,location.action,phase),controls:PoolPoseControl[]=[];
  if(knot.rotationInputs.length!==this.bundle.bones.length||Object.keys(knot.limbs).sort().join()!=='footL,footR,handL,handR')
   throw new Error('Selected pool knot has the wrong configured hierarchy or limb set.');
  finiteRow(knot.rootTravel,3,'selected root travel');
  const basis=knot.rotationInputs.map((input,i)=>{
   finiteRow(input,16,'pre-control rotation input');
   const rotation=properPoolRotation(input);
   if(i===0){rotation.splice(12,3,...knot.rootTravel);registerPoolRootTravel(rotation);}
   return rotation;
  });
  const pose=poolIntervalPreference(this.bundle,this.neutral.rest,this.neutral.inverse,basis,basis,0,true);
  for(const limb of [...numericFeet,...numericHands]){
   const s=knot.limbs[limb],a=this.anatomy[limb],p=policy[limb];
   finiteRow(s.target,3,'selected limb target');finiteRow(s.pole,3,'selected limb pole');rotationInput(s.orientation,'selected limb orientation');
   const foot=limb==='footL'||limb==='footR';
   validatePoolKneeOrbit(s.kneeOrbit,foot);
   let state:PoolLimbState={target:s.target,pole:s.pole,orientation:s.orientation,...(s.kneeOrbit===undefined?{}:{kneeOrbit:s.kneeOrbit})};
   if(foot){
    if(s.grasp)throw new Error('Selected foot has an arm attachment.');
    const place=action==='pool_enter'?heldPlace(this.definition,limb,knot.unit):Object.entries(this.definition.places).find(([,spec])=>spec.surface===p.surface)?.[0];
    if(p.required){
     if(!place||this.definition.places[place]?.surface!==p.surface||p.region?.kind!=='top-face'||
       canonicalPoolValue(p.region)!==canonicalPoolValue(installedPoolSupport(this.fixture,p.surface!).region))
      throw new Error('Selected foot differs from its declared support at '+knot.unit);
     const installed=action==='pool_enter'?this.foot(limb,place):this.primaryExitFoot(limb,place,knot.unit);
     if(!same(s.target,installed.target)||!same(s.orientation,installed.orientation))throw new Error('Selected foot differs from its installed sole at '+knot.unit);
    }
   }else if(p.required){
    if(!s.grasp||p.region?.kind!=='rail'||p.surface!==s.grasp.surface)throw new Error('Selected wrist lost its declared rail at '+knot.unit);
    graspInput(s.grasp,p.region.parameter);
    state={...this.numericAttachment(limb,phase,s.grasp,{target:s.target,orientation:s.orientation},this.numericWork,action),pole:s.pole};
   }else if(s.grasp)throw new Error('Selected free wrist unexpectedly remains attached.');
   if(!numericLimbReachable(this.limbReach[limb],point(pose.world[a.upper]),state.target))
    throw new PoolTrialRefusal('Selected pool control cannot reach '+limb+' at '+knot.unit);
   controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],...(foot?{legFrame:'source-entry-0' as const}:{}),state});
  }
  return makePoolPoseProgram(basis,controls,policy);
 }

 /** A declared intermediate cut derives its body and commands from the actual two selected endpoint programs. */
 splitSelectedEntry(left:PoolPoseProgram,right:PoolPoseProgram,fromUnit:number,toUnit:number,unit:number,action:'pool_enter'|'pool_exit_0'='pool_enter'):PoolPoseProgram {
  if(unit===fromUnit)return left;if(unit===toUnit)return right;
  if(![fromUnit,toUnit,unit].every(Number.isSafeInteger)||!(unit>fromUnit&&unit<toUnit))throw new Error('Invalid selected pool interval cut.');
  const t=(unit-fromUnit)/(toUnit-fromUnit),phase=unit/this.definition.clockUnits,location={action,phase};
  const policy=poolSourcePolicy(this.fixture,location.action,phase);
  const pose=poolIntervalPreference(this.bundle,this.neutral.rest,this.neutral.inverse,left.preferenceBasis,right.preferenceBasis,t,true);
  const controls=poolIntervalProgramControls(left,right).map(c=>{
   const {from,to,...chain}=c,limb=this.bundle.bones[c.end].name.replace('.','') as PoolLimb;
   let {state}=resolvePoolLimbState(c,t,location);
   if(state.attached){
    if(!policy[limb].required||limb!=='handL'&&limb!=='handR')throw new Error('Unsupported wrist attachment at a selected interval cut.');
    state={...state,attached:{...state.attached,source:{...location,limb}}};
   }else if((limb==='handL'||limb==='handR')&&policy[limb].required)throw new Error('Selected interval cut lacks a required wrist.');
   return {...chain,state};
  });
  return makePoolPoseProgram(pose.basis,controls,policy);
 }

 /** Build any extra water-only cut from the same two selected programs used by the graph. */
 freeWaterKnot(left:PoolPoseProgram,right:PoolPoseProgram,t:number,action:string,phase:number):PoolPoseProgram {
  if(t===0)return left;if(t===1)return right;
  const policy=poolSourcePolicy(this.fixture,action,phase);
  if([...numericFeet,...numericHands].some(l=>policy[l].mode!=='free'))throw new Error('A water bridge unexpectedly requires a contact.');
  const pose=poolIntervalPreference(this.bundle,this.neutral.rest,this.neutral.inverse,left.preferenceBasis,right.preferenceBasis,t,true);
  const controls=poolIntervalProgramControls(left,right).map(({from,to,...chain})=>({
   ...chain,state:resolvePoolLimbState({...chain,from,to},t,{action,phase}).state,
  }));
  return makePoolPoseProgram(pose.basis,controls,policy);
 }

 /** Bind the selected 62380 program once; both incident intervals consume that exact node. */
 withdrawalFrom(start:PoolPoseProgram,landed:NumericBody):(phase:number)=>PoolPoseProgram {
  if(this.definition.version!==16)throw new Error('The selected pool withdrawal requires a water-stroke motion.');
  bodyInput(landed);
  const spec=this.definition,atStart=this.placeBody(landed),from=start.controls;
  if(!atStart.basis.every((m,i)=>same(m,start.preferenceBasis[i])))throw new Error('Selected withdrawal intent differs from its pre-control seam.');
  const canonical=this.entry(poolWithdrawalEnd),swim=this.paddle(0),bounds=poolWaterBounds(this.fixture);
  const stateOf=(p:PoolPoseProgram,l:PoolLimb)=>{
   const c=p.controls.find(c=>c.end===this.anatomy[l].end);
   if(!c)throw new Error('Withdrawal seam lacks the configured '+l);
   return c.state;
  };
  const held={handL:stateOf(start,'handL'),handR:stateOf(start,'handR')};
  if(!held.handL.attached||!held.handR.attached||from.length!==4)throw new Error('Withdrawal must start with both selected literal rail grasps.');
  return phase=>{
   if(!Number.isFinite(phase)||phase<poolWithdrawalStart||phase>1)throw new Error('Pool withdrawal is outside the selected entry path.');
   if(phase===poolWithdrawalStart)return start;
   if(phase===poolWithdrawalEnd)return canonical;
   if(phase===1)return swim;
   if(phase>poolWithdrawalEnd)return this.freeWaterKnot(canonical,swim,(phase-poolWithdrawalEnd)/(1-poolWithdrawalEnd),'pool_enter',phase);
   const nominal=phase<=spec.hand.release.handR[1]?landed:this.body(phase).intent;
   const {intent,freeFootShiftX}=poolWithdrawalBody(phase,landed,nominal,spec.waterCorridor);
   const pose=this.placeBody(intent),policy=poolSourcePolicy(this.fixture,'pool_enter',phase),controls:PoolPoseControl[]=[];
   for(const limb of numericFeet){
    const a=this.anatomy[limb],goal=this.freeFootGoal(limb,phase,intent);
    controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],legFrame:'source-entry-0',
     state:{target:freeFootShiftX?add(goal,[freeFootShiftX,0,0]):goal,pole:point(pose.world[a.lower]),orientation:this.flatFeet[limb]}});
   }
   for(const limb of numericHands){
    const grip=held[limb],a=this.anatomy[limb],shoulder=point(pose.world[a.upper]),release=spec.hand.release[limb];
    let state:PoolLimbState;
    if(phase<=release[0]){
     const g=grip.attached!;
     const actual=this.exactGrip(this.gripRail(limb,phase),pose,g.parameter,g.rawOrientation,g.activeVertex);
     if(!same(actual.target,grip.target)||!same(actual.orientation,grip.orientation))throw new Error('Held withdrawal wrist changed its literal attachment.');
     state=poolHeldWithdrawalHand(actual,grip,point(atStart.world[a.upper]),shoulder);
    }else state=poolFreeWithdrawalHand(phase,{limb,landedGrip:grip,landedHipX:landed.hips[0],release,railRadius:this.fixture.rails[limb==='handL'?0:1].radius,
     shoulder,reach:this.limbReach[limb],palm:a.completeHandCoefficients!,bounds,paddle:stateOf(canonical,limb)});
    if(policy[limb].required!==!!state.attached)throw new Error('Withdrawal wrist differs from its phase-owned support.');
    controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],state});
   }
   return makePoolPoseProgram(pose.basis,controls,policy);
  };
 }

 entry(phase:number):PoolPoseProgram {
  if(phase===1&&this.definition.waterStroke)return this.waterJoin??=this.fittedStroke(this.definition.waterStroke,0,'pool_enter');
  if(phase===.94&&this.definition.version===16)return this.corridorJoin??=this.entryNode(phase);
  return this.entryNode(phase);
 }
 private entryNode(phase:number):PoolPoseProgram {
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
