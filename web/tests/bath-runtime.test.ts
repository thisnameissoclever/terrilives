import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {decodeGeometry,geometryBuffers,type Bundle,type Geometry,type MeshDescription} from '../src/render/character/bundle.js';
import {combineClipFamily,type ClipLibrary,type ClipParts} from '../src/render/character/clip-runtime.js';
import {defaultAppearance} from '../src/character/schema.js';
import {selectGeometry} from '../src/render/character/variants.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {posedPositions} from '../src/render/character/geometry-proof.js';
import {bathAnimationSample,bathToySelector} from '../src/render/character/bath-motion.js';
import {configuredPoseForProof} from '../src/render/character/pose.js';
import type {PoseDiagnostics} from '../src/render/character/contact-types.js';
import {SupportSurface} from '../src/render/character/support-surface.js';
import {PoolSolidIndex,type Triangle} from '../src/render/character/pool-solid.js';
import type {Vec3} from '../src/render/character/math.js';

const root=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('export/manifest.json',root),'utf8')) as Bundle;
const library=JSON.parse(readFileSync(new URL('clips/clips.json',root),'utf8')) as ClipLibrary;
const parts=JSON.parse(readFileSync(new URL('clips/bath/parts.json',root),'utf8')) as ClipParts;
function load(description:MeshDescription,folder:string):Geometry {
  const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(folder+'/'+description[key],root))).buffer]));
  return decodeGeometry({...manifest,runtime:description},'runtime',buffers as Record<typeof geometryBuffers[number],ArrayBuffer>);
}
const source=combineClipFamily(load(manifest.runtime,'export'),load(parts.geometry!,'clips/bath'),parts,library,'bath');
const bodies=[{height:50,build:50,shoulders:50,hips:50,torso:50},
  {height:0,build:0,shoulders:0,hips:0,torso:100},
  {height:100,build:100,shoulders:100,hips:100,torso:0},
  {height:100,build:0,shoulders:0,hips:100,torso:100},
  {height:0,build:100,shoulders:100,hips:0,torso:0}];
const point=(positions:Float32Array,index:number)=>Array.from(positions.subarray(index*3,index*3+3));
const binary=new DataView(new ArrayBuffer(4));
function exactFloat(value:number):bigint {
  binary.setFloat32(0,value,true);const bits=binary.getUint32(0,true),exponent=(bits>>>23)&255;
  if(exponent===255)throw new Error('Non-finite water footprint coordinate.');
  const mantissa=BigInt((bits&0x7fffff)+(exponent?0x800000:0));
  return (bits>>>31?-mantissa:mantissa)<<BigInt(exponent?exponent-1:0);
}
type ExactPoint=readonly [bigint,bigint];
const exactPoint=(p:readonly number[]):ExactPoint=>[exactFloat(p[0]),exactFloat(p[1])];
const turn=(a:ExactPoint,b:ExactPoint,c:ExactPoint)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function mesh(geometry:Geometry,positions:Float32Array,name:string){
  const part=geometry.description.parts.find(part=>part.name===name)!;
  const ids=[...new Set(geometry.indices.subarray(part.start,part.start+part.count))],local=new Map(ids.map((id,index)=>[id,index]));
  const points=ids.map(id=>point(positions,id) as unknown as Vec3),triangles:[number,number,number][]=[];
  for(let at=part.start;at<part.start+part.count;at+=3)triangles.push([0,1,2].map(offset=>local.get(geometry.indices[at+offset])!) as [number,number,number]);
  return {points,triangles};
}
function basin(geometry:Geometry,positions:Float32Array){
  const shell=mesh(geometry,positions,'Creator clip bath Bathtub continuous shell');
  const surface=new SupportSurface(shell.points,shell.triangles);
  const low=[0,1,2].map(axis=>Math.min(...shell.points.map(p=>p[axis]))) as unknown as Vec3;
  const high=[0,1,2].map(axis=>Math.max(...shell.points.map(p=>p[axis]))) as unknown as Vec3;
  const solid=new PoolSolidIndex({id:'bath-shell',kind:'solid',vertices:shell.points,triangles:shell.triangles,bounds:[low,high]});
  const water=mesh(geometry,positions,'Creator clip bath Bath opaque water surface');
  expect(Math.max(...water.points.map(p=>p[2]))).toBe(Math.min(...water.points.map(p=>p[2])));
  const exact=water.points.map(exactPoint),edges=new Map<string,{a:number;b:number;count:number}>();
  let area=0n;
  for(const triangle of water.triangles){
    const value=turn(...triangle.map(index=>exact[index]) as [ExactPoint,ExactPoint,ExactPoint]);
    expect(value).not.toBe(0n);if(area)expect(value>0n).toBe(area>0n);area+=value;
    for(let i=0;i<3;i++){
      const a=triangle[i],b=triangle[(i+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(':');
      const old=edges.get(key);
      if(old){expect([old.a,old.b]).toEqual([b,a]);old.count++;expect(old.count).toBe(2);}
      else edges.set(key,{a,b,count:1});
    }
  }
  const boundary=[...edges.values()].filter(edge=>edge.count===1),next=new Map(boundary.map(edge=>[edge.a,edge.b]));
  expect(next.size).toBe(boundary.length);expect(next.size).toBe(water.points.length);
  expect(water.triangles.length).toBe(water.points.length-2);
  const loop=[boundary[0].a];let at=next.get(loop[0])!;
  while(at!==loop[0]){expect(loop).not.toContain(at);loop.push(at);at=next.get(at)!;expect(at).toBeDefined();}
  expect(loop.length).toBe(boundary.length);if(area<0n)loop.reverse();
  const polygon=loop.map(index=>exact[index]);
  for(let i=0;i<polygon.length;i++)expect(turn(polygon[i],polygon[(i+1)%polygon.length],polygon[(i+2)%polygon.length])>=0n).toBe(true);
  return {surface,solid,water:water.points[0][2],insideWater:(p:readonly number[])=>{
    const candidate=exactPoint(p);
    return polygon.every((a,index)=>turn(a,polygon[(index+1)%polygon.length],candidate)>=0n);
  }};
}

it('uses one native toy identity and a paused native clock for the complete play cycle',()=>{
  expect([0,1,2,3].map(bathToySelector)).toEqual(['none','duck','boat','submarine']);
  for(const bad of [-1,.5,4,NaN])expect(()=>bathToySelector(bad)).toThrow();
  expect(bathAnimationSample(36,24,false)).toBe(0);
  expect(bathAnimationSample(9,24,false)).toBe(6);
  expect(bathAnimationSample(9,24,true)).toBe(0);
  expect(bathAnimationSample(9,24,false)).toBe(bathAnimationSample(9,24,false));
  for(const identity of [1,2,3]){
    const geometry=selectGeometry(source,defaultAppearance(),{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,clip:'bath',includeFixture:true,bathToy:bathToySelector(identity)});
    expect(geometry.description.parts.filter(part=>part.name.startsWith('Creator clip bath Bath play ')).map(part=>part.name))
      .toEqual(['Creator clip bath Bath play '+bathToySelector(identity)]);
  }
});

it('evaluates the complete play track and keeps engaged palms on the common toy grip',()=>{
  for(const presentation of ['masculine','feminine'] as const)for(const body of bodies){
    const appearance=defaultAppearance(presentation);appearance.body=body;
    const geometry=selectGeometry(source,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,clip:'bath',includeFixture:true,bathToy:'duck'});
    for(let sample=0;sample<library.clips.bath.samples.length;sample++){
      const diagnostics:PoseDiagnostics={contacts:[],assemblies:{}};
      const matrices=configuredPoseForProof(geometry.manifest,{presentation,...body,face:appearance.face},'bath',sample,anatomicalHeight(geometry.vertices),diagnostics,geometry);
      expect(Array.from(matrices).every(Number.isFinite)).toBe(true);
      for(const contact of diagnostics.contacts)expect(contact.error,JSON.stringify({presentation,body,sample,contact:contact.name})).toBeLessThan(.00001);
    }
  }
},120000);

it('keeps complete rendered legs and feet inside the actual basin below water through every play sample',()=>{
  for(const presentation of ['masculine','feminine'] as const)for(const body of bodies){
    const appearance=defaultAppearance(presentation);appearance.body=body;
    const geometry=selectGeometry(source,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,clip:'bath',includeFixture:true,bathToy:'duck'});
    const shape={presentation,...body,face:appearance.face},top=anatomicalHeight(geometry.vertices);
    const legs=geometry.description.parts.filter(part=>/^Creator bare (leg|foot) [LR]$/.test(part.name));
    expect(legs).toHaveLength(4);
    const vertices=[...new Set(legs.flatMap(part=>Array.from(geometry.indices.subarray(part.start,part.start+part.count))))];
    let worstFloor=-Infinity,worstWater=-Infinity,minGap=Infinity;
    let previous:number[]|undefined;
    for(let sample=0;sample<library.clips.bath.samples.length;sample++){
      const positions=posedPositions(geometry,shape,'bath',sample,top);
      const selected=vertices.flatMap(index=>point(positions,index));
      if(previous){expect(selected).toEqual(previous);continue;}previous=selected;
      const bounds=basin(geometry,positions);
      for(const index of vertices){
        const vertex=point(positions,index);
        expect(bounds.insideWater(vertex),JSON.stringify({presentation,body,index,vertex})).toBe(true);
        const floor=bounds.surface.height(vertex[0],vertex[1],'top');expect(floor).toBeDefined();
        worstFloor=Math.max(worstFloor,floor!-vertex[2]);
        worstWater=Math.max(worstWater,vertex[2]-bounds.water);
      }
      for(const part of legs)for(let at=part.start;at<part.start+part.count;at+=3){
        const triangle=[0,1,2].map(offset=>point(positions,geometry.indices[at+offset])) as unknown as Triangle;
        minGap=Math.min(minGap,bounds.solid.minimumTriangleGap(triangle));
      }
    }
    const label=JSON.stringify({presentation,body});
    expect(worstFloor,label).toBeLessThanOrEqual(0);expect(worstWater,label).toBeLessThanOrEqual(0);expect(minGap,label).toBeGreaterThan(0);
  }
},120000);
