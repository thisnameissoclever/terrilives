import {abortedContact,type CharacterContactRoster,type ContactAppearance} from './contact-admission.js';

export interface CharacterLoadCandidate {
  loadBytes(bytes:Uint8Array):boolean;
  characterAppearances():ContactAppearance[];
  flushCommands():void;
  free():void;
}

/** Inspect queued outcomes on a disposable candidate, then adopt the untouched original bytes. */
export async function loadPreparedCharacterState(bytes:Uint8Array,live:{loadBytes(bytes:Uint8Array):boolean},
  createCandidate:()=>CharacterLoadCandidate,roster:CharacterContactRoster,signal?:AbortSignal):Promise<boolean> {
  const snapshot=bytes.slice(),candidate=createCandidate();
  let release=()=>{},removeAbort=()=>{};
  try{
    if(signal?.aborted)throw abortedContact();
    if(!candidate.loadBytes(snapshot))return false;
    const current=candidate.characterAppearances();candidate.flushCommands();
    const stage=roster.stage(current,candidate.characterAppearances());release=()=>stage.release();
    const aborted=new Promise<never>((_resolve,reject)=>{
      if(!signal)return;
      const cancel=()=>{stage.release();reject(abortedContact());};signal.addEventListener('abort',cancel,{once:true});removeAbort=()=>signal.removeEventListener('abort',cancel);
      if(signal.aborted)cancel();
    });
    await Promise.race([stage.ready,aborted]);
    if(signal?.aborted)throw abortedContact();
    return stage.commit(()=>live.loadBytes(snapshot));
  }finally{removeAbort();release();candidate.free();}
}
