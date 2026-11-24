import type {SimBridge} from '../../bridge.js';
import {screenX,screenY,layeredDepth,LAYER_PROP,LAYER_SIM} from '../iso.js';
import type {SceneTarget} from '../scene-target.js';
import {sampleLight,type TileLighting} from '../lighting.js';
import {sampleShade,type SkyExposure} from '../sky.js';
import type {Ambient} from '../daylight.js';
import {loadCreatorRig,loadCreatorGeometry,creatorClips} from './creator-assets.js';
import type {Geometry} from './bundle.js';
import {bodySelectionKey} from './prepared-body.js';
import type {CharacterRig} from './clip-runtime.js';
import {clipSample,hasBook} from './motion.js';
import {PreparedCharacter} from './prepared-character.js';
import {CharacterScenePlan,type PlannedActor} from './scene-plan.js';
import {PreparedSleepingCover} from './prepared-sleeping-cover.js';
import {requireSleepingCoverContribution} from './sleep-contact-sample.js';
import type {Vec3} from './math.js';
import {WORLD_CHARACTER_FRAME} from './camera.js';
import type {SceneHit} from '../scene-picks.js';
import type {CharacterContactRoster} from './contact-admission.js';
import type {CharacterPreparationMode} from './character-preparation-service.js';
import type {CharacterAppearanceV1} from '../../character/schema.js';
import {ShowerSteam} from './shower-steam.js';
import {showerSteamEnvelopes,showerSteamCabin} from './steam-envelope.js';
import {bathToySelector} from './bath-motion.js';
import {PoolRipples} from './pool-ripples.js';
import {collectPoolWaterContacts,PoolLandingRipples,type PoolWaterFootprint} from './pool-water-contact.js';
import {poolContactFixture,poolContactTakeoffPhase} from './pool-contact-release.js';
import {poolWaterBounds} from './pool-water-retarget.js';

type WorldContacts=Pick<CharacterContactRoster,'require'> & Partial<Pick<CharacterContactRoster,'mode'>>;
interface ActorResources {geometry:Geometry;renderer:PreparedCharacter;resourceId:number;appearance?:CharacterAppearanceV1;contactMode?:CharacterPreparationMode}
let nextResourceId=1;
export interface CharacterSceneView {originX:number;originY:number;scale:number;width:number;height:number;gridSize:number;ambient:Ambient;skyShade:number;lighting:TileLighting|null;sky:SkyExposure;fixtureDepthBase:number}
export type CharacterHit=SceneHit;
export interface CharacterFrameProbeActor {entity:number;sim:number;clip:string;sample:number;resourceId:number;bodyCompactions:number;bodyShapeChanges:number;attachmentChanges:number}
export interface CharacterFrameProbe {count:number;hasView:boolean;originX:number;originY:number;scale:number;width:number;height:number;actors:CharacterFrameProbeActor[]}

export class CharacterWorld {
  readonly plan:CharacterScenePlan;
  private readonly actors=new Map<number,ActorResources>();
  private readonly covers=new Map<number,PreparedSleepingCover>();
  private fixtureRevision=-1;
  private readonly displayed:{actor:PlannedActor;resources:ActorResources}[]=[];
  private closed=false;
  private generation=0;
  private currentSource:SimBridge|null=null;
  private currentView:CharacterSceneView|null=null;
  private readonly steam:ShowerSteam;
  private readonly poolLanding=new PoolLandingRipples();
  private poolRipples:PoolRipples|null=null;
  private poolFootprint:PoolWaterFootprint|null=null;
  private constructor(private readonly device:GPUDevice,private readonly format:GPUTextureFormat,
    private readonly geometries:ReadonlyMap<string,CharacterRig>,private readonly sceneTarget:()=>SceneTarget,private readonly contacts?:WorldContacts){
    this.plan=new CharacterScenePlan(action=>{
      const geometry=geometries.get(action);if(!geometry)throw new Error('Configured character clip is unavailable: '+action);
      return geometry.manifest.actions[action].length;
    },()=>{if(this.currentSource&&this.currentView)this.prepare(this.currentSource,this.currentView);});
    this.steam=new ShowerSteam(device);
  }
  static async create(device:GPUDevice,format:GPUTextureFormat,sceneTarget:()=>SceneTarget,contacts?:WorldContacts):Promise<CharacterWorld>{
    const base=await loadCreatorGeometry(),baseRig=await loadCreatorRig('idle'),geometries=new Map<string,CharacterRig>();
    for(const action of Object.keys(base.manifest.actions))geometries.set(action,baseRig);
    const families=new Map<string,string>();for(const [name,clip] of Object.entries(creatorClips.clips))families.set(clip.family,name);
    for(const [family,example] of families){const geometry=await loadCreatorRig(example);for(const [name,clip] of Object.entries(creatorClips.clips))if(clip.family===family)geometries.set(name,geometry);}
    return new CharacterWorld(device,format,geometries,sceneTarget,contacts);
  }
  private destroyActor(actor:ActorResources):void {actor.renderer.destroy();}
  reset():void {this.generation++;for(const actor of this.actors.values())this.destroyActor(actor);this.actors.clear();for(const cover of this.covers.values())cover.destroy();this.covers.clear();this.fixtureRevision=-1;this.displayed.length=0;this.plan.reset();this.steam.begin();this.poolRipples?.begin();this.poolLanding.clear();}
  destroy():void {if(this.closed)return;this.closed=true;this.reset();this.steam.destroy();this.poolRipples?.destroy();}
  prepareFixtures(source:SimBridge):void {
    const revision=source.lotRevision();if(revision===this.fixtureRevision)return;
    const ids=Array.from(source.ids()),kinds=Array.from(source.kinds()),active=new Set<number>(),frame=WORLD_CHARACTER_FRAME;
    for(let row=0;row<ids.length;row++)if(kinds[row]!==0){
      const model=source.objectModel(ids[row])?.id;if(model!=='bed'&&model!=='double_bed')continue;
      active.add(ids[row]);const bunk=model==='bed',old=this.covers.get(ids[row]);
      if(old?.bunk===bunk)continue;old?.destroy();
      const rig=this.geometries.get(bunk?'bunk_sleep':'bed_sleep')!;
      this.covers.set(ids[row],new PreparedSleepingCover(this.device,{...rig.base,manifest:rig.manifest},bunk,frame.size,frame.size));
    }
    for(const [id,cover] of this.covers)if(!active.has(id)){cover.destroy();this.covers.delete(id);}
    this.fixtureRevision=revision;
  }
  beginFrame(source:SimBridge,view:CharacterSceneView):void {this.prepareFixtures(source);this.plan.sync(source);this.plan.fixtureDepthBase=view.fixtureDepthBase;this.currentSource=source;this.currentView=view;}

  prepare(source:SimBridge,view:CharacterSceneView):void {
    if(this.closed)throw new Error('Character world renderer is closed.');
    const contactMode=this.contacts?.mode;
    for(const actor of this.plan.actors){
      const clip=creatorClips.clips[actor.action.clip],sample=clip?clip.samples[clipSample(clip.samples.length,actor.action.sample,clip.playback).index]:undefined;
      const context={wear:['bath','shower'].includes(actor.action.clip)||actor.action.clip.startsWith('pool_')?'bare' as const:'clothed' as const,prop:sample?.bookVisible||hasBook(actor.action.clip)?'book':'none',
        swimwear:actor.action.clip.startsWith('pool_')?(actor.appearance.presentation==='feminine'?'two_piece' as const:'trunks' as const):'none' as const,
        fixture:'none',eyes_closed:sample?.eyesClosed??actor.action.clip==='sleep',clip:actor.action.clip,grip:actor.action.clip==='mop'?'mop' as const:'relaxed' as const,includeFixture:false,includeActivityWater:actor.action.clip==='bath',bathToy:actor.action.clip==='bath'?bathToySelector(actor.bathToy??0):'none' as const,stockMask:actor.stockMask,heldSlot:actor.action.heldSlot};
      const rig=this.geometries.get(actor.action.clip)!;let resources=this.actors.get(actor.entity);
      if(!resources||resources.renderer.selectionKey!==bodySelectionKey(actor.appearance)){
        if(resources)this.destroyActor(resources);
        const frame=WORLD_CHARACTER_FRAME,renderer=new PreparedCharacter(this.device,rig,actor.appearance,context,frame.size,frame.size,{zoom:frame.zoom,groundFraction:frame.groundFraction});
        resources={geometry:renderer.geometry,renderer,resourceId:nextResourceId++};this.actors.set(actor.entity,resources);
      }else resources.renderer.select(rig,actor.appearance,context);
      if(resources.appearance!==actor.appearance||resources.contactMode!==contactMode){
        resources.renderer.setContacts(this.contacts?.require(actor.entity,actor.appearance));
        resources.appearance=actor.appearance;resources.contactMode=contactMode;
      }
      resources.geometry=resources.renderer.geometry;
    }
    for(const actor of this.plan.actors)if(actor.includeFixture&&['bed_sleep','bunk_sleep'].includes(actor.action.clip)){
      const cover=this.covers.get(actor.fixtureEntity!);if(!cover)throw new Error('Sleeping fixture cover was not prepared.');
      const action=actor.action.clip as 'bed_sleep'|'bunk_sleep';
      const contributions=this.plan.actors.filter(other=>other.fixtureEntity===actor.fixtureEntity).map(other=>
        requireSleepingCoverContribution(this.actors.get(other.entity)!.renderer.renderer.resources.sleepContact,action,other.offset[0]));
      cover.update(contributions);
    }
    const active=new Set<number>();this.displayed.length=0;this.steam.begin();
    const poolActive=this.plan.actors.some(actor=>actor.fixtureModel==='pool'&&actor.action.clip.startsWith('pool_'));
    if(poolActive){
      this.poolRipples??=new PoolRipples(this.device);
      if(!this.poolFootprint){
        const {low,high,surface}=poolWaterBounds(poolContactFixture());
        this.poolFootprint={minimum:[low[0],low[1]],maximum:[high[0],high[1]],height:surface};
      }
    }
    this.poolRipples?.begin();
    this.poolLanding.begin(poolActive?source.clockTick():0);
    const colourways=source.colourways(),shifts=source.colourwayShifts();
    for(const actor of this.plan.actors){
      active.add(actor.entity);const resources=this.actors.get(actor.entity)!,{renderer}=resources;
      const cover=actor.includeFixture&&['bed_sleep','bunk_sleep'].includes(actor.action.clip)?this.covers.get(actor.fixtureEntity!)??null:null;
      renderer.setCoverResource(cover);
      const emissive=view.lighting?sampleLight(view.lighting,Math.floor(actor.x),Math.floor(actor.y)):0,shade=sampleShade(view.sky,Math.floor(actor.x),Math.floor(actor.y));
      const light=view.ambient.slice(0,3).map(value=>value*(1-view.skyShade*shade)*(1-emissive)+emissive) as unknown as Vec3;
      const depth=layeredDepth(actor.x,actor.y,view.gridSize,LAYER_SIM);
      const includeCover=cover!==null;
      const includeActivityFixture=includeCover||actor.action.clip==='bath';
      const colourway=actor.fixtureRow>=0?colourways[actor.fixtureRow]:0;
      // The bath attachment is water; the ordinary tub sprite owns its colourway.
      const fixtureColourway:Vec3=actor.action.clip!=='bath'&&colourway>0&&3*colourway+2<shifts.length
        ?[shifts[3*colourway],shifts[3*colourway+1]-1,shifts[3*colourway+2]]:[0,0,0];
      renderer.prepareScene(actor.action.clip,actor.action.sample,actor.angle,actor.token,
        {width:view.width,height:view.height,x:screenX(actor.x,actor.y,view.originX,view.scale),y:screenY(actor.x,actor.y,view.originY,view.scale),
         scale:view.scale,depth,step:depth-layeredDepth(actor.x+1,actor.y,view.gridSize,LAYER_SIM),light},
        {offset:actor.offset,includeFixture:includeActivityFixture,fixtureToken:includeActivityFixture?actor.fixtureRow+1:0,fixtureColourway});
      const anchors=renderer.renderer.anchors(actor.angle,actor.offset);
      if(actor.action.clip==='shower'){
        const body=renderer.renderer,mesh=body.resources;
        this.steam.add(showerSteamEnvelopes(body.geometry,mesh.deformed,body.poseMatrices,actor.angle,actor.offset),
          screenX(actor.x,actor.y,view.originX,view.scale),screenY(actor.x,actor.y,view.originY,view.scale),view.scale,
          depth,depth-layeredDepth(actor.x+1,actor.y,view.gridSize,LAYER_SIM),actor.action.sample/creatorClips.clips.shower.samples.length*Math.PI*2,light,
          showerSteamCabin(body.geometry,body.poseMatrices),actor.angle);
      }
      if(actor.fixtureModel==='pool'&&actor.fixtureEntity!==null&&actor.action.clip.startsWith('pool_')){
        const body=renderer.renderer,water=this.poolFootprint!;
        const {ripples,touchdown}=collectPoolWaterContacts(body.geometry,body.resources.deformed,body.poseMatrices,water,actor.offset);
        const depth=layeredDepth(actor.x,actor.y,view.gridSize,LAYER_PROP);
        const frame={
          x:screenX(actor.x,actor.y,view.originX,view.scale),y:screenY(actor.x,actor.y,view.originY,view.scale),
          scale:view.scale,depth,depthStep:depth-layeredDepth(actor.x+1,actor.y,view.gridSize,LAYER_PROP),
          owner:actor.fixtureRow+1,angle:actor.angle,water,light,phase:actor.action.sample*.54,
        };
        for(const ripple of ripples)this.poolRipples!.add(ripple,frame);
        const takeoff=poolContactTakeoffPhase();
        const forwardEntry=takeoff!==null&&actor.action.clip==='pool_enter'&&source.poolPhases()?.[actor.row]===1
          &&actor.action.sample/(body.geometry.manifest.actions.pool_enter.length-1)>=takeoff;
        const impact=this.poolLanding.observe(actor.entity,actor.fixtureEntity,forwardEntry,touchdown);
        if(impact)this.poolRipples!.add(impact,frame,true);
      }
      actor.head=[actor.x+anchors.head[0],actor.y-anchors.head[1],anchors.head[2]];actor.feet=[actor.x+anchors.feet[0],actor.y-anchors.feet[1],anchors.feet[2]];
      actor.hand=[actor.x+anchors.hand[0],actor.y-anchors.hand[1],anchors.hand[2]];
      this.displayed.push({actor,resources});
    }
    this.poolLanding.end();
    for(const [entity,resources] of this.actors)if(!active.has(entity)){this.destroyActor(resources);this.actors.delete(entity);}
  }
  draw=(pass:GPURenderPassEncoder):void=>{for(const {resources} of this.displayed)resources.renderer.drawScene(pass);};
  private drawRipples=(encoder:GPUCommandEncoder,target:SceneTarget):void=>{this.poolRipples?.draw(encoder,target);};
  get waterSurfaceDraw(){return this.poolRipples?.active?this.drawRipples:undefined;}
  drawEffects=(encoder:GPUCommandEncoder,target:SceneTarget):void=>{this.steam.draw(encoder,target);};
  async pick(x:number,y:number):Promise<CharacterHit|null|undefined>{
    const generation=this.generation,source=this.currentSource;
    if(this.closed||!source||!this.currentView)return undefined;
    const revision=source.lotRevision(),target=this.sceneTarget(),owners=this.plan.pickOwners.snapshot();
    const stale=()=>this.closed||generation!==this.generation||source!==this.currentSource||source.lotRevision()!==revision||target!==this.sceneTarget();
    let id:number;
    try{id=await target.pick(x,y);}catch(error){if(stale())return undefined;throw error;}
    if(stale())return undefined;
    return owners.get(id)??null;
  }
  replacesEntity(entity:number):boolean{return this.plan.actors.some(actor=>actor.entity===entity);}
  probeFrame(target:CharacterFrameProbe):void {
    if(target.actors.length<this.displayed.length)throw new Error('Character frame probe has insufficient actor slots.');
    target.count=this.displayed.length;const view=this.currentView;target.hasView=view!==null;
    target.originX=view?.originX??0;target.originY=view?.originY??0;target.scale=view?.scale??0;target.width=view?.width??0;target.height=view?.height??0;
    for(let index=0;index<this.displayed.length;index++){
      const {actor,resources}=this.displayed[index],slot=target.actors[index],metrics=resources.renderer.metrics;
      slot.entity=actor.entity;slot.sim=actor.sim;slot.clip=actor.action.clip;slot.sample=actor.action.sample;slot.resourceId=resources.resourceId;
      slot.bodyCompactions=metrics.bodyCompactions;slot.bodyShapeChanges=metrics.bodyShapeChanges;slot.attachmentChanges=metrics.attachmentChanges;
    }
  }
  diagnostics(){
    const geometries=new Set<object>();let bufferBytes=this.steam.allocatedBufferBytes+(this.poolRipples?.allocatedBufferBytes??0),textureBytes=0;
    for(const {resources} of this.displayed){bufferBytes+=resources.renderer.allocatedPrivateBufferBytes;textureBytes+=resources.renderer.renderer.allocatedTextureBytes;
      for(const resource of resources.renderer.sharedResourceAllocations)if(!geometries.has(resource.identity)){geometries.add(resource.identity);bufferBytes+=resource.bytes;}}
    for(const cover of this.covers.values()){
      const renderer=cover.renderer,identity=renderer.resources.staticResources.buffers;
      if(!geometries.has(identity)){geometries.add(identity);bufferBytes+=renderer.allocatedPrivateBufferBytes+renderer.allocatedSharedBufferBytes;}
    }
    return structuredClone({actors:this.displayed.map(({actor,resources})=>({entity:actor.entity,sim:actor.sim,token:actor.token,clip:actor.action.clip,sample:actor.action.sample,
      appearance:actor.appearance,x:actor.x,y:actor.y,angle:actor.angle,offset:actor.offset,head:actor.head,feet:actor.feet,fixture:actor.fixtureEntity,
      textureBytes:resources.renderer.renderer.allocatedTextureBytes,privateBufferBytes:resources.renderer.allocatedPrivateBufferBytes,prepared:resources.renderer.metrics})),
      allocation:{bufferBytes,textureBytes,textureCount:0,sharedGeometryCount:geometries.size},
      view:this.currentView?{originX:this.currentView.originX,originY:this.currentView.originY,scale:this.currentView.scale,width:this.currentView.width,height:this.currentView.height}:null});
  }
}
