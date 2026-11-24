import type {PlantedStep} from './pool-planted-step.js';
import {rigidBasis} from './pool-contact-protocol.js';
import {openingKnots,type FlyingFoot,type OpeningGeometry} from './pool-opening-flight.js';
import {add,dot,length,scale,sub,type Vec3} from './math.js';
import {poolChainReachable,poolRootRayIntervals,type PoolChainReach,type PoolReachConstraint} from './pool-entry-domain.js';
import type {PoolTrialWork} from './pool-trial-work.js';

export type NumericHand='handL'|'handR';
export type NumericFoot='footL'|'footR';
export const numericHands=['handL','handR'] as const;
export const numericFeet=['footL','footR'] as const;
export interface NumericBody {hips:Vec3;hipPitch:number;trunkPitch:number;headPitch:number;trunkYaw?:number}
export interface NumericFootGoal {place:string;surface:string;target:Vec3;orientation:readonly number[]}
export interface NumericGrasp {surface:string;parameter:number;rawOrientation:readonly number[];activeVertex:number}
export interface NumericHandGoal {grasp:NumericGrasp;poleOffset:Vec3;heldTarget?:Vec3;heldOrientation?:readonly number[]}
export interface NumericFreeHand {freeTarget:Vec3;orientation:readonly number[];poleOffset:Vec3}
export type NumericArm=NumericHandGoal|NumericFreeHand;
export interface NumericKnot {ref:string;unit:number;body:NumericBody;feet:Record<NumericFoot,NumericFootGoal|FlyingFoot>;hands:Record<NumericHand,NumericArm>}
export interface NumericRecipe {knots:readonly NumericKnot[];acquisition:Record<NumericHand,NumericHandGoal>;secondRung:Record<NumericHand,NumericHandGoal>}

export interface NumericRailEdge {
  surface:string;from:number;to:number;origin:Vec3;direction:Vec3;rawOrientation:readonly number[];activeVertex:number;
  frameY:number;side:number|null;onlyParameter?:number;
}
export interface NumericPoseShape {offsets:Record<NumericFoot|NumericHand,Vec3>;elbows:Record<NumericHand,Vec3>}
export interface NumericAcquisition {body:NumericBody;hands:Record<NumericHand,NumericHandGoal&{heldTarget:Vec3;heldOrientation:readonly number[]}>;branch:'ordinary'|'fallback'}
export interface NumericRawChoice {
  readonly label:string;readonly body?:NumericBody;readonly relativeToPrevious?:boolean;
  readonly freeHands?:Partial<Record<NumericHand,{offset:Vec3;orientation:readonly number[]}>>;
  readonly parameters?:Partial<Record<NumericHand,number>>;readonly literalHands?:Record<NumericHand,NumericGrasp>;
}
export interface NumericStageRequest {
  unit:number;role:'acquisition'|'first-rung'|'second-rung'|'third-rung'|'crest-leading'|'crest';
  places:Record<NumericFoot,string>;choices:readonly NumericRawChoice[];
}
export type NumericHandCommand={kind:'held'}|{kind:'rail';parameter?:number;keepFrame:boolean;literal?:NumericGrasp}|{kind:'free';offset:Vec3;orientation:readonly number[]};
export interface NumericBodyChoice {
  readonly label:string;readonly body:NumericBody;readonly relativeToUnit?:number;
  readonly shape:NumericPoseShape;readonly hands:Record<NumericHand,NumericHandCommand>;
}
export interface NumericKnotChoices {
  unit:number;role:NumericStageRequest['role'];
  feet:Record<NumericFoot,NumericFootGoal>;edges:Record<NumericHand,readonly NumericRailEdge[]>;choices:readonly NumericBodyChoice[];
}
export interface NumericProposalInput {
  acquisition:NumericAcquisition;reach:Record<NumericFoot|NumericHand,PoolChainReach>;stages:readonly NumericKnotChoices[];parameterDomain:readonly [number,number];opening?:OpeningGeometry;
}
export type NumericProposal={kind:'recipe';recipe:NumericRecipe}|{kind:'unavailable';unit:number;reason:string};

const same=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const equalGraspFrame=(a:NumericGrasp,b:NumericRailEdge)=>a.surface===b.surface&&a.activeVertex===b.activeVertex&&same(a.rawOrientation,b.rawOrientation);

export function finiteRow(value:unknown,size:number,label:string):void {
  if(!Array.isArray(value)||value.length!==size)throw new Error('Invalid numeric pool '+label+'.');
  for(let i=0;i<size;i++)if(!Number.isFinite(value[i]))throw new Error('Invalid numeric pool '+label+'.');
}
export function rotationInput(value:readonly number[],label:string):void {
  finiteRow(value,16,label);rigidBasis(value,1);
}
export function bodyInput(value:NumericBody):void {
  finiteRow(value.hips,3,'hips');
  if(![value.trunkPitch,value.hipPitch,value.headPitch,value.trunkYaw??0].every(Number.isFinite))throw new Error('Invalid numeric pool body rotation.');
}
function reachInput(reach:PoolChainReach):void {
  finiteRow(reach.lengths,2,'chain lengths');
  const [a,b]=reach.lengths;
  if(a<=0||b<=0||!Number.isFinite(reach.minimum)||!Number.isFinite(reach.maximum)||
    reach.minimum!==Math.abs(a-b)||reach.maximum!==a+b)throw new Error('Invalid numeric pool reach shell.');
}
export function parameterInput(parameter:number,domain:readonly [number,number]):void {
  if(!Number.isFinite(parameter)||parameter<domain[0]||parameter>domain[1])throw new Error('Invalid numeric pool rail parameter.');
}
export function graspInput(g:NumericGrasp,domain:readonly [number,number]):void {
  parameterInput(g.parameter,domain);rotationInput(g.rawOrientation,'raw wrist orientation');
  if(!Number.isSafeInteger(g.activeVertex)||g.activeVertex<0||typeof g.surface!=='string'||!g.surface)throw new Error('Invalid numeric pool grasp.');
}
function footInput(g:NumericFootGoal):void {
  finiteRow(g.target,3,'sole target');rotationInput(g.orientation,'sole orientation');
  if(typeof g.place!=='string'||!g.place||typeof g.surface!=='string'||!g.surface)throw new Error('Invalid numeric pool sole.');
}
export function numericLimbReachable(reach:PoolChainReach,start:Vec3,target:Vec3):boolean {
  finiteRow(start,3,'joint start');finiteRow(target,3,'limb target');
  if(!Number.isFinite(length(sub(start,target))))throw new Error('Invalid numeric pool limb distance.');
  return poolChainReachable(reach,start,target);
}
export function validateNumericKnot(knot:NumericKnot,clock:number,domain:readonly [number,number]):void {
  if(!Number.isSafeInteger(knot.unit)||knot.unit<0||knot.unit>clock||knot.ref!=='entry/'+knot.unit)throw new Error('Invalid numeric pool knot.');
  bodyInput(knot.body);
  for(const l of numericFeet){
    const foot=knot.feet[l];
    if('flight' in foot){if(Object.keys(foot).sort().join(',')!=='flight,orientation,target')throw new Error('Invalid numeric opening foot fields.');finiteRow(foot.target,3,'free sole target');rotationInput(foot.orientation,'free sole orientation');}
    else footInput(foot);
  }
  for(const l of numericHands){
    const h=knot.hands[l];finiteRow(h.poleOffset,3,'elbow offset');
    if('freeTarget' in h){finiteRow(h.freeTarget,3,'free wrist target');rotationInput(h.orientation,'free wrist orientation');}
    else{
      graspInput(h.grasp,domain);
      if((h.heldTarget===undefined)!==(h.heldOrientation===undefined))throw new Error('Incomplete held pool wrist.');
      if(h.heldTarget&&h.heldOrientation){finiteRow(h.heldTarget,3,'held target');rotationInput(h.heldOrientation,'held orientation');}
    }
  }
}

/** Match the grounded acquisition's neutral, poolward ray, then planted sagittal arc. Empty intersection is a physical outcome. */
export function numericalGroundOffset(constraints:readonly PoolReachConstraint[],radius:number,budget:PoolTrialWork):Vec3|undefined {
  if(!Number.isFinite(radius)||radius<=0)throw new Error('Pool acquisition needs the real planted height.');
  for(const c of constraints){finiteRow(c.center,3,'ground constraint');reachInput(c.reach);}
  const admits=(p:Vec3)=>constraints.every(c=>numericLimbReachable(c.reach,p,c.center));
  const neutral:Vec3=[0,0,0],direction:Vec3=[0,-1,0];
  if(admits(neutral))return neutral;
  for(const span of poolRootRayIntervals(direction,constraints)){
    budget.reserve('grounded rail offset',{expansions:1});
    const p=scale(direction,span.minimum+(span.maximum-span.minimum)/4);
    if(admits(p))return p;
  }
  const cuts=[0,Math.PI/2],centre:Vec3=[0,0,-radius];
  for(const c of constraints){
    const d=sub(c.center,centre),projection=Math.hypot(d[1],d[2]);
    if(projection===0)continue;
    const middle=Math.atan2(-d[1],d[2]);
    for(const limit of [c.reach.minimum,c.reach.maximum]){
      const v=(dot(d,d)+radius*radius-limit*limit)/(2*radius*projection);
      if(v< -1||v>1)continue;
      for(const sign of [-1,1]){
        const angle=(middle+sign*Math.acos(v)+2*Math.PI)%(2*Math.PI);
        if(angle>0&&angle<Math.PI/2)cuts.push(angle);
      }
    }
  }
  cuts.sort((a,b)=>a-b);
  for(let i=1;i<cuts.length;i++){
    if(cuts[i]===cuts[i-1])continue;
    budget.reserve('grounded rail arc',{expansions:1});
    const angle=cuts[i-1]+(cuts[i]-cuts[i-1])/4;
    const p=add(centre,[0,-radius*Math.sin(angle),radius*Math.cos(angle)]);
    if(admits(p))return p;
  }
  return undefined;
}

/** Intersect each finite rail segment with this hand's configured shell. Choose each wrist independently. */
export function numericalWrist(limb:NumericHand,shoulder:Vec3,reach:PoolChainReach,edges:readonly NumericRailEdge[],
  budget:PoolTrialWork,parameter?:number,maintained?:NumericGrasp,raisedPreference=false):NumericGrasp|undefined {
  finiteRow(shoulder,3,'shoulder');reachInput(reach);
  if(parameter!==undefined&&!Number.isFinite(parameter))throw new Error('Invalid numeric pool rail parameter.');
  const preferred=add(shoulder,[0,-reach.lengths[0],reach.lengths[0]/2]);
  let best:{distance:number;grasp:NumericGrasp}|undefined;
  for(const edge of edges){
    budget.reserve('consider '+limb+' rail segment',{expansions:1});
    finiteRow(edge.origin,3,'rail origin');finiteRow(edge.direction,3,'rail direction');rotationInput(edge.rawOrientation,'raw wrist orientation');
    const extent=dot(edge.direction,edge.direction);
    if(!Number.isFinite(edge.from)||!Number.isFinite(edge.to)||!(edge.from<edge.to)||!Number.isFinite(extent)||extent<=0||
      !Number.isFinite(edge.frameY)||(edge.side===null?!maintained:![-1,0,1].includes(edge.side))||!Number.isSafeInteger(edge.activeVertex)||edge.activeVertex<0)
      throw new Error('Invalid configured exterior rail segment.');
    if((edge.side!==null&&Math.sign(shoulder[1]-edge.frameY)!==edge.side)||maintained&&!equalGraspFrame(maintained,edge))continue;
    const width=edge.to-edge.from;
    if(edge.onlyParameter!==undefined)parameterInput(edge.onlyParameter,[edge.from,edge.to]);
    if(edge.onlyParameter!==undefined&&parameter!==undefined&&edge.onlyParameter!==parameter)continue;
    const fixed=parameter??edge.onlyParameter;
    if(fixed!==undefined&&(fixed<edge.from||fixed>edge.to))continue;
    const intervals=poolRootRayIntervals(edge.direction,[{limb,center:sub(shoulder,edge.origin),reach}]);
    for(const span of intervals){
      let lo=Math.max(0,span.minimum),hi=Math.min(1,span.maximum);
      if(raisedPreference)for(const [slope,offset] of [[-edge.direction[1],shoulder[1]-edge.origin[1]],[edge.direction[2],edge.origin[2]-shoulder[2]]]){
        if(slope===0){if(offset<=0)hi=lo;}
        else if(slope>0)lo=Math.max(lo,-offset/slope);
        else hi=Math.min(hi,-offset/slope);
      }
      if(!(lo<hi))continue;
      const wanted=dot(sub(preferred,edge.origin),edge.direction)/dot(edge.direction,edge.direction);
      const f=fixed===undefined?Math.max(lo+(hi-lo)/4,Math.min(hi-(hi-lo)/4,wanted)):(fixed-edge.from)/width;
      if(f<lo||f>hi)continue;
      const target=add(edge.origin,scale(edge.direction,f));
      if(!numericLimbReachable(reach,shoulder,target))continue;
      const distance=length(sub(target,preferred)),p=fixed??edge.from+width*f;
      if(!best||distance<best.distance||distance===best.distance&&p<best.grasp.parameter)
        best={distance,grasp:{surface:edge.surface,parameter:p,rawOrientation:[...edge.rawOrientation],activeVertex:edge.activeVertex}};
    }
  }
  return best?.grasp;
}

function freezeNamedChoices<T>(value:T):T {
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freezeNamedChoices(child);
    Object.freeze(value);
  }
  return value;
}

/** No source, owner or pose evaluator is available to this iterator. Unreachable branches are ordinary values. */
export function* selectNumericPoolAnchors(input:NumericProposalInput,budget:PoolTrialWork):Generator<NumericProposal> {
  finiteRow(input.parameterDomain,2,'exterior parameter range');
  if(!(input.parameterDomain[0]<input.parameterDomain[1]))throw new Error('Invalid numeric pool exterior parameter range.');
  bodyInput(input.acquisition.body);
  for(const l of [...numericFeet,...numericHands])reachInput(input.reach[l]);
  for(const l of numericHands){
    const h=input.acquisition.hands[l];graspInput(h.grasp,input.parameterDomain);finiteRow(h.heldTarget,3,'acquired wrist');rotationInput(h.heldOrientation,'acquired orientation');finiteRow(h.poleOffset,3,'acquired pole');
  }
  const chosen:NumericKnot[]=[];
  function* visit(index:number):Generator<NumericProposal>{
    if(index===input.stages.length){
      budget.reserve('detach complete pool recipe',{expansions:1});
      const second=chosen.find((_,i)=>input.stages[i].role==='second-rung')!;
      if(!('grasp' in second.hands.handL)||!('grasp' in second.hands.handR))throw new Error('Second rung must declare both rail destinations.');
      const selection=freezeNamedChoices(structuredClone({knots:chosen,acquisition:input.acquisition.hands,secondRung:{handL:second.hands.handL,handR:second.hands.handR}}));
      yield {kind:'recipe',recipe:selection};
      return;
    }
    const stage=input.stages[index];
    for(const choice of stage.choices){
      budget.reserve('expand '+stage.role+' '+choice.label,{expansions:1});
      bodyInput(choice.body);
      for(const l of [...numericFeet,...numericHands])finiteRow(choice.shape.offsets[l],3,'configured joint offset');
      for(const l of numericHands)finiteRow(choice.shape.elbows[l],3,'configured elbow offset');
      for(const l of numericFeet)footInput(stage.feet[l]);
      const previous=choice.relativeToUnit===undefined?undefined:chosen.find(k=>k.unit===choice.relativeToUnit)?.body;
      if(choice.relativeToUnit!==undefined&&!previous)throw new Error('Relative pool stance has no selected named predecessor.');
      const body=previous?
        {...choice.body,hips:add(previous!.hips,choice.body.hips)}:choice.body;
      if(!body.hips.every(Number.isFinite)||![body.trunkPitch,body.hipPitch,body.headPitch,body.trunkYaw??0].every(Number.isFinite))
        throw new Error('Invalid numeric pool stance.');
      const unavailable=numericFeet.find(l=>!numericLimbReachable(input.reach[l],add(body.hips,choice.shape.offsets[l]),stage.feet[l].target));
      if(unavailable){yield {kind:'unavailable',unit:stage.unit,reason:unavailable+' cannot reach its fixed sole'};continue;}
      const hands={} as Record<NumericHand,NumericArm>;
      let failure:string|undefined;
      for(const l of numericHands){
        const shoulder=add(body.hips,choice.shape.offsets[l]),command=choice.hands[l];
        if(command.kind==='free'){
          const target=add(shoulder,command.offset);
          if(!numericLimbReachable(input.reach[l],shoulder,target)){failure=l+' cannot reach the declared free goal';break;}
          hands[l]={freeTarget:target,orientation:command.orientation,poleOffset:choice.shape.elbows[l]};
        }else if(command.kind==='held'){
          if(!numericLimbReachable(input.reach[l],shoulder,input.acquisition.hands[l].heldTarget)){failure=l+' cannot maintain the acquired wrist';break;}
          hands[l]=input.acquisition.hands[l];
        }else if(command.literal){
          if(stage.role!=='crest-leading'||command.parameter!==command.literal.parameter)throw new Error('Literal wrist requires its named crest destination.');
          graspInput(command.literal,input.parameterDomain);
          hands[l]={grasp:command.literal,poleOffset:choice.shape.elbows[l]};
        }else{
          const grasp=numericalWrist(l,shoulder,input.reach[l],stage.edges[l],budget,command.parameter,
            command.keepFrame?input.acquisition.hands[l].grasp:undefined);
          if(!grasp){failure=l+' has no compatible finite rail contact';break;}
          hands[l]={grasp,poleOffset:choice.shape.elbows[l]};
        }
      }
      if(failure){yield {kind:'unavailable',unit:stage.unit,reason:failure};continue;}
      chosen.push({ref:'entry/'+stage.unit,unit:stage.unit,body,feet:stage.feet,hands});
      try{yield* visit(index+1);}finally{chosen.pop();}
    }
  }
  yield* visit(0);
}

export function* expandSelectedPoolRecipes(input:NumericProposalInput,budget:PoolTrialWork,selected:NumericRecipe,plants:readonly PlantedStep[]=[]):Generator<{kind:'recipe';recipe:NumericRecipe}> {
 let knots=selected.knots;
 for(let segment=input.opening;segment;segment=segment.next){
  const planted=segment.flight.kind==='third-exterior-step'||segment.flight.kind==='crest-landing-step';
  const plant=plants.find(s=>s.fromUnit===segment.flight.startUnit&&s.toUnit===segment.flight.endUnit);
  if(planted!==!!plant)throw new Error('Exterior expansion lacks its selected planted endpoint rotations.');
  knots=openingKnots(knots,segment,budget,plant);
 }
 yield {kind:'recipe',recipe:structuredClone({...selected,knots})};
}

export function* numericalPoolRecipes(input:NumericProposalInput,budget:PoolTrialWork):Generator<NumericProposal> {
 for(const option of selectNumericPoolAnchors(input,budget)){
  if(option.kind==='unavailable')yield option;
  else yield* expandSelectedPoolRecipes(input,budget,option.recipe);
 }
}
