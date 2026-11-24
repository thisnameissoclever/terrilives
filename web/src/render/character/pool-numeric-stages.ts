import {parseOpening,type ParsedOpening,type PoolOpeningRequest} from './pool-opening-flight.js';
import type {PoolCycleDefinition} from './pool-cycle-source.js';
import type {PoolFixtureV1} from './pool-contact-types.js';
import {poolSourcePolicy} from './pool-source-policy.js';
import {bodyInput,graspInput,finiteRow,rotationInput,numericFeet,numericHands,parameterInput,type NumericBody,type NumericFoot,type NumericHand,
  type NumericGrasp,type NumericHandCommand,type NumericStageRequest} from './pool-numeric-recipe.js';
import type {Vec3} from './math.js';
import type {PoolTrialWork} from './pool-trial-work.js';

type Fields=Record<string,unknown>;
type Region=readonly [number,number];
interface ParsedChoice {
  readonly label:string;readonly body:NumericBody|null;readonly relativeToUnit?:number;
  readonly hands:Record<NumericHand,NumericHandCommand>;
}
interface ParsedStage {
  readonly unit:number;readonly role:NumericStageRequest['role'];readonly places:Record<NumericFoot,string>;
  readonly regions:Record<NumericHand,Region|null>;readonly choices:readonly ParsedChoice[];
}
const token={};
class CheckedStages {
  readonly #definition:PoolCycleDefinition;readonly #fixture:PoolFixtureV1;
  constructor(key:object,definition:PoolCycleDefinition,fixture:PoolFixtureV1,readonly stages:readonly ParsedStage[],readonly opening?:ParsedOpening){
    if(key!==token)throw new Error('Invalid numeric pool stage parse.');
    this.#definition=definition;this.#fixture=fixture;Object.freeze(this);
  }
  static read(value:CheckedStages,definition:PoolCycleDefinition,fixture:PoolFixtureV1):readonly ParsedStage[] {
    if(!(#definition in value)||value.#definition!==definition||value.#fixture!==fixture)throw new Error('Numeric pool stage parse belongs to different inputs.');
    return value.stages;
  }
}
export type ParsedNumericStages=CheckedStages;
export const readParsedStages=CheckedStages.read;

function fields(raw:unknown,required:readonly string[],optional:readonly string[],label:string):Fields {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||(Object.getPrototypeOf(raw)!==Object.prototype&&Object.getPrototypeOf(raw)!==null))
    throw new Error('Invalid numeric pool '+label+'.');
  const row=raw as Fields;
  if(required.some(k=>!Object.hasOwn(row,k)))throw new Error('Missing numeric pool '+label+' field.');
  for(const k of Reflect.ownKeys(row)){
    const descriptor=Object.getOwnPropertyDescriptor(row,k)!;
    if(typeof k!=='string'||!required.includes(k)&&!optional.includes(k)||!('value' in descriptor))
      throw new Error('Unexpected numeric pool '+label+' field: '+String(k));
  }
  return row;
}
function list(raw:unknown,label:string):unknown[]{
  if(!Array.isArray(raw))throw new Error('Invalid numeric pool '+label+'.');
  const out:unknown[]=[];
  for(let i=0;i<raw.length;i++){
    const d=Object.getOwnPropertyDescriptor(raw,i);
    if(!d||!('value' in d))throw new Error('Invalid numeric pool '+label+' element.');
    out.push(d.value);
  }
  return out;
}
function freezeNew<T>(value:T):T {
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freezeNew(child);
    Object.freeze(value);
  }
  return value;
}
function parseBody(raw:unknown):NumericBody {
  const row=fields(raw,['hips','hipPitch','trunkPitch','headPitch'],['trunkYaw'],'body');
  const hips=list(row.hips,'hips');finiteRow(hips,3,'hips');
  const body:NumericBody={hips:hips as unknown as Vec3,hipPitch:row.hipPitch as number,trunkPitch:row.trunkPitch as number,headPitch:row.headPitch as number,
    ...(Object.hasOwn(row,'trunkYaw')?{trunkYaw:row.trunkYaw as number}:{})};
  if(Object.hasOwn(row,'trunkYaw')&&!Number.isFinite(row.trunkYaw))throw new Error('Invalid numeric pool body rotation.');
  bodyInput(body);return body;
}
export function heldPlace(definition:PoolCycleDefinition,limb:NumericFoot,unit:number):string|undefined {
  let place=definition.anchors[0].feet[limb==='footL'?0:1];
  const moves=definition.version===16&&definition.forwardHop?definition.forwardHop.footTransitions:definition.footTransitions;
  for(const move of moves)if(move.limb===limb){
    if(unit<move.startUnit)break;
    if(unit===move.startUnit)return move.from;
    if(unit<move.endUnit)return;
    place=move.to;
  }
  return place==='free'?undefined:place;
}

/** Parse and detach the entire exterior request before selecting jobs or constructing a mesh, rig, sole or rail. */
export function parseNumericStages(raw:unknown,definition:PoolCycleDefinition,fixture:PoolFixtureV1,work:PoolTrialWork,opening?:PoolOpeningRequest):ParsedNumericStages {
  if(definition.version!==16)throw new Error('The numerical pool slice requires v16.');
  const stages=list(raw,'stages'),parsed:ParsedStage[]=[];
  if(stages.length<3)throw new Error('Numeric pool stages require acquisition, first rung and second rung in order.');
  const grip=definition.groundGrip,roles=['acquisition','first-rung','second-rung'] as const;
  const units=[grip.acquisitionUnit,grip.firstRungUnit,grip.secondRungUnit];
  const connected=opening&&Object.getOwnPropertyDescriptor(opening,'kind')?.value==='connected-exterior';
  if(connected&&stages.length!==5)throw new Error('Connected exterior needs five named stances.');
  const third=definition.anchors.find(a=>a.name==='outside-third')?.unit;
  const start=definition.crestRoute.sampleUnits[0],replant=definition.crestRoute.handTransferUnits[3];
  for(const [i,rawStage] of stages.entries()){
    work.reserve('parse numeric stage '+i);
    const row=fields(rawStage,['unit','role','places','choices'],[],'stage'),unit=row.unit as number;
    if(!Number.isSafeInteger(unit)||unit<0||unit>definition.clockUnits||i>0&&unit<=parsed[i-1].unit)throw new Error('Invalid numerical stage order or unit.');
    const role=i<3?roles[i]:connected?(i===3?'third-rung':'crest-leading'):'crest';
    if(row.role!==role||i<3&&unit!==units[i]||i>=3&&(connected?unit!==(i===3?third:start):unit<start||unit>=replant))
      throw new Error('Numeric pool stage role does not match the exterior motion at '+unit+'.');
    const policy=poolSourcePolicy(fixture,'pool_enter',unit/definition.clockUnits);
    const places={} as Record<NumericFoot,string>,placeFields=fields(row.places,numericFeet,[],'foot places');
    for(const foot of numericFeet){
      const name=placeFields[foot],held=heldPlace(definition,foot,unit),s=policy[foot];
      if(typeof name!=='string'||!Object.hasOwn(definition.places,name))throw new Error('Unknown numeric pool foot place for '+foot+'.');
      if(!held||name!==held||!s.required||s.region?.kind!=='top-face'||definition.places[name].surface!==s.surface)
        throw new Error('Numeric '+foot+' must name its actual held top-face place at '+unit+'.');
      places[foot]=name;
    }
    const regions={} as Record<NumericHand,Region|null>;
    for(const hand of numericHands){
      const s=policy[hand];
      if(!s.required){if(role!=='crest')throw new Error('Missing required exterior rung hand '+hand+'.');regions[hand]=null;continue;}
      if(s.region?.kind!=='rail'||!s.surface)throw new Error('Missing required numeric rail for '+hand+'.');
      const [low,high]=definition.hand.outsideBranch;
      const lo=Math.max(low,s.region.parameter[0]),hi=Math.min(high,s.region.parameter[1]);
      if(lo>hi)throw new Error('Required numeric rail has no exterior region for '+hand+'.');
      regions[hand]=[lo,hi];
    }
    const sourceChoices=list(row.choices,'choices');
    if(!sourceChoices.length||role==='acquisition'&&sourceChoices.length!==1)throw new Error('Invalid numeric pool acquisition marker or empty choice list.');
    const choices:ParsedChoice[]=sourceChoices.map((rawChoice,j)=>{
      work.reserve('parse numeric choice '+unit+'/'+j);
      const bases=role==='acquisition'?['label']:['label','body'];
      const optional=role==='acquisition'?[]:role==='first-rung'?['relativeToPrevious']:role==='crest-leading'?['relativeToPrevious','literalHands']:['relativeToPrevious','parameters','freeHands'];
      const choice=fields(rawChoice,bases,optional,'choice'),label=choice.label;
      if(typeof label!=='string')throw new Error('Invalid numeric pool choice label.');
      if(Object.hasOwn(choice,'relativeToPrevious')&&typeof choice.relativeToPrevious!=='boolean')throw new Error('Invalid numeric pool position mode.');
      const parameters=Object.hasOwn(choice,'parameters')?fields(choice.parameters,[],numericHands,'parameters'):{};
      const free=Object.hasOwn(choice,'freeHands')?fields(choice.freeHands,[],numericHands,'free wrists'):{};
      const literal=role==='crest-leading'?fields(choice.literalHands,numericHands,[],'selected crest hands'):null;
      const commands={} as Record<NumericHand,NumericHandCommand>;
      for(const hand of numericHands){
        const region=regions[hand];
        if(literal){
          if(!region)throw new Error('Selected crest wrist lacks its finite rail region.');
          const grip=fields(literal[hand],['surface','parameter','rawOrientation','activeVertex'],[],'selected literal wrist') as unknown as NumericGrasp;
          graspInput(grip,region);
          if(grip.surface!==policy[hand].surface)throw new Error('Selected crest wrist differs from its actual rail.');
          commands[hand]={kind:'rail',keepFrame:false,parameter:grip.parameter,literal:structuredClone(grip)};
          continue;
        }
        if(!region){
          if(Object.hasOwn(parameters,hand))throw new Error('Free numeric wrist cannot also specify a rail parameter: '+hand);
          if(!Object.hasOwn(free,hand))throw new Error('Missing free numeric wrist command: '+hand);
          const wrist=fields(free[hand],['offset','orientation'],[],'free wrist');
          const offset=list(wrist.offset,'free wrist offset'),orientation=list(wrist.orientation,'free wrist orientation');
          finiteRow(offset,3,'free wrist offset');rotationInput(orientation as number[],'free wrist orientation');
          commands[hand]={kind:'free',offset:offset as unknown as Vec3,orientation:orientation as number[]};
        }else{
          if(Object.hasOwn(free,hand))throw new Error('Required numeric wrist cannot be free: '+hand);
          if(role==='acquisition'||role==='first-rung'){commands[hand]={kind:'held'};continue;}
          if(Object.hasOwn(parameters,hand))parameterInput(parameters[hand] as number,region);
          commands[hand]={kind:'rail',keepFrame:role==='second-rung',...(Object.hasOwn(parameters,hand)?{parameter:parameters[hand] as number}:{})};
        }
      }
      return {label,body:role==='acquisition'?null:parseBody(choice.body),...(choice.relativeToPrevious===true?{relativeToUnit:parsed[i-1].unit}:{}),hands:commands};
    });
    parsed.push({unit,role,places,regions,choices});
  }
  return new CheckedStages(token,definition,fixture,freezeNew(parsed),parseOpening(opening,definition,fixture,parsed,work));
}
