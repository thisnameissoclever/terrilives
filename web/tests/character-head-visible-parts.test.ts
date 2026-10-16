import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {decodeGeometry,geometryBuffers,type Bundle,type Geometry,type MeshDescription,type MeshPart} from '../src/render/character/bundle.js';
import {combineClipFamily,type ClipLibrary,type ClipParts} from '../src/render/character/clip-runtime.js';
import {defaultAppearance} from '../src/character/schema.js';
import {configuredPose} from '../src/render/character/pose.js';
import {anatomicalHeight,shapeVertices} from '../src/render/character/shape.js';
import {identity,type Vec3} from '../src/render/character/math.js';
import {HeadEnvelope} from '../src/render/character/head-envelope.js';
import {HeadEnvelope as OriginalEnvelope} from './fixtures/head-envelope/original.js';
import {selectGeometry as originalSelection,type AppearanceContext} from './fixtures/head-envelope/variants-original.js';

const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('export/manifest.json',directory),'utf8')) as Bundle;
const library=JSON.parse(readFileSync(new URL('clips/clips.json',directory),'utf8')) as ClipLibrary;
function load(description:MeshDescription,folder:string){
  const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(folder+'/'+description[key],directory))).buffer]));
  return decodeGeometry({...manifest,runtime:description},'runtime',buffers as Record<typeof geometryBuffers[number],ArrayBuffer>);
}
const base=load(manifest.runtime,'export'),parts=JSON.parse(readFileSync(new URL('clips/cleaning/parts.json',directory),'utf8')) as ClipParts;
const union=combineClipFamily(base,parts.geometry?load(parts.geometry,'clips/cleaning'):null,parts,library,'cleaning');
const context:AppearanceContext={wear:'clothed',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'idle',grip:'relaxed'};
const contexts:AppearanceContext[]=[context,{...context,eyes_closed:true},{...context,wear:'bare'},
  {...context,wear:'bare',eyes_closed:true},{...context,clip:'mop',grip:'mop'},{...context,clip:'read',prop:'book'}];

it('retains the original compact selector independently of the prepared-rig selector',()=>{
  const text=readFileSync(new URL('./fixtures/head-envelope/variants-original.ts',import.meta.url),'utf8')
    .replaceAll("from '../../../src/character/","from '../../character/")
    .replaceAll("from '../../../src/render/character/","from './").replaceAll('\r\n','\n');
  expect(createHash('sha256').update(text).digest('hex')).toBe('5ce731aaf2093da3457b65064cbc59d5ef84d42806501e8c8836c283d07f0c9f');
});

it.each(['curl','bob','wave','crop','quiff','bald'])('matches compact selected %s heads through eyes, wear and grip masks',hairstyle=>{
  for(const presentation of ['masculine','feminine'] as const)for(const size of [0,100]){
    const appearance=defaultAppearance(presentation);appearance.hairstyle=hairstyle==='bald'?'curl':hairstyle;appearance.bald=hairstyle==='bald';appearance.glasses=true;
    appearance.body={height:size,build:size,shoulders:size,hips:size,torso:size};
    const shape={presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(union.vertices);
    const cage=shapeVertices(union.cage,shape,top),envelope=new HeadEnvelope(union);
    envelope.configure(cage);
    const matrices=configuredPose(union.manifest,shape,'read',1.5,top,undefined,union);envelope.pose(matrices);
    const points=Reflect.get(envelope,'points') as Float64Array,prepared=Reflect.get(envelope,'vertices') as {contributions:unknown}[];
    const unchanged=Buffer.from(points.buffer.slice(0)),contributions=prepared.map(vertex=>vertex.contributions);
    for(const selectionContext of contexts){
      const compact=originalSelection(union,appearance,selectionContext);
      const selected=compact.description.parts.map(part=>{
        const source=union.description.parts.find(candidate=>candidate.name===part.name&&candidate.count===part.count&&candidate.region===part.region);
        if(!source)throw new Error('A compact reference part has no union source.');return source;
      });
      const original=new OriginalEnvelope(compact);original.configure(shapeVertices(compact.cage,shape,top));original.pose(matrices);
      envelope.setVisibleParts(selected);
      for(let facing=0;facing<4;facing++)expect(envelope.top(facing*Math.PI/2)).toStrictEqual(original.top(facing*Math.PI/2));
      expect(Buffer.from(points.buffer).equals(unchanged)).toBe(true);
      prepared.forEach((vertex,index)=>expect(vertex.contributions).toBe(contributions[index]));
    }
  }
},30000);

function fixture(points:readonly Vec3[],indices:readonly number[],parts:MeshPart[],direct=true):Geometry {
  const vertices=new Float32Array(points.length*16),ranges=new Uint32Array(points.length*4),weights=new ArrayBuffer(points.length*8);
  const ids=new Uint32Array(weights),coefficients=new Float32Array(weights),adjacency=points.map(()=>[] as number[]);
  points.forEach((point,i)=>{vertices.set([...point,0,0,1,0,0,0,0,1,0,0,0,0,1],i*16);ranges.set([i,1,i,Number(direct)],i*4);ids[i*2]=i;coefficients[i*2+1]=1;});
  indices.forEach((index,i)=>adjacency[index].push(Math.floor(i/3)));
  const normalRanges=new Uint32Array(points.length*2),normalTriangles=new Uint32Array(indices.length);let at=0;
  adjacency.forEach((rows,i)=>{normalRanges.set([at,rows.length],i*2);normalTriangles.set(rows,at);at+=rows.length;});
  return {manifest,description:{vertexCount:points.length,cageCount:points.length,indexCount:indices.length,coefficientCount:points.length,parts},
    vertices,cage:vertices.slice(),indices:new Uint32Array(indices),stencilRanges:ranges,stencilWeights:weights,normalRanges,normalTriangles};
}
const part=(name:string,start:number,region=1):MeshPart=>({name,start,count:3,region,outline:false});
const matrices=()=>new Float32Array([...identity(),...identity()]);
function originalFor(geometry:Geometry,parts:readonly MeshPart[],pose:Float32Array<ArrayBuffer>,hairRegion:number|null=null,cage=geometry.cage):OriginalEnvelope {
  const selected={...geometry,cage,description:{...geometry.description,parts:[...parts]}};
  const compact=originalSelection(selected,defaultAppearance(),context),original=new OriginalEnvelope(compact);
  original.configure(compact.cage,hairRegion);original.pose(pose);return original;
}

it('preserves first insertion tie order and last selected part metadata for shared indices',()=>{
  const a=part('Natural neck',0),b=part('Collar stand',3),outlined=part('Sculpted head',6);
  const geometry=fixture([[0,0,1],[1,1,1],[2,2,1]],[0,1,2,1,0,2,0,1,2],[a,b,outlined]);
  const envelope=new HeadEnvelope(geometry),pose=matrices();envelope.pose(pose);
  for(const selected of [[b,a],[outlined,a],[a,outlined],[a]]){
    const original=originalFor(geometry,selected,pose);envelope.setVisibleParts(selected);
    for(let facing=0;facing<4;facing++)expect(envelope.top(facing*Math.PI/2)).toStrictEqual(original.top(facing*Math.PI/2));
  }
  envelope.setVisibleParts([b,a]);expect(envelope.top(0)).toEqual([1,1,1]);
  envelope.setVisibleParts([outlined,a]);expect(envelope.top(0)[2]).toBe(1);
  envelope.setVisibleParts([a,outlined]);expect(envelope.top(0)[2]).toBe(1.004);
});

it('filters shared-vertex normal adjacency to the selected triangles',()=>{
  const a=part('Sculpted head',0),b=part('HAIR_01_TRIPO_CURL',3,8);
  const geometry=fixture([[0,0,1],[-1,0,0],[0,-1,0],[1,0,0],[0,1,0]],[0,1,2,0,3,4],[a,b],false);
  const pose=matrices(),envelope=new HeadEnvelope(geometry);envelope.pose(pose);
  const unmasked=envelope.top(0);
  for(const selected of [[a],[b],[b,a]]){
    envelope.setVisibleParts(selected);const original=originalFor(geometry,selected,pose);
    for(let facing=0;facing<4;facing++)expect(envelope.top(facing*Math.PI/2)).toStrictEqual(original.top(facing*Math.PI/2));
  }
  envelope.setVisibleParts([a]);expect(envelope.top(0)).not.toEqual(unmasked);
});

it('reuses immutable masks, preserves them through configure, and restores all parts with undefined',()=>{
  const a=part('Natural neck',0),b=part('Collar stand',3),geometry=fixture([[0,0,1],[1,1,1],[2,2,1]],[0,1,2,1,0,2],[a,b]);
  const indices=geometry.indices;let reads=0;Object.defineProperty(geometry,'indices',{get(){reads++;return indices;}});
  const envelope=new HeadEnvelope(geometry),pose=matrices(),first=[a],second=[b];envelope.pose(pose);
  const all=envelope.top(0);envelope.setVisibleParts(first);const result=envelope.top(0),selection=Reflect.get(envelope,'selection');
  reads=0;envelope.setVisibleParts(first);expect(reads).toBe(0);expect(envelope.top(0)).toBe(result);
  envelope.setVisibleParts(second);reads=0;envelope.setVisibleParts(first);expect(reads).toBe(0);expect(Reflect.get(envelope,'selection')).toBe(selection);
  const cage=geometry.cage.slice();cage[2]+=2;envelope.configure(cage);envelope.pose(pose);
  expect(Reflect.get(envelope,'selection')).toBe(selection);expect(envelope.top(0)).toStrictEqual(originalFor(geometry,first,pose,null,cage).top(0));
  envelope.setVisibleParts([]);expect(()=>envelope.top(0)).toThrow('no visible head');
  envelope.setVisibleParts(undefined);expect(envelope.top(0)).toStrictEqual(originalFor(geometry,geometry.description.parts,pose,null,cage).top(0));
  expect(envelope.top(0)).not.toEqual(all);
});

it('uses selected region metadata and still respects hidden bone flags',()=>{
  const a=part('Natural neck',0,8),b=part('Collar stand',3,9);
  const geometry=fixture([[0,0,1],[1,1,1],[2,2,1]],[0,1,2,1,0,2],[a,b]);
  const envelope=new HeadEnvelope(geometry),pose=matrices();envelope.configure(geometry.cage,8);envelope.pose(pose);
  envelope.setVisibleParts([a,b]);expect(()=>envelope.top(0)).toThrow('no visible head');
  envelope.setVisibleParts([b,a]);expect(envelope.top(0)).toStrictEqual(originalFor(geometry,[b,a],pose,8).top(0));
  const hidden=pose.slice();hidden[15]=-1;envelope.pose(hidden);expect(()=>envelope.top(0)).toThrow('no visible head');
});

it('reuses exact head results when only unrelated limb matrices change',()=>{
  const geometry=fixture([[0,0,1],[-1,0,0],[0,-1,0]],[0,1,2],[part('Sculpted head',0)]);
  const envelope=new HeadEnvelope(geometry),pose=matrices();envelope.pose(pose);const first=envelope.top(0);
  const limbs=pose.slice();limbs[16+12]=4;envelope.pose(limbs);
  expect(envelope.top(0)).toBe(first);
  limbs[14]+=1;envelope.pose(limbs);
  expect(envelope.top(0)[2]).toBe(first[2]+1);
});

it('invalidates head results for visibility, direct-normal dependencies, and signed zero',()=>{
  const geometry=fixture([[0,0,1],[-1,0,0],[0,-1,0]],[0,1,2],[part('Sculpted head',0)]);
  for(let i=0;i<3;i++){geometry.vertices[i*16+6]=1;geometry.cage[i*16+7]=1;}
  const envelope=new HeadEnvelope(geometry),pose=matrices();envelope.pose(pose);const first=envelope.top(0);
  const normalOnly=pose.slice();normalOnly[16+1]=.25;envelope.pose(normalOnly);const second=envelope.top(0);
  expect(second).toEqual(first);expect(second).not.toBe(first);
  const negativeZero=normalOnly.slice();negativeZero[1]=-0;envelope.pose(negativeZero);const third=envelope.top(0);
  expect(third).toEqual(second);expect(third).not.toBe(second);
  negativeZero[16+15]=-1;envelope.pose(negativeZero);
  expect(()=>envelope.top(0)).toThrow('no visible head');
});

it('invalidates prepared head dependencies when the configured surface changes',()=>{
  const geometry=fixture([[0,0,1],[-1,0,0],[0,-1,0]],[0,1,2],[part('Sculpted head',0)]);
  const envelope=new HeadEnvelope(geometry),pose=matrices();envelope.pose(pose);const first=envelope.top(0);
  const cage=geometry.cage.slice();for(let i=0;i<3;i++)cage[i*16+2]+=2;
  envelope.configure(cage);envelope.pose(pose);expect(envelope.top(0)[2]).toBe(first[2]+2);
});
