import type {Vec3} from './math.js';

type Point2=readonly [number,number];
export interface PoolWaterFootprint {minimum:Point2;maximum:Point2;height:number}
export interface PoolRippleContact {x:number;y:number;radius:number;strength:number}
interface PoseSource {cage:Float32Array;manifest:{bones:readonly {name:string}[]}}
interface PoolWaterContacts {ripples:PoolRippleContact[];touchdown:Point2|null}

const STRIDE=16;
const SAMPLE_LIMIT=96;
const WATERLINE_BAND=.105;
const INSET=.012;
const cachedGroups=new WeakMap<PoseSource,readonly (readonly number[])[]>();

function region(name:string):number {
  if(name==='hips'||name==='spine')return 0;
  if(/^(upper_arm|forearm|hand)\.L$/.test(name))return 1;
  if(/^(upper_arm|forearm|hand)\.R$/.test(name))return 2;
  if(/^foot\.[LR]$/.test(name))return 3;
  return -1;
}

function poseGroups(body:PoseSource):readonly (readonly number[])[]{
  const previous=cachedGroups.get(body);
  if(previous)return previous;
  const group=[[],[],[],[]] as number[][];
  const boneRegions=body.manifest.bones.map(bone=>region(bone.name));
  for(let index=0;index<body.cage.length;index+=STRIDE){
    let influence=0;
    for(let j=1;j<4;j++)if(body.cage[index+10+j]>body.cage[index+10+influence])influence=j;
    const part=boneRegions[body.cage[index+6+influence]];
    if(part>=0&&body.cage[index+15]<7)group[part].push(index);
  }
  const bounded=group.map(indices=>indices.length<=SAMPLE_LIMIT
    ?indices
    :Array.from({length:SAMPLE_LIMIT},(_,i)=>indices[Math.round(i*(indices.length-1)/(SAMPLE_LIMIT-1))]));
  cachedGroups.set(body,bounded);
  return bounded;
}

/** Sample the configured body with the same skinned pose used to draw it. */
export function collectPoolWaterContacts(body:PoseSource,shaped:Float32Array,matrices:Float32Array,
  water:PoolWaterFootprint,offset:Vec3):PoolWaterContacts {
  const groups=poseGroups(body);
  const ripples:PoolRippleContact[]=[];
  let footX=0,footY=0,footCount=0;
  for(let group=0;group<groups.length;group++){
    let sumX=0,sumY=0,sumRadiusSquared=0,totalWeight=0,min=Infinity,max=-Infinity;
    for(const at of groups[group]){
      const x=shaped[at],y=shaped[at+1],z=shaped[at+2];
      let px=offset[0],py=offset[1],pz=offset[2];
      for(let j=0;j<4;j++){
        const w=shaped[at+10+j];
        if(w===0)continue;
        const m=shaped[at+6+j]*16;
        px+=w*(matrices[m]*x+matrices[m+4]*y+matrices[m+8]*z+matrices[m+12]);
        py+=w*(matrices[m+1]*x+matrices[m+5]*y+matrices[m+9]*z+matrices[m+13]);
        pz+=w*(matrices[m+2]*x+matrices[m+6]*y+matrices[m+10]*z+matrices[m+14]);
      }
      if(!(px>water.minimum[0]+INSET&&px<water.maximum[0]-INSET&&py>water.minimum[1]+INSET&&py<water.maximum[1]-INSET))continue;
      const height=pz-water.height;
      if(group===3){
        if(height<=.015){footX+=px;footY+=py;footCount++;}
        continue;
      }
      min=Math.min(min,height);max=Math.max(max,height);
      const weight=Math.max(0,1-Math.abs(height)/WATERLINE_BAND)**2;
      sumX+=px*weight;sumY+=py*weight;
      sumRadiusSquared+=(px*px+py*py)*weight;
      totalWeight+=weight;
    }
    const contact=Math.min(1,(.015-min)/.04,(max+.065)/.035);
    if(!totalWeight||contact<=0)continue;
    const torso=group===0;
    const x=sumX/totalWeight,y=sumY/totalWeight;
    const spread=Math.sqrt(Math.max(0,sumRadiusSquared/totalWeight-x*x-y*y));
    const radius=Math.min(torso ? .60 : .32,(torso ? .36 : .17)+spread);
    ripples.push({x,y,radius,strength:contact*(torso ? .19 : .15)});
  }
  const contact=ripples[0];
  return {ripples,touchdown:footCount?[footX/footCount,footY/footCount]:contact?[contact.x,contact.y]:null};
}

interface LandingPresence {fixture:number;frame:number;launch:boolean;wet:boolean;impact?:{point:Point2;tick:number}}

/** A presentation effect starts only when a displayed forward entry meets the water. */
export class PoolLandingRipples {
  private readonly presence=new Map<number,LandingPresence>();
  private frame=0;
  private tick=0;

  begin(tick:number):void {
    if(tick<this.tick)this.clear();
    this.tick=tick;this.frame++;
  }
  observe(entity:number,fixture:number,launch:boolean,contact:Point2|null):PoolRippleContact|null {
    const previous=this.presence.get(entity);
    const previousFrame=previous?.fixture===fixture&&previous.frame>=this.frame-1?previous:undefined;
    let impact=previousFrame?.impact;
    if(!contact&&!launch&&impact&&this.tick-impact.tick>=6)impact=undefined;
    if(previousFrame&&!impact&&!previousFrame.wet&&contact&&(launch||previousFrame.launch)){
      impact={point:contact,tick:this.tick};
    }
    this.presence.set(entity,{fixture,frame:this.frame,launch,wet:contact!==null,impact});
    if(!impact)return null;
    const age=(this.tick-impact.tick)/6;
    if(age>=1)return null;
    return {x:impact.point[0],y:impact.point[1],radius:.27+.39*age,strength:.32*(1-age)**2};
  }
  end():void {
    for(const [entity,state] of this.presence)if(state.frame!==this.frame)this.presence.delete(entity);
  }
  clear():void {this.presence.clear();}
}
