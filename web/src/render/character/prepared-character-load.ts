import {abortedContact,type CharacterContactRoster,type ContactAppearance} from './contact-admission.js';
import type {CharacterPreparationMode} from './character-preparation-service.js';
import type {SimBridge} from '../../bridge.js';

type FrameContactSource = Pick<SimBridge,'commandDrainRevision'|'appearanceHash'|'characterAppearances'|'poolContactRequired'>;

/** Queued leases belong to the next native drain, even when a frame advances no time. */
export class CharacterContactFrameSync {
  private drained = 0;
  private appearance: bigint | null = null;

  constructor(private readonly source:FrameContactSource,private readonly roster:CharacterContactRoster) {}

  reset():void {
    this.drained=this.source.commandDrainRevision();
    this.appearance=this.source.appearanceHash();
  }

  afterFrame():void {
    const drained=this.source.commandDrainRevision();
    if(drained===this.drained)return;
    const appearance=this.source.appearanceHash();
    if(appearance!==this.appearance||this.roster.hasQueued){
      this.roster.afterCommands(this.source.characterAppearances(),contactMode(this.source));
    }
    this.appearance=appearance;this.drained=drained;
  }
}

export interface CharacterLoadCandidate {
  loadBytes(bytes:Uint8Array):boolean;
  characterAppearances():ContactAppearance[];
  poolContactRequired?():boolean;
  prepareSceneAssets?():Promise<void>|undefined;
  flushCommands():void;
  free():void;
}

function contactMode(candidate:Pick<CharacterLoadCandidate,'poolContactRequired'>):CharacterPreparationMode {
  return candidate.poolContactRequired?.()===false?'base':'pool-required';
}

/** Inspect queued outcomes on a disposable candidate, then adopt the untouched original bytes. */
export async function loadPreparedCharacterState(bytes:Uint8Array,live:{loadBytes(bytes:Uint8Array):boolean;settlesQueuedOnLoad?():boolean},
  createCandidate:()=>CharacterLoadCandidate,roster:CharacterContactRoster,signal?:AbortSignal,onPoolPreparation?:()=>void):Promise<boolean> {
  const snapshot=bytes.slice(),candidate=createCandidate();
  let release=()=>{},removeAbort=()=>{};
  try{
    if(signal?.aborted)throw abortedContact();
    if(!candidate.loadBytes(snapshot))return false;
    const current=candidate.characterAppearances(),currentMode=contactMode(candidate);
    const settles=live.settlesQueuedOnLoad?.()??false;
    const currentSceneAssets=settles?undefined:candidate.prepareSceneAssets?.();
    void currentSceneAssets?.catch(()=>{});
    candidate.flushCommands();
    const future=candidate.characterAppearances(),futureMode=contactMode(candidate);
    const sceneAssets=Promise.all([currentSceneAssets,candidate.prepareSceneAssets?.()]);
    void sceneAssets.catch(()=>{});
    if(futureMode==='pool-required'||(!settles&&currentMode==='pool-required'))onPoolPreparation?.();
    const stage=settles?roster.stage(future,undefined,{current:futureMode})
      :roster.stage(current,future,{current:currentMode,afterCommands:futureMode});
    release=()=>stage.release();
    const aborted=new Promise<never>((_resolve,reject)=>{
      if(!signal)return;
      const cancel=()=>{stage.release();reject(abortedContact());};signal.addEventListener('abort',cancel,{once:true});removeAbort=()=>signal.removeEventListener('abort',cancel);
      if(signal.aborted)cancel();
    });
    await Promise.race([Promise.all([stage.ready,sceneAssets]),aborted]);
    if(signal?.aborted||settles!==(live.settlesQueuedOnLoad?.()??false))throw abortedContact();
    return stage.commit(()=>live.loadBytes(snapshot));
  }finally{removeAbort();release();candidate.free();}
}
