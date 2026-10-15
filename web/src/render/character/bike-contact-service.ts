import type {CharacterAppearanceV1} from '../../character/schema.js';
import type {BikeContactArtifactV1,BikeContactInputV1} from './bike-contact-types.js';
import {freezeBikeContactArtifact,validateBikeContactInput,validateBikeContactResponse} from './bike-contact-protocol.js';
import {bikeContactAppearanceKey,prepareBikeContactForAppearance} from './bike-contact-preparation.js';
import {WorkerBikeContactTransport,type BikeContactTransport} from './bike-contact-transport.js';
import {BikeContactNotReadyError} from './bike-contact-sample.js';
import {PreparationQueue,type PreparationLease,type PreparationDefinition} from './preparation-queue.js';
export {bikeContactAppearanceKey,BikeContactNotReadyError};
export type {BikeContactTransport} from './bike-contact-transport.js';
export type BikeContactLease=PreparationLease<BikeContactArtifactV1>;
export interface BikeContactServiceOptions {
  inputFactory?:(appearance:CharacterAppearanceV1)=>Promise<BikeContactInputV1>;
  transportFactory?:()=>BikeContactTransport;
}

/** Compatibility service for explicit bike-only clients; the game uses full character preparation. */
export class BikeContactService {
  private readonly queue=new PreparationQueue<BikeContactArtifactV1>();
  private transport:BikeContactTransport|undefined;
  private sequence=0;
  private readonly definition:PreparationDefinition<BikeContactArtifactV1>;
  constructor(options:BikeContactServiceOptions={}){
    const inputFactory=options.inputFactory??prepareBikeContactForAppearance;
    this.definition={key:bikeContactAppearanceKey,prepare:async(appearance,work)=>{
      work.inputPrepared();const input=await inputFactory(appearance);validateBikeContactInput(input);
      const saved=work.findReady(input.key);if(saved)return saved;
      work.compiled();this.transport??=(options.transportFactory??(()=>new WorkerBikeContactTransport()))();
      const id=++this.sequence;
      try{
        const response=await this.transport.run({version:1,id,input});validateBikeContactResponse(response);
        if(response.id!==id)throw new Error('Bike contact response does not match its request.');
        if(!response.ok)throw new Error(response.error);
        const artifact=freezeBikeContactArtifact(response.artifact);
        if(artifact.key!==input.key||artifact.shapeKey!==input.shapeKey||artifact.shoeKey!==input.shoeKey
          ||artifact.revisions.source!==input.revisions.source||artifact.revisions.fixture!==input.revisions.fixture||artifact.revisions.shoes!==input.revisions.shoes)
          throw new Error('Bike contact artifact does not match its input.');
        return artifact;
      }catch(error){this.transport?.dispose();this.transport=undefined;throw error;}
    }};
  }
  acquire(owner:string,appearance:CharacterAppearanceV1):BikeContactLease{return this.queue.acquire(owner,appearance,this.definition);}
  require(owner:string,appearance:CharacterAppearanceV1):BikeContactArtifactV1 {
    const artifact=this.queue.require(owner,bikeContactAppearanceKey(appearance));if(!artifact)throw new BikeContactNotReadyError();return artifact;
  }
  release(owner:string):void {this.queue.release(owner);}
  diagnostics(){return {...this.queue.diagnostics(),workerAlive:!!this.transport};}
  dispose():void {this.queue.dispose();this.transport?.dispose();this.transport=undefined;}
}
