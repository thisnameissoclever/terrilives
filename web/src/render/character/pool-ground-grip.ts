import {add,sub,type Vec3} from './math.js';
import {poolChainReachable,poolRootRayIntervals,type PoolReachConstraint} from './pool-entry-domain.js';

const poolward:Vec3=[0,-1,0];
const chooseInterior=(minimum:number,maximum:number)=>minimum+(maximum-minimum)/4;

/** Intersect the actual reach shells on one directed sagittal circle. */
function fitSagittalCircle(centre:Vec3,radius:number,direction:1|-1,limit:number,preference:number,constraints:readonly PoolReachConstraint[]):Vec3|null {
  const angles=[0,limit],turn=2*Math.PI;
  for(const {center,reach} of constraints){
    const [x,y,z]=sub(center,centre),projection=Math.hypot(y,z);
    if(projection===0)continue;
    const origin=Math.atan2(direction*y,z),constant=x*x+y*y+z*z+radius*radius;
    for(const distance of [reach.minimum,reach.maximum]){
      const cosine=(constant-distance*distance)/(2*radius*projection);
      if(cosine < -1||cosine > 1)continue;
      const sweep=Math.acos(cosine);
      for(const angle of [origin-sweep,origin+sweep]){
        const normal=((angle%turn)+turn)%turn;
        if(normal>0&&normal<limit)angles.push(normal);
      }
    }
  }
  angles.sort((a,b)=>a-b);
  const position=(angle:number):Vec3=>add(centre,[0,direction*radius*Math.sin(angle),radius*Math.cos(angle)]);
  const admits=(point:Vec3)=>constraints.every(c=>poolChainReachable(c.reach,point,c.center));
  const candidates:{point:Vec3;distance:number}[]=[];
  for(let index=1;index<angles.length;index++){
    const minimum=angles[index-1],maximum=angles[index];
    if(minimum===maximum)continue;
    const angle=preference<=minimum?chooseInterior(minimum,maximum):preference>=maximum?maximum-(maximum-minimum)/4:preference;
    const point=position(angle);
    if(admits(point))candidates.push({point,distance:Math.abs(preference-angle)});
  }
  candidates.sort((a,b)=>a.distance-b.distance);
  return candidates[0]?.point??null;
}

/** Fit both rail targets and both fixed soles through a common grounded pelvis path. */
export function fitPoolGroundGrip(constraints:readonly PoolReachConstraint[],radius:number):Vec3 {
  const admits=(offset:Vec3)=>constraints.every(c=>poolChainReachable(c.reach,offset,c.center));
  const neutral:Vec3=[0,0,0];
  if(admits(neutral))return neutral;

  for(const interval of poolRootRayIntervals(poolward,constraints)){
    const offset:Vec3=[0,-chooseInterior(interval.minimum,interval.maximum),0];
    if(admits(offset))return offset;
  }
  if(!Number.isFinite(radius)||radius<=0)throw new Error('Pool acquisition needs the real planted height.');
  const arc=fitSagittalCircle([0,0,-radius],radius,-1,Math.PI/2,0,constraints);
  if(arc)return arc;
  throw new Error('Pool acquisition has no joint reach through the fixed-sole pelvis path.',{cause:{constraints,radius}});
}

/** Keep the established shin and ankle location while fitting the first-rung thigh and remaining reaches. */
export function fitPoolFirstRungHips(preferred:Vec3,hipsFromKnee:Vec3,thighLength:number,constraints:readonly PoolReachConstraint[]):Vec3 {
  const centre:Vec3=[preferred[0],hipsFromKnee[1],hipsFromKnee[2]];
  const lateral=preferred[0]-hipsFromKnee[0],radiusSquared=thighLength*thighLength-lateral*lateral;
  if(radiusSquared<=0)throw new Error('Pool first rung thigh has no sagittal radius.');
  const angle=Math.atan2(preferred[1]-centre[1],preferred[2]-centre[2]);
  const fitted=fitSagittalCircle(centre,Math.sqrt(radiusSquared),1,Math.PI,angle,constraints);
  if(!fitted)throw new Error('Pool first rung has no reachable hips over the clear planted shin.',{cause:{preferred,centre,thighLength,constraints}});
  return fitted;
}
