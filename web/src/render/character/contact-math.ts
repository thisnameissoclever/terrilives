import {dot,sub,type Vec3} from './math.js';
import {closestSphereBoxPoint} from './sphere-box.js';

/** Feasible positions on a real segment inside a limb's reach sphere. */
export function reachableSegment(start:Vec3,direction:Vec3,center:Vec3,radius:number,bounds:readonly [number,number]):[number,number]|null {
  const offset=sub(start,center),a=dot(direction,direction),b=2*dot(offset,direction),c=dot(offset,offset)-radius*radius;
  if(a<1e-12)throw new Error('Contact segment has no length.');
  const discriminant=b*b-4*a*c;if(discriminant<0)return null;
  const root=Math.sqrt(discriminant),low=Math.max(bounds[0],(-b-root)/(2*a)),high=Math.min(bounds[1],(-b+root)/(2*a));
  return low<=high?[low,high]:null;
}

/** Closest rigid assembly translation in the intersection of reach spheres and a permitted box. */
export function fitAssembly(preferred:Vec3,min:Vec3,max:Vec3,spheres:readonly {center:Vec3;radius:number}[]):[number,number,number]|null {
  return closestSphereBoxPoint(preferred,min,max,spheres);
}
