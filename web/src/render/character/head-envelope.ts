import type {Geometry,MeshPart} from './bundle.js';
import {authoredOutline,CHARACTER_OUTLINE_WIDTH} from './authored-surfaces.js';
import type {Vec3} from './math.js';

const vertical=Math.sqrt(1166),outlineWidth=CHARACTER_OUTLINE_WIDTH;
const projectionLength=Math.hypot(21,21,vertical);
const normalScratch=new Float64Array(3);
interface Contribution {bone:number;x:number;y:number;z:number;weight:number}
interface HeadScan {indices:Uint32Array;positions:Uint32Array;visibility:Uint32Array;regions:Uint8Array;outlines:Uint8Array}
/**
 * One visible part selection. `visible` marks its head vertices; the
 * triangles that light the normal of the vertex in scan slot `i` are
 * `normalTriangles[normalStarts[i]]` up to `normalStarts[i + 1]`, in part
 * order. Typed arrays rather than maps and per-vertex arrays: every prepared
 * character keeps several of these, and the maps cost megabytes each.
 */
interface HeadSelection {scan:HeadScan;visible:Uint8Array;normalStarts:Uint32Array;normalTriangles:Uint32Array}

/**
 * The head vertices of `parts`, in the order a vertex first appears; a vertex
 * shared by several head parts takes the region and outline of the last.
 * `slots` maps a vertex to its scan slot and is left filled for the caller.
 */
function headScan(parts:readonly MeshPart[],geometry:Geometry,slots:Int32Array):HeadScan {
  const indices=geometry.indices,order:number[]=[],regions:number[]=[],outlines:number[]=[];
  for(const part of parts)if([1,8,9].includes(part.region)){
    const outline=Number(authoredOutline(part.name));
    for(let at=part.start;at<part.start+part.count;at++){
      const index=indices[at];let slot=slots[index];
      if(slot<0){slot=order.length;slots[index]=slot;order.push(index);regions.push(0);outlines.push(0);}
      regions[slot]=part.region;outlines[slot]=outline;
    }
  }
  const count=order.length,scan:HeadScan={indices:Uint32Array.from(order),positions:new Uint32Array(count),visibility:new Uint32Array(count),
    regions:Uint8Array.from(regions),outlines:Uint8Array.from(outlines)};
  for(let i=0;i<count;i++){scan.positions[i]=order[i]*3;scan.visibility[i]=geometry.vertices[order[i]*16+6]*16+15;}
  return scan;
}

export function projectedHeadHeight(point:Vec3,facing:number):number {
  const c=Math.cos(facing),s=Math.sin(facing),x=c*point[0]-s*point[1],y=s*point[0]+c*point[1];
  return -(x-y)*21+point[2]*vertical;
}

/** Bake skin-before-subdivision into sparse bone contributions once per appearance. */
export class HeadEnvelope {
  private readonly points:Float64Array;
  private readonly scan:HeadScan;
  private contributionRanges=new Uint32Array(0);
  private contributionBones=new Uint32Array(0);
  private contributionValues=new Float64Array(0);
  private cage:Float32Array<ArrayBuffer>;
  private matrices:Float32Array<ArrayBuffer>|null=null;
  private poseDependencies=new Uint32Array(0);
  private dependencyValues=new Float32Array(0);
  private hasPose=false;
  private readonly cache=new Map<number,Vec3>();
  private readonly selections=new WeakMap<readonly MeshPart[],HeadSelection>();
  private visibleParts:readonly MeshPart[]|undefined;
  private selection:HeadSelection|undefined;
  private hairRegion:number|null=null;

  constructor(private readonly geometry:Geometry){
    this.points=new Float64Array(geometry.description.vertexCount*3);
    this.scan=headScan(geometry.description.parts,geometry,new Int32Array(geometry.description.vertexCount).fill(-1));
    this.cage=geometry.cage;this.configure(this.cage);
  }

  /** Select immutable union-geometry parts without rebuilding their prepared head points. */
  setVisibleParts(parts?:readonly MeshPart[]):void {
    if(parts===this.visibleParts)return;
    let selection:HeadSelection|undefined;
    if(parts!==undefined){
      selection=this.selections.get(parts);
      if(!selection){
        const geometry=this.geometry,indices=geometry.indices,slots=new Int32Array(geometry.description.vertexCount).fill(-1);
        const scan=headScan(parts,geometry,slots),visible=new Uint8Array(geometry.description.vertexCount);
        for(const index of scan.indices)visible[index]=1;
        // Count each selected vertex's triangles over every part, then place them in the same order.
        const normalStarts=new Uint32Array(scan.indices.length+1);
        for(const part of parts)for(let at=part.start;at<part.start+part.count;at++){const slot=slots[indices[at]];if(slot>=0)normalStarts[slot+1]++;}
        for(let i=0;i<scan.indices.length;i++)normalStarts[i+1]+=normalStarts[i];
        const normalTriangles=new Uint32Array(normalStarts[scan.indices.length]),filled=normalStarts.slice(0,scan.indices.length);
        for(const part of parts)for(let at=part.start;at<part.start+part.count;at++){
          const slot=slots[indices[at]];if(slot>=0)normalTriangles[filled[slot]++]=part.start+Math.floor((at-part.start)/3)*3;
        }
        selection={scan,visible,normalStarts,normalTriangles};
        this.selections.set(parts,selection);
      }
    }
    this.visibleParts=parts;this.selection=selection;this.cache.clear();
  }

  configure(cage:Float32Array<ArrayBuffer>,hairRegion:number|null=null):void {
    this.cage=cage;this.hairRegion=hairRegion;this.matrices=null;this.hasPose=false;this.cache.clear();
    const ids=new Uint32Array(this.geometry.stencilWeights),weights=new Float32Array(this.geometry.stencilWeights);
    const bones=new Set<number>(),head=this.scan.indices,perVertex:Contribution[][]=[];
    for(const index of head){
      const contributions=new Map<number,Contribution>(),offset=index*4;
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
      // Kept only until the typed arrays below are filled, not for the envelope's lifetime.
      const rows=[...contributions.values()];perVertex.push(rows);
      for(const contribution of rows)bones.add(contribution.bone);
      bones.add(this.geometry.vertices[index*16+6]);
      if(this.geometry.stencilRanges[index*4+3]===1){
        const base=this.geometry.stencilRanges[index*4+2]*16;
        for(let j=0;j<4;j++)bones.add(cage[base+6+j]);
      }
    }
    this.poseDependencies=Uint32Array.from([...bones].flatMap(bone=>Array.from({length:16},(_,axis)=>bone*16+axis)));
    this.dependencyValues=new Float32Array(this.poseDependencies.length);
    let count=0;for(const rows of perVertex)count+=rows.length;
    this.contributionRanges=new Uint32Array(head.length+1);
    this.contributionBones=new Uint32Array(count);this.contributionValues=new Float64Array(count*4);
    let at=0;
    for(let i=0;i<head.length;i++){
      this.contributionRanges[i]=at;
      for(const contribution of perVertex[i]){
        this.contributionBones[at]=contribution.bone*16;
        const v=at*4;this.contributionValues[v]=contribution.x;this.contributionValues[v+1]=contribution.y;
        this.contributionValues[v+2]=contribution.z;this.contributionValues[v+3]=contribution.weight;at++;
      }
    }
    this.contributionRanges[head.length]=at;
  }

  pose(matrices:Float32Array<ArrayBuffer>):void {
    let changed=!this.hasPose;
    for(let i=0;!changed&&i<this.poseDependencies.length;i++){
      // Object.is preserves signed zero without allocating a per-frame buffer view.
      if(!Object.is(this.dependencyValues[i],matrices[this.poseDependencies[i]]))changed=true;
    }
    this.matrices=matrices;
    if(!changed)return;
    for(let i=0;i<this.poseDependencies.length;i++)this.dependencyValues[i]=matrices[this.poseDependencies[i]];
    this.hasPose=true;this.cache.clear();
    const ranges=this.contributionRanges,bones=this.contributionBones,values=this.contributionValues,positions=this.scan.positions;
    for(let i=0;i<positions.length;i++){
      const at=positions[i];let px=0,py=0,pz=0;
      for(let j=ranges[i];j<ranges[i+1];j++){
        const b=bones[j],v=j*4,x=values[v],y=values[v+1],z=values[v+2],weight=values[v+3];
        px+=matrices[b]*x+matrices[b+4]*y+matrices[b+8]*z+matrices[b+12]*weight;
        py+=matrices[b+1]*x+matrices[b+5]*y+matrices[b+9]*z+matrices[b+13]*weight;
        pz+=matrices[b+2]*x+matrices[b+6]*y+matrices[b+10]*z+matrices[b+14]*weight;
      }
      this.points[at]=px;this.points[at+1]=py;this.points[at+2]=pz;
    }
  }

  /**
   * The outline normal at `index`, written into `normalScratch`. `top` reads
   * it for every outline vertex near the crown on every posed frame, so it
   * uses scalars; each sum, product and `Math.hypot` matches the array form it
   * replaced, so the normal is bit-identical.
   */
  private normal(index:number,slot:number):Float64Array {
    const g=this.geometry,points=this.points;let n0=0,n1=0,n2=0;
    if(g.stencilRanges[index*4+3]===1){
      const base=g.stencilRanges[index*4+2]*16,cage=this.cage,m=this.matrices!;
      for(let j=0;j<4;j++){
        const b=cage[base+6+j]*16,w=cage[base+10+j];
        n0+=w*(m[b]*cage[base+3]+m[b+4]*cage[base+4]+m[b+8]*cage[base+5]);
        n1+=w*(m[b+1]*cage[base+3]+m[b+5]*cage[base+4]+m[b+9]*cage[base+5]);
        n2+=w*(m[b+2]*cage[base+3]+m[b+6]*cage[base+4]+m[b+10]*cage[base+5]);
      }
    }else{
      const at=index*3,a0=points[at],a1=points[at+1],a2=points[at+2],selection=this.selection;
      const start=selection?selection.normalStarts[slot]:g.normalRanges[index*2],count=selection?selection.normalStarts[slot+1]-start:g.normalRanges[index*2+1];
      for(let i=start;i<start+count;i++){
        const triangle=selection?selection.normalTriangles[i]:g.normalTriangles[i]*3;
        const corner=g.indices[triangle]===index?0:g.indices[triangle+1]===index?1:2;
        // A corner outside the visible selection counts as the origin, as before.
        const p=g.indices[triangle+(corner+1)%3],q=g.indices[triangle+(corner+2)%3];
        const pHidden=selection!==undefined&&selection.visible[p]===0,qHidden=selection!==undefined&&selection.visible[q]===0;
        const b0=(pHidden?0:points[p*3])-a0,b1=(pHidden?0:points[p*3+1])-a1,b2=(pHidden?0:points[p*3+2])-a2;
        const c0=(qHidden?0:points[q*3])-a0,c1=(qHidden?0:points[q*3+1])-a1,c2=(qHidden?0:points[q*3+2])-a2;
        const bl=Math.hypot(b0,b1,b2),cl=Math.hypot(c0,c1,c2);if(bl<1e-8||cl<1e-8)continue;
        const x=b1*c2-b2*c1,y=b2*c0-b0*c2,z=b0*c1-b1*c0,length=Math.hypot(x,y,z);
        if(length<1e-10)continue;
        let dot=0;dot=dot+b0*c0;dot=dot+b1*c1;dot=dot+b2*c2;
        const angle=Math.acos(Math.max(-1,Math.min(1,dot/(bl*cl))));
        n0+=x/length*angle;n1+=y/length*angle;n2+=z/length*angle;
      }
    }
    const length=Math.max(1e-10,Math.hypot(n0,n1,n2)),out=normalScratch;out[0]=n0/length;out[1]=n1/length;out[2]=n2/length;return out;
  }

  /** Return the actual projected top, including normal extrusion, in rotated model space. */
  top(facing:number):Vec3 {
    const cached=this.cache.get(facing);if(cached)return cached;
    if(!this.matrices)throw new Error('Pose the character before reading the head envelope.');
    const c=Math.cos(facing),s=Math.sin(facing),points=this.points,matrices=this.matrices;
    let highest=-Infinity,px=0,py=0,pz=0;
    const scan=this.selection?.scan??this.scan,hair=this.hairRegion;
    for(let i=0;i<scan.indices.length;i++){
      const region=scan.regions[i];
      if(hair!==null&&(region===8||region===9)&&region!==hair)continue;
      if(!(matrices[scan.visibility[i]]>=0))continue;
      const at=scan.positions[i],x=points[at],y=points[at+1],z=points[at+2];
      const rotatedX=c*x-s*y,rotatedY=s*x+c*y,height=-(rotatedX-rotatedY)*21+z*vertical;
      if(height>highest){highest=height;px=x;py=y;pz=z;}
    }
    const fillTop=highest;
    for(let i=0;i<scan.indices.length;i++){
      const region=scan.regions[i];
      if(!scan.outlines[i])continue;
      if(hair!==null&&(region===8||region===9)&&region!==hair)continue;
      if(!(matrices[scan.visibility[i]]>=0))continue;
      const at=scan.positions[i],x=points[at],y=points[at+1],z=points[at+2];
      const rotatedX=c*x-s*y,rotatedY=s*x+c*y;
      if(-(rotatedX-rotatedY)*21+z*vertical+outlineWidth*projectionLength<fillTop)continue;
      const normal=this.normal(scan.indices[i],i),ex=x+normal[0]*outlineWidth,ey=y+normal[1]*outlineWidth,ez=z+normal[2]*outlineWidth;
      const exRotated=c*ex-s*ey,eyRotated=s*ex+c*ey,height=-(exRotated-eyRotated)*21+ez*vertical;
      if(height>highest){highest=height;px=ex;py=ey;pz=ez;}
    }
    if(!Number.isFinite(highest))throw new Error('Character has no visible head envelope.');
    const rotated:Vec3=[c*px-s*py,s*px+c*py,pz];
    this.cache.set(facing,rotated);return rotated;
  }
}
