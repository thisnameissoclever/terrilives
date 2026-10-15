import type { SimBridge } from '../../bridge.js';
import { CharacterDraft } from '../../character/draft.js';
import type { HouseholdChoice } from '../../character/catalog.js';
import type {CharacterAppearanceV1} from '../../character/schema.js';
import type {AppearanceContacts} from '../../render/character/contact-admission.js';

export type CreatorSource = Pick<SimBridge,'characterCatalog'|'characterSnapshot'|'characterResults'|'characterAppearances'|'createCharacter'|'editCharacter'|'householdSize'>;
const reasons:Readonly<Record<number,string>>={1:'That housemate is no longer here.',2:'The household is full.',3:'Enter a valid name.',
  4:'An appearance value is invalid.',5:'A personality value is invalid.',6:'Check the selected traits.',7:'Check the environmental preferences.',
  8:'A hobby is unavailable.',9:'Choose a supported skill level.',10:'A household relationship is invalid.',11:'There is no clear arrival route.',
  12:'This character record uses an unsupported version.',13:'The character record is invalid.'};
let nextRequest=1;

export class CreatorSession {
  readonly draft:CharacterDraft;
  pending=false;
  error='';
  private request:number|null=null;
  private closed=false;
  constructor(private readonly source:CreatorSource, seed:number, household:readonly HouseholdChoice[], readonly sim:number|null,
    private readonly accepted:(entity:number)=>void,private readonly contacts?:AppearanceContacts) {
    const catalog=source.characterCatalog();
    if(sim===null)this.draft=CharacterDraft.create(seed,catalog,household);
    else {
      const snapshot=source.characterSnapshot(sim);
      if(!snapshot)throw new Error(reasons[1]);
      this.draft=CharacterDraft.edit(snapshot,seed,catalog,household,sim);
    }
  }
  prepareAppearance(appearance:CharacterAppearanceV1){return this.contacts?this.contacts.prepare(appearance):Promise.resolve(undefined);}
  submit():boolean {
    if(this.pending||this.closed)return false;
    try {
      const value=this.draft.resolve();
      this.contacts?.require(value.appearance);
      const request=nextRequest;nextRequest=nextRequest===0xffffffff?1:nextRequest+1;
      const command=()=>this.sim===null?this.source.createCharacter(request,value):this.source.editCharacter(request,this.sim,this.draft.patch());
      const queued=this.contacts?.queue?this.contacts.queue(value.appearance,command):command();
      if(!queued){this.error='The changes could not be queued. Please try again.';return false;}
      this.request=request;this.pending=true;this.error='';return true;
    }catch(error){this.error=error instanceof Error?error.message:String(error);return false;}
  }
  afterCommands():boolean {
    let changed=false;
    for(const result of this.source.characterResults())if(this.pending&&result.request===this.request){
      changed=true;this.pending=false;this.request=null;
      if(result.reason!==null){this.error=reasons[result.reason]??'The changes were refused.';continue;}
      const entity=this.source.characterAppearances().find(row=>row.sim===result.sim)?.entity;
      if(entity===undefined){this.error='The changed housemate could not be found.';continue;}
      this.accepted(entity);
    }
    return changed;
  }
  destroy():void {if(this.closed)return;this.closed=true;this.contacts?.dispose();}
}
