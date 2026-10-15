import {add,cross,dot,length,scale,sub,unit,type Vec3} from './math.js';

type Sphere={center:Vec3;radius:number};
type Plane={normal:Vec3;distance:number};
type Boundary={sphere:Sphere}|{plane:Plane};
type Line={point:Vec3;direction:Vec3};
const tolerance=1e-7;

function intersectPlanes(a:Plane,b:Plane):Line|null {
  const direction=cross(a.normal,b.normal),square=dot(direction,direction);if(square<1e-16)return null;
  const point=scale(add(scale(cross(b.normal,direction),a.distance),scale(cross(direction,a.normal),b.distance)),1/square);
  return {point,direction:unit(direction)};
}
function radicalPlane(a:Sphere,b:Sphere):Plane|null {
  const delta=sub(b.center,a.center),distance=length(delta);if(distance<1e-12)return null;
  return {normal:scale(delta,1/distance),distance:(dot(b.center,b.center)-dot(a.center,a.center)+a.radius*a.radius-b.radius*b.radius)/(2*distance)};
}
function nearestCircle(sphere:Sphere,plane:Plane,preferred:Vec3):Vec3[] {
  const height=plane.distance-dot(plane.normal,sphere.center),square=sphere.radius*sphere.radius-height*height;
  if(square< -1e-12)return [];
  const center=add(sphere.center,scale(plane.normal,height)),radius=Math.sqrt(Math.max(0,square));
  if(radius<1e-12)return [center];
  const delta=sub(preferred,center);let radial=sub(delta,scale(plane.normal,dot(delta,plane.normal)));
  if(length(radial)<1e-12)radial=cross(plane.normal,Math.abs(plane.normal[0])<.8?[1,0,0]:[0,1,0]);
  return [add(center,scale(unit(radial),radius))];
}
function lineSphere(line:Line,sphere:Sphere):Vec3[] {
  const delta=sub(sphere.center,line.point),along=dot(delta,line.direction),closest=add(line.point,scale(line.direction,along));
  const off=sub(closest,sphere.center),square=sphere.radius*sphere.radius-dot(off,off);if(square< -1e-12)return [];
  const step=scale(line.direction,Math.sqrt(Math.max(0,square)));return [add(closest,step),sub(closest,step)];
}
function pair(a:Boundary,b:Boundary,preferred:Vec3):Vec3[] {
  if('sphere' in a&&'sphere' in b){const plane=radicalPlane(a.sphere,b.sphere);return plane?nearestCircle(a.sphere,plane,preferred):[];}
  if('sphere' in a&&'plane' in b)return nearestCircle(a.sphere,b.plane,preferred);
  if('plane' in a&&'sphere' in b)return nearestCircle(b.sphere,a.plane,preferred);
  if('plane' in a&&'plane' in b){const line=intersectPlanes(a.plane,b.plane);return line?[add(line.point,scale(line.direction,dot(sub(preferred,line.point),line.direction)))]:[];}
  return [];
}
function triple(boundaries:Boundary[]):Vec3[] {
  const spheres=boundaries.flatMap(boundary=>'sphere' in boundary?[boundary.sphere]:[]),planes=boundaries.flatMap(boundary=>'plane' in boundary?[boundary.plane]:[]);
  if(!spheres.length){
    const [a,b,c]=planes,line=intersectPlanes(a,b);if(!line)return [];
    const denominator=dot(c.normal,line.direction);if(Math.abs(denominator)<1e-12)return [];
    return [add(line.point,scale(line.direction,(c.distance-dot(c.normal,line.point))/denominator))];
  }
  for(let i=1;i<spheres.length;i++){const plane=radicalPlane(spheres[0],spheres[i]);if(!plane)return [];planes.push(plane);}
  const line=intersectPlanes(planes[0],planes[1]);return line?lineSphere(line,spheres[0]):[];
}

/** In three dimensions, a closest feasible point lies on at most three independent active boundaries. */
export function closestSphereBoxPoint(preferred:Vec3,min:Vec3,max:Vec3,spheres:readonly Sphere[]):[number,number,number]|null {
  if([...preferred,...min,...max].some(value=>!Number.isFinite(value))||min.some((value,i)=>value>max[i])||spheres.some(s=>!Number.isFinite(s.radius)||s.radius<0||s.center.some(value=>!Number.isFinite(value))))throw new Error('Invalid contact feasibility domain.');
  const clamp=(p:Vec3)=>p.map((value,i)=>Math.max(min[i],Math.min(max[i],value))) as [number,number,number];
  const inside=(p:Vec3)=>p.every((value,i)=>value>=min[i]-tolerance&&value<=max[i]+tolerance)&&spheres.every(sphere=>length(sub(p,sphere.center))<=sphere.radius+tolerance);
  const projected=clamp(preferred);if(inside(projected))return projected;
  for(let i=0;i<spheres.length;i++){
    if(length(sub(clamp(spheres[i].center),spheres[i].center))>spheres[i].radius+tolerance)return null;
    for(let j=i+1;j<spheres.length;j++)if(length(sub(spheres[i].center,spheres[j].center))>spheres[i].radius+spheres[j].radius+tolerance)return null;
  }
  const boundaries:Boundary[]=spheres.map(sphere=>({sphere}));
  for(let axis=0;axis<3;axis++)for(const distance of new Set([min[axis],max[axis]])){
    const normal:[number,number,number]=[0,0,0];normal[axis]=1;boundaries.push({plane:{normal,distance}});
  }
  let best:[number,number,number]|null=null,cost=Infinity;
  const consider=(p:Vec3)=>{if(!inside(p))return;const delta=sub(p,preferred),next=dot(delta,delta);if(next<cost){cost=next;best=[...p];}};
  for(const boundary of boundaries){
    if('plane' in boundary)consider(add(preferred,scale(boundary.plane.normal,boundary.plane.distance-dot(boundary.plane.normal,preferred))));
    else {const delta=sub(preferred,boundary.sphere.center);consider(add(boundary.sphere.center,scale(length(delta)>1e-12?unit(delta):[1,0,0],boundary.sphere.radius)));}
  }
  for(let i=0;i<boundaries.length;i++)for(let j=i+1;j<boundaries.length;j++){
    for(const p of pair(boundaries[i],boundaries[j],preferred))consider(p);
    for(let k=j+1;k<boundaries.length;k++)for(const p of triple([boundaries[i],boundaries[j],boundaries[k]]))consider(p);
  }
  return best;
}
