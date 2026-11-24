import {add,type Vec3} from './math.js';
import {evaluatePoolPoseProgram,poolIntervalPreference,poolSkinMatrices} from './pool-contact-sample.js';
import {posedCageSurface} from './geometry-proof.js';
import {translatePoolRoot} from './pool-canonical-pose.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {projectedTrianglePatch,type Triangle} from './pool-solid.js';
import type {PoolCycleSource} from './pool-cycle-source.js';

const yz=(p:Vec3):Vec3=>[p[1],p[2],p[0]];
const limbs=['footL','footR','handL','handR'] as const;

/** Translate the released waist into the opening while its loaded sole stays installed. */
export function fitLaunchWaist(source:PoolCycleSource,program:PoolPoseProgram,unit:number){
 const {bundle,neutral}=source;
 const location={action:'pool_enter',phase:unit/source.definition.clockUnits};
 const solved=evaluatePoolPoseProgram(bundle,neutral.rest,neutral.inverse,program,location);
 const skin=poolSkinMatrices(solved.world,neutral.inverse);
 const rails=source.fixture.rails.map((r,i)=>{
  const solid=source.fixture.solids.find(h=>h.id===r.id)!;
  const side=i===0?1:-1,margin=r.radius/16;
  const faces=solid.triangles.map(ids=>{
   const [a,b,c]=ids.map(id=>yz(solid.vertices[id]));
   const by=b[0]-a[0],bz=b[1]-a[1],cy=c[0]-a[0],cz=c[1]-a[1],det=by*cz-bz*cy;
   if(det===0)return;
   const dxdy=((b[2]-a[2])*cz-(c[2]-a[2])*bz)/det;
   const dxdz=(by*(c[2]-a[2])-cy*(b[2]-a[2]))/det;
   return {tri:[a,b,c] as Triangle,dxdy,dxdz,y0:Math.min(a[0],b[0],c[0]),y1:Math.max(a[0],b[0],c[0]),
    z0:Math.min(a[1],b[1],c[1]),z1:Math.max(a[1],b[1],c[1])};
  }).filter(f=>f!==undefined);
  return {faces,side,margin,edge:solid.bounds[i===0?1:0][0]};
 });
 let left=-Infinity,right=Infinity;
 for(const [layer,g] of source.geometry.entries()){
  const parts=g.description.parts.filter(p=>p.name==='Creator bare hips'||p.name==='Creator pool trunks waist'||p.name==='Creator pool two_piece waist');
  if(!parts.length)continue;
  const mesh=posedCageSurface(g,source.cages[layer],skin);
  const point=(id:number):Vec3=>[mesh[3*id+1],mesh[3*id+2],mesh[3*id]];
  for(const p of parts)for(let k=p.start;k<p.start+p.count;k+=3){
   const tri:Triangle=[point(g.indices[k]),point(g.indices[k+1]),point(g.indices[k+2])];
   for(const rail of rails){
    if(tri.every(q=>(q[2]-rail.edge)*rail.side>rail.margin))continue;
    for(const f of rail.faces){
     if(tri.every(q=>q[0]<f.y0)||tri.every(q=>q[0]>f.y1)||tri.every(q=>q[1]<f.z0)||tri.every(q=>q[1]>f.z1))continue;
     const a=f.tri[0];
     for(const q of projectedTrianglePatch(tri,f.tri)){
      const x=a[2]+f.dxdy*(q[0]-a[0])+f.dxdz*(q[1]-a[1]),limit=x+rail.side*rail.margin-q[2];
      if(rail.side>0)left=Math.max(left,limit);else right=Math.min(right,limit);
     }
    }
   }
  }
 }
 const dx=Math.max(left,Math.min(right,0));
 if(!Number.isFinite(dx)||!dx||left>right)return program;
 const delta:Vec3=[dx,0,0];
 const placed=poolIntervalPreference(bundle,neutral.rest,neutral.inverse,program.preferenceBasis,program.preferenceBasis,0,true);
 translatePoolRoot(placed,delta);
 return makePoolPoseProgram(placed.basis,program.controls.map((c,i)=>({...c,state:{...c.state,
  target:program.policy[limbs[i]].required?c.state.target:add(c.state.target,delta),pole:add(c.state.pole,delta)}})),program.policy);
}
