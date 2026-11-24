import type {CharacterAppearanceV1} from '../../character/schema.js';
import type {Geometry} from './bundle.js';
import type {CharacterRig} from './clip-runtime.js';
import {selectParts,type AppearanceContext} from './variants.js';
import {PreparedBody,bodySelectionKey,type PreparedSelection} from './prepared-body.js';
import {CharacterMeshResources} from './mesh-resources.js';
import {CharacterRenderer} from './renderer.js';
import {characterPixelScale} from './camera.js';
import type {CharacterBodyVariant} from './body-variants.js';
import type {BikeContactArtifactV1} from './bike-contact-types.js';
import type {CharacterPreparation} from './character-preparation-service.js';
import type {PreparedSleepingCover} from './prepared-sleeping-cover.js';
import {bindSeatContacts} from './seat-contact-sample.js';
import {bindPoolContacts} from './pool-contact-sample.js';
import {poolContactAppearanceKey} from './pool-contact-identity.js';
import {poolContactFixture,poolContactTakeoffPhase} from './pool-contact-release.js';

type Placement=Parameters<CharacterRenderer['prepareScene']>[4];
type SceneOptions=Parameters<CharacterRenderer['prepareScene']>[5];
interface View {body:CharacterRenderer;variants:Map<CharacterBodyVariant,CharacterRenderer>;extra:CharacterRenderer|null;cover:CharacterRenderer|null}
const renderers=(view:View)=>[view.body,...view.variants.values(),view.extra,view.cover].filter((renderer):renderer is CharacterRenderer=>renderer!==null);
/** True when two contexts have the same values for every key, as the selection cache's JSON key would see them. */
function sameContext(a:AppearanceContext,b:AppearanceContext):boolean {
  const left=a as unknown as Record<string,unknown>,right=b as unknown as Record<string,unknown>;
  for(const key in left)if(!Object.is(left[key],right[key]))return false;
  for(const key in right)if(!(key in left)&&right[key]!==undefined)return false;
  return true;
}

/** A live actor owns one body and its current attachments; views share all pose work. */
export class PreparedCharacter {
  private readonly prepared:PreparedBody;
  readonly selectionKey:string;
  private readonly views:View[]=[];
  private extra:Geometry|null=null;
  private cover:Geometry|null=null;
  private borrowedCover:PreparedSleepingCover|null=null;
  private current:PreparedSelection;
  private appearance:CharacterAppearanceV1;
  private closed=false;
  readonly metrics={bodyCompactions:1,bodyShapeChanges:0,attachmentChanges:0};
  private shapeKey='';
  private poolSelection=false;
  private poolBinding:{artifact:CharacterPreparation['pool'];selection:PreparedSelection;shapeKey:string;manifest:Geometry['manifest'];parts:Geometry['description']['parts'];garmentManifest:Geometry['manifest'];garmentParts:Geometry['description']['parts']}|undefined;
  /** An unchanged selection can reuse its attachments. Appearance edits pass a new record. */
  private selected:{rig:CharacterRig;appearance:CharacterAppearanceV1;context:AppearanceContext}|null=null;
  constructor(private readonly device:GPUDevice,rig:CharacterRig,appearance:CharacterAppearanceV1,context:AppearanceContext,
    width:number,height:number,framing:{zoom?:number;groundFraction?:number}={}){
    this.selectionKey=bodySelectionKey(appearance);this.appearance=appearance;this.prepared=new PreparedBody(rig.base,appearance);
    this.current=this.prepared.select(rig,appearance,context);
    this.views.push({body:new CharacterRenderer(device,this.prepared.geometry,width,height,framing),variants:new Map(),extra:null,cover:null});
    for(const variant of rig.bodyVariants??[]){
      const main=this.renderer,mesh=new CharacterMeshResources(device,variant.geometry,{top:main.resources.top,skeleton:main.resources.skeleton});
      this.views[0].variants.set(variant,new CharacterRenderer(device,variant.geometry,width,height,{},mesh));
    }
    for(const eyes_closed of [false,true])this.renderer.resources.prepareHeadSelection(selectParts(this.prepared.geometry,appearance,{...context,eyes_closed},undefined,false));
    this.select(rig,appearance,context);
  }
  get geometry():Geometry{return this.current.body;}
  get renderer():CharacterRenderer{return this.views[0].body;}
  addView(width:number,height:number):number {
    this.selected=null;const main=this.views[0];this.views.push({body:main.body.createView(width,height),variants:new Map([...main.variants].map(([variant,renderer])=>[variant,renderer.createView(width,height)])),
      extra:main.extra?.createView(width,height)??null,cover:this.borrowedCover?.view(this.views.length,width,height)??main.cover?.createView(width,height)??null});
    for(const renderer of renderers(this.views.at(-1)!))renderer.setCharacterAppearance(this.appearance);
    return this.views.length-1;
  }
  view(index=0):CharacterRenderer{return this.views[index].body;}
  setBikeContact(contact:BikeContactArtifactV1|undefined):void {
    const mesh=this.renderer.resources;if(mesh.bikeContact===contact)return;
    this.selected=null;mesh.bikeContact=contact;mesh.lastPoseKey='';mesh.lastMatrices=null;
  }
  setContacts(contact:CharacterPreparation|undefined):void {
    this.setBikeContact(contact?.bike);const mesh=this.renderer.resources;
    if(mesh.sleepContact===contact?.sleep&&mesh.seatContact===contact?.seat&&mesh.poolContact===contact?.pool)return;
    this.selected=null;
    mesh.sleepContact=contact?.sleep;mesh.seatContact=contact?.seat;mesh.poolContact=contact?.pool;mesh.lastPoseKey='';mesh.lastMatrices=null;
    bindSeatContacts(mesh.seatContact,this.geometry,mesh.shape,mesh.top);this.bindPoolSelection();
  }
  private bindPoolSelection(awaitingCurrentContact=false):void {
    const mesh=this.renderer.resources,artifact=mesh.poolContact;
    if(!this.poolSelection||!artifact)return;
    // World selection changes before its newly admitted contacts are installed in this same frame.
    if(awaitingCurrentContact&&artifact.appearanceKey!==poolContactAppearanceKey(this.appearance))return;
    const saved=this.poolBinding;
    if(saved?.artifact===artifact&&saved.selection===this.current&&saved.shapeKey===this.shapeKey
      &&saved.manifest===this.current.body.manifest&&saved.parts===this.current.body.description.parts
      &&saved.garmentManifest===this.current.extra?.manifest&&saved.garmentParts===this.current.extra?.description.parts)return;
    if(!this.current.extra||this.current.variants.length)throw new Error('Pool motion requires its selected body and temporary garments.');
    bindPoolContacts(artifact,this.current.body,mesh.shape,mesh.top,[this.current.extra],poolContactFixture(),poolContactTakeoffPhase());
    this.poolBinding={artifact,selection:this.current,shapeKey:this.shapeKey,manifest:this.current.body.manifest,parts:this.current.body.description.parts,garmentManifest:this.current.extra.manifest,garmentParts:this.current.extra.description.parts};
  }

  select(rig:CharacterRig,appearance:CharacterAppearanceV1,context:AppearanceContext):void {
    if(this.closed)throw new Error('Prepared character is closed.');
    const last=this.selected;
    if(last&&last.rig===rig&&last.appearance===appearance&&sameContext(last.context,context)){
      // A shared sleeping cover displays the appearance of the last actor selected for that fixture.
      if(this.borrowedCover)for(const view of this.views)view.cover?.setCharacterAppearance(appearance);
      return;
    }
    this.selected=null;
    if(this.selectionKey!==bodySelectionKey(appearance))throw new Error('Prepared character style changed.');
    this.appearance=appearance;this.current=this.prepared.select(rig,appearance,context);
    this.poolSelection=rig.manifest.clipMetadata?.[context.clip??'']?.contacts.policy==='pool';
    if(this.current.variants.some(variant=>!this.views[0].variants.has(variant)))throw new Error('Character body variant was not prepared with this person.');
    const shapeKey=JSON.stringify([appearance.presentation,appearance.body,appearance.face]);
    const changingShape=shapeKey!==this.shapeKey;
    if(changingShape){this.metrics.bodyShapeChanges++;this.shapeKey=shapeKey;}
    this.renderer.setGeometry(this.current.body);
    this.replaceAttachment('extra',this.current.extra);
    for(const view of this.views)for(const renderer of renderers(view))renderer.setCharacterAppearance(appearance);
    const mesh=this.renderer.resources;if(!changingShape)bindSeatContacts(mesh.seatContact,this.geometry,mesh.shape,mesh.top);
    this.bindPoolSelection(true);
    this.selected={rig,appearance,context:{...context}};
  }
  setCover(cover:Geometry|null):void {this.replaceAttachment('cover',cover);}
  setCoverResource(cover:PreparedSleepingCover|null):void {
    if(this.borrowedCover===cover)return;
    this.selected=null;
    if(!this.borrowedCover)for(const view of this.views)view.cover?.destroy();
    this.borrowedCover=cover;this.cover=cover?.geometry??null;
    this.views.forEach((view,index)=>{view.cover=cover?.view(index,view.body.width,view.body.height)??null;view.cover?.setCharacterAppearance(this.appearance);});
  }
  private replaceAttachment(kind:'extra'|'cover',geometry:Geometry|null):void {
    if(this[kind]===geometry)return;
    this.selected=null;
    if(kind==='cover'&&this.borrowedCover){this.borrowedCover=null;for(const view of this.views)view.cover=null;}
    this[kind]=geometry;this.metrics.attachmentChanges++;
    for(const view of this.views){view[kind]?.destroy();view[kind]=null;}
    if(!geometry)return;
    const main=this.renderer,mesh=new CharacterMeshResources(this.device,geometry,{top:main.resources.top,skeleton:main.resources.skeleton});
    for(const view of this.views){
      const renderer=new CharacterRenderer(this.device,geometry,view.body.width,view.body.height,{},mesh);
      renderer.setCharacterAppearance(this.appearance);view[kind]=renderer;
    }
  }
  prepareScene(action:string,frame:number,facing:number,id:number,placement:Placement,options:SceneOptions={},index=0):void {
    const view=this.views[index];view.body.prepareScene(action,frame,facing,id,placement,options);
    for(const renderer of [...this.current.variants.map(variant=>view.variants.get(variant)!),view.extra,view.cover])if(renderer){
      renderer.setFraming(view.body.pixelScale/characterPixelScale(view.body.width,view.body.height),view.body.groundFraction);
      if(renderer!==view.cover||!this.borrowedCover)renderer.setPoseSource(view.body.poseMatrices);
      renderer.prepareScene(action,frame,facing,id,placement,options);
    }
  }
  drawScene(pass:GPURenderPassEncoder,index=0):void {
    const view=this.views[index];
    for(const phase of ['outline','fill'] as const){
      view.body.drawScene(pass,phase);
      let previous:CharacterRenderer|null=null;
      for(const batch of this.current.batches[phase]){
        const renderer=batch.owner?view.variants.get(batch.owner)!:view.extra!;
        renderer.drawSceneRange(pass,phase,batch,previous!==renderer);previous=renderer;
      }
      view.cover?.drawScene(pass,phase);
    }
  }
  get allocatedPrivateBufferBytes():number {return this.views.reduce((sum,view,index)=>sum+renderers(view).reduce((bytes,renderer)=>bytes+(index?272:renderer.allocatedPrivateBufferBytes),0),0);}
  get sharedResourceAllocations(){return renderers(this.views[0]).map(renderer=>({identity:renderer.resources.staticResources.buffers,bytes:renderer.allocatedSharedBufferBytes}));}
  get allocatedSharedBufferBytes():number{return this.sharedResourceAllocations.reduce((sum,resource)=>sum+resource.bytes,0);}
  destroy():void {if(this.closed)return;this.closed=true;for(const view of this.views)for(const renderer of renderers(view))if(renderer!==view.cover||!this.borrowedCover)renderer.destroy();this.views.length=0;}
}
