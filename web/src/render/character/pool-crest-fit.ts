import {add,scale,sub,type Vec3} from './math.js';
import {poolRootRayIntervals,type PoolReachConstraint} from './pool-entry-domain.js';
import type {PoolSolid} from './pool-contact-types.js';
import type {Triangle} from './pool-solid.js';

export function poolCrestYaw(triangles:readonly Triangle[],rails:readonly PoolSolid[],originX:number,margin=0):number {
  const clearance=Math.min(originX-rails[0].bounds[1][0],rails[1].bounds[0][0]-originX)-margin;
  let angle=0;
  for(const triangle of triangles)for(const [x,y] of triangle){
    if(Math.abs(y)>=clearance)throw new Error('Pool crest torso cannot fit between the actual rails at this lateral placement.');
    const radius=Math.hypot(x,y);
    if(radius>clearance)angle=Math.max(angle,Math.atan2(Math.abs(y),Math.abs(x))+Math.acos(clearance/radius));
  }
  return angle;
}

function clipX(points:readonly Vec3[],boundary:number,sign:1|-1):Vec3[] {
  if(!points.length)return [];
  const clipped:Vec3[]=[];
  let prior=points.at(-1)!,inside=sign*(prior[0]-boundary)>=0;
  for(const point of points){
    const next=sign*(point[0]-boundary)>=0;
    if(inside!==next)clipped.push(add(prior,scale(sub(point,prior),(boundary-prior[0])/(point[0]-prior[0]))));
    if(next)clipped.push(point);
    prior=point;
    inside=next;
  }
  return clipped;
}

/** Exterior Y needed by the complete turned torso where it overlaps either rail's X span. */
export function poolCrestExteriorY(triangles:readonly Triangle[],rails:readonly PoolSolid[],originX:number,yaw:number):number {
  const c=Math.cos(yaw),s=Math.sin(yaw);
  let minimum=-Infinity;
  for(const triangle of triangles){
    const turned=triangle.map(([x,y,z]):Vec3=>[originX+x*c-y*s,x*s+y*c,z]);
    for(const rail of rails)for(const point of clipX(clipX(turned,rail.bounds[0][0],1),rail.bounds[1][0],-1))
      minimum=Math.max(minimum,rail.bounds[1][1]-point[1]);
  }
  return minimum;
}

export function poolCrestReachY(constraints:readonly PoolReachConstraint[],minimum:number,maximum:number,preferred:number):number {
  const spans=poolRootRayIntervals([0,1,0],constraints).map(interval=>({
    minimum:Math.max(interval.minimum,minimum),
    maximum:Math.min(interval.maximum,maximum),
  })).filter(span=>span.minimum<span.maximum);
  if(!spans.length)throw new Error('Pool crest has no shared torso, planted sole and grip depth.',{cause:{constraints,minimum,maximum}});
  const options=spans.map(span=>preferred>span.minimum&&preferred<span.maximum?preferred:
    preferred<=span.minimum?span.minimum+(span.maximum-span.minimum)/4:span.maximum-(span.maximum-span.minimum)/4);
  return options.sort((a,b)=>Math.abs(a-preferred)-Math.abs(b-preferred))[0];
}
