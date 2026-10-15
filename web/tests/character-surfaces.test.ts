import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {decodeGeometry,geometryBuffers,type Bundle,type Geometry} from '../src/render/character/bundle.js';
import {defaultAppearance} from '../src/character/schema.js';
import {selectGeometry} from '../src/render/character/variants.js';
import {authoredOutline} from '../src/render/character/authored-surfaces.js';
import {freckleCoordinates,freckleCoverage} from '../src/render/character/freckles.js';
import {HeadEnvelope,projectedHeadHeight} from '../src/render/character/head-envelope.js';
import {shapeVertices,anatomicalHeight} from '../src/render/character/shape.js';
import {configuredPose} from '../src/render/character/pose.js';
import {posedPositions} from '../src/render/character/geometry-proof.js';
import {identity} from '../src/render/character/math.js';
import {CharacterRenderer} from '../src/render/character/renderer.js';

const base=new URL('../../assets/models/sims/character-creator/export/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',base),'utf8')) as Bundle;
const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(manifest.runtime[key],base))).buffer]));
const source=decodeGeometry(manifest,'runtime',buffers as Record<typeof geometryBuffers[number],ArrayBuffer>);
const context={wear:'clothed' as const,prop:'none',fixture:'none',eyes_closed:false};

it('requires explicit outline ownership and leaves seams and recessed surfaces uninflated',()=>{
  for(const part of source.description.parts)expect(()=>authoredOutline(part.name)).not.toThrow();
  for(const name of ['Creator jacket zip','Natural neck','Collar stand','Pocket top seam','Creator clip bath Bath opaque water surface','Creator clip toilet Toilet recessed bowl'])expect(authoredOutline(name),name).toBe(false);
  for(const name of ['Sculpted head','Overshirt body','HAIR_01_TRIPO_CURL','Creator clip toilet Toilet upright lid'])expect(authoredOutline(name),name).toBe(true);
  expect(()=>authoredOutline('Unknown eye-catching structural mesh')).toThrow('outline ownership');
});

it('keeps freckles on the head and nose surfaces without sphere geometry or density steps',()=>{
  const appearance=defaultAppearance();appearance.freckles=true;
  const geometry=selectGeometry(source,appearance,context);
  expect(geometry.description.parts.some(part=>part.densityThreshold!==undefined)).toBe(false);
  for(const density of [0,1,4,5,6,49,50,51,99,100]){
    expect(selectGeometry(source,{...appearance,freckle_density:density},context)).toBe(geometry);
  }
  const coordinates=freckleCoordinates(geometry);
  for(const part of geometry.description.parts){
    const expected=Number(['Sculpted head','Small rounded nose'].includes(part.name));
    for(let i=part.start;i<part.start+part.count;i++)expect(coordinates[geometry.indices[i]*4+3],part.name).toBe(expected);
  }
  const samples=Array.from({length:16000},(_,i)=>[(i%160)/159*.36-.18,-.18,1.57+Math.floor(i/160)/99*.27] as const);
  let previous=0;
  for(const density of [0,1,4,5,6,49,50,51,99,100]){
    const coverage=samples.reduce((sum,p)=>sum+freckleCoverage(p,density/100),0)/samples.length;
    expect(coverage).toBeGreaterThanOrEqual(previous);if(density>0)expect(coverage).toBeGreaterThan(previous);
    previous=coverage;
  }
  expect(previous).toBeGreaterThan(.045);
  for(const range of [[1.59,1.65],[1.76,1.83]])expect(samples.filter(p=>p[2]>=range[0]&&p[2]<=range[1]).some(p=>freckleCoverage(p,1)>.4)).toBe(true);
  expect(freckleCoverage([0,.18,1.8],1)).toBe(0);
});

it('anchors above the posed projected head surface for every facing and body extreme',()=>{
  for(const height of [0,100])for(const hairstyle of ['curl','bob','crop'] as const){
    const appearance=defaultAppearance();appearance.body.height=height;appearance.hairstyle=hairstyle;appearance.face.shape=height?'angular':'round';
    const geometry=selectGeometry(source,appearance,context),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
    const top=anatomicalHeight(geometry.vertices),deformed=shapeVertices(geometry.cage,shape,top);
    const envelope=new HeadEnvelope(geometry);envelope.configure(deformed);
    const matrices=configuredPose(geometry.manifest,shape,'read',1.5,top,undefined,geometry);
    const surface=posedPositions(geometry,shape,'read',1.5,top);envelope.pose(matrices);
    for(let facing=0;facing<4;facing++){
      const angle=facing*Math.PI/2,anchor=envelope.top(angle);let actual=-Infinity;
      for(const part of geometry.description.parts)if([1,8,9].includes(part.region))for(let i=part.start;i<part.start+part.count;i++){
        const vertex=geometry.indices[i]*3;actual=Math.max(actual,projectedHeadHeight([surface[vertex],surface[vertex+1],surface[vertex+2]],angle));
      }
      const difference=projectedHeadHeight(anchor,0)-actual;
      expect(difference).toBeGreaterThan(.01);expect(difference).toBeLessThan(.19);
      expect(envelope.top(angle)).toBe(anchor);
    }
  }
});

it('applies all skin weights before subdivision when locating the head',()=>{
  const cage=new Float32Array([
    0,0,1, 0,0,1, 0,1,0,0, .25,.75,0,0, 0,1,
    0,0,3, 0,0,1, 0,1,0,0, .75,.25,0,0, 0,1,
  ]);
  const stencilWeights=new ArrayBuffer(16);new Uint32Array(stencilWeights).set([0,0,1,0]);new Float32Array(stencilWeights).set([.2],1);new Float32Array(stencilWeights).set([.8],3);
  const geometry={description:{vertexCount:1,parts:[{name:'Sculpted head',start:0,count:1,region:1}]},
    vertices:cage.slice(0,16),cage,indices:new Uint32Array([0]),stencilRanges:new Uint32Array([0,2,0,1]),stencilWeights} as unknown as Geometry;
  const envelope=new HeadEnvelope(geometry),bones=new Float32Array([...identity(),...identity()]);bones[30]=2;
  envelope.pose(bones);
  // .2*(1 + .75*2) + .8*(3 + .25*2), followed by the .004 outline.
  expect(envelope.top(0)[2]).toBeCloseTo(3.304,5);
});

it('accounts for and destroys surface coordinates and avoids subdivision writes for density edits',()=>{
  Object.assign(globalThis,{GPUBufferUsage:{VERTEX:1,STORAGE:2,COPY_SRC:4,COPY_DST:8,INDEX:16,UNIFORM:32},GPUShaderStage:{VERTEX:1,FRAGMENT:2}});
  const created:{size:number;destroyed:boolean;destroy():void}[]=[],writes:unknown[]=[];
  const device={lost:new Promise(()=>{}),queue:{writeBuffer(buffer:unknown){writes.push(buffer);}},
    createBuffer({size}:{size:number}){const buffer={size,destroyed:false,destroy(){this.destroyed=true;}};created.push(buffer);return buffer;},
    createBindGroupLayout(){return {};},createBindGroup(){return {};},createShaderModule(){return {};},createPipelineLayout(){return {};},
    createComputePipeline(){return {getBindGroupLayout(){return {};}};},createRenderPipeline(){return {};}} as unknown as GPUDevice;
  const appearance=defaultAppearance(),geometry=selectGeometry(source,appearance,context);
  const renderer=new CharacterRenderer(device,geometry,96,128);renderer.setCharacterAppearance(appearance);
  expect(renderer.allocatedBufferBytes).toBe(created.reduce((sum,buffer)=>sum+buffer.size,0));
  expect(created.filter(buffer=>buffer.size===geometry.description.vertexCount*16)).toHaveLength(2);
  writes.length=0;appearance.freckles=true;appearance.freckle_density=67;renderer.setCharacterAppearance(appearance);
  expect(writes).toHaveLength(0);
  renderer.destroy();expect(created.every(buffer=>buffer.destroyed)).toBe(true);
});
