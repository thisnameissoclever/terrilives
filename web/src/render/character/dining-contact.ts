import {add,cross,dot,identity,length,scale,sub,unit,type Vec3} from './math.js';

export interface DiningGripFit {rotation:number[];transform:number[];wrist:Vec3}

/** Rotate the held assembly about its fixed bowl endpoint without changing the grip. */
export function fitDiningGrip(wrist:Vec3,bowl:Vec3,shoulder:Vec3,inner:number,outer:number):DiningGripFit|null{
  const from=sub(wrist,bowl),radius=length(from),toward=sub(shoulder,bowl),distance=length(toward);
  if(radius<1e-10||distance<1e-10){
    const reach=length(sub(wrist,shoulder));
    return reach>=inner&&reach<=outer?{rotation:identity(),transform:identity(),wrist}:null;
  }
  const axis=scale(toward,1/distance),preferred=scale(from,1/radius),denominator=2*distance*radius;
  const low=Math.max(-1,(distance*distance+radius*radius-outer*outer)/denominator);
  const high=Math.min(1,(distance*distance+radius*radius-inner*inner)/denominator);
  if(low>high)return null;
  const cosine=dot(preferred,axis),chosen=Math.max(low,Math.min(high,cosine));
  if(Math.abs(chosen-cosine)<1e-12)return {rotation:identity(),transform:identity(),wrist};
  let tangent=sub(preferred,scale(axis,cosine));
  if(length(tangent)<1e-10)tangent=cross(axis,Math.abs(axis[2])<.8?[0,0,1]:[0,1,0]);
  const direction=add(scale(axis,chosen),scale(unit(tangent),Math.sqrt(Math.max(0,1-chosen*chosen))));
  const vector=cross(preferred,direction),turnCosine=Math.max(-1,Math.min(1,dot(preferred,direction))),sine=length(vector);
  const rotation=identity();
  if(sine>1e-10){
    const normal=scale(vector,1/sine),[x,y,z]=normal,one=1-turnCosine;
    rotation.splice(0,12,
      turnCosine+x*x*one,y*x*one+z*sine,z*x*one-y*sine,0,
      x*y*one-z*sine,turnCosine+y*y*one,z*y*one+x*sine,0,
      x*z*one+y*sine,y*z*one-x*sine,turnCosine+z*z*one,0);
  }else if(turnCosine<0){
    const [x,y,z]=unit(cross(preferred,Math.abs(preferred[2])<.8?[0,0,1]:[0,1,0]));
    rotation.splice(0,12,2*x*x-1,2*x*y,2*x*z,0,2*x*y,2*y*y-1,2*y*z,0,2*x*z,2*y*z,2*z*z-1,0);
  }
  const transform=[...rotation];
  transform.splice(12,3,...sub(bowl,[rotation[0]*bowl[0]+rotation[4]*bowl[1]+rotation[8]*bowl[2],
    rotation[1]*bowl[0]+rotation[5]*bowl[1]+rotation[9]*bowl[2],rotation[2]*bowl[0]+rotation[6]*bowl[1]+rotation[10]*bowl[2]]));
  return {rotation,transform,wrist:add(bowl,scale(direction,radius))};
}
