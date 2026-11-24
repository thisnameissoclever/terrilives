import type {Geometry} from './bundle.js';
import {posedCageSurface} from './geometry-proof.js';
import {add,scale,type Vec3} from './math.js';
import {poolSkinMatrices} from './pool-contact-sample.js';
import {poolRootRayIntervals,type PoolChainReach} from './pool-entry-domain.js';
import {poolSurfacePoint} from './pool-entry-anatomy.js';
import type {PoolFixtureV1,PoolLimb} from './pool-contact-types.js';
import type {PoolSurfaceCoefficient} from './pool-surface-coefficient.js';

interface WaterBounds {low:Vec3;high:Vec3;surface:number}

export function poolWaterBounds(fixture:PoolFixtureV1):WaterBounds {
  const floor=fixture.solids.find(solid=>solid.id==='Pool basin floor'&&solid.kind==='floor');
  const liner=fixture.solids.find(solid=>solid.id==='Pool wall'&&solid.kind==='solid');
  if(!floor||!liner)throw new Error('Pool stroke requires the evaluated floor and liner.');
  for(const axis of [0,1])for(const edge of floor.bounds){
    if(!liner.triangles.some(triangle=>triangle.every(vertex=>liner.vertices[vertex][axis]===edge[axis])))
      throw new Error('Pool stroke floor edge has no matching liner plane.');
  }
  const [low,high]=floor.bounds;
  if(low[2]!==high[2]||high[2]>=fixture.waterHeight)throw new Error('Pool stroke floor and water height are inconsistent.');
  return {low,high,surface:fixture.waterHeight};
}

/** Fit the authored direction through the open reach shell and the evaluated distal envelope. */
export function fitPoolWaterTarget(bounds:WaterBounds,limb:PoolLimb,start:Vec3,reach:PoolChainReach,direction:Vec3,
  orientation:readonly number[],coefficients:readonly PoolSurfaceCoefficient[]):Vec3 {
  const foot=limb.startsWith('foot');
  const minimum:[number,number,number]=[...bounds.low];
  const maximum:[number,number,number]=[bounds.high[0],bounds.high[1],foot?bounds.surface:Infinity];
  const failure=()=>new Error('Pool stroke has no reachable clear target for '+limb+'.',{cause:{start,direction,reach,minimum,maximum}});
  for(const coefficient of coefficients){
    const w=coefficient[3],offset=poolSurfacePoint(orientation,coefficient);
    if(!Number.isFinite(w)||w<=0)throw failure();
    for(const axis of [0,1,2]){
      const low=(bounds.low[axis]-offset[axis])/w;
      const high=((axis===2?(foot?bounds.surface:Infinity):bounds.high[axis])-offset[axis])/w;
      minimum[axis]=Math.max(minimum[axis],low);
      maximum[axis]=Math.min(maximum[axis],high);
    }
  }
  let first=0,last=Infinity;
  for(const axis of [0,1,2]){
    if(minimum[axis]>=maximum[axis])throw failure();
    const delta=direction[axis];
    if(delta===0){
      if(start[axis]<=minimum[axis]||start[axis]>=maximum[axis])throw failure();
      continue;
    }
    const a=(minimum[axis]-start[axis])/delta,b=(maximum[axis]-start[axis])/delta;
    first=Math.max(first,Math.min(a,b));
    last=Math.min(last,Math.max(a,b));
  }
  const [interval]=poolRootRayIntervals(direction,[{limb,center:[0,0,0],reach}]);
  first=Math.max(first,interval?.minimum??Infinity);
  last=Math.min(last,interval?.maximum??-Infinity);
  if(!(first<last))throw failure();
  const amount=first<1&&1<last?1:(first+last)/2;
  return add(start,scale(direction,amount));
}

/** Measure immersion from the same selected nose and mouth surfaces observed during admission. */
export function poolStrokeAirwayRise(geometry:Geometry,cage:Float32Array<ArrayBuffer>,world:readonly number[][],inverse:readonly number[][],
  waterHeight:number,freeboardFraction:number):number {
  const surface=posedCageSurface(geometry,cage,poolSkinMatrices(world,inverse));
  let lowest=Infinity,highest=-Infinity;
  for(const part of geometry.description.parts)if(/nose|smile/i.test(part.name)){
    for(let index=part.start;index<part.start+part.count;index++){
      const z=surface[geometry.indices[index]*3+2];
      lowest=Math.min(lowest,z);
      highest=Math.max(highest,z);
    }
  }
  if(!Number.isFinite(lowest)||!(lowest<highest))throw new Error('Pool stroke needs the complete selected airway surface.');
  return Math.max(0,waterHeight+(highest-lowest)*freeboardFraction-lowest);
}
