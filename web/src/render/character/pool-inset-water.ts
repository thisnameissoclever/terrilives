import {add,type Vec3} from './math.js';
import {evaluatePoolPoseProgram,poolIntervalPreference,poolSkinMatrices} from './pool-contact-sample.js';
import {translatePoolRoot} from './pool-canonical-pose.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {posedCageSurface} from './geometry-proof.js';
import type {PoolCycleSource} from './pool-cycle-source.js';
import {PoolTrialRefusal} from './pool-trial-work.js';

type Box=[number,number,number,number,number,number];
const empty=():Box=>[Infinity,-Infinity,Infinity,-Infinity,Infinity,-Infinity];
function include(b:Box,p:Vec3){for(let a=0;a<3;a++){b[2*a]=Math.min(b[2*a],p[a]);b[2*a+1]=Math.max(b[2*a+1],p[a]);}}

/** Select a single translation for the whole paddle, using the selected skin and garment sweep. */
export function insetPaddleOffset(s:PoolCycleSource,stroke:(p:number)=>PoolPoseProgram):Vec3{
 return insetWaterOffset(s,Array.from({length:24},(_,i)=>({program:stroke(i/24),action:'pool_paddle',phase:i/24})));
}
export function insetWaterOffset(s:PoolCycleSource,samples:readonly {program:PoolPoseProgram;action:string;phase:number}[]):Vec3{
 const bay=s.definition.dryBay;
 if(!bay&&!s.definition.rectangularPool)return [0,0,0];
 const rim=s.fixture.solids.find(o=>o.id==='Pool stone coping')!,floor=s.fixture.solids.find(o=>o.id==='Pool basin floor')!;
 const obstacles:Box[]=bay?[[bay.liner[0],bay.liner[1],bay.liner[2],rim.bounds[1][1],floor.bounds[0][2],rim.bounds[1][2]]]:[];
 for(const solid of s.fixture.solids){
  if(!solid.id.startsWith('Pool inside ladder tread')&&!solid.id.startsWith('Pool ladder'))continue;
  const [lo,hi]=solid.bounds;
  if(hi[2]-lo[2]<=.05){obstacles.push([lo[0],hi[0],lo[1],hi[1],lo[2],hi[2]]);continue;}
  const bands=Array.from({length:24},empty),band=(z:number)=>Math.min(23,Math.max(0,Math.floor(24*(z-lo[2])/(hi[2]-lo[2]))));
  for(const tri of solid.triangles){
   const a=tri.map(i=>solid.vertices[i]),iz0=band(Math.min(...a.map(v=>v[2]))),iz1=band(Math.max(...a.map(v=>v[2])));
   for(let i=iz0;i<=iz1;i++){
    const z0=lo[2]+i*(hi[2]-lo[2])/24,z1=lo[2]+(i+1)*(hi[2]-lo[2])/24;
    for(let j=0;j<3;j++){
     const p=a[j],q=a[(j+1)%3];if(p[2]>=z0&&p[2]<=z1)include(bands[i],p);
     for(const z of [z0,z1])if((p[2]-z)*(q[2]-z)<0){const t=(z-p[2])/(q[2]-p[2]);include(bands[i],[p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1]),z]);}
    }
   }
  }
  obstacles.push(...bands.filter(b=>Number.isFinite(b[0])));
 }
 const extents=s.geometry.map(g=>{const v=new Float32Array(g.indices.length*2);for(let i=0;i<v.length;i+=2){v[i]=Infinity;v[i+1]=-Infinity;}return v;});
 for(const {program,action,phase} of samples){
  const pose=evaluatePoolPoseProgram(s.bundle,s.neutral.rest,s.neutral.inverse,program,{action,phase}),matrices=poolSkinMatrices(pose.world,s.neutral.inverse);
  s.geometry.forEach((g,layer)=>{
   const mesh=posedCageSurface(g,s.cages[layer],matrices),e=extents[layer];
   for(const part of g.description.parts)for(let k=part.start;k<part.start+part.count;k+=3)for(let axis=0;axis<3;axis++){
    const a=mesh[g.indices[k]*3+axis],b=mesh[g.indices[k+1]*3+axis],c=mesh[g.indices[k+2]*3+axis],j=k*2+axis*2;
    e[j]=Math.min(e[j],a,b,c);e[j+1]=Math.max(e[j+1],a,b,c);
   }
  });
 }
 const lo=[Infinity,Infinity],hi=[-Infinity,-Infinity],pad=s.fixture.rails[0].radius/2;
 for(const e of extents)for(let i=0;i<e.length;i+=6)if(e[i+4]<=rim.bounds[1][2]+pad){
  for(let a=0;a<2;a++){lo[a]=Math.min(lo[a],e[i+2*a]);hi[a]=Math.max(hi[a],e[i+2*a+1]);}
 }
 const inset=.01,stepX=.005,stepY=.002;
 const x0=Math.ceil((floor.bounds[0][0]+inset+pad-lo[0])/stepX),x1=Math.floor((floor.bounds[1][0]-inset-pad-hi[0])/stepX);
 const y0=Math.ceil((floor.bounds[0][1]+inset+pad-lo[1])/stepY),y1=Math.floor((floor.bounds[1][1]-inset-pad-hi[1])/stepY);
 if(x1<x0||y1<y0)throw new PoolTrialRefusal('The configured paddle has no room within the coping.');
 const width=x1-x0+2,height=y1-y0+2,grid=new Int32Array(width*height);
 for(const e of extents)for(let i=0;i<e.length;i+=6)for(const o of obstacles){
  if(e[i+5]<o[4]-pad||e[i+4]>o[5]+pad)continue;
  const x=Math.max(x0,Math.ceil((o[0]-e[i+1]-pad)/stepX)),xx=Math.min(x1,Math.floor((o[1]-e[i]+pad)/stepX));
  const y=Math.max(y0,Math.ceil((o[2]-e[i+3]-pad)/stepY)),yy=Math.min(y1,Math.floor((o[3]-e[i+2]+pad)/stepY));
  if(x>xx||y>yy)continue;
  const a=x-x0,b=xx-x0+1,c=(y-y0)*width,d=(yy-y0+1)*width;
  grid[c+a]++;grid[c+b]--;grid[d+a]--;grid[d+b]++;
 }
 let best=Infinity,out:Vec3|undefined;
 for(let y=0;y<height-1;y++)for(let x=0;x<width-1;x++){
  const i=y*width+x;grid[i]+=(x?grid[i-1]:0)+(y?grid[i-width]:0)-(x&&y?grid[i-width-1]:0);
  const dx=(x+x0)*stepX,dy=(y+y0)*stepY,cost=dx*dx+dy*dy;
  if(grid[i]===0&&cost<best){out=[dx,dy,0];best=cost;}
 }
 if(!out)throw new PoolTrialRefusal('The configured paddle has no clear lane inside the pool.');
 return out;
}

export function translateInsetPaddle(s:PoolCycleSource,p:PoolPoseProgram,delta:Vec3){
 if(delta[0]===0&&delta[1]===0)return p;
 const pose=poolIntervalPreference(s.bundle,s.neutral.rest,s.neutral.inverse,p.preferenceBasis,p.preferenceBasis,0,true);
 translatePoolRoot(pose,delta);
 return makePoolPoseProgram(pose.basis,p.controls.map(c=>({...c,state:{...c.state,target:add(c.state.target,delta),pole:add(c.state.pole,delta)}})),p.policy);
}
