import type {PoolCycleSource,PoolFoot} from './pool-cycle-source.js';
import {preparePoolContactPatch,type PreparedPoolPatch} from './pool-contact-patch.js';
import {poolSurfacePoint} from './pool-entry-anatomy.js';
import {properPoolRotation} from './pool-canonical-pose.js';
import {multiply} from './math.js';

interface SoleChoice {kind:'front'|'back'|'heel';pitch:number;patch:PreparedPoolPatch;raw:readonly number[]}
const facing=[-1,0,0,0,0,-1,0,0,0,0,1,0,0,0,0,1];
const tip=(a:number)=>[1,0,0,0,0,Math.cos(a),Math.sin(a),0,0,-Math.sin(a),Math.cos(a),0,0,0,0,1];

/** The heel choices are actual connected triangle fans at lower-hull vertices of the selected foot. */
export function* outwardSoleChoices(source:PoolCycleSource,limb:PoolFoot,place:string):Generator<SoleChoice>{
  const a=source.anatomy[limb],g=source.geometry[0],part=g.description.parts.find(p=>p.name===a.patch.part)!;
  const flat=multiply(facing,properPoolRotation(source.neutral.rest[a.end]));
  yield {kind:'front',pitch:0,patch:a.front!,raw:flat};
  yield {kind:'back',pitch:0,patch:a.back!,raw:flat};
  const tread=source.fixture.solids.find(s=>s.id===source.definition.places[place].surface)!;
  const ids=[...new Set(g.indices.subarray(part.start,part.start+part.count))];
  const points=a.surfaceCoefficients.map((c,i)=>{const p=poolSurfacePoint(flat,c);return {id:ids[i],y:p[1]/c[3],z:p[2]/c[3]};});
  const ordered=[...points].sort((p,q)=>p.y-q.y||p.z-q.z||p.id-q.id),hull:typeof ordered=[];
  for(const p of ordered){
    if(hull.length&&hull.at(-1)!.y===p.y)continue;
    while(hull.length>=2){
      const a=hull[hull.length-2],b=hull[hull.length-1];
      if((b.y-a.y)*(p.z-a.z)-(b.z-a.z)*(p.y-a.y)>0)break;
      hull.pop();
    }
    hull.push(p);
  }
  const cuts=new Set<number>([0,Math.PI/4]);
  for(let i=1;i<hull.length;i++){
    const ang=Math.atan2(hull[i-1].z-hull[i].z,hull[i].y-hull[i-1].y);
    if(ang>0&&ang<Math.PI/4)cuts.add(ang);
  }
  const sorted=[...cuts].sort((a,b)=>a-b);
  const angles=[...sorted,...sorted.slice(1).map((a,i)=>(a+sorted[i])/2)].sort((a,b)=>a-b);
  const patches=new Map<number,PreparedPoolPatch>();
  for(const pitch of angles){
    const raw=pitch?properPoolRotation(multiply(tip(pitch),flat)):flat;
    let highest=-Infinity,at=0;
    for(let i=0;i<ids.length;i++){
      const c=a.surfaceCoefficients[i],p=poolSurfacePoint(raw,c),z=(tread.bounds[1][2]-p[2])/c[3];
      if(z>highest){highest=z;at=i;}
    }
    // Outward-facing toes point toward increasing Y. The heel is behind the ankle.
    if(points[at].y>0)continue;
    const anchor=ids[at];let patch=patches.get(anchor);
    if(!patch){
      const triangles:number[]=[];
      for(let i=part.start;i<part.start+part.count;i+=3)if(g.indices[i]===anchor||g.indices[i+1]===anchor||g.indices[i+2]===anchor)triangles.push((i-part.start)/3);
      patch=preparePoolContactPatch(g,source.cages[0],source.neutral.rest,source.bundle.bones[a.end].name,{part:part.name,triangles});
      patches.set(anchor,patch);
    }
    yield {kind:'heel',pitch,patch,raw};
  }
}
