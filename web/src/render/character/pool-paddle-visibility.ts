import type {Geometry} from './bundle.js';
import {add, cross, dot, scale, solveLimb, sub, unit, type Vec3} from './math.js';
import type {PoolFixtureV1} from './pool-contact-types.js';
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

/** Include the bevel on the inside of the coping when measuring room for the elbows. */
export function paddleRimSides(fixture:PoolFixtureV1):readonly [number,number] {
  const coping=fixture.solids.find(s=>s.id==='Pool stone coping');
  if(!coping)throw new Error('The pool needs a coping mesh to fit its stroke.');
  const middleY=(coping.bounds[0][1]+coping.bounds[1][1])/2;
  const middleX=(coping.bounds[0][0]+coping.bounds[1][0])/2;
  let left=-Infinity,right=Infinity;
  for(const face of coping.triangles)for(let i=0;i<3;i++){
    const a=coping.vertices[face[i]],b=coping.vertices[face[(i+1)%3]];
    if((a[1]<=middleY)===(b[1]<=middleY))continue;
    const x=a[0]+(middleY-a[1])*(b[0]-a[0])/(b[1]-a[1]);
    if(x<middleX)left=Math.max(left,x);
    else if(x>middleX)right=Math.min(right,x);
  }
  if(!Number.isFinite(left)||!Number.isFinite(right))throw new Error('The pool coping has no open centre.');
  return [left,right];
}

/** Keep the wrist fixed and tuck just enough of the elbow's bend circle under the stroke. */
function paddleElbowPole(shoulder:Vec3,target:Vec3,reach:PoolChainReach,side:number,limit:number):Vec3 {
  const preferred=add(shoulder,[side*reach.lengths[0],0,0]);
  if(side*shoulder[0]+reach.lengths[0]<=limit)return preferred;
  const elbow=solveLimb(shoulder,target,...reach.lengths,preferred);
  if(side*elbow[0]<=limit)return preferred;
  const axis=unit(sub(target,shoulder));
  const centre=add(shoulder,scale(axis,dot(sub(elbow,shoulder),axis)));
  const radial=sub(elbow,centre),tangent=cross(axis,radial);
  const outwardRadius=side*radial[0];
  if(outwardRadius<=0)return preferred;
  const cosine=Math.max(-1,Math.min(1,(limit-side*centre[0])/outwardRadius));
  const sine=Math.sqrt(1-cosine*cosine)*(tangent[2]>0?-1:1);
  return add(centre,add(scale(radial,cosine),scale(tangent,sine)));
}

/** Reach forward, sweep outward and back, then recover near the water with a bent elbow. */
export function poolPaddleArm(bounds:ReturnType<typeof poolWaterBounds>, limb:'handL'|'handR', phase:number,
  shoulder:Vec3, reach:PoolChainReach, orientation:readonly number[], palm:readonly PoolSurfaceCoefficient[],elbowLimit:number) {
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
  if(!(forward>0))throw new Error('Pool paddle lacks space ahead of the shoulder for a full pull.',{
    cause:{shoulder,frontmostWrist,waterMinimum:bounds.low,waterMaximum:bounds.high},
  });
  const rear=forward*(.25/.81);
  const direction:Vec3=[side*reach.maximum*(.25+.12*Math.sin(angle)),
    -(rear+(forward-rear)*(1+Math.cos(angle))/2),wrist-shoulder[2]];
  const target=fitPoolWaterTarget(bounds,limb,shoulder,reach,direction,orientation,palm);
  // Point the elbow out along the surface while the wrist pulls through the water.
  const pole=paddleElbowPole(shoulder,target,reach,side,elbowLimit);
  return {target,pole,orientation};
}
