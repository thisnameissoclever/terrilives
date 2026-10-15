import {validateAppearance} from '../../character/schema.js';
import {canonicalSleepValue,sleepContactAppearance,sleepContactAppearanceKey} from './sleep-contact-identity.js';
import {SLEEP_ACTIONS,SLEEP_CONTACT_SOLVER_REVISION,type SleepContactInputDataV1,type SleepContactInputV1,type SleepContactArtifactV1} from './sleep-contact-types.js';

function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid sleep contact record.');return value as Record<string,unknown>;}
function text(value:unknown,max=16384):asserts value is string {if(typeof value!=='string'||!value.length||value.length>max)throw new Error('Invalid sleep contact identifier.');}
function finite(value:unknown):asserts value is number {if(typeof value!=='number'||!Number.isFinite(value))throw new Error('Sleep contact values must be finite.');}
function numbers(value:unknown,count:number):asserts value is number[]{
  if(!Array.isArray(value)||value.length!==count)throw new Error('Invalid sleep contact array.');
  for(let i=0;i<count;i++){if(!Object.hasOwn(value,i))throw new Error('Sparse sleep contact arrays are invalid.');finite(value[i]);if(!Object.is(Math.fround(value[i]),value[i]))throw new Error('Sleep contact arrays must preserve Float32 values.');}
}
function header(value:unknown):Record<string,unknown>{
  const row=record(value);if(row.version!==1||row.solverRevision!==SLEEP_CONTACT_SOLVER_REVISION)throw new Error('Unsupported sleep contact version.');
  text(row.appearanceKey);const revisions=record(row.revisions);for(const name of ['source','body','bed','bunk'])text(revisions[name],4096);return row;
}
function key(value:unknown):void {if(typeof value!=='string'||!/^sleep-v1:[a-f0-9]{64}$/.test(value))throw new Error('Invalid sleep contact key.');}
export function validateSleepContactInputData(value:unknown):asserts value is SleepContactInputDataV1 {
  const row=header(value);const appearance=validateAppearance(row.appearance);
  if(sleepContactAppearanceKey(appearance)!==row.appearanceKey||canonicalSleepValue(appearance)!==row.appearanceKey)throw new Error('Sleep contact appearance identity differs.');
}
export function validateSleepContactInput(value:unknown):asserts value is SleepContactInputV1 {validateSleepContactInputData(value);key((value as SleepContactInputV1).key);}
export async function sleepContactDigest(value:unknown):Promise<string> {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalSleepValue(value)));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function makeSleepContactInput(data:SleepContactInputDataV1):Promise<SleepContactInputV1> {
  const appearance=sleepContactAppearance(data.appearance),normalized={...data,appearance,appearanceKey:sleepContactAppearanceKey(appearance)};
  validateSleepContactInputData(normalized);return {...normalized,key:'sleep-v1:'+await sleepContactDigest(normalized)};
}
export async function verifySleepContactInput(input:SleepContactInputV1):Promise<void> {
  validateSleepContactInput(input);const {key:actual,...data}=input;
  if((await makeSleepContactInput(data)).key!==actual)throw new Error('Sleep contact input key does not match its contents.');
}
export function validateSleepContactArtifact(value:unknown):asserts value is SleepContactArtifactV1 {
  const row=header(value);key(row.key);const clips=record(row.clips);
  for(const action of SLEEP_ACTIONS){
    const clip=record(clips[action]);if(clip.action!==action||clip.sourcePhase!==0)throw new Error('Invalid sleeping clip artifact.');
    text(clip.source);text(clip.partKey);text(clip.shapeKey);finite(clip.top);if(clip.top<=0)throw new Error('Invalid sleeping anatomical height.');
    if(!Array.isArray(clip.matrices)||clip.matrices.length<17*16||clip.matrices.length>512*16||clip.matrices.length%16)throw new Error('Invalid sleeping matrix count.');
    numbers(clip.matrices,clip.matrices.length);
    const offsets=action==='bed_sleep'?[0,-.77]:[0];
    if(!Array.isArray(clip.covers)||clip.covers.length!==offsets.length)throw new Error('Invalid sleeping slot count.');
    for(let i=0;i<offsets.length;i++){
      const cover=record(clip.covers[i]);if(!Object.is(cover.offsetX,offsets[i]))throw new Error('Invalid sleeping slot placement.');
      numbers(cover.heights,action==='bed_sleep'?49*45:25*45);
    }
  }
}
export function freezeSleepContactArtifact(artifact:SleepContactArtifactV1):SleepContactArtifactV1 {
  validateSleepContactArtifact(artifact);
  const freeze=(value:unknown):void=>{if(!value||typeof value!=='object'||Object.isFrozen(value))return;for(const child of Object.values(value))freeze(child);Object.freeze(value);};
  freeze(artifact);return artifact;
}
