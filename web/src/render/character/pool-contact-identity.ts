import type {CharacterAppearanceV1} from '../../character/schema.js';
import type {Geometry} from './bundle.js';
import type {ShapeParameters} from './shape.js';
import {canonicalSleepValue,sleepContactAppearance,sleepShapeKey} from './sleep-contact-identity.js';

export const canonicalPoolValue=canonicalSleepValue;
export const poolContactAppearance=sleepContactAppearance;
export const poolShapeKey=sleepShapeKey;
export function poolContactAppearanceKey(appearance:CharacterAppearanceV1):string{return canonicalPoolValue(poolContactAppearance(appearance));}

/** Compare exactly the supplied byte ranges without creating reusable validation authority. */
export function poolByteViewsEqual(left:Uint8Array,right:Uint8Array):boolean {
  const length=left.byteLength;if(length!==right.byteLength)return false;let offset=0;
  if(left.byteOffset%4===0&&right.byteOffset%4===0){
    const count=Math.floor(length/4),a=new Uint32Array(left.buffer,left.byteOffset,count),b=new Uint32Array(right.buffer,right.byteOffset,count);
    for(let word=0;word<count;word++)if(a[word]!==b[word])return false;offset=count*4;
  }
  for(;offset<length;offset++)if(left[offset]!==right[offset])return false;
  return true;
}
const keys=new WeakMap<Geometry,string>();

/** Bind the selected physical mesh, including its skinning and subdivision inputs. */
export function poolPartKey(geometry:Geometry):string {
  const saved=keys.get(geometry);if(saved)return saved;
  let first=2166136261,second=2246822519;
  const word=(value:number)=>{first=Math.imul(first^value,16777619);second=Math.imul(second^value,3266489917);};
  const floating=new Float64Array(1),bits=new Uint32Array(floating.buffer);
  const visit=(value:unknown):void=>{
    if(typeof value==='number'){floating[0]=value;word(bits[0]);word(bits[1]);return;}
    if(typeof value==='string'){word(value.length);for(let i=0;i<value.length;i++)word(value.charCodeAt(i));return;}
    if(typeof value==='boolean'){word(value?1:0);return;}
    if(value===null||value===undefined){word(0xffffffff);return;}
    if(Array.isArray(value)){word(value.length);for(const child of value)visit(child);return;}
    for(const name of Object.keys(value as object).sort()){visit(name);visit((value as Record<string,unknown>)[name]);}
  };
  for(const buffer of [geometry.vertices,geometry.cage,geometry.indices,geometry.stencilRanges,geometry.normalRanges,geometry.normalTriangles]){
    word(buffer.byteLength);const values=new Uint32Array(buffer.buffer,buffer.byteOffset,buffer.byteLength/4);for(const value of values)word(value);
  }
  for(const value of new Uint32Array(geometry.stencilWeights))word(value);
  if(geometry.fixtureGeometry&&geometry.fixtureGeometry!==geometry){
    const fixture=geometry.fixtureGeometry;visit(fixture.description.parts);
    for(const buffer of [fixture.vertices,fixture.cage,fixture.indices,fixture.stencilRanges]){
      const values=new Uint32Array(buffer.buffer,buffer.byteOffset,buffer.byteLength/4);word(values.length);for(const value of values)word(value);
    }
    for(const value of new Uint32Array(fixture.stencilWeights))word(value);
  }
  visit(geometry.manifest.bones);
  for(const action of Object.keys(geometry.manifest.actions).filter(name=>name.startsWith('pool_')).sort()){
    visit(action);visit(geometry.manifest.actions[action]);visit(geometry.manifest.basisActions[action]);visit(geometry.manifest.clipMetadata?.[action]);
  }
  const key=canonicalPoolValue([geometry.description.parts.map(p=>[p.name,p.start,p.count,p.region]),first>>>0,second>>>0]);keys.set(geometry,key);return key;
}

export function poolShapeIdentity(appearance:ShapeParameters,top:number):string{return poolShapeKey(appearance,top);}
