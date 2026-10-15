import type {CharacterAppearanceV1} from '../../character/schema.js';

export interface PreparationLease<A> {
  readonly owner:string;readonly generation:number;readonly appearanceKey:string;readonly ready:Promise<A>;release():void;
}
export interface PreparationWork<A> {
  inputPrepared():void;compiled():void;findReady(key:string):A|undefined;
}
export interface PreparationDefinition<A> {
  key(appearance:CharacterAppearanceV1):string;
  prepare(appearance:CharacterAppearanceV1,work:PreparationWork<A>):Promise<A>;
}
interface Entry<A> {key:string;appearance:CharacterAppearanceV1;definition:PreparationDefinition<A>;leases:Set<LeaseRecord<A>>;artifact?:A;failure?:unknown}
interface LeaseRecord<A> {lease:PreparationLease<A>;entry:Entry<A>;closed:boolean;resolve:(artifact:A)=>void;reject:(error:unknown)=>void}
export const preparationCancelled=()=>{const error=new Error('Character preparation was superseded or released.');error.name='AbortError';return error;};

/** Every resource shares one serial work queue; only current owners retain completed artifacts. */
export class PreparationQueue<A extends {key:string}> {
  private readonly owners=new Map<string,LeaseRecord<A>>();
  private readonly entries=new Map<string,Entry<A>>();
  private readonly queue:Entry<A>[]=[];
  private active:Entry<A>|undefined;
  private generation=0;private disposed=false;private inputPreparations=0;private compilations=0;private discardedResults=0;private lastError:string|null=null;
  private lastWorkerError:{name:string|null;kind:string|null;stack:string|null}|null=null;
  acquire(owner:string,appearance:CharacterAppearanceV1,definition:PreparationDefinition<A>):PreparationLease<A> {
    if(this.disposed)throw new Error('The character preparation service is disposed.');
    if(!owner||owner.length>32768)throw new Error('Invalid character preparation owner.');
    const key=definition.key(appearance),previous=this.owners.get(owner);
    if(previous&&!previous.closed&&previous.entry.key===key&&previous.entry.failure===undefined)return previous.lease;
    let entry=this.entries.get(key);
    if(!entry||entry.failure!==undefined){entry={key,appearance:structuredClone(appearance),definition,leases:new Set()};this.entries.set(key,entry);this.queue.push(entry);}
    let resolve!:(artifact:A)=>void,reject!:(error:unknown)=>void;
    const ready=new Promise<A>((yes,no)=>{resolve=yes;reject=no;});void ready.catch(()=>{});
    let record:LeaseRecord<A>;
    const lease={owner,generation:++this.generation,appearanceKey:key,ready,release:()=>this.releaseRecord(record)};
    record={lease,entry,closed:false,resolve,reject};entry.leases.add(record);this.owners.set(owner,record);
    if(entry.artifact)resolve(entry.artifact);
    if(previous)this.releaseRecord(previous);
    this.dispatch();return lease;
  }
  require(owner:string,key:string):A|undefined {const row=this.owners.get(owner);return !this.disposed&&row&&!row.closed&&row.entry.key===key?row.entry.artifact:undefined;}
  release(owner:string):void {const row=this.owners.get(owner);if(row)this.releaseRecord(row);}
  private releaseRecord(row:LeaseRecord<A>):void {
    if(row.closed)return;row.closed=true;if(this.owners.get(row.lease.owner)===row)this.owners.delete(row.lease.owner);
    row.entry.leases.delete(row);row.reject(preparationCancelled());this.collect(row.entry);
  }
  private collect(entry:Entry<A>):void {
    if(entry.leases.size||this.active===entry)return;
    if(this.entries.get(entry.key)===entry)this.entries.delete(entry.key);
    const index=this.queue.indexOf(entry);if(index>=0)this.queue.splice(index,1);entry.artifact=undefined;
  }
  private dispatch():void {
    if(this.disposed||this.active)return;const entry=this.queue.shift();if(!entry)return;
    if(!entry.leases.size){this.collect(entry);this.dispatch();return;}this.active=entry;
    void this.run(entry).finally(()=>{
      if(this.active===entry)this.active=undefined;
      for(const row of entry.leases)if(!row.closed){if(entry.artifact)row.resolve(entry.artifact);else if(entry.failure!==undefined)row.reject(entry.failure);}
      this.collect(entry);this.dispatch();
    });
  }
  private async run(entry:Entry<A>):Promise<void> {
    try{
      const artifact=await entry.definition.prepare(entry.appearance,{
        inputPrepared:()=>{this.inputPreparations++;},compiled:()=>{if(this.disposed||!entry.leases.size)throw preparationCancelled();this.compilations++;},
        findReady:key=>{for(const other of this.entries.values())if(other!==entry&&other.artifact?.key===key)return other.artifact;return undefined;},
      });
      if(this.disposed||!entry.leases.size){this.discardedResults++;return;}entry.artifact=artifact;
    }catch(error){
      if(this.disposed)return;
      if(!entry.leases.size){this.discardedResults++;return;}
      entry.failure=error instanceof Error?error:new Error(String(error));this.lastError=(entry.failure as Error).message;
      const diagnostic=entry.failure as Error&{workerStack?:string;workerErrorName?:string;workerKind?:string};
      this.lastWorkerError=diagnostic.workerStack?{name:diagnostic.workerErrorName??null,kind:diagnostic.workerKind??null,stack:diagnostic.workerStack}:null;
    }
  }
  diagnostics(){let ready=0;for(const entry of this.entries.values())if(entry.artifact)ready++;
    return {owners:this.owners.size,entries:this.entries.size,queued:this.queue.length,inFlight:Number(!!this.active),ready,
      generations:this.generation,inputPreparations:this.inputPreparations,compilations:this.compilations,discardedResults:this.discardedResults,lastError:this.lastError,lastWorkerError:this.lastWorkerError,disposed:this.disposed};}
  dispose():void {if(this.disposed)return;this.disposed=true;for(const row of this.owners.values())this.releaseRecord(row);this.active=undefined;this.queue.length=0;this.entries.clear();}
}
