import type { CharacterAppearanceV1 } from '../../character/schema.js';
import { loadCreatorRig, creatorClips } from '../../render/character/creator-assets.js';
import {bodySelectionKey} from '../../render/character/prepared-body.js';
import {PreparedCharacter} from '../../render/character/prepared-character.js';
import {SceneTarget} from '../../render/scene-target.js';
import {PreparedSleepingCover} from '../../render/character/prepared-sleeping-cover.js';
import {requireSleepingCoverContribution} from '../../render/character/sleep-contact-sample.js';
import {PreviewFixtureRenderer} from '../../render/character/preview-fixture.js';
import {CharacterContactOwner,sharedCharacterPreparation} from '../../render/character/contact-admission.js';
import type {CharacterPreparation} from '../../render/character/character-preparation-service.js';

interface PreviewContacts {prepare(appearance:CharacterAppearanceV1):Promise<CharacterPreparation|undefined>;dispose?():void}

export class CreatorPreview {
  private actor: PreparedCharacter | null = null;
  private generation = 0;
  private closed = false;
  private readonly scenes:SceneTarget[];
  private readonly covers=new Map<string,PreparedSleepingCover>();
  private fixture:Promise<PreviewFixtureRenderer>|null=null;
  private readonly context: GPUCanvasContext;
  private readonly smallContext: GPUCanvasContext;
  private readonly contacts:PreviewContacts;
  private requested='';
  private preparation:Promise<CharacterPreparation|undefined>|null=null;
  constructor(private readonly device: GPUDevice, private readonly format: GPUTextureFormat,
    private readonly canvas: HTMLCanvasElement, private readonly small: HTMLCanvasElement,contacts?:PreviewContacts) {
    this.contacts=contacts??new CharacterContactOwner(sharedCharacterPreparation());
    const context=canvas.getContext('webgpu'),smallContext=small.getContext('webgpu');
    if (!context || !smallContext) throw new Error('Character preview graphics are unavailable.');
    this.context=context;this.smallContext=smallContext;
    context.configure({device,format,alphaMode:'premultiplied'});smallContext.configure({device,format,alphaMode:'premultiplied'});
    this.scenes=[new SceneTarget(device,canvas.width,canvas.height,format),new SceneTarget(device,small.width,small.height,format)];
  }
  prepare(appearance:CharacterAppearanceV1,facing:number,action='idle'):Promise<CharacterPreparation|undefined> {
    const requested=JSON.stringify([appearance,facing,action]);
    if(requested!==this.requested){this.requested=requested;++this.generation;this.preparation=this.contacts.prepare(appearance);void this.preparation.catch(()=>{});}
    return this.preparation!;
  }
  async draw(appearance: CharacterAppearanceV1, facing: number, action='idle', frame=0,currentFrame?:()=>number): Promise<boolean> {
    const preparation=this.prepare(appearance,facing,action),generation=this.generation;
    const contact=await preparation;
    if(this.closed||generation!==this.generation)return false;
    const source=await loadCreatorRig(action);
    if(this.closed||generation!==this.generation)return false;
    const publishedChair=['read','sit'].includes(action);
    const fixture=publishedChair?await(this.fixture??=PreviewFixtureRenderer.create(this.device).catch(error=>{this.fixture=null;throw error;})):null;
    if(this.closed||generation!==this.generation)return false;
    frame=currentFrame?.()??frame;
    const clip=creatorClips.clips[action],sample=clip?.samples[Math.min(Math.floor(frame),clip.samples.length-1)];
    const context={wear:['bath','shower'].includes(action)?'bare' as const:'clothed' as const,
      prop:sample?.bookVisible||['read','stand_read'].includes(action)?'book':'none',fixture:['read','sit'].includes(action)?'armchair':'none',
      eyes_closed:sample?.eyesClosed??action==='sleep',clip:action,grip:action==='mop'?'mop' as const:'relaxed' as const,includeFixture:!publishedChair};
    if(!this.actor||this.actor.selectionKey!==bodySelectionKey(appearance)){
      this.actor?.destroy();this.actor=new PreparedCharacter(this.device,source,appearance,context,this.canvas.width,this.canvas.height);
      this.actor.addView(this.small.width,this.small.height);
    }else this.actor.select(source,appearance,context);
    this.actor.setContacts(contact);
    if(action==='bed_sleep'||action==='bunk_sleep'){
      let cover=this.covers.get(action);
      if(!cover){cover=new PreparedSleepingCover(this.device,this.actor.geometry,action==='bunk_sleep',this.canvas.width,this.canvas.height);this.covers.set(action,cover);}
      cover.update([requireSleepingCoverContribution(contact?.sleep,action,0)]);this.actor.setCoverResource(cover);
    }
    else this.actor.setCoverResource(null);
    const upright=['idle','walk','talk','book_idle','book_walk','owned_stand_read'].includes(action);
    const largeFixture=['bed_sleep','bunk_sleep','fridge','sofa_recline','shower'].includes(action)
      ||action.startsWith('fetch_')||action.startsWith('shelve_')||action.startsWith('seat_sofa_');
    this.actor.view().setFraming(upright?1.2:largeFixture?.65:1,upright?.84:largeFixture?.70:.73);
    this.actor.view(1).setFraming(largeFixture?.6:1,largeFixture?.75:100/128);
    for(const [index,actor] of [this.actor.view(),this.actor.view(1)].entries()) {
      this.actor.prepareScene(action,frame,facing,1,{width:actor.width,height:actor.height,x:actor.width*.5,y:actor.height*actor.groundFraction,
        scale:actor.pixelScale,depth:.5,step:.12,light:[1,1,1]},{includeFixture:!publishedChair},index);
      const encoder=this.device.createCommandEncoder(),scene=this.scenes[index],pass=scene.begin(encoder);
      fixture?.draw(pass,facing,{width:actor.width,height:actor.height,scale:actor.pixelScale,groundFraction:actor.groundFraction});
      this.actor.drawScene(pass,index);pass.end();scene.resolve(encoder,(index?this.smallContext:this.context).getCurrentTexture());
      this.device.queue.submit([encoder.finish()]);
    }
    await this.device.queue.onSubmittedWorkDone();
    return true;
  }
  destroy():void {
    if(this.closed)return;this.closed=true;++this.generation;
    void this.fixture?.then(fixture=>fixture.destroy(),()=>{});
    this.contacts.dispose?.();
    this.actor?.destroy();for(const cover of this.covers.values())cover.destroy();this.covers.clear();for(const scene of this.scenes)scene.destroy();this.context.unconfigure();this.smallContext.unconfigure();
  }
}
