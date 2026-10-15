import {characterPreparationKey,type CharacterPreparationLease,type CharacterPreparation} from '../../src/render/character/character-preparation-service.js';

import type {CharacterAppearanceV1} from '../../src/character/schema.js';
import type {ContactService} from '../../src/render/character/contact-admission.js';

interface Entry {key:string;ready:Promise<CharacterPreparation>;resolve:(value:CharacterPreparation)=>void;reject:(error:unknown)=>void;artifact?:CharacterPreparation}

/** Opaque artifacts isolate owner/admission behavior from the independently tested solver. */
export class AdmissionTestService implements ContactService {
  readonly owners=new Map<string,CharacterPreparationLease>();
  readonly entries=new Map<string,Entry>();
  requests=0;
  private generation=0;
  acquire(owner:string,appearance:CharacterAppearanceV1):CharacterPreparationLease {
    const key=characterPreparationKey(appearance),old=this.owners.get(owner);if(old?.appearanceKey===key)return old;
    let entry=this.entries.get(key);
    if(!entry){
      let resolve!:Entry['resolve'],reject!:Entry['reject'];const ready=new Promise<CharacterPreparation>((yes,no)=>{resolve=yes;reject=no;});void ready.catch(()=>{});
      entry={key,ready,resolve,reject};this.entries.set(key,entry);this.requests++;
    }
    const lease:CharacterPreparationLease={owner,generation:++this.generation,appearanceKey:key,ready:entry.ready,
      release:()=>{if(this.owners.get(owner)!==lease)return;this.owners.delete(owner);this.collect(key);}};
    this.owners.set(owner,lease);if(old)this.collect(old.appearanceKey);return lease;
  }
  require(owner:string,appearance:CharacterAppearanceV1):CharacterPreparation {
    const key=characterPreparationKey(appearance),lease=this.owners.get(owner),artifact=this.entries.get(key)?.artifact;
    if(!lease||lease.appearanceKey!==key||!artifact)throw new Error('Character contacts are not ready.');return artifact;
  }
  release(owner:string):void {this.owners.get(owner)?.release();}
  private collect(key:string):void {
    if([...this.owners.values()].some(lease=>lease.appearanceKey===key))return;
    const entry=this.entries.get(key);if(!entry)return;this.entries.delete(key);
    const error=new Error('Superseded');error.name='AbortError';entry.reject(error);
  }
  finish(appearance:CharacterAppearanceV1):void {
    const key=characterPreparationKey(appearance),entry=this.entries.get(key);if(!entry)throw new Error('No requested configuration.');
    entry.artifact={bike:{key},sleep:{key}} as CharacterPreparation;entry.resolve(entry.artifact);
  }
  finishAll():void {for(const entry of this.entries.values())if(!entry.artifact){entry.artifact={bike:{key:entry.key},sleep:{key:entry.key}} as CharacterPreparation;entry.resolve(entry.artifact);}}
  fail(appearance:CharacterAppearanceV1):void {this.entries.get(characterPreparationKey(appearance))!.reject(new Error('Contact preparation failed.'));}
}
