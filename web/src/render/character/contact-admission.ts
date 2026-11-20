import type {CharacterAppearanceV1} from '../../character/schema.js';
import {CharacterPreparationService,characterPreparationKey,type CharacterPreparationLease,type CharacterPreparation,type CharacterPreparationMode} from './character-preparation-service.js';


export interface ContactAppearance {entity:number;appearance:CharacterAppearanceV1}
export type ContactService=Pick<CharacterPreparationService,'acquire'|'require'|'release'>;
export interface AppearanceContacts {
  prepare(appearance:CharacterAppearanceV1,mode?:CharacterPreparationMode):Promise<CharacterPreparation>;
  require(appearance:CharacterAppearanceV1,mode?:CharacterPreparationMode):CharacterPreparation;
  queue?(appearance:CharacterAppearanceV1,command:()=>boolean):boolean;
  dispose():void;
}
let nextOwner=1;
let shared:CharacterPreparationService|undefined;
export function sharedCharacterPreparation():CharacterPreparationService {
  if(!shared){
    shared=new CharacterPreparationService();const service=shared;
    if(typeof window!=='undefined'){
      const close=(event:PageTransitionEvent)=>{if(!event.persisted){service.dispose();if(shared===service)shared=undefined;window.removeEventListener('pagehide',close);}};
      window.addEventListener('pagehide',close);
    }
  }
  return shared;
}
export const abortedContact=()=>new DOMException('Character preparation was superseded.','AbortError');

/** A creator session owns its newest requested configuration independently of GPU views. */
export class CharacterContactOwner implements AppearanceContacts {
  private closed=false;
  private readonly owner='character-draft:'+nextOwner++;
  constructor(private readonly service:ContactService,private readonly roster?:CharacterContactRoster){}
  prepare(appearance:CharacterAppearanceV1,mode=this.roster?.mode??'pool-required'):Promise<CharacterPreparation> {
    if(this.closed)return Promise.reject(abortedContact());
    return this.service.acquire(this.owner,appearance,mode).ready;
  }
  require(appearance:CharacterAppearanceV1,mode=this.roster?.mode??'pool-required'):CharacterPreparation {
    if(this.closed)throw abortedContact();return this.service.require(this.owner,appearance,mode);
  }
  queue(appearance:CharacterAppearanceV1,command:()=>boolean):boolean {
    this.require(appearance);return this.roster?this.roster.queuePrepared(appearance,command):command();
  }
  dispose():void {if(this.closed)return;this.closed=true;this.service.release(this.owner);}
}

export interface ContactStage {ready:Promise<void>;commit(adopt?:()=>boolean):boolean;release():void}
export interface ContactStageModes {readonly current:CharacterPreparationMode;readonly afterCommands?:CharacterPreparationMode}
interface LiveContact {key:string;lease:CharacterPreparationLease}

/** Live, queued and transactional candidate owners have explicit, bounded lifetimes. */
export class CharacterContactRoster {
  private readonly scope='character-roster:'+nextOwner++;
  private readonly live=new Map<number,LiveContact>();
  private readonly queued=new Map<string,CharacterPreparationLease>();
  private stageNumber=0;
  private activeStage:ContactStage|null=null;
  private liveMode:CharacterPreparationMode='pool-required';
  private closed=false;
  constructor(private readonly service:ContactService,private readonly pendingLimit=6){}
  get mode():CharacterPreparationMode{return this.liveMode;}
  private owner(entity:number):string{return this.scope+':live:'+entity;}
  require(entity:number,appearance:CharacterAppearanceV1,mode=this.liveMode):CharacterPreparation {
    if(this.closed)throw new Error('Character contact ownership is closed.');
    return this.service.require(this.owner(entity),appearance,mode);
  }
  stage(rows:readonly ContactAppearance[],afterCommands?:readonly ContactAppearance[],modes:ContactStageModes={current:this.liveMode}):ContactStage {
    if(this.closed)throw new Error('Character contact ownership is closed.');
    this.activeStage?.release();const generation=++this.stageNumber;
    const currentMode=modes.current,futureMode=afterCommands?(modes.afterCommands??currentMode):currentMode;
    const current=structuredClone(rows),future=structuredClone(afterCommands??rows);
    const appearances=new Map<string,{appearance:CharacterAppearanceV1;mode:CharacterPreparationMode}>();
    for(const [group,mode] of [[current,currentMode],[future,futureMode]] as const)
      for(const {appearance} of group)appearances.set(characterPreparationKey(appearance,mode),{appearance,mode});
    if(new Set(future.map(row=>characterPreparationKey(row.appearance,futureMode))).size>this.pendingLimit)throw new Error('Too many queued character configurations.');
    const requested=[...appearances.values()],leases=requested.map(({appearance,mode},index)=>this.service.acquire(this.scope+':stage:'+generation+':'+index,appearance,mode));
    let released=false;
    const stage:ContactStage={
      ready:Promise.all(leases.map(lease=>lease.ready)).then(()=>{}),
      commit:adopt=>{
        if(released||this.activeStage!==stage||this.closed)throw abortedContact();
        for(const [index,{appearance,mode}] of requested.entries())this.service.require(leases[index].owner,appearance,mode);
        if(adopt&&!adopt())return false;
        this.replaceLive(current,currentMode);
        if(afterCommands){
          this.releaseQueued();const liveKeys=new Set([...this.live.values()].map(entry=>entry.key));
          for(const row of future){const key=characterPreparationKey(row.appearance,futureMode);if(!liveKeys.has(key))this.pinReady(row.appearance,futureMode);}
        }
        return true;
      },
      release:()=>{if(released)return;released=true;for(const lease of leases)lease.release();if(this.activeStage===stage)this.activeStage=null;},
    };
    // A superseded stage is allowed to settle before its caller next awaits it.
    void stage.ready.catch(()=>{});this.activeStage=stage;return stage;
  }
  async prepareCurrent(rows:readonly ContactAppearance[],mode=this.liveMode):Promise<void> {
    const stage=this.stage(rows,undefined,{current:mode});try{await stage.ready;stage.commit();}finally{stage.release();}
  }
  private replaceLive(rows:readonly ContactAppearance[],mode:CharacterPreparationMode):void {
    const next=new Map<number,LiveContact>();
    for(const row of rows){
      const key=characterPreparationKey(row.appearance,mode),previous=this.live.get(row.entity);
      if(previous?.key===key){this.require(row.entity,row.appearance,mode);next.set(row.entity,previous);continue;}
      const lease=this.service.acquire(this.owner(row.entity),row.appearance,mode);this.service.require(this.owner(row.entity),row.appearance,mode);next.set(row.entity,{key,lease});
    }
    for(const [entity,entry] of this.live)if(next.get(entity)!==entry)entry.lease.release();
    this.live.clear();for(const [entity,entry] of next)this.live.set(entity,entry);this.liveMode=mode;
  }
  private pinReady(appearance:CharacterAppearanceV1,mode:CharacterPreparationMode):{lease:CharacterPreparationLease;created:boolean} {
    const key=characterPreparationKey(appearance,mode),saved=this.queued.get(key);if(saved)return {lease:saved,created:false};
    if(this.queued.size>=this.pendingLimit)throw new Error('Apply queued character changes before preparing more.');
    const owner=this.scope+':queued:'+key,lease=this.service.acquire(owner,appearance,mode);
    try{this.service.require(owner,appearance,mode);}catch(error){lease.release();throw error;}
    this.queued.set(key,lease);return {lease,created:true};
  }
  queuePrepared(appearance:CharacterAppearanceV1,command:()=>boolean):boolean {
    const key=characterPreparationKey(appearance,this.liveMode),pin=this.pinReady(appearance,this.liveMode);
    try{const queued=command();if(!queued&&pin.created){this.queued.delete(key);pin.lease.release();}return queued;}
    catch(error){if(pin.created){this.queued.delete(key);pin.lease.release();}throw error;}
  }
  /** Called after an actual native command drain, before any new appearance is drawn. */
  afterCommands(rows:readonly ContactAppearance[],mode=this.liveMode):void {
    const available=new Set([...this.live.values()].map(entry=>entry.key));for(const key of this.queued.keys())available.add(key);
    for(const row of rows)if(!available.has(characterPreparationKey(row.appearance,mode)))throw new Error('Character appearance was not admitted. Prepare its contacts before changing the live household.');
    this.replaceLive(rows,mode);this.releaseQueued();
  }
  private releaseQueued():void {for(const lease of this.queued.values())lease.release();this.queued.clear();}
  get hasQueued():boolean{return this.queued.size>0;}
  diagnostics(){return {live:this.live.size,queued:this.queued.size,staging:this.activeStage!==null};}
  dispose():void {if(this.closed)return;this.closed=true;this.activeStage?.release();this.releaseQueued();for(const entry of this.live.values())entry.lease.release();this.live.clear();}
}
