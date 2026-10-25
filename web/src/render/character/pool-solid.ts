import {add,cross,dot,length,scale,sub,type Vec3} from './math.js';
import type {PoolSolid} from './pool-contact-types.js';

export type Triangle=readonly [Vec3,Vec3,Vec3];
type Bounds=readonly [Vec3,Vec3];
interface Face {triangle:Triangle;bounds:Bounds;id:number}
interface Node {bounds:Bounds;faces?:Face[];children?:[Node,Node]}
export interface PoolVertex {id:number;rank:number;point:Vec3}
interface VertexNode {bounds:Bounds;points?:PoolVertex[];children?:[VertexNode,VertexNode]}
export interface PoolVertexScan {point:PoolVertex|null;distance:number;triangle:number;penetrating:number[];exteriorBounds?:Bounds}
const bounds=(points:readonly Vec3[]):Bounds=>[
  [0,1,2].map(axis=>Math.min(...points.map(p=>p[axis]))) as unknown as Vec3,
  [0,1,2].map(axis=>Math.max(...points.map(p=>p[axis]))) as unknown as Vec3,
];
const overlap=(a:Bounds,b:Bounds)=>[0,1,2].every(axis=>a[0][axis]<=b[1][axis]&&b[0][axis]<=a[1][axis]);
const boxDistance=(p:Vec3,b:Bounds)=>Math.hypot(...[0,1,2].map(axis=>Math.max(0,b[0][axis]-p[axis],p[axis]-b[1][axis])));
const boxSeparation=(a:Bounds,b:Bounds)=>Math.hypot(...[0,1,2].map(axis=>Math.max(0,a[0][axis]-b[1][axis],b[0][axis]-a[1][axis])));
function tree(faces:Face[]):Node {
  const box=bounds(faces.flatMap(f=>[f.bounds[0],f.bounds[1]]));
  if(faces.length<=8)return {bounds:box,faces};
  const axis=[0,1,2].sort((a,b)=>(box[1][b]-box[0][b])-(box[1][a]-box[0][a]))[0];
  faces.sort((a,b)=>(a.bounds[0][axis]+a.bounds[1][axis])-(b.bounds[0][axis]+b.bounds[1][axis])||a.id-b.id);
  const split=Math.floor(faces.length/2);return {bounds:box,children:[tree(faces.slice(0,split)),tree(faces.slice(split))]};
}
function vertexTree(points:PoolVertex[]):VertexNode {
  const box=bounds(points.map(p=>p.point));if(points.length<=12)return {bounds:box,points};
  const axis=[0,1,2].sort((a,b)=>(box[1][b]-box[0][b])-(box[1][a]-box[0][a]))[0];
  points.sort((a,b)=>a.point[axis]-b.point[axis]||a.rank-b.rank);const middle=points.length>>1;
  return {bounds:box,children:[vertexTree(points.slice(0,middle)),vertexTree(points.slice(middle))]};
}
export class PoolVertexIndex {
  readonly root:VertexNode;
  constructor(readonly points:PoolVertex[]){this.root=vertexTree([...points]);}
  update(points:PoolVertex[]):void {
    if(points.length!==this.points.length)throw new Error('Pool vertex ownership changed.');
    for(let index=0;index<points.length;index++){
      if(points[index].id!==this.points[index].id||points[index].rank!==this.points[index].rank)throw new Error('Pool vertex order changed.');
      this.points[index].point=points[index].point;
    }
    const refit=(node:VertexNode):Bounds=>{
      node.bounds=node.points?bounds(node.points.map(point=>point.point)):bounds(node.children!.flatMap(child=>[...refit(child)]));
      return node.bounds;
    };
    refit(this.root);
  }
}
function rayBox(origin:Vec3,direction:Vec3,box:Bounds):boolean {
  let low=0,high=Infinity;
  for(let axis=0;axis<3;axis++){
    if(direction[axis]===0){if(origin[axis]<box[0][axis]||origin[axis]>box[1][axis])return false;continue;}
    const a=(box[0][axis]-origin[axis])/direction[axis],b=(box[1][axis]-origin[axis])/direction[axis];
    low=Math.max(low,Math.min(a,b));high=Math.min(high,Math.max(a,b));if(low>high)return false;
  }
  return true;
}
function rayTriangle(origin:Vec3,direction:Vec3,[a,b,c]:Triangle):number|null {
  const e1=sub(b,a),e2=sub(c,a),p=cross(direction,e2),det=dot(e1,p);
  if(Math.abs(det)<1e-14)return null;
  const inverse=1/det,t=sub(origin,a),u=dot(t,p)*inverse;
  if(u<0||u>1)return null;
  const q=cross(t,e1),v=dot(direction,q)*inverse;if(v<0||u+v>1)return null;
  const distance=dot(e2,q)*inverse;return distance>=0?distance:null;
}
export function nearestTriangle(p:Vec3,[a,b,c]:Triangle):Vec3 {
  const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);
  if(d1<=0&&d2<=0)return a;
  const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return b;
  const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0)return add(a,scale(ab,d1/(d1-d3)));
  const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return c;
  const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0)return add(a,scale(ac,d2/(d2-d6)));
  const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0)return add(b,scale(sub(c,b),(d4-d3)/((d4-d3)+(d5-d6))));
  const denominator=va+vb+vc;
  if(denominator===0)return [a,b,c].sort((x,y)=>length(sub(p,x))-length(sub(p,y)))[0];
  return add(a,add(scale(ab,vb/denominator),scale(ac,vc/denominator)));
}

function segmentDistance(a:Vec3,b:Vec3,c:Vec3,d:Vec3):number {
  const u=sub(b,a),v=sub(d,c),w=sub(a,c),aa=dot(u,u),bb=dot(u,v),cc=dot(v,v),dd=dot(u,w),ee=dot(v,w),denominator=aa*cc-bb*bb;
  const clamp=(n:number)=>Math.max(0,Math.min(1,n));
  let s=denominator>0?clamp((bb*ee-cc*dd)/denominator):0,t=cc>0?(bb*s+ee)/cc:0;
  if(t<0){t=0;s=aa>0?clamp(-dd/aa):0;}else if(t>1){t=1;s=aa>0?clamp((bb-dd)/aa):0;}
  return length(sub(add(a,scale(u,s)),add(c,scale(v,t))));
}

export function triangleDistance(a:Triangle,b:Triangle):number {
  let best=Infinity;
  for(let edge=0;edge<3;edge++){
    const left=a[edge],right=a[(edge+1)%3],start=b[edge],end=b[(edge+1)%3];
    const crossing=rayTriangle(left,sub(right,left),b),reverse=rayTriangle(start,sub(end,start),a);
    if(crossing!==null&&crossing<=1||reverse!==null&&reverse<=1)return 0;
    best=Math.min(best,length(sub(left,nearestTriangle(left,b))),length(sub(start,nearestTriangle(start,a))));
    for(let other=0;other<3;other++)best=Math.min(best,segmentDistance(left,right,b[other],b[(other+1)%3]));
  }
  return best;
}

/** Clip a body triangle to a finite horizontal support, preserving interpolated height. */
export function horizontalPatch(triangle:Triangle,box:Bounds):Vec3[] {
  let polygon:Vec3[]=[...triangle];
  for(const axis of [0,1])for(const direction of [-1,1]){
    const boundary=direction<0?box[0][axis]:box[1][axis],input=polygon;polygon=[];
    for(let i=0;i<input.length;i++){
      const a=input[i],b=input[(i+1)%input.length],da=(a[axis]-boundary)*direction,db=(b[axis]-boundary)*direction;
      if(da<=0)polygon.push(a);
      if((da<0&&db>0)||(da>0&&db<0))polygon.push(add(a,scale(sub(b,a),da/(da-db))));
    }
  }
  return polygon;
}

export function projectedTrianglePatch(body:Triangle,support:Triangle):Vec3[]{
  const sign=Math.sign(cross(sub(support[1],support[0]),sub(support[2],support[0]))[2]);if(!sign)return [];
  let polygon:Vec3[]=[...body];
  for(let edge=0;edge<3;edge++){
    const a=support[edge],b=support[(edge+1)%3],input=polygon;polygon=[];
    const side=(p:Vec3)=>sign*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]));
    for(let i=0;i<input.length;i++){
      const left=input[i],right=input[(i+1)%input.length],dl=side(left),dr=side(right);
      if(dl>=0)polygon.push(left);
      if((dl<0&&dr>0)||(dl>0&&dr<0))polygon.push(add(left,scale(sub(right,left),dl/(dl-dr))));
    }
  }
  return polygon;
}

/** Immutable fixture acceleration only. No solver target or posed body enters this index. */
export class PoolSolidIndex {
  private readonly root:Node;
  constructor(readonly solid:PoolSolid){
    if(!solid.triangles.length)throw new Error('Pool solid has no evaluated triangles: '+solid.id);
    this.root=tree(solid.triangles.map((indices,id)=>{const triangle=indices.map(index=>solid.vertices[index]) as unknown as Triangle;return {triangle,id,bounds:bounds(triangle)};}));
  }
  distanceLowerBound(point:Vec3):number {
    const [low,high]=this.solid.bounds;
    if(this.solid.kind==='floor'&&point[0]>=low[0]&&point[0]<=high[0]&&point[1]>=low[1]&&point[1]<=high[1])return point[2]-high[2];
    return boxDistance(point,this.root.bounds);
  }
  boundaryOverlaps(box:Bounds,node=this.root):boolean {
    if(!overlap(box,node.bounds))return false;
    if(node.faces)return node.faces.some(face=>overlap(box,face.bounds));
    return node.children!.some(child=>this.boundaryOverlaps(box,child));
  }
  private certifiedExteriorDistance(box:Bounds):number|null {
    let lower=Infinity;
    const visit=(node:Node)=>{
      if(boxSeparation(box,node.bounds)>lower)return;
      if(node.faces)for(const face of node.faces)lower=Math.min(lower,boxSeparation(box,face.bounds));
      else for(const child of [...node.children!].sort((a,b)=>boxSeparation(box,a.bounds)-boxSeparation(box,b.bounds)))visit(child);
    };
    visit(this.root);
    if(lower<=0||this.inside(scale(add(box[0],box[1]),.5)))return null;
    return lower;
  }
  /** Exact vertex observations with conservative empty-box and distance certificates. */
  scanVertices(vertices:PoolVertexIndex,positiveLimit=Infinity):PoolVertexScan|null {
    let selected:PoolVertex|null=null,distance=Infinity,triangle=-1;
    const penetrating:number[]=[];
    const record=(point:PoolVertex,value:number,face:number)=>{
      if(value<distance||(value===distance&&(!selected||point.rank<selected.rank))){selected=point;distance=value;triangle=face;}
    };
    if(this.solid.kind==='floor'){
      for(const point of vertices.points){
        const lower=this.distanceLowerBound(point.point);if(lower>=0&&lower>Math.min(distance,positiveLimit))continue;
        const actual=this.clearance(point.point);if(actual.distance<0)penetrating.push(point.id);record(point,actual.distance,actual.triangle);
      }
      return selected?{point:selected,distance,triangle,penetrating}:null;
    }
    const exterior=this.certifiedExteriorDistance(vertices.root.bounds);
    if(exterior!==null)return exterior<=positiveLimit?{point:null,distance:exterior,triangle:-1,penetrating,exteriorBounds:vertices.root.bounds}:null;
    const insidePoints=(node:VertexNode,knownInside?:boolean)=>{
      if(!overlap(node.bounds,this.root.bounds))return;
      if(knownInside===undefined&&!this.boundaryOverlaps(node.bounds)){
        const centre=scale(add(node.bounds[0],node.bounds[1]),.5);
        if(!this.inside(centre))return;
        knownInside=true;
      }
      if(node.points)for(const point of node.points){
        if(!knownInside&&!this.inside(point.point))continue;
        const nearest=this.nearest(point.point);if(nearest.distance===0)continue;
        penetrating.push(point.id);record(point,-nearest.distance,nearest.triangle);
      }else for(const child of node.children!)insidePoints(child,knownInside);
    };
    insidePoints(vertices.root);
    if(penetrating.length||positiveLimit<0)return selected?{point:selected,distance,triangle,penetrating}:null;
    distance=positiveLimit;
    const nearestPair=(body:VertexNode,solid:Node)=>{
      if(boxSeparation(body.bounds,solid.bounds)>distance)return;
      if(body.points&&solid.faces){
        for(const point of body.points)for(const face of solid.faces){
          const nearest=nearestTriangle(point.point,face.triangle);record(point,length(sub(point.point,nearest)),face.id);
        }
      }else if(!body.points&&(solid.faces||length(sub(body.bounds[1],body.bounds[0]))>=length(sub(solid.bounds[1],solid.bounds[0])))){
        for(const child of [...body.children!].sort((a,b)=>boxSeparation(a.bounds,solid.bounds)-boxSeparation(b.bounds,solid.bounds)))nearestPair(child,solid);
      }else{
        for(const child of [...solid.children!].sort((a,b)=>boxSeparation(body.bounds,a.bounds)-boxSeparation(body.bounds,b.bounds)))nearestPair(body,child);
      }
    };
    nearestPair(vertices.root,this.root);
    if(!selected)return null;
    const canonical=this.nearest((selected as PoolVertex).point);
    return {point:selected,distance:canonical.distance,triangle:canonical.triangle,penetrating};
  }
  nearest(point:Vec3):{point:Vec3;distance:number;triangle:number}{
    let distance=Infinity,witness:Vec3=point,triangle=-1;
    const visit=(node:Node)=>{
      if(boxDistance(point,node.bounds)>distance)return;
      if(node.faces)for(const face of node.faces){const candidate=nearestTriangle(point,face.triangle),value=length(sub(point,candidate));if(value<distance){distance=value;witness=candidate;triangle=face.id;}}
      else for(const child of [...node.children!].sort((a,b)=>boxDistance(point,a.bounds)-boxDistance(point,b.bounds)))visit(child);
    };
    visit(this.root);return {point:witness,distance,triangle};
  }
  minimumTriangleGap(query:Triangle,existingMinimum=Infinity):number {
    const box=bounds(query);let distance=existingMinimum;
    const visit=(node:Node)=>{
      if(boxSeparation(box,node.bounds)>distance)return;
      if(node.faces)for(const face of node.faces)distance=Math.min(distance,triangleDistance(query,face.triangle));
      else for(const child of [...node.children!].sort((a,b)=>boxSeparation(box,a.bounds)-boxSeparation(box,b.bounds)))visit(child);
    };
    visit(this.root);return distance;
  }
  inside(point:Vec3):boolean {
    if(boxDistance(point,this.root.bounds)>0)return false;
    const direction:Vec3=[1,.3141592653589793,.2718281828459045],hits:number[]=[];
    const visit=(node:Node)=>{if(!rayBox(point,direction,node.bounds))return;if(node.faces)for(const face of node.faces){const t=rayTriangle(point,direction,face.triangle);if(t!==null)hits.push(t);}else for(const child of node.children!)visit(child);};
    visit(this.root);hits.sort((a,b)=>a-b);
    // Adjacent triangles share one surface crossing; merge only double-precision roundoff.
    const distinct=hits.filter((value,index)=>index===0||Math.abs(value-hits[index-1])>Number.EPSILON*128*Math.max(1,Math.abs(value)));
    return distinct.length%2===1;
  }
  clearance(point:Vec3):{distance:number;triangle:number;surfacePoint:Vec3}{
    if(this.solid.kind==='floor'){
      const [low,high]=this.solid.bounds;
      if(point[0]>=low[0]&&point[0]<=high[0]&&point[1]>=low[1]&&point[1]<=high[1])return {distance:point[2]-high[2],triangle:0,surfacePoint:[point[0],point[1],high[2]]};
    }
    const nearest=this.nearest(point);
    return {distance:this.solid.kind==='solid'&&this.inside(point)?-nearest.distance:nearest.distance,triangle:nearest.triangle,surfacePoint:nearest.point};
  }
  /** A preparation query: exact first exit along a declared contact-release direction. */
  exitAlong(point:Vec3,direction:Vec3):number|null {
    if(this.solid.kind!=='solid'||!this.inside(point))return null;
    let exit=Infinity;
    const visit=(node:Node)=>{
      if(!rayBox(point,direction,node.bounds))return;
      if(node.faces)for(const face of node.faces){const hit=rayTriangle(point,direction,face.triangle);if(hit!==null&&hit>0)exit=Math.min(exit,hit);}
      else for(const child of node.children!)visit(child);
    };
    visit(this.root);return Number.isFinite(exit)?exit:null;
  }
  crossings(triangle:Triangle):Vec3[] {
    const query=bounds(triangle),points:Vec3[]=[];
    const intersect=(a:Triangle,b:Triangle)=>{for(let edge=0;edge<3;edge++){
      const origin=a[edge],direction=sub(a[(edge+1)%3],origin),t=rayTriangle(origin,direction,b);
      if(t!==null&&t<=1)points.push(add(origin,scale(direction,t)));
    }};
    const visit=(node:Node)=>{if(!overlap(query,node.bounds))return;if(node.faces)for(const face of node.faces){if(overlap(query,face.bounds)){intersect(triangle,face.triangle);intersect(face.triangle,triangle);}}else for(const child of node.children!)visit(child);};
    visit(this.root);return points;
  }
  triangleWitness(triangle:Triangle):{point:Vec3;distance:number;triangle:number}|null {
    if(this.solid.kind==='floor'){
      const polygon=horizontalPatch(triangle,this.solid.bounds),point=polygon.sort((a,b)=>a[2]-b[2])[0];
      return point&&point[2]<this.solid.bounds[1][2]?{point,distance:point[2]-this.solid.bounds[1][2],triangle:0}:null;
    }
    const hits=this.crossings(triangle);let worst:{point:Vec3;distance:number;triangle:number}|null=null;
    for(let a=0;a<hits.length;a++)for(let b=a+1;b<hits.length;b++){
      const point=scale(add(hits[a],hits[b]),.5),clearance=this.clearance(point);
      if(clearance.distance<0&&(!worst||clearance.distance<worst.distance))worst={point,distance:clearance.distance,triangle:clearance.triangle};
    }
    return worst;
  }
}
