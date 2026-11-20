import {expect,it,vi} from 'vitest';
import definition from '../../assets/models/sims/character-creator/pool_activity_motion_v14.json';
import {defaultAppearance} from '../src/character/schema.js';
import {createPoolContactInput,poolContactFixture} from '../src/render/character/pool-contact-preparation.js';
import {compileOwnedPoolCycle,poolOwnedStaticIdentity} from '../src/render/character/pool-owned-compilation.js';
import type {PoolCycleDiagnostic} from '../src/render/character/pool-cycle-compiler.js';
import type {PoolCycleDefinition} from '../src/render/character/pool-cycle-source.js';
import type {Bundle,Geometry,MeshDescription} from '../src/render/character/bundle.js';
import type {PoolFixtureV1} from '../src/render/character/pool-contact-types.js';
import type {ShapeParameters} from '../src/render/character/shape.js';
import {identity} from '../src/render/character/math.js';

type ValidateDefinition=typeof import('../src/render/character/pool-cycle-source.js').validatePoolCycleDefinition;
const probe=vi.hoisted(()=>({
 read:undefined as undefined|((bundle:Bundle,geometry:readonly Geometry[],fixture:PoolFixtureV1)=>void),
 validate:undefined as ValidateDefinition|undefined,
}));
vi.mock('../src/render/character/pool-cycle-source.js',()=>({
 validatePoolCycleDefinition(value:unknown){const validate:ValidateDefinition=probe.validate!;validate(value);},
 PoolCycleSource:class {
  readonly neutral={rest:[],inverse:[]};readonly anatomy={};readonly cages:Float32Array<ArrayBuffer>[];
  constructor(readonly bundle:Bundle,readonly shape:ShapeParameters,readonly top:number,readonly geometry:readonly Geometry[],readonly fixture:PoolFixtureV1,readonly source:PoolCycleDefinition){
   this.cages=geometry.map(g=>g.cage.slice());
  }
  entry(){
   probe.read?.(this.bundle,this.geometry,this.fixture);
   const body=this.geometry[0];
   throw new TypeError('Probe source failure',{cause:{values:[...body.vertices],indices:[...body.indices],weight:new Float32Array(body.stencilWeights)[1],
    bone:this.bundle.bones[0].name,part:body.description.parts[0].name,shape:this.shape.presentation,top:this.top,water:this.fixture.waterHeight,
    phase:this.source.anchors[1].phase,skin:body.cage[0],normalRange:body.normalRanges[0],normalTriangle:body.normalTriangles[0]}});
  }
 }
}));
vi.mock('../src/render/character/pool-source-policy.js',async original=>({
 ...await original<typeof import('../src/render/character/pool-source-policy.js')>(),poolSourceEvents:()=>[0,1],
}));

async function inputs(){
 const sourceModule=await vi.importActual<typeof import('../src/render/character/pool-cycle-source.js')>('../src/render/character/pool-cycle-source.js');
 const validate:ValidateDefinition=sourceModule.validatePoolCycleDefinition;
 probe.validate=validate;
 const appearance=defaultAppearance(),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
 const row=new Float32Array(18);row.set([9,2,3,4,5,6],0);row[17]=9;
 const vertices=row.subarray(1,17),cage=vertices.slice();cage[0]=7;cage[6]=cage[7]=cage[8]=cage[9]=0;cage[10]=1;
 const weights=new ArrayBuffer(8);new Float32Array(weights)[1]=1;
 const parts=[{name:'probe',start:0,count:3,region:1,outline:false}],description={vertexCount:1,indexCount:3,cageCount:1,coefficientCount:1,parts};
 const sourceDefinition:unknown=structuredClone(definition);
 validate(sourceDefinition);
 const digest=sourceDefinition.reference.sourceRigSha256;
 const mesh:MeshDescription={...description,vertices:'probe-vertices',verticesSha256:digest,indices:'probe-indices',indicesSha256:digest,cage:'probe-cage',cageSha256:digest,
  stencilRanges:'probe-stencil-ranges',stencilRangesSha256:digest,stencilWeights:'probe-stencil-weights',stencilWeightsSha256:digest,
  normalRanges:'probe-normal-ranges',normalRangesSha256:digest,normalTriangles:'probe-normal-triangles',normalTrianglesSha256:digest};
 const bundle:Bundle={version:3,sourceSha256:digest,bones:[{name:'hips',parent:-1,head:[0,0,0],tail:[0,1,0],rest:identity(),inverseRest:identity()}],materials:[],
  actions:{pool_enter:[]},basisActions:{pool_enter:[sourceDefinition.reference.neutralSample.basis]},original:mesh,runtime:mesh,fixtureBasis:identity(),
  fixtureModel:'pool',animationSpace:'evaluated-parent-local-delta'};
 const body={manifest:bundle,description,vertices,indices:new Uint32Array([8,0,0,0,8]).subarray(1,4),cage,
  stencilRanges:new Uint32Array([0,1,0,0]),stencilWeights:weights,normalRanges:new Uint32Array([0,1]),normalTriangles:new Uint32Array([0,0,0])};
 return {appearance,sourceDefinition,row,body,source:{bundle,shape,geometry:[body,{...body,description:{...description,parts:[{...parts[0],name:'garment'}]}}],fixture:structuredClone(poolContactFixture()),top:2}};
}

const detail=(row:PoolCycleDiagnostic)=>((row.error?.cause as {cause:Error}).cause).cause as Record<string,unknown>;

it('captures selected subviews and descriptors before callbacks and preserves a detached causal failure',async()=>{
 const {appearance,sourceDefinition,row,body,source}=await inputs();
 const input=await createPoolContactInput(appearance),rows:PoolCycleDiagnostic[]=[];
 const water=source.fixture.waterHeight,phase=sourceDefinition.anchors[1].phase,presentation=source.shape.presentation;
 expect(()=>compileOwnedPoolCycle(input,source,sourceDefinition,event=>{
  rows.push(event);
  if(event.phase===0){
   row.fill(42);body.indices[0]=42;body.cage[0]=42;new Float32Array(body.stencilWeights)[1]=42;
   body.normalRanges[0]=42;body.normalTriangles[0]=42;body.stencilRanges[0]=42;
   source.bundle.bones[0].name='mutated';body.description.parts[0].name='mutated';source.fixture.waterHeight+=1;
   sourceDefinition.anchors[1].phase+=.001;source.shape.presentation=presentation==='feminine'?'masculine':'feminine';source.top=3;
   detail(event).bone='edited diagnostic';
  }
 })).toThrow('no paddle join');
 expect(rows.map(event=>[event.phase,event.stage,event.passed])).toEqual([[0,'entry-source',false],[1,'entry-source',false]]);
 expect(detail(rows[1])).toMatchObject({values:[2,3,4,5,6,0,0,0,0,0,0,0,0,0,0,0],indices:[0,0,0],weight:1,bone:'hips',part:'probe',shape:presentation,top:2,water,phase,skin:7,normalRange:0,normalTriangle:0});
 expect((rows[1].error?.cause as {cause:Error}).cause).toBeInstanceOf(TypeError);
 expect((rows[1].error?.cause as {cause:Error}).cause.stack).toContain('Probe source failure');
 expect(()=>compileOwnedPoolCycle(input,source,sourceDefinition)).toThrow('Pool source anchor is invalid');
});

it('refuses accessors, shared memory and unsupported typed proxies during capture',async()=>{
 const {appearance,sourceDefinition,source,body}=await inputs(),input=await createPoolContactInput(appearance);
 let reads=0;
 Object.defineProperty(source.shape,'probe',{get(){reads++;return 1;},configurable:true});
 expect(()=>compileOwnedPoolCycle(input,source,sourceDefinition)).toThrow(/accessor/i);
 expect(reads).toBe(0);
 Reflect.deleteProperty(source.shape,'probe');
 const original=body.vertices;
 const shared=new SharedArrayBuffer(original.byteLength);
 Reflect.set(body,'vertices',new Float32Array(shared));
 expect(()=>compileOwnedPoolCycle(input,source,sourceDefinition)).toThrow(/shared/i);
 Object.setPrototypeOf(shared,ArrayBuffer.prototype);
 expect(()=>compileOwnedPoolCycle(input,source,sourceDefinition)).toThrow(/shared/i);
 body.vertices=new Proxy(original,{});
 expect(()=>compileOwnedPoolCycle(input,source,sourceDefinition)).toThrow(/capture|view/i);
 const wrongView=new Int32Array(original.length);
 Object.setPrototypeOf(wrongView,Float32Array.prototype);
 Reflect.set(body,'vertices',wrongView);
 expect(()=>compileOwnedPoolCycle(input,source,sourceDefinition)).toThrow(/view/i);
 body.vertices=original;body.cage[9]=1;
 expect(body.cage[13]).toBe(0);
 expect(()=>compileOwnedPoolCycle(input,source,sourceDefinition)).toThrow('cage references a missing skin matrix');
});

it('reads changed bytes and fixture values when it starts a new compilation',async()=>{
 const {appearance,sourceDefinition,row,body,source}=await inputs(),input=await createPoolContactInput(appearance);
 const run=()=>{
  const rows:PoolCycleDiagnostic[]=[];
  expect(()=>compileOwnedPoolCycle(input,source,sourceDefinition,event=>rows.push(event))).toThrow('no paddle join');
  return detail(rows[0]);
 };
 const before=run(),water=source.fixture.waterHeight;
 row[1]=11;body.cage[0]=12;new Float32Array(body.stencilWeights)[1]=.75;source.fixture.waterHeight+=.001;
 expect(before).toMatchObject({values:[2,3,4,5,6,0,0,0,0,0,0,0,0,0,0,0],skin:7,weight:1,water});
 expect(run()).toMatchObject({values:[11,3,4,5,6,0,0,0,0,0,0,0,0,0,0,0],skin:12,weight:.75,water:water+.001});
});

it('distinguishes equal-valued concurrent datasets and removes membership after failure',async()=>{
 const left=await inputs(),right=await inputs(),input=await createPoolContactInput(left.appearance);
 let first:PoolFixtureV1|undefined,second:PoolFixtureV1|undefined;
 let inner=false,mixed:unknown;const identities:object[]=[];
 probe.read=(_bundle,geometry,fixture)=>{
  const identity=poolOwnedStaticIdentity(fixture,geometry[0]);if(identity)identities.push(identity);
  if(inner){
   second=fixture;
   try{poolOwnedStaticIdentity(first!,second!);}catch(error){mixed=error;}
  }else first=fixture;
 };
 try{
  expect(()=>compileOwnedPoolCycle(input,left.source,left.sourceDefinition,event=>{
   if(event.phase===0){
    inner=true;
    try{expect(()=>compileOwnedPoolCycle(input,right.source,right.sourceDefinition)).toThrow('no paddle join');}
    finally{inner=false;}
   }
  })).toThrow('no paddle join');
  expect(first).toBeDefined();expect(second).toBeDefined();
  expect(identities).toHaveLength(4);expect(identities[0]).not.toBe(identities[1]);
  expect(mixed).toMatchObject({message:expect.stringMatching(/dataset/i)});
  expect(poolOwnedStaticIdentity(first!)).toBeUndefined();expect(poolOwnedStaticIdentity(second!)).toBeUndefined();
  expect(poolOwnedStaticIdentity(left.source.fixture,left.body)).toBeUndefined();
 }finally{probe.read=undefined;}
});

it('disposes the dataset when the diagnostic callback throws',async()=>{
 const {appearance,source,sourceDefinition}=await inputs(),input=await createPoolContactInput(appearance);
 let seen:PoolFixtureV1|undefined;
 probe.read=(_bundle,_geometry,fixture)=>{seen=fixture;};
 try{
  expect(()=>compileOwnedPoolCycle(input,source,sourceDefinition,()=>{throw new Error('diagnostic interrupted');})).toThrow('diagnostic interrupted');
  expect(seen).toBeDefined();
  expect(poolOwnedStaticIdentity(seen!)).toBeUndefined();
 }finally{probe.read=undefined;}
});
