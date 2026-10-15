import type {Geometry} from '../../../src/render/character/bundle.js';
import {authoredOutline,CHARACTER_OUTLINE_WIDTH} from '../../../src/render/character/authored-surfaces.js';
import type {Vec3} from '../../../src/render/character/math.js';

const vertical=Math.sqrt(1166),outlineWidth=CHARACTER_OUTLINE_WIDTH;
const projectionLength=Math.hypot(21,21,vertical);
interface Contribution {bone:number;x:number;y:number;z:number;weight:number}
interface HeadVertex {index:number;outline:boolean;region:number;contributions:Contribution[]}

export function projectedHeadHeight(point:Vec3,facing:number):number {
  const c=Math.cos(facing),s=Math.sin(facing),x=c*point[0]-s*point[1],y=s*point[0]+c*point[1];
  return -(x-y)*21+point[2]*vertical;
}

/** Bake skin-before-subdivision into sparse bone contributions once per appearance. */
export class HeadEnvelope {
  private readonly vertices:HeadVertex[]=[];
  private readonly points:Float64Array;
  private cage:Float32Array<ArrayBuffer>;
  private matrices:Float32Array<ArrayBuffer>|null=null;
  private readonly cache=new Map<number,Vec3>();
  private hairRegion:number|null=null;

  constructor(private readonly geometry:Geometry){
    const selected=new Map<number,HeadVertex>();
    for(const part of geometry.description.parts)if([1,8,9].includes(part.region))for(let i=part.start;i<part.start+part.count;i++){
      const index=geometry.indices[i];
      selected.set(index,{index,outline:authoredOutline(part.name),region:part.region,contributions:[]});
    }
    this.vertices=[...selected.values()];this.points=new Float64Array(geometry.description.vertexCount*3);
    this.cage=geometry.cage;this.configure(this.cage);
  }

  configure(cage:Float32Array<ArrayBuffer>,hairRegion:number|null=null):void {
    this.cage=cage;this.hairRegion=hairRegion;this.matrices=null;this.cache.clear();
    const ids=new Uint32Array(this.geometry.stencilWeights),weights=new Float32Array(this.geometry.stencilWeights);
    for(const vertex of this.vertices){
      const contributions=new Map<number,Contribution>(),offset=vertex.index*4;
      const start=this.geometry.stencilRanges[offset],count=this.geometry.stencilRanges[offset+1];
      for(let i=start;i<start+count;i++){
        const base=ids[i*2]*16,coefficient=weights[i*2+1];
        for(let j=0;j<4;j++){
          const weight=cage[base+10+j]*coefficient;if(weight===0)continue;
          const bone=cage[base+6+j],entry=contributions.get(bone)??{bone,x:0,y:0,z:0,weight:0};
          entry.x+=cage[base]*weight;entry.y+=cage[base+1]*weight;entry.z+=cage[base+2]*weight;entry.weight+=weight;
          contributions.set(bone,entry);
        }
      }
      vertex.contributions=[...contributions.values()];
    }
  }

  pose(matrices:Float32Array<ArrayBuffer>):void {
    if(this.matrices===matrices)return;
    this.matrices=matrices;this.cache.clear();
    for(const vertex of this.vertices){
      const at=vertex.index*3;this.points.fill(0,at,at+3);
      for(const contribution of vertex.contributions){
        const b=contribution.bone*16,{x,y,z,weight}=contribution;
        for(let axis=0;axis<3;axis++)this.points[at+axis]+=matrices[b+axis]*x+matrices[b+4+axis]*y+matrices[b+8+axis]*z+matrices[b+12+axis]*weight;
      }
    }
  }

  private point(index:number):[number,number,number]{const at=index*3;return [this.points[at],this.points[at+1],this.points[at+2]];}

  private normal(index:number):Vec3 {
    const g=this.geometry,n=[0,0,0];
    if(g.stencilRanges[index*4+3]===1){
      const base=g.stencilRanges[index*4+2]*16,cage=this.cage,m=this.matrices!;
      for(let j=0;j<4;j++){
        const b=cage[base+6+j]*16,w=cage[base+10+j];
        for(let axis=0;axis<3;axis++)n[axis]+=w*(m[b+axis]*cage[base+3]+m[b+4+axis]*cage[base+4]+m[b+8+axis]*cage[base+5]);
      }
    }else{
      const a=this.point(index),start=g.normalRanges[index*2],count=g.normalRanges[index*2+1];
      for(let i=start;i<start+count;i++){
        const at=g.normalTriangles[i]*3;
        const corner=g.indices[at]===index?0:g.indices[at+1]===index?1:2;
        const b=this.point(g.indices[at+(corner+1)%3]).map((v,axis)=>v-a[axis]);
        const c=this.point(g.indices[at+(corner+2)%3]).map((v,axis)=>v-a[axis]);
        const bl=Math.hypot(...b),cl=Math.hypot(...c);if(bl<1e-8||cl<1e-8)continue;
        const cross=[b[1]*c[2]-b[2]*c[1],b[2]*c[0]-b[0]*c[2],b[0]*c[1]-b[1]*c[0]],length=Math.hypot(...cross);
        if(length<1e-10)continue;
        const angle=Math.acos(Math.max(-1,Math.min(1,b.reduce((sum,v,axis)=>sum+v*c[axis],0)/(bl*cl))));
        for(let axis=0;axis<3;axis++)n[axis]+=cross[axis]/length*angle;
      }
    }
    const length=Math.max(1e-10,Math.hypot(...n));return [n[0]/length,n[1]/length,n[2]/length];
  }

  /** Return the actual projected top, including normal extrusion, in rotated model space. */
  top(facing:number):Vec3 {
    const cached=this.cache.get(facing);if(cached)return cached;
    if(!this.matrices)throw new Error('Pose the character before reading the head envelope.');
    let highest=-Infinity,point:Vec3=[0,0,0];
    const visible=(vertex:HeadVertex)=>!(this.hairRegion!==null&&[8,9].includes(vertex.region)&&vertex.region!==this.hairRegion)
      &&this.matrices![this.geometry.vertices[vertex.index*16+6]*16+15]>=0;
    for(const vertex of this.vertices)if(visible(vertex)){
      const p=this.point(vertex.index),height=projectedHeadHeight(p,facing);
      if(height>highest){highest=height;point=p;}
    }
    const fillTop=highest;
    for(const vertex of this.vertices)if(vertex.outline&&visible(vertex)){
      const p=this.point(vertex.index);
      if(projectedHeadHeight(p,facing)+outlineWidth*projectionLength<fillTop)continue;
      const normal=this.normal(vertex.index),expanded:Vec3=[p[0]+normal[0]*outlineWidth,p[1]+normal[1]*outlineWidth,p[2]+normal[2]*outlineWidth];
      const height=projectedHeadHeight(expanded,facing);if(height>highest){highest=height;point=expanded;}
    }
    if(!Number.isFinite(highest))throw new Error('Character has no visible head envelope.');
    const c=Math.cos(facing),s=Math.sin(facing),rotated:Vec3=[c*point[0]-s*point[1],s*point[0]+c*point[1],point[2]];
    this.cache.set(facing,rotated);return rotated;
  }
}
