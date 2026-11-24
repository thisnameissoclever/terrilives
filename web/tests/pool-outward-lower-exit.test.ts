import {expect,it} from 'vitest';
import {identity,type Vec3} from '../src/render/character/math.js';
import {outwardFootSwing} from '../src/render/character/pool-outward-lower-exit.js';
import {poolSurfacePoint} from '../src/render/character/pool-entry-anatomy.js';

const coefficients=[[0,-.18,0,1],[0,-.26,0,2],[0,.15,.04,1]] as const;
const foot=(target:Vec3,orientation=identity())=>({target,orientation,lift:.04});

it('draws the complete heel beyond the tread before lowering it',()=>{
 const from=foot([-.36,.98,.86]),to=foot([-.36,.98,.36]);
 const step=(v:number)=>outwardFootSwing('footL',from,to,v,false,coefficients,1,.024,.42);
 expect(step(0)).toBe(from);
 expect(step(1)).toBe(to);
 for(const t of [.2,.48,.76]){
  const pose=step(t);
  for(const c of coefficients)expect(poolSurfacePoint(pose.orientation,c)[1]+c[3]*pose.target[1]).toBeGreaterThan(1);
 }
 expect(step(.2).target[2]).toBeGreaterThan(from.target[2]);
 expect(step(.76).target[2]).toBeGreaterThan(to.target[2]);
 expect(step(.76).target[2]).toBeLessThan(step(.48).target[2]);
});

it('turns the lifted dry foot through the same quarter-turn as the pelvis',()=>{
 const outward=[-1,0,0,0,0,-1,0,0,0,0,1,0,0,0,0,1];
 const from=foot([-.64,1.4,.11],outward),to=foot([-.36,1.5,.11]);
 const mid=outwardFootSwing('footR',from,to,.46,true,coefficients,1,.024,.42);
 expect(mid.orientation[1]).toBeCloseTo(-1,10);
 expect(mid.target[2]).toBeGreaterThan(.2);
 expect(mid.target[1]).toBeLessThan((from.target[1]+to.target[1])/2);
 expect(outwardFootSwing('footR',from,to,.76,true,coefficients,1,.024,.42).orientation).toEqual(to.orientation);
});
