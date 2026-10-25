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

export type PoolFoot='footL'|'footR';
export type PoolHand='handL'|'handR';
interface Anchor {unit:number;phase:number;name:string;feet:[string,string];body:string;trunkPitchDegrees:number}
interface Transfer {limb:PoolFoot;from:string;to:string;start:number;end:number;startUnit:number;endUnit:number}
export interface PoolCycleDefinition {
 version:9;clockUnits:number;nativeTicks:{enter:number;paddle:number;exit:number;tickHz:number};
 reference:{neutralSample:{basis:number[][]};sourceRigSha256:string};
 ground:{pelvisXY:[number,number];bounds:Vec3[]};anchors:Anchor[];footTransitions:Transfer[];transferPercentages:number[];bodyProgressFraction:number;
 places:Record<string,{surface:string;patch:'front'|'back'|'full'}>;
 legFlexionDegrees:{low:number;high:number;crestLeading:number};
 hand:{approach:[number,number];release:Record<PoolHand,[number,number]>;region:[number,number];outsideBranch:[number,number];crestBranch:[number,number];insideBranch:[number,number]};
 paddle:{centre:Vec3;hipPitchDegrees:number;headPitchDegrees:number;footSoleZ:number;footY:number;kickAmplitude:number;palmY:number;palmZ:number;palmWaveY:number;palmWaveZ:number;palmHalfWidth:number;palmWaveX:number;handPitchDegrees:number;samples:number};
 waterCorridor:{initialCentre:Vec3;finalCentre:Vec3};
}
export function validatePoolCycleDefinition(value:unknown):asserts value is PoolCycleDefinition {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Pool source definition is missing');const source=value as Partial<PoolCycleDefinition>;
 if(source.version!==9||source.clockUnits!==100000||source.nativeTicks?.enter!==20||source.nativeTicks.paddle!==60||source.nativeTicks.exit!==20||source.nativeTicks.tickHz!==10||source.paddle?.samples!==12)throw new Error('Pool source has another native clock');
 if(!Array.isArray(source.anchors)||!source.anchors.length||!Array.isArray(source.footTransitions)||!source.places||!source.hand||!source.legFlexionDegrees||!source.waterCorridor||!source.ground||!source.reference)throw new Error('Pool source is incomplete');
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
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const bounds=(points:readonly Vec3[]):[Vec3,Vec3]=>[vector([0,1,2].map(i=>Math.min(...points.map(p=>p[i])))),vector([0,1,2].map(i=>Math.max(...points.map(p=>p[i]))))];
interface FootGoal {place:string;support:PoolSupport;target:Vec3;orientation:readonly number[];plane:number;bounds:[Vec3,Vec3];height:number;lift:number}
interface BodyIntent {hips:Vec3;hipPitch:number;trunkPitch:number;headPitch:number}

/** This source owns one explicit action recipe; it never searches after observing a failure. */
export class PoolCycleSource {
 readonly neutral;readonly anatomy;readonly cages;readonly rawFeet:Record<PoolFoot,number[]>;readonly flatFeet:Record<PoolFoot,readonly number[]>;
 private readonly footGoals=new Map<string,FootGoal>();private readonly footFrames=new Map<string,ReturnType<typeof preparePoolFootContactFrame>>();private readonly railReferences=new Map<string,PoolRailContactFrame>();private readonly bodies=new Map<number,BodyIntent>();
 private readonly railInputs=new Map<string,PoolPreparedRailGeometry>();private readonly grips=new Map<string,PoolLimbState>();
 private readonly hip:number;private readonly spine:number;private readonly head:number;
 private readonly limbReach;private readonly sourceHands:Record<PoolHand,{wrist:Vec3;elbow:Vec3;rotation:number[]}>;
 constructor(readonly bundle:Bundle,readonly shape:ShapeParameters,readonly top:number,readonly geometry:readonly Geometry[],readonly fixture:PoolFixtureV1,readonly definition:PoolCycleDefinition){
  validatePoolCycleDefinition(definition);
  if(definition.version!==9||definition.nativeTicks.enter!==20||definition.nativeTicks.paddle!==60||definition.nativeTicks.exit!==20||definition.paddle.samples!==12)throw new Error('Pool source differs from its native activity contract.');
  if(canonicalPoolValue(bundle.basisActions.pool_enter[0])!==canonicalPoolValue(definition.reference.neutralSample.basis))throw new Error('Pool source changed its anatomical reference.');
  if(!definition.anchors.length||definition.anchors[0].phase!==0||definition.anchors.at(-1)!.phase!==1||definition.anchors.some((a,i)=>a.phase!==a.unit/definition.clockUnits||i>0&&a.phase<=definition.anchors[i-1].phase))throw new Error('Pool source anchor clock is invalid.');
  this.neutral=canonicalPoolPreference(bundle,shape,top,'pool_enter',0,geometry);this.anatomy=preparePoolEntryAnatomy(geometry[0],shape,top);this.cages=geometry.map(g=>shapeVertices(g.cage,shape,top));
  this.hip=bundle.bones.findIndex(b=>b.name==='hips');this.spine=bundle.bones.findIndex(b=>b.name==='spine');this.head=bundle.bones.findIndex(b=>b.name==='head');
  this.rawFeet={footL:properPoolRotation(this.neutral.rest[this.anatomy.footL.end]),footR:properPoolRotation(this.neutral.rest[this.anatomy.footR.end])};
  this.limbReach=Object.fromEntries((['footL','footR','handL','handR'] as const).map(limb=>{const a=this.anatomy[limb];return [limb,configuredPoolChainReach(this.neutral.rest,a.upper,a.lower,a.end)];})) as Record<PoolLimb,ReturnType<typeof configuredPoolChainReach>>;
  this.flatFeet={footL:this.foot('footL','ground').orientation,footR:this.foot('footR','ground').orientation};
  const inverse=inverseAffine(this.neutral.world[this.spine]);
  this.sourceHands=Object.fromEntries((['handL','handR'] as const).map(limb=>{const a=this.anatomy[limb];return [limb,{wrist:transform(inverse,point(this.neutral.world[a.end])),elbow:transform(inverse,point(this.neutral.world[a.lower])),rotation:properPoolRotation(multiply(inverse,this.neutral.world[a.end]))}];})) as typeof this.sourceHands;
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
  const full=bounds(a.surfaceCoefficients.map(c=>poolSurfacePoint(matrix,c)));let ceiling=Infinity;
  for(const obstacle of this.fixture.solids)if(obstacle.id!==support.surface)for(const triangle of obstacle.triangles){
   const points=triangle.map(i=>obstacle.vertices[i]),n=cross(sub(points[1],points[0]),sub(points[2],points[0]));if(n[2]>=0||n[0]!==0||n[1]!==0||points[0][2]<=frame.planeHeight)continue;
   const b=bounds(points);if(b[0][0]<full[1][0]&&b[1][0]>full[0][0]&&b[0][1]<full[1][1]&&b[1][1]>full[0][1])ceiling=Math.min(ceiling,points[0][2]);
  }
  const maxW=Math.max(...rows.map(r=>r.w)),lift=Math.min(.25/4,(ceiling-full[1][2])/(2*maxW));if(!(lift>0))throw new Error('Complete configured foot has no withdrawal height: '+limb+' '+place);
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
    const limb:PoolFoot=left.plane<right.plane?'footL':'footR',goal=limb==='footL'?left:right,y=(left.target[1]+right.target[1])/2,o=offset(limb),r=this.chord(limb,spec.legFlexionDegrees.low),dx=goal.target[0]-x-o[0],dy=goal.target[1]-y-o[1],vertical=r*r-dx*dx-dy*dy;if(vertical<=0)throw new Error('Pool descent source has no real planted height');hips=[x,y,goal.target[2]+Math.sqrt(vertical)-o[2]];
   }else {
    const lowLeft=left.plane<right.plane,highFlex=anchor.body==='crest-leading'?spec.legFlexionDegrees.crestLeading:spec.legFlexionDegrees.high;
    const circles=([['footL',left,lowLeft?spec.legFlexionDegrees.low:highFlex],['footR',right,lowLeft?highFlex:spec.legFlexionDegrees.low]] as const).map(([limb,goal,flex])=>{const o=offset(limb),r=this.chord(limb,flex),dx=goal.target[0]-x-o[0];if(r*r<=dx*dx)throw new Error('Pool authored leg chord has no sagittal radius');return {y:goal.target[1]-o[1],z:goal.target[2]-o[2],r:Math.sqrt(r*r-dx*dx)};});
    const [a,b]=circles,dy=b.y-a.y,dz=b.z-a.z,d=Math.hypot(dy,dz),along=(a.r*a.r-b.r*b.r+d*d)/(2*d),heightSquared=a.r*a.r-along*along;
    if(!Number.isFinite(along)||heightSquared<=0)throw new Error('Pool authored alternating stance has no real two-leg intersection');
    const h=Math.sqrt(heightSquared),solutions=[1,-1].map(sign=>[a.y+along*dy/d+sign*h*dz/d,a.z+along*dz/d-sign*h*dy/d]);solutions.sort((a,b)=>b[0]-a[0]);hips=[x,solutions[0][0],solutions[0][1]];
   }
  }
  const result={hips,hipPitch,trunkPitch:anchor.trunkPitchDegrees,headPitch};this.bodies.set(anchor.unit,result);return result;
 }
 body(phase:number){
  const anchors=this.definition.anchors;let intent=this.anchorIntent(anchors[0]);
  for(let i=1;i<anchors.length;i++)if(phase<=anchors[i].phase){const a=anchors[i-1],b=anchors[i],u=phase===b.phase?1:(phase-a.phase)/(b.phase-a.phase),movingFeet=a.feet.some((place,index)=>place!==b.feet[index]),t=smooth(clamp(u/(movingFeet?this.definition.bodyProgressFraction:1),0,1)),left=this.anchorIntent(a),right=this.anchorIntent(b);intent={hips:lerp(left.hips,right.hips,t),hipPitch:mix(left.hipPitch,right.hipPitch,t),trunkPitch:mix(left.trunkPitch,right.trunkPitch,t),headPitch:mix(left.headPitch,right.headPitch,t)};break;}
  const author=canonicalPoolPreference(this.bundle,this.shape,this.top,'pool_enter',0,this.geometry);
  for(const [bone,degrees] of [[this.hip,intent.hipPitch],[this.spine,intent.trunkPitch],[this.head,intent.headPitch]])setPoolWorldRotation(author,bone,multiply(pitch(degrees),this.neutral.world[bone]));
  translatePoolRoot(author,sub(intent.hips,point(author.world[this.hip])));
  return {intent,basis:author.basis,pose:poolIntervalPreference(this.bundle,author.rest,author.inverse,author.basis,author.basis,0,true)};
 }
 private waterFoot(limb:PoolFoot,centre:Vec3,wave:number,corridor:boolean):Vec3 {
  const a=this.anatomy[limb],ground=this.foot(limb,'ground'),normalHip=point(this.neutral.world[this.hip]),x=centre[0]+this.neutral.world[a.end][12]-normalHip[0];
  if(!corridor)return [x,this.definition.paddle.footY+this.definition.paddle.kickAmplitude*Math.sin(wave),ground.target[2]+this.definition.paddle.footSoleZ+this.definition.paddle.kickAmplitude*Math.cos(wave)];
  const low=this.fixture.solids.find(s=>s.id===this.definition.places.inside1.surface)!,rows=a.surfaceCoefficients.map(c=>({p:poolSurfacePoint(this.flatFeet[limb],c),w:c[3]})),p=a.patch.vertices.map(v=>poolSurfacePoint(this.flatFeet[limb],v.coefficient)),depth=Math.max(...p.map(v=>v[1]))-Math.min(...p.map(v=>v[1]));
  return [x,Math.min(...rows.map(r=>(low.bounds[0][1]-depth/2-r.p[1])/r.w)),ground.target[2]+this.definition.paddle.footSoleZ];
 }
 private freeFootGoal(limb:PoolFoot,phase:number):Vec3 {
  const spec=this.definition,body=this.body(phase),wave=limb==='footL'?0:Math.PI;
  if(phase>=.88){const corridor=this.waterFoot(limb,body.intent.hips,wave,true);if(phase<=.94)return corridor;return lerp(corridor,this.waterFoot(limb,body.intent.hips,wave,false),clamp((phase-.94)/.06,0,1));}
  let place='ground';
  for(const row of spec.footTransitions.filter(r=>r.limb===limb)){
   if(phase<row.start)break;if(phase>=row.end){place=row.to;continue;}
   const from=this.foot(limb,row.from),to=row.to==='free'?null:this.foot(limb,row.to),u=(phase-row.start)/(row.end-row.start),target=to?.target??this.waterFoot(limb,spec.waterCorridor.initialCentre,wave,true),arrivalLift=to?.lift??.025;
   if(u===0)return from.target;if(u===1)return target;
   const a=this.anatomy[limb],rows=a.surfaceCoefficients.map(c=>({p:poolSurfacePoint(this.flatFeet[limb],c),w:c[3]})),outside=row.from==='ground'||row.from.startsWith('outside')||row.to.startsWith('outside'),gap=2*this.fixture.rails[0].radius;
   let corridor:number;
   if(outside){const edge=Math.max(...this.fixture.solids.map(s=>s.bounds[1][1]));corridor=Math.max(...rows.map(r=>(edge+gap-r.p[1])/r.w));}
   else {const minimum=to?.plane??0,obstacles=Object.entries(spec.places).filter(([name])=>name==='crest'||name.startsWith('inside')).map(([,p])=>this.fixture.solids.find(s=>s.id===p.surface)!).filter(s=>s.id!==to?.support.surface&&s.bounds[1][2]>minimum&&s.bounds[1][2]<=from.plane);if(!obstacles.length)throw new Error('Pool descent has no authored outgoing edge');const edge=Math.min(...obstacles.map(s=>s.bounds[0][1]));corridor=Math.min(...rows.map(r=>(edge-gap-r.p[1])/r.w));}
   const retractY=row.from==='ground'?from.target[1]:corridor,knots:[number,Vec3][]=[[0,from.target],[.2,[from.target[0],retractY,from.target[2]+from.lift]],[.65,[target[0],corridor,target[2]+arrivalLift]],[.85,[target[0],target[1],target[2]+arrivalLift]],[1,target]];
   for(let i=1;i<knots.length;i++)if(u<=knots[i][0])return lerp(knots[i-1][1],knots[i][1],(u-knots[i-1][0])/(knots[i][0]-knots[i-1][0]));
  }
  if(place==='free')return this.waterFoot(limb,body.intent.hips,wave,true);
  return this.foot(limb,place).target;
 }
 private elbow(limb:PoolHand,pose:ReturnType<PoolCycleSource['body']>['pose']):Vec3 {
  const a=this.anatomy[limb],shoulder=point(pose.world[a.upper]),hips=point(pose.world[this.hip]),distance=this.limbReach[limb].lengths[0];return [shoulder[0]+Math.sign(hips[0]-shoulder[0])*distance,shoulder[1],shoulder[2]-distance];
 }
 private grip(limb:PoolHand,phase:number):PoolLimbState {
  const key=limb+':'+phase,old=this.grips.get(key);if(old)return old;
  const body=this.body(phase),a=this.anatomy[limb],support=poolSourceRecord(this.fixture,{action:'pool_enter',phase}).limbs[limb],geometryKey=limb+':'+canonicalPoolValue(support);let physical=this.railInputs.get(geometryKey);
  if(!physical){physical=preparePoolRailGeometry(this.fixture,support,this.geometry[0],this.cages[0],this.neutral.inverse[a.end],a.patch);this.railInputs.set(geometryKey,physical);}
  const shoulder=point(body.pose.world[a.upper]),upper=this.limbReach[limb].lengths[0],outside=phase<=.42,crest=phase>.42&&phase<=.48,branch=outside?this.definition.hand.outsideBranch:crest?this.definition.hand.crestBranch:this.definition.hand.insideBranch;
  const desired:Vec3=[shoulder[0],crest?Math.max(shoulder[1],this.fixture.rails[0].points[3].point[1]):shoulder[1]-upper,shoulder[2]+(outside?upper/2:crest?-upper:-upper)];
  const inverse=[...this.neutral.inverse[a.end]];inverse.splice(12,3,0,0,0);const localNormal=transform(inverse,[0,1,0]),thumb=a.thumb!,thumbDirection=sub(vector(thumb.slice(0,3)),scale(vector(a.anchor.slice(0,3)),thumb[3]/a.anchor[3])),reference=identity();reference.splice(0,3,...thumbDirection);const local=inverseAffine(boneFrame([0,0,0],localNormal,reference));
  const choices:{parameter:number;raw:number[];active:number;distance:number}[]=[];
  for(const entry of physical.edges){if(entry.edge.toParameter<=branch[0]||entry.edge.fromParameter>=branch[1])continue;
   const normal:Vec3=[physical.side,0,0],tangent=sub(entry.to,entry.from);let transverse=cross(normal,tangent);if(transverse[2]<0||transverse[2]===0&&transverse[1]*(shoulder[1]-entry.from[1])<0)transverse=scale(transverse,-1);const world=identity();world.splice(0,3,...transverse);
   const raw=properPoolRotation(multiply(boneFrame([0,0,0],normal,world),local)),location={action:'pool_enter',phase,limb},referenceKey=geometryKey+':'+canonicalPoolValue(raw);let frame=this.railReferences.get(referenceKey);
   if(!frame){frame=resolvePoolRailContactFrame(physical,raw,entry.edge.fromParameter,undefined,location);this.railReferences.set(referenceKey,frame);}const coefficient=physical.coefficients[physical.vertices.indexOf(frame.activeVertex)][3],w=Number(coefficient.numerator)*2**coefficient.exponent;
   const from=vector(entry.from.map((v,i)=>frame.translation[i]+(v-frame.targetPoint[i])/w)),direction=scale(sub(entry.to,entry.from),1/w),wanted=dot(sub(desired,from),direction)/dot(direction,direction);
   for(const interval of poolRootRayIntervals(direction,[{limb,center:sub(shoulder,from),reach:this.limbReach[limb]}])){
    let low=Math.max(0,interval.minimum,(branch[0]-entry.edge.fromParameter)/(entry.edge.toParameter-entry.edge.fromParameter)),high=Math.min(1,interval.maximum,(branch[1]-entry.edge.fromParameter)/(entry.edge.toParameter-entry.edge.fromParameter));
    if(outside)for(const [axis,sign] of [[1,-1],[2,1]] as const){const slope=direction[axis]*sign,offset=(from[axis]-shoulder[axis])*sign;if(slope===0){if(offset<=0)high=low;}else if(slope>0)low=Math.max(low,-offset/slope);else high=Math.min(high,-offset/slope);}
    if(!(low<high))continue;const amount=clamp(wanted,low+(high-low)/4,high-(high-low)/4),target=add(from,scale(direction,amount));choices.push({parameter:entry.edge.fromParameter+(entry.edge.toParameter-entry.edge.fromParameter)*amount,raw,active:frame.activeVertex,distance:length(sub(target,desired))});
   }
  }
  choices.sort((a,b)=>a.distance-b.distance||a.parameter-b.parameter);const chosen=choices[0];if(!chosen)throw new Error('Pool source has no forward/reachable actual grip: '+limb+' '+phase);
  const location={action:'pool_enter',phase,limb},frame=resolvePoolRailContactFrame(physical,chosen.raw,chosen.parameter,chosen.active,location);
  const state:PoolLimbState={target:frame.translation,orientation:frame.orientation,pole:this.elbow(limb,body.pose),attached:{source:location,geometry:physical,parameter:chosen.parameter,rawOrientation:chosen.raw,activeVertex:frame.activeVertex}};this.grips.set(key,state);return state;
 }
 private neutralHand(limb:PoolHand,body:ReturnType<PoolCycleSource['body']>):PoolLimbState {
  const source=this.sourceHands[limb],spine=body.pose.world[this.spine];return {target:transform(spine,source.wrist),pole:transform(spine,source.elbow),orientation:properPoolRotation(multiply(spine,source.rotation))};
 }
 private paddleHand(limb:PoolHand,body:ReturnType<PoolCycleSource['body']>,phase:number):PoolLimbState {
  const a=this.anatomy[limb],spec=this.definition.paddle,side=limb==='handL'?-1:1,wave=phase*2*Math.PI+(side===-1?0:Math.PI),hips=body.intent.hips;
  const palm:Vec3=[hips[0]+side*(spec.palmHalfWidth+spec.palmWaveX*Math.sin(wave)),hips[1]+spec.palmY-spec.centre[1]-spec.palmWaveY*Math.sin(wave),hips[2]+spec.palmZ-spec.centre[2]+spec.palmWaveZ*Math.cos(wave)];
  const orientation=properPoolRotation(multiply(pitch(spec.handPitchDegrees),this.neutral.rest[a.end])),offset=poolSurfacePoint(orientation,a.anchor);return {target:scale(sub(palm,offset),1/a.anchor[3]),orientation,pole:this.elbow(limb,body.pose)};
 }
 private hand(limb:PoolHand,phase:number,body:ReturnType<PoolCycleSource['body']>):PoolLimbState {
  const policy=poolSourcePolicy(this.fixture,'pool_enter',phase)[limb];if(policy.required)return this.grip(limb,phase);
  const spec=this.definition,neutral=this.neutralHand(limb,body),approach=spec.hand.approach,release=spec.hand.release[limb];
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
  const body=this.body(phase),controls:PoolPoseControl[]=[];
  for(const limb of ['footL','footR'] as const){const a=this.anatomy[limb];controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],legFrame:'source-entry-0',state:{target:this.freeFootGoal(limb,phase),orientation:this.flatFeet[limb],pole:point(body.pose.world[a.lower])}});}
  for(const limb of ['handL','handR'] as const){const a=this.anatomy[limb];controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],state:this.hand(limb,phase,body)});}
  for(const control of controls){const limb=this.bundle.bones[control.end].name.replace('.','') as PoolLimb;if(!poolChainReachable(this.limbReach[limb],point(body.pose.world[control.upper]),control.state.target))throw new Error('Pool authored source exceeds actual '+limb+' reach at '+phase);}
  return makePoolPoseProgram(body.basis.map(clonePoolMatrix),controls,poolSourcePolicy(this.fixture,'pool_enter',phase));
 }
 paddle(phase:number):PoolPoseProgram {
  if(phase===0||phase===1)return this.entry(1);const body=this.body(1),controls:PoolPoseControl[]=[];
  for(const limb of ['footL','footR'] as const){const a=this.anatomy[limb],wave=phase*Math.PI*2+(limb==='footL'?0:Math.PI);controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],legFrame:'source-entry-0',state:{target:this.waterFoot(limb,body.intent.hips,wave,false),orientation:this.flatFeet[limb],pole:point(body.pose.world[a.lower])}});}
  for(const limb of ['handL','handR'] as const){const a=this.anatomy[limb];controls.push({upper:a.upper,lower:a.lower,end:a.end,anchor:[0,0,0,1],state:this.paddleHand(limb,body,phase)});}
  return makePoolPoseProgram(body.basis.map(clonePoolMatrix),controls,poolSourcePolicy(this.fixture,'pool_paddle',phase));
 }
}
