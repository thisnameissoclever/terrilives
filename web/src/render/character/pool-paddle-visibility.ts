import type {Geometry} from './bundle.js';
import {add, type Vec3} from './math.js';
import {poolSurfacePoint} from './pool-entry-anatomy.js';
import type {PoolChainReach} from './pool-entry-domain.js';
import type {PoolSurfaceCoefficient} from './pool-surface-coefficient.js';
import {fitPoolWaterTarget, type poolWaterBounds} from './pool-water-retarget.js';

/** Set the waterline halfway through the vertical depth of the prone, shaped torso. */
export function poolPaddleTorsoRise(geometry:Geometry, points:Float32Array, water:number, airwayRise:number):number {
  const torso=geometry.description.parts.find(part=>part.name==='Creator bare torso');
  if(!torso)throw new Error('Pool paddle requires the selected bare torso.');
  let low=Infinity,high=-Infinity;
  for(let i=torso.start;i<torso.start+torso.count;i++){
    const z=points[geometry.indices[i]*3+2];
    low=Math.min(low,z);
    high=Math.max(high,z);
  }
  if(!(high>low))throw new Error('Pool paddle torso has no measured depth.');
  return Math.max(airwayRise,water-(low+high)/2);
}

/** Reach forward, sweep outward and back, then recover near the water with a bent elbow. */
export function poolPaddleArm(bounds:ReturnType<typeof poolWaterBounds>, limb:'handL'|'handR', phase:number,
  shoulder:Vec3, reach:PoolChainReach, orientation:readonly number[], palm:readonly PoolSurfaceCoefficient[]) {
  const side=limb==='handL'?-1:1;
  const angle=2*Math.PI*phase+(side===-1?0:Math.PI);
  let bottom=Infinity,top=-Infinity;
  let rearmostContact=-Infinity,frontmostContact=Infinity;
  for(const coefficient of palm){
    const weight=coefficient[3],offset=poolSurfacePoint(orientation,coefficient);
    if(!(weight>0))throw new Error('Pool paddle palm has an invalid skin weight.');
    // These are the wrist heights at which individual palm vertices meet the water.
    const level=(bounds.surface-offset[2])/weight;
    top=Math.max(top,level);
    bottom=Math.min(bottom,level);
    const contact=(bounds.low[1]-offset[1])/weight;
    rearmostContact=Math.max(rearmostContact,contact);
    frontmostContact=Math.min(frontmostContact,contact);
  }
  if(!(top>bottom))throw new Error('Pool paddle palm has no measured depth.');
  const depth=top-bottom;
  const wrist=(top+bottom)/2-depth*.6*Math.sin(angle);
  // Reserve half a palm in front of its leading edge, then fit one sweep for the whole cycle.
  const frontmostWrist=rearmostContact+(rearmostContact-frontmostContact)/2;
  const forward=Math.min(.81*reach.maximum,shoulder[1]-frontmostWrist);
  if(!(forward>0))throw new Error('Pool paddle lacks space ahead of the shoulder for a full pull.');
  const rear=forward*(.25/.81);
  const direction:Vec3=[side*reach.maximum*(.25+.12*Math.sin(angle)),
    -(rear+(forward-rear)*(1+Math.cos(angle))/2),wrist-shoulder[2]];
  const target=fitPoolWaterTarget(bounds,limb,shoulder,reach,direction,orientation,palm);
  // Point the elbow out along the surface while the wrist pulls through the water.
  const pole=add(shoulder,[side*reach.lengths[0],0,0]);
  return {target,pole,orientation};
}
