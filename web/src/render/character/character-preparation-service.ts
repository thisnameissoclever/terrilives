import type {CharacterAppearanceV1} from '../../character/schema.js';
import {recordDiagnostic} from '../../diagnostics.js';
import {bikeContactAppearanceKey,prepareBikeContactForAppearance} from './bike-contact-preparation.js';
import {createSleepContactInput,sleepContactAppearanceKey} from './sleep-contact-preparation.js';
import {freezeBikeContactArtifact,validateBikeContactInput} from './bike-contact-protocol.js';
import {freezeSleepContactArtifact,validateSleepContactInput} from './sleep-contact-protocol.js';
import type {BikeContactArtifactV1,BikeContactInputV1} from './bike-contact-types.js';
import type {SleepContactArtifactV1,SleepContactInputV1} from './sleep-contact-types.js';
import {createSeatContactInput,seatContactAppearanceKey} from './seat-contact-preparation.js';
import {freezeSeatContactArtifact,validateSeatContactInput} from './seat-contact-protocol.js';
import type {SeatContactArtifactV1,SeatContactInputV1} from './seat-contact-types.js';
import {PreparationQueue,preparationCancelled,type PreparationLease,type PreparationDefinition} from './preparation-queue.js';
import {WorkerPreparationTransport,type PreparationTransport} from './preparation-transport.js';
import {validatePreparationResponse,type PreparationArtifact,type PreparationRequest} from './preparation-protocol.js';

export interface CharacterPreparation {readonly bike:BikeContactArtifactV1;readonly sleep:SleepContactArtifactV1;readonly seat:SeatContactArtifactV1}
export type CharacterPreparationLease=PreparationLease<CharacterPreparation>;
export const characterPreparationKey=(appearance:CharacterAppearanceV1)=>JSON.stringify([bikeContactAppearanceKey(appearance),sleepContactAppearanceKey(appearance),seatContactAppearanceKey(appearance)]);
export class CharacterPreparationNotReadyError extends Error {
  constructor(){super('Character support must be prepared before admitting this appearance.');this.name='CharacterPreparationNotReadyError';}
}
interface Owner {lease:CharacterPreparationLease;parts:PreparationLease<PreparationArtifact>[];closed:boolean;artifact?:CharacterPreparation;failure?:unknown;reject:(error:unknown)=>void}
let serviceSequence=0;
export interface CharacterPreparationServiceOptions {
  bikeInputFactory?:(appearance:CharacterAppearanceV1)=>Promise<BikeContactInputV1>;
  sleepInputFactory?:(appearance:CharacterAppearanceV1)=>Promise<SleepContactInputV1>;
  seatInputFactory?:(appearance:CharacterAppearanceV1)=>Promise<SeatContactInputV1>;
  transportFactory?:()=>PreparationTransport;
}

/** Required support is independently keyed, but every expensive job uses the same worker. */
export class CharacterPreparationService {
  private readonly diagnosticId=++serviceSequence;
  private readonly queue=new PreparationQueue<PreparationArtifact>();
  private readonly owners=new Map<string,Owner>();
  private readonly bike:PreparationDefinition<PreparationArtifact>;
  private readonly sleep:PreparationDefinition<PreparationArtifact>;
  private readonly seat:PreparationDefinition<PreparationArtifact>;
  private transport:PreparationTransport|undefined;
  private sequence=0;private generation=0;private disposed=false;
  constructor(private readonly options:CharacterPreparationServiceOptions={}){
    this.bike={key:a=>'bike:'+bikeContactAppearanceKey(a),prepare:async(a,work)=>{
      work.inputPrepared();const input=await(options.bikeInputFactory??prepareBikeContactForAppearance)(a);validateBikeContactInput(input);
      const saved=work.findReady(input.key);if(saved)return saved;
      work.compiled();const artifact=freezeBikeContactArtifact(await this.compile({version:1,id:++this.sequence,kind:'bike',input}) as BikeContactArtifactV1);
      if(artifact.key!==input.key||artifact.shapeKey!==input.shapeKey||artifact.shoeKey!==input.shoeKey
        ||artifact.revisions.source!==input.revisions.source||artifact.revisions.fixture!==input.revisions.fixture||artifact.revisions.shoes!==input.revisions.shoes)
        throw new Error('Bike contact artifact does not match its input.');return artifact;
    }};
    this.sleep={key:a=>'sleep:'+sleepContactAppearanceKey(a),prepare:async(a,work)=>{
      work.inputPrepared();const input=await(options.sleepInputFactory??createSleepContactInput)(a);validateSleepContactInput(input);
      const saved=work.findReady(input.key);if(saved)return saved;
      work.compiled();const artifact=freezeSleepContactArtifact(await this.compile({version:1,id:++this.sequence,kind:'sleep',input}) as SleepContactArtifactV1);
      if(artifact.key!==input.key||artifact.appearanceKey!==input.appearanceKey
        ||Object.keys(input.revisions).some(name=>artifact.revisions[name as keyof typeof input.revisions]!==input.revisions[name as keyof typeof input.revisions]))
        throw new Error('Sleeping support artifact does not match its input.');return artifact;
    }};
    this.seat={key:a=>'seat:'+seatContactAppearanceKey(a),prepare:async(a,work)=>{
      work.inputPrepared();const input=await(options.seatInputFactory??createSeatContactInput)(a);validateSeatContactInput(input);
      const saved=work.findReady(input.key);if(saved)return saved;
      work.compiled();const artifact=freezeSeatContactArtifact(await this.compile({version:1,id:++this.sequence,kind:'seat',input}) as SeatContactArtifactV1);
      if(artifact.key!==input.key||artifact.appearanceKey!==input.appearanceKey
        ||Object.keys(input.revisions).some(name=>artifact.revisions[name as keyof typeof input.revisions]!==input.revisions[name as keyof typeof input.revisions]))
        throw new Error('Seated support artifact does not match its input.');return artifact;
    }};
  }
  private async compile(request:PreparationRequest):Promise<PreparationArtifact>{
    const id=`preparation:${this.diagnosticId}:${request.id}`,started=Date.now();recordDiagnostic('worker.prepare',{id,state:'start',kind:request.kind});
    try{this.transport??=(this.options.transportFactory??(()=>new WorkerPreparationTransport()))();
      const response=await this.transport.run(request);validatePreparationResponse(response);
      if(response.id!==request.id||response.kind!==request.kind)throw new Error('Character preparation response does not match its request.');
      if(!response.ok){const error=new Error(response.error);Object.assign(error,{workerStack:response.workerStack,workerErrorName:response.errorName,workerKind:response.kind});throw error;}
      recordDiagnostic('worker.prepare',{id,state:'complete',kind:request.kind,elapsedMs:Date.now()-started});return response.artifact;
    }catch(error){
      const cancelled=error instanceof Error&&error.name==='AbortError';
      recordDiagnostic('worker.prepare',{id,state:cancelled?'complete':'failed',kind:request.kind,cancelled,elapsedMs:Date.now()-started},cancelled?undefined:error);
      this.transport?.dispose();this.transport=undefined;throw error;}
  }
  acquire(owner:string,appearance:CharacterAppearanceV1):CharacterPreparationLease {
    if(this.disposed)throw new Error('The character preparation service is disposed.');
    if(!owner||owner.length>16384)throw new Error('Invalid character preparation owner.');
    const key=characterPreparationKey(appearance),previous=this.owners.get(owner);
    if(previous&&!previous.closed&&previous.failure===undefined&&previous.lease.appearanceKey===key)return previous.lease;
    const requested=structuredClone(appearance);
    const parts=[this.queue.acquire(owner+':bike',requested,this.bike),this.queue.acquire(owner+':sleep',requested,this.sleep),this.queue.acquire(owner+':seat',requested,this.seat)];
    let resolve!:(value:CharacterPreparation)=>void,reject!:(error:unknown)=>void;
    const ready=new Promise<CharacterPreparation>((yes,no)=>{resolve=yes;reject=no;});void ready.catch(()=>{});
    let record:Owner;
    const lease={owner,generation:++this.generation,appearanceKey:key,ready,release:()=>this.releaseRecord(record)};
    record={lease,parts,closed:false,reject};this.owners.set(owner,record);
    if(previous)this.releaseRecord(previous,new Set(parts));
    const prepared=this.lookup(owner,requested);if(prepared){record.artifact=prepared;resolve(prepared);}
    else void Promise.all(parts.map(part=>part.ready)).then(()=>{
      if(record.closed)return;const artifact=this.lookup(owner,requested);
      if(!artifact){reject(new CharacterPreparationNotReadyError());return;}record.artifact=artifact;resolve(artifact);
    },error=>{record.failure=error;reject(error);});
    return lease;
  }
  private lookup(owner:string,appearance:CharacterAppearanceV1):CharacterPreparation|undefined {
    const bike=this.queue.require(owner+':bike',this.bike.key(appearance)) as BikeContactArtifactV1|undefined;
    const sleep=this.queue.require(owner+':sleep',this.sleep.key(appearance)) as SleepContactArtifactV1|undefined;
    const seat=this.queue.require(owner+':seat',this.seat.key(appearance)) as SeatContactArtifactV1|undefined;
    return bike&&sleep&&seat?Object.freeze({bike,sleep,seat}):undefined;
  }
  require(owner:string,appearance:CharacterAppearanceV1):CharacterPreparation {
    const record=this.owners.get(owner);
    if(this.disposed||!record||record.closed||record.lease.appearanceKey!==characterPreparationKey(appearance))throw new CharacterPreparationNotReadyError();
    const artifact=record.artifact??=this.lookup(owner,appearance);if(!artifact)throw new CharacterPreparationNotReadyError();return artifact;
  }
  release(owner:string):void {const record=this.owners.get(owner);if(record)this.releaseRecord(record);}
  private releaseRecord(record:Owner,preserve?:ReadonlySet<PreparationLease<PreparationArtifact>>):void {
    if(record.closed)return;record.closed=true;
    if(this.owners.get(record.lease.owner)===record)this.owners.delete(record.lease.owner);
    for(const part of record.parts)if(!preserve?.has(part))part.release();record.reject(preparationCancelled());
  }
  diagnostics(){const resources=this.queue.diagnostics();return {...resources,owners:this.owners.size,resourceOwners:resources.owners,workerAlive:!!this.transport};}
  dispose():void {if(this.disposed)return;this.disposed=true;for(const owner of this.owners.values())this.releaseRecord(owner);this.queue.dispose();this.transport?.dispose();this.transport=undefined;}
}
