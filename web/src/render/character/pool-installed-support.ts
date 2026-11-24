import type {PoolFixtureV1,PoolSupport} from './pool-contact-types.js';
import {cross,sub} from './math.js';

export function installedPoolSupport(fixture:PoolFixtureV1,surface:string):PoolSupport {
 if(surface===fixture.ground.id)return {mode:'support',surface,interval:null,intervalSpace:'clip-phase',region:{kind:'top-face'}};
 const solid=fixture.solids.find(s=>s.id===surface);
 if(!solid)throw new Error('Pool source names an absent physical support: '+surface);
 const triangles=solid.triangles.flatMap((t,i)=>{
  const [a,b,c]=t.map(v=>solid.vertices[v]),normal=cross(sub(b,a),sub(c,a));
  return normal[2]>0&&normal[0]===0&&normal[1]===0?[i]:[];
 });
 if(!triangles.length)throw new Error('Pool source has no actual horizontal support: '+surface);
 return {mode:'support',surface,interval:null,intervalSpace:'clip-phase',region:{kind:'top-face',triangles}};
}
