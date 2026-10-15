import type {SimBridge} from '../../bridge.js';
import type {RenderSource} from '../../frame.js';
import {walkingFacing} from '../../frame.js';
import type {CharacterAppearanceV1} from '../../character/schema.js';
import type {InteractionSelection} from '../interaction-sprites.js';
import {shelfPresence} from '../shelf-sprites.js';
import {characterActionPlan,type CharacterActionPlan} from './action-plan.js';
import type {Vec3} from './math.js';
import {fixtureDepthSprite,fixtureDrawRecord,shelfDepthSprite,type FixtureDrawRecord} from '../fixture-depth.js';
import {ScenePickRegistry} from '../scene-picks.js';

export interface PlannedActor {
  entity:number;sim:number;row:number;token:number;appearance:CharacterAppearanceV1;action:CharacterActionPlan;
  x:number;y:number;angle:number;offset:Vec3;fixtureRow:number;fixtureEntity:number|null;fixtureModel:string|null;
  includeFixture:boolean;stockMask:number;
  head:Vec3;feet:Vec3;hand:Vec3;
}
type Source=Pick<SimBridge,'appearanceHash'|'characterAppearances'|'objectModel'|'objectFacing'|'lotRevision'|'modelSeatIds'>&RenderSource;
const fixtureAngles=[Math.PI/2,0,3*Math.PI/2,Math.PI];
const bodyAngles=[0,Math.PI/2,3*Math.PI/2,0,Math.PI];

/** One displayed ownership plan drives mesh rendering, sprite suppression and picking. */
export class CharacterScenePlan {
  readonly actors:PlannedActor[]=[];
  readonly pickOwners=new ScenePickRegistry();
  fixtureDepthBase=0;
  depthForSprite(sprite:number):number|null{return fixtureDepthSprite(sprite,this.fixtureDepthBase);}
  shelfDepthForSprite(sprite:number):number|null{return shelfDepthSprite(sprite,this.fixtureDepthBase);}
  drawForSprite(sprite:number,row=-1):FixtureDrawRecord|null {
    const actor=row<0?undefined:this.fixtureAt(row);
    return fixtureDrawRecord(sprite,this.fixtureDepthBase,actor?.action.clip,actor?.action.sample);
  }
  replacedRows=new Uint8Array(0);
  private appearanceHash:bigint|null=null;
  private revision=-1;
  private readonly appearances=new Map<number,{sim:number;appearance:CharacterAppearanceV1}>();
  private readonly models=new Map<number,{id:string;facing:number;places:readonly string[]}>();
  private dinnerKind=-1;
  constructor(private readonly frameCount:(action:string)=>number,private readonly ready?:()=>void){}
  fixtureAt(row:number):PlannedActor|undefined{return this.actors.find(actor=>actor.fixtureRow===row);}
  actorAt(row:number):PlannedActor|undefined{return this.actors.find(actor=>actor.row===row);}

  /** Read string-bearing metadata before the frame borrows any WebAssembly array views. */
  sync(source:Source):void {
    const hash=source.appearanceHash();
    if(hash!==this.appearanceHash){this.appearances.clear();for(const row of source.characterAppearances())this.appearances.set(row.entity,row);this.appearanceHash=hash;}
    const revision=source.lotRevision();
    if(revision!==this.revision){
      this.models.clear();const ids=Array.from(source.ids()),kinds=Array.from(source.kinds());
      for(let row=0;row<ids.length;row++)if(kinds[row]!==0){const model=source.objectModel(ids[row]);if(model)this.models.set(ids[row],{id:model.id,facing:source.objectFacing(ids[row])??0,places:source.modelSeatIds(model.id)});}
      this.revision=revision;
    }
    this.dinnerKind=source.itemKinds().indexOf('dinner');
  }
  reset():void {this.appearanceHash=null;this.revision=-1;this.actors.length=0;this.appearances.clear();this.models.clear();this.pickOwners.reset();}

  update(source:RenderSource,interactions:InteractionSelection,alpha:number,tick:number,reducedMotion:boolean):void {
    const count=source.count;if(this.replacedRows.length<count)this.replacedRows=new Uint8Array(count);this.replacedRows.fill(0);
    this.actors.length=0;
    const ids=source.ids(),kinds=source.kinds(),actions=source.visualActions(),activities=source.activities(),facings=source.facings();
    const current=source.positions(),previous=source.prevPositions(),carrying=source.carrying(),dishes=source.carriedDishes?.();
    const stages=source.readingStages?.(),books=source.carriedBooks?.(),slots=source.readingHomeSlots?.(),remaining=source.readingReachRemaining?.(),totals=source.readingReachTotals?.();
    const whole=source.seatedWhole?.(),seatedPlaces=source.seatedPlaces?.(),sleepingPlaces=source.sleepingPlaces?.(),progress=source.choreProgress?.();
    const targets=source.interactionTargets?.(),beds=source.sleepingBeds?.(),seats=source.seatedFurniture?.(),shelves=source.readingHomeShelves?.();
    const soundActions=source.soundActions?.(),soundSources=source.soundSources?.();
    const shelfOffsets=source.shelfBookOffsets?.(),shelfCounts=source.shelfBookCounts?.(),shelfMasks=source.shelfBookMasks?.();
    const drawnFixtures=new Set<number>();
    for(let row=0;row<count;row++){
      if(kinds[row]!==0)continue;
      const record=this.appearances.get(ids[row]);if(!record)continue;
      // Shower audio already exposes the validated exact fixture while legacy body art has no shower code.
      const shower=activities[row]===12&&soundActions?.[row]===1;
      let target=interactions.targetRows[row];
      if(shower)target=ids.indexOf(soundSources?.[row]??0xffffffff);
      if(target<0){
        const targetId=actions[row]===9?beds?.[row]:whole?.[row]===1||actions[row]===3||actions[row]===8?seats?.[row]:stages?.[row]===6||stages?.[row]===7?shelves?.[row]:targets?.[row];
        if(targetId!==undefined&&targetId!==0xffffffff)target=ids.indexOf(targetId);
      }
      const model=target>=0?this.models.get(ids[target]):undefined;
      const x=previous[row*2]+(current[row*2]-previous[row*2])*alpha,y=previous[row*2+1]+(current[row*2+1]-previous[row*2+1])*alpha;
      const facing=actions[row]===5?walkingFacing(previous[row*2],previous[row*2+1],current[row*2],current[row*2+1],facings[row]):facings[row];
      const action=characterActionPlan({action:shower?20:actions[row],activity:activities[row],entity:ids[row],facing,x,y,tick:tick+alpha,reducedMotion,
        fixtureModel:model?.id??null,wholeSeat:whole?.[row]===1,readingStage:stages?.[row]??0,carriedBook:books!==undefined&&books[row]!==0xffffffff,
        carriedDishes:(dishes?.[row]??0)>0,carriedDinner:carrying[row]===this.dinnerKind&&activities[row]<=2,
        shelfSlot:slots?.[row]??0,reachRemaining:remaining?.[row]??0,reachTotal:totals?.[row]??0,progress:progress?.[row]??0,halfCycleTicks:interactions.timingFor(row)},this.frameCount);
      if(!action)continue;
      // Keep contacting feet on the same eight source states as the published pedals.
      if(action.clip==='exercise')action.sample=Math.floor(action.sample);
      if(action.fixture&&(target<0||!model))throw new Error('Configured activity has no physical fixture: '+action.clip);
      const fixture=action.fixture?target:-1;let offset:Vec3=[0,0,0];
      if(action.clip==='bed_sleep'){
        const place=sleepingPlaces?.[row];if(place!==0&&place!==1)throw new Error('Double-bed sleeper has no valid place.');offset=[place===1?-.77:0,0,0];
      }else if(action.clip.startsWith('seat_sofa_')){
        const stable=model!.places[seatedPlaces?.[row]??-1],place=['seat_1','seat_2','seat_3'].indexOf(stable);
        if(place<0)throw new Error('Sofa occupant has no stable seat.');offset=[0,(place-1)*.58,0];
      }
      const includeFixture=fixture>=0&&!drawnFixtures.has(fixture);if(fixture>=0)drawnFixtures.add(fixture);
      this.replacedRows[row]=1;
      this.actors.push({entity:ids[row],sim:record.sim,row,token:row+1,appearance:record.appearance,action,
        x:fixture>=0?previous[fixture*2]+(current[fixture*2]-previous[fixture*2])*alpha:x,
        y:fixture>=0?previous[fixture*2+1]+(current[fixture*2+1]-previous[fixture*2+1])*alpha:y,
        angle:fixture>=0?fixtureAngles[model!.facing]:bodyAngles[facing]??0,offset,fixtureRow:fixture,fixtureEntity:fixture>=0?ids[fixture]:null,
        fixtureModel:fixture>=0?model!.id:null,includeFixture,stockMask:fixture>=0?interactions.shelfMask(fixture,shelfPresence(fixture,shelfOffsets,shelfCounts,shelfMasks)):0,head:[x,y,0],feet:[x,y,0],hand:[x,y,0]});
    }
    this.ready?.();
  }
}
