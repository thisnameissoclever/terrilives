import type {Bundle,Geometry} from './bundle.js';
import {shapeVertices,type ShapeParameters} from './shape.js';
import {canonicalPoolPreference,solvePoolHierarchyLimb,translatePoolRoot} from './pool-canonical-pose.js';
import {interpolatePoolPose} from './pool-contact-sample.js';
import {posedCageSurface} from './geometry-proof.js';
import type {Vec3} from './math.js';

const head=(matrix:readonly number[]):Vec3=>[matrix[12],matrix[13],matrix[14]];
export interface CompiledPoolPose {skin:Float32Array<ArrayBuffer>;basis:number[][];rest:number[][]}

/** Worker-side constraints always observe the same fixed hierarchy that rendering evaluates. */
export function compilePoolPaddlePreference(bundle:Bundle,shape:ShapeParameters,top:number,frame:number,geometry:readonly Geometry[],water:number,floor:number):CompiledPoolPose {
  const candidate=canonicalPoolPreference(bundle,shape,top,'pool_paddle',frame,geometry);
  const cages=geometry.map(g=>shapeVertices(g.cage,shape,top));
  let skin:Float32Array<ArrayBuffer>;
  const deform=()=>{
    skin=interpolatePoolPose(bundle,candidate.rest,candidate.inverse,candidate.basis,candidate.basis,0);
    return geometry.map((g,i)=>({geometry:g,points:posedCageSurface(g,cages[i],skin)}));
  };
  const minimum=(surfaces:ReturnType<typeof deform>,accept:(name:string)=>boolean)=>{
    let z=Infinity;
    for(const {geometry,points} of surfaces)for(const part of geometry.description.parts)if(accept(part.name))
      for(let at=part.start;at<part.start+part.count;at++)z=Math.min(z,points[geometry.indices[at]*3+2]);
    return z;
  };
  let surfaces=deform();
  const airway=minimum(surfaces,name=>/nose|smile/i.test(name));
  if(!Number.isFinite(airway))throw new Error('Selected pool body has no authored airway surface.');
  if(airway<water){translatePoolRoot(candidate,[0,0,water-airway]);surfaces=deform();}
  const legs=['L','R'].map(side=>{
    const index=(name:string)=>{const found=bundle.bones.findIndex(b=>b.name===name);if(found<0)throw new Error('Missing pool leg joint: '+name);return found;};
    const upper=index('thigh.'+side),lower=index('shin.'+side),end=index('foot.'+side);
    return {side,upper,lower,end,pole:head(candidate.world[lower]),orientation:[...candidate.world[end]]};
  });
  for(let pass=0;pass<8;pass++){
    let changed=false;
    for(const leg of legs){
      const z=minimum(surfaces,name=>name==='Creator bare foot '+leg.side||name==='Creator bare leg '+leg.side);
      if(z>=floor)continue;
      const target=[...head(candidate.world[leg.end])] as [number,number,number];target[2]+=floor-z;
      // Round the prepared translation outward by representation, not a physical offset.
      const scalar=new Float32Array([target[2]]),bits=new Uint32Array(scalar.buffer);
      if(scalar[0]<=target[2]){bits[0]+=scalar[0]>=0?1:-1;}target[2]=scalar[0];
      solvePoolHierarchyLimb(candidate,leg.upper,leg.lower,leg.end,target,leg.pole,leg.orientation);changed=true;
    }
    if(!changed)return {skin:skin!,basis:candidate.basis,rest:candidate.rest};
    surfaces=deform();
  }
  throw new Error('Pool paddle leg articulation exceeded its eight-pass floor constraint budget.');
}
