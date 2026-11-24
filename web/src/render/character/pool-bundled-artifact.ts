import type {PoolContactArtifactV1,PoolContactInputV1} from './pool-contact-types.js';
import {validatePoolArtifactForInput} from './pool-contact-protocol.js';

/** This index is part of the trusted release, separate from any file being loaded. */
export interface BundledPoolArtifact {
  key:string;
  sha256:string;
  byteLength:number;
  url:string;
}

type Row=Record<string,unknown>;
const row=(v:unknown):v is Row=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const minusZero=(_key:string,v:unknown)=>typeof v==='number'&&Object.is(v,-0)?{$poolNegativeZero:true}:v;
export const encodePoolRoute=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value,minusZero));
export function decodePoolRoute(bytes:Uint8Array<ArrayBuffer>):unknown {
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes),(_k,v:unknown)=>
    row(v)&&v.$poolNegativeZero===true&&Object.keys(v).length===1?-0:v);
}

/** Preserve shared rail geometry when moving a fully admitted worker result into a release asset. */
export function packCompletePoolArtifact(input:PoolContactInputV1,artifact:PoolContactArtifactV1):Uint8Array<ArrayBuffer> {
  validatePoolArtifactForInput(artifact,input);
  const indices=new WeakMap<object,number>(),byContent=new Map<string,number>(),rails:object[]=[];
  const body=JSON.stringify(artifact,(k,v)=>{
    if(k==='geometry'&&row(v)&&v.version==='pool-rail-goal-v1'){
      let index=indices.get(v);
      if(index===undefined){
        const encoded=JSON.stringify(v,minusZero);
        index=byContent.get(encoded);
        if(index===undefined){index=rails.length;rails.push(v);byContent.set(encoded,index);}
        indices.set(v,index);
      }
      return {$poolRail:index};
    }
    return minusZero(k,v);
  });
  return new TextEncoder().encode('{"format":1,"rails":'+JSON.stringify(rails,minusZero)+',"artifact":'+body+'}');
}

export function unpackCompletePoolArtifact(input:PoolContactInputV1,bytes:Uint8Array<ArrayBuffer>):PoolContactArtifactV1 {
  const packet=decodePoolRoute(bytes);
  if(!row(packet)||packet.format!==1||!Array.isArray(packet.rails)||!row(packet.artifact))throw new Error('Invalid bundled pool packet.');
  const rails=packet.rails;
  if(rails.some(v=>!row(v)||v.version!=='pool-rail-goal-v1'))throw new Error('Invalid bundled pool rail table.');
  const restore=(v:unknown):unknown=>{
    if(Array.isArray(v)){for(let i=0;i<v.length;i++)v[i]=restore(v[i]);}
    else if(row(v)){
      if(Object.hasOwn(v,'$poolRail')){
        const i=v.$poolRail;
        if(Object.keys(v).length!==1||typeof i!=='number'||!Number.isSafeInteger(i)||i<0||i>=rails.length)throw new Error('Invalid bundled pool rail reference.');
        return rails[i];
      }
      for(const k of Object.keys(v))v[k]=restore(v[k]);
    }
    return v;
  };
  const artifact=restore(packet.artifact);
  validatePoolArtifactForInput(artifact,input);
  return artifact;
}

/** A key miss or a missing optional asset uses cold preparation. A corrupted asset retains its diagnostic. */
export async function loadBundledPoolArtifact(input:PoolContactInputV1,catalog:readonly BundledPoolArtifact[],
  fetchAsset:(url:string)=>Promise<Response>=url=>fetch(url)):Promise<PoolContactArtifactV1|undefined> {
  const matches=catalog.filter(a=>a.key===input.key);
  if(!matches.length)return;
  const item=matches[0];
  if(matches.length!==1)throw new Error('Invalid bundled pool release index.');
  const bytes=await fetchPoolReleaseBytes(item,fetchAsset);
  return bytes?unpackCompletePoolArtifact(input,bytes):undefined;
}

export async function fetchPoolReleaseBytes(item:Omit<BundledPoolArtifact,'key'>,fetchAsset:(url:string)=>Promise<Response>=url=>fetch(url)){
  if(!Number.isSafeInteger(item.byteLength)||item.byteLength<=0||!/^[0-9a-f]{64}$/.test(item.sha256)||!item.url)
    throw new Error('Invalid bundled pool release index.');
  const response=await fetchAsset(item.url);
  if(response.status===404||response.status===410)return;
  if(!response.ok||!response.body)throw new Error('Bundled pool asset could not be loaded: '+response.status);
  const bytes=new Uint8Array(item.byteLength),reader=response.body.getReader();let length=0;
  try{
    for(;;){
      const part=await reader.read();if(part.done)break;
      if(part.value.length>bytes.length-length){await reader.cancel();throw new Error('Bundled pool asset exceeds its recorded byte length.');}
      bytes.set(part.value,length);length+=part.value.length;
    }
  }finally{reader.releaseLock();}
  if(length!==item.byteLength)throw new Error('Bundled pool asset is incomplete.');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  if(digest!==item.sha256)throw new Error('Bundled pool asset differs from its release digest.');
  return bytes;
}
