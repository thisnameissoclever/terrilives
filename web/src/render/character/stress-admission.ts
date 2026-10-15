import type {CharacterDraftV1,CharacterPatchV1} from '../../character/schema.js';
import type {SimBridge} from '../../bridge.js';
import {CharacterContactOwner,type CharacterContactRoster,type ContactService} from './contact-admission.js';

export interface StressCharacterActions {
  loadBytes(bytes:Uint8Array):Promise<boolean>;
  create(request:number,draft:CharacterDraftV1):Promise<boolean>;
  edit(request:number,person:number,patch:CharacterPatchV1):Promise<boolean>;
  prepareCurrent():Promise<void>;
}
type Source=Pick<SimBridge,'createCharacter'|'editCharacter'|'characterSnapshot'|'characterAppearances'|'householdSize'>;

/** Stress probes use the same pre-admission boundary as player-facing controls. */
export class StressCharacterAdmission implements StressCharacterActions {
  private readonly preparing=new Set<CharacterContactOwner>();
  constructor(private readonly source:Source,private readonly contacts:ContactService,private readonly roster:CharacterContactRoster,
    readonly loadBytes:(bytes:Uint8Array)=>Promise<boolean>){}
  private async queue(appearance:CharacterDraftV1['appearance'],command:()=>boolean):Promise<boolean> {
    if(this.preparing.size>=this.source.householdSize()[1])throw new Error('Wait for pending character preparations before requesting more.');
    const owner=new CharacterContactOwner(this.contacts,this.roster);this.preparing.add(owner);
    try{await owner.prepare(appearance);return owner.queue(appearance,command);}
    finally{this.preparing.delete(owner);owner.dispose();}
  }
  create(request:number,draft:CharacterDraftV1):Promise<boolean> {
    const value=structuredClone(draft);return this.queue(value.appearance,()=>this.source.createCharacter(request,value));
  }
  edit(request:number,person:number,patch:CharacterPatchV1):Promise<boolean> {
    const value=structuredClone(patch),appearance=value.appearance??this.source.characterSnapshot(person)?.appearance;
    if(!appearance)return Promise.resolve(this.source.editCharacter(request,person,value));
    return this.queue(appearance,()=>this.source.editCharacter(request,person,value));
  }
  prepareCurrent():Promise<void> {return this.roster.prepareCurrent(this.source.characterAppearances());}
  dispose():void {for(const owner of this.preparing)owner.dispose();this.preparing.clear();}
}

/** Guard only the test facade; application bridge methods and native commands stay unchanged. */
export function guardedCharacterStressSource<T extends object>(source:T):T {
  const alternatives:Readonly<Record<string,string>>={loadBytes:'loadBytes',createCharacter:'create',editCharacter:'edit'};
  return new Proxy(source,{get(target,key){
    if(typeof key==='string'&&Object.hasOwn(alternatives,key))return ()=>{throw new Error(`Use await __terriStress.characters.${alternatives[key]}(...) so character contacts are ready before mutation.`);};
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
}
