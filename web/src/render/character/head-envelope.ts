import type {Geometry,MeshPart} from './bundle.js';
import {authoredOutline,CHARACTER_OUTLINE_WIDTH} from './authored-surfaces.js';
import type {Vec3} from './math.js';

const vertical=Math.sqrt(1166),outlineWidth=CHARACTER_OUTLINE_WIDTH;
const projectionLength=Math.hypot(21,21,vertical);
interface Contribution {bone:number;x:number;y:number;z:number;weight:number}
interface HeadVertexView {index:number;outline:boolean;region:number}
interface HeadVertex extends HeadVertexView {contributions:Contribution[]}
interface HeadSelection {vertices:readonly HeadVertexView[];indices:ReadonlySet<number>;normalTriangles:ReadonlyMap<number,readonly number[]>}

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
  private readonly selections=new WeakMap<readonly MeshPart[],HeadSelection>();
  private visibleParts:readonly MeshPart[]|undefined;
  private selection:HeadSelection|undefined;
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

  /** Select immutable union-geometry parts without rebuilding their prepared head points. */
  setVisibleParts(parts?:readonly MeshPart[]):void {
    if(parts===this.visibleParts)return;
    let selection:HeadSelection|undefined;
    if(parts!==undefined){
      selection=this.selections.get(parts);
      if(!selection){
        const selected=new Map<number,HeadVertexView>(),indices=this.geometry.indices;
        for(const part of parts)if([1,8,9].includes(part.region))for(let at=part.start;at<part.start+part.count;at++){
          const index=indices[at];selected.set(index,{index,outline:authoredOutline(part.name),region:part.region});
        }
        const normalTriangles=new Map<number,number[]>();
        for(const part of parts)for(let at=part.start;at<part.start+part.count;at++){
          const index=indices[at];if(!selected.has(index))continue;
          let rows=normalTriangles.get(index);if(!rows){rows=[];normalTriangles.set(index,rows);}
          rows.push(part.start+Math.floor((at-part.start)/3)*3);
        }
        selection={vertices:[...selected.values()],indices:new Set(selected.keys()),normalTriangles};
        this.selections.set(parts,selection);
      }
    }
    this.visibleParts=parts;this.selection=selection;this.cache.clear();
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
      const at=vertex.index*3;let px=0,py=0,pz=0;
      for(const contribution of vertex.contributions){
        const b=contribution.bone*16,{x,y,z,weight}=contribution;
        px+=matrices[b]*x+matrices[b+4]*y+matrices[b+8]*z+matrices[b+12]*weight;
        py+=matrices[b+1]*x+matrices[b+5]*y+matrices[b+9]*z+matrices[b+13]*weight;
        pz+=matrices[b+2]*x+matrices[b+6]*y+matrices[b+10]*z+matrices[b+14]*weight;
      }
      this.points[at]=px;this.points[at+1]=py;this.points[at+2]=pz;
    }
  }

  private point(index:number):[number,number,number]{const at=index*3;return [this.points[at],this.points[at+1],this.points[at+2]];}
  private normalPoint(index:number):[number,number,number]{return this.selection&&!this.selection.indices.has(index)?[0,0,0]:this.point(index);}

  private normal(index:number):Vec3 {
    const g=this.geometry,n=[0,0,0];
    if(g.stencilRanges[index*4+3]===1){
      const base=g.stencilRanges[index*4+2]*16,cage=this.cage,m=this.matrices!;
      for(let j=0;j<4;j++){
        const b=cage[base+6+j]*16,w=cage[base+10+j];
        for(let axis=0;axis<3;axis++)n[axis]+=w*(m[b+axis]*cage[base+3]+m[b+4+axis]*cage[base+4]+m[b+8+axis]*cage[base+5]);
      }
    }else{
      const a=this.point(index),selected=this.selection?.normalTriangles.get(index);
      const start=this.selection?0:g.normalRanges[index*2],count=this.selection?(selected?.length??0):g.normalRanges[index*2+1];
      for(let i=start;i<start+count;i++){
        const at=selected?selected[i]:g.normalTriangles[i]*3;
        const corner=g.indices[at]===index?0:g.indices[at+1]===index?1:2;
        const b=this.normalPoint(g.indices[at+(corner+1)%3]).map((v,axis)=>v-a[axis]);
        const c=this.normalPoint(g.indices[at+(corner+2)%3]).map((v,axis)=>v-a[axis]);
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
    const c=Math.cos(facing),s=Math.sin(facing),points=this.points;
    const heightAt=(x:number,y:number,z:number)=>{
      const rotatedX=c*x-s*y,rotatedY=s*x+c*y;
      return -(rotatedX-rotatedY)*21+z*vertical;
    };
    let highest=-Infinity,point:Vec3=[0,0,0];
    const vertices=this.selection?.vertices??this.vertices;
    const visible=(vertex:HeadVertexView)=>!(this.hairRegion!==null&&[8,9].includes(vertex.region)&&vertex.region!==this.hairRegion)
      &&this.matrices![this.geometry.vertices[vertex.index*16+6]*16+15]>=0;
    for(const vertex of vertices)if(visible(vertex)){
      const at=vertex.index*3,x=points[at],y=points[at+1],z=points[at+2],height=heightAt(x,y,z);
      if(height>highest){highest=height;point=[x,y,z];}
    }
    const fillTop=highest;
    for(const vertex of vertices)if(vertex.outline&&visible(vertex)){
      const at=vertex.index*3,x=points[at],y=points[at+1],z=points[at+2];
      if(heightAt(x,y,z)+outlineWidth*projectionLength<fillTop)continue;
      const normal=this.normal(vertex.index),ex=x+normal[0]*outlineWidth,ey=y+normal[1]*outlineWidth,ez=z+normal[2]*outlineWidth;
      const height=heightAt(ex,ey,ez);if(height>highest){highest=height;point=[ex,ey,ez];}
    }
    if(!Number.isFinite(highest))throw new Error('Character has no visible head envelope.');
    const rotated:Vec3=[c*point[0]-s*point[1],s*point[0]+c*point[1],point[2]];
    this.cache.set(facing,rotated);return rotated;
  }
}
