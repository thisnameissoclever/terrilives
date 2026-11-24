import type {Geometry,Bundle} from '../src/render/character/bundle.js';
import type {PreparedPoolPatch} from '../src/render/character/pool-contact-patch.js';
import type {PoolFixtureV1,PoolSupport} from '../src/render/character/pool-contact-types.js';
import {identity,inverseAffine} from '../src/render/character/math.js';
import {composeSkeletonPose} from '../src/render/character/pose-joints.js';
import {registerPoolRestMatrix} from '../src/render/character/pool-matrix-producer.js';
import {properPoolRotation} from '../src/render/character/pool-canonical-pose.js';

export function poolFootConstructionFixture(){
  const cage=new Float32Array(64),stencils=new ArrayBuffer(32),ids=new Uint32Array(stencils),weights=new Float32Array(stencils);
  [[2,0,0],[2.25,0,0],[2,.25,0],[2.25,.25,.1]].forEach((p,index)=>{cage.set(p,index*16);cage[index*16+6]=3;cage[index*16+10]=1;ids[index*2]=index;weights[index*2+1]=1;});
  const bundle={sourceSha256:'synthetic-foot-rig-v1',bones:[{name:'root',parent:-1},{name:'upper',parent:0},{name:'lower',parent:1},{name:'foot.L',parent:2}]} as unknown as Bundle;
  const rest=Array.from({length:4},identity);rest[2][12]=1;rest[3][12]=2;
  rest.forEach(matrix=>registerPoolRestMatrix(matrix,[matrix[12],0,0],[matrix[12],1,0],identity()));
  const basis=Array.from({length:4},()=>properPoolRotation(identity())),inverse=rest.map(inverseAffine),pose={bundle,rest,inverse,basis,world:composeSkeletonPose(bundle.bones,rest,basis)};
  const geometry={manifest:bundle,cage,indices:new Uint32Array([0,1,2,1,3,2]),stencilWeights:stencils,stencilRanges:new Uint32Array([0,1,0,0,1,1,1,0,2,1,2,0,3,1,3,0]),
    description:{vertexCount:4,cageCount:4,parts:[{name:'Synthetic whole foot',start:0,count:6}]}} as unknown as Geometry;
  const patch={part:'Synthetic whole foot',bone:3,sourceTriangles:[0],vertices:[{id:0},{id:1},{id:2}]} as unknown as PreparedPoolPatch;
  const fixture={ground:{id:'ground',bounds:[[0,0,.5],[1,1,.5]]},solids:[],revisions:{}} as unknown as PoolFixtureV1;
  const support:PoolSupport={mode:'support',surface:'ground',region:{kind:'top-face'},interval:[0,1]};
  return {geometry,cage,patch,fixture,support,pose};
}
