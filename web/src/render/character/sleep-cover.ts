import type {Geometry,Material} from './bundle.js';
import {SupportSurface} from './support-surface.js';
import {appendStaticMesh} from './static-mesh.js';
import type {Vec3} from './math.js';

export interface SleepingSurface {geometry:Geometry;points:Float32Array<ArrayBuffer>;offsetX:number}

/** One shared cover follows all occupied bodies without changing the mattress or person. */
export function addSleepingCover(scene:Geometry,sleepers:readonly SleepingSurface[],bunk:boolean):Geometry {return sleepingCover(scene,sleepers,bunk,true);}

/** A cover owns only its fabric; it never copies or reshapes the sleepers. */
export function createSleepingCover(scene:Geometry,sleepers:readonly SleepingSurface[],bunk:boolean):Geometry {return sleepingCover(scene,sleepers,bunk,false);}

function supportSurface({geometry,points,offsetX}:SleepingSurface):SupportSurface {
    const vertices:Vec3[]=Array.from({length:points.length/3},(_,i)=>[points[i*3]+offsetX,points[i*3+1],points[i*3+2]]);
    const triangles:[number,number,number][]=[];
    for(const part of geometry.description.parts)if(part.region!==10&&part.region!==12)for(let i=part.start;i<part.start+part.count;i+=3)triangles.push([geometry.indices[i],geometry.indices[i+1],geometry.indices[i+2]]);
    return new SupportSurface(vertices,triangles,.05);
}
function grid(bunk:boolean){
  const width=bunk?.78:1.53,nx=bunk?25:49,ny=45,minimumY=-.94,maximumY=.225,base=bunk?.47539448:.478;
  return {width,nx,ny,minimumY,base,dx:width/(nx-1),dy:(maximumY-minimumY)/(ny-1)};
}

/** Preparation evaluates one person in one source-defined sleeping slot. */
export function prepareSleepingCoverContribution(sleeper:SleepingSurface,bunk:boolean):Float32Array<ArrayBuffer> {
  const surface=supportSurface(sleeper),{width,nx,ny,minimumY,base,dx,dy}=grid(bunk),height=new Float32Array(nx*ny).fill(base);
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const top=surface.height(x*dx-width/2,minimumY+y*dy,'top');if(top!==undefined)height[y*nx+x]=Math.max(height[y*nx+x],top+.035);
  }
  const draped=height.slice(),radius=.24;
  for(let oy=-Math.ceil(radius/dy);oy<=Math.ceil(radius/dy);oy++)for(let ox=-Math.ceil(radius/dx);ox<=Math.ceil(radius/dx);ox++){
    const distance=(ox*dx)**2+(oy*dy)**2;if(distance>radius*radius)continue;
    for(let y=Math.max(0,oy);y<Math.min(ny,ny+oy);y++)for(let x=Math.max(0,ox);x<Math.min(nx,nx+ox);x++)draped[y*nx+x]=Math.max(draped[y*nx+x],height[(y-oy)*nx+x-ox]-6*distance);
  }
  return draped;
}

/** Float32 rounding and maximum are monotone, so prepared drapes combine exactly. */
export function composeSleepingCoverHeights(contributions:readonly ArrayLike<number>[],bunk:boolean,out?:Float32Array<ArrayBuffer>):Float32Array<ArrayBuffer> {
  const {nx,ny,base}=grid(bunk),height=out??new Float32Array(nx*ny);
  if(height.length!==nx*ny||contributions.some(row=>row.length!==height.length))throw new Error('Sleeping cover grid size differs.');
  height.fill(base);
  for(let i=0;i<height.length;i++)for(const contribution of contributions)height[i]=Math.max(height[i],contribution[i]);
  return height;
}

interface CoverTopology {points:[number,number,number][];triangles:[number,number,number][];height:Float32Array<ArrayBuffer>;normals:Float64Array;surfaceCount:number;bunk:boolean}
const retained=new WeakMap<Geometry,CoverTopology>();
function topology(draped:Float32Array<ArrayBuffer>,bunk:boolean):CoverTopology {
  const {width,nx,ny,minimumY,base,dx,dy}=grid(bunk);
  const points:[number,number,number][]=Array.from({length:nx*ny},(_,i)=>[(i%nx)*dx-width/2,minimumY+Math.floor(i/nx)*dy,draped[i]]),triangles:[number,number,number][]=[];
  for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++){const a=y*nx+x;triangles.push([a,a+1,a+nx],[a+1,a+nx+1,a+nx]);}
  const border=[...Array.from({length:nx},(_,i)=>i),...Array.from({length:ny-1},(_,i)=>(i+1)*nx+nx-1),
    ...Array.from({length:nx-1},(_,i)=>ny*nx-2-i),...Array.from({length:ny-2},(_,i)=>(ny-2-i)*nx)];
  for(let i=0;i<border.length;i++){
    const a=border[i],b=border[(i+1)%border.length],c=points.length,d=c+1;
    points.push([points[a][0],points[a][1],base-.07],[points[b][0],points[b][1],base-.07]);triangles.push([a,c,b],[b,c,d]);
  }
  return {points,triangles,height:draped,normals:new Float64Array(points.length*3),surfaceCount:nx*ny,bunk};
}
function coverGeometry(scene:Geometry,data:CoverTopology,append:boolean):Geometry {
  const reference=scene.manifest.materials.find(material=>/sage duvet/i.test(material.name));
  const material:Material=reference??{name:'Sleeping sage cover',group:5,unlit:false,colour:[.30,.43,.37,1],interpolation:'EASE',
    ramp:[{position:0,colour:[.15,.215,.185,1]},{position:.45,colour:[.24,.344,.296,1]},{position:.75,colour:[.30,.43,.37,1]}]};
  const source=append?scene:{...scene,description:{vertexCount:0,cageCount:0,indexCount:0,coefficientCount:0,parts:[]},
    vertices:new Float32Array(0),cage:new Float32Array(0),indices:new Uint32Array(0),stencilRanges:new Uint32Array(0),stencilWeights:new ArrayBuffer(0),normalRanges:new Uint32Array(0),normalTriangles:new Uint32Array(0)};
  const cover=appendStaticMesh(source,'Configured shared sleeping cover',data.points,data.triangles,material);
  if(!append)retained.set(cover,data);return cover;
}

function sleepingCover(scene:Geometry,sleepers:readonly SleepingSurface[],bunk:boolean,append:boolean):Geometry {
  const contributions=sleepers.map(sleeper=>prepareSleepingCoverContribution(sleeper,bunk));
  return coverGeometry(scene,topology(composeSleepingCoverHeights(contributions,bunk),bunk),append);
}

export function createSleepingCoverFromContributions(scene:Geometry,contributions:readonly ArrayLike<number>[],bunk:boolean):Geometry {
  return coverGeometry(scene,topology(composeSleepingCoverHeights(contributions,bunk),bunk),false);
}

/** Occupancy updates keep topology and buffers, including the original normal sum order. */
export function updateSleepingCoverFromContributions(cover:Geometry,contributions:readonly ArrayLike<number>[],bunk:boolean):void {
  const data=retained.get(cover);if(!data||data.bunk!==bunk)throw new Error('Sleeping cover topology was not prepared for this fixture.');
  const {points,triangles,height,normals,surfaceCount}=data;
  composeSleepingCoverHeights(contributions,bunk,height);
  for(let i=0;i<surfaceCount;i++)points[i][2]=height[i];
  normals.fill(0);
  for(const triangle of triangles){
    const [a,b,c]=triangle;
    const abx=points[b][0]-points[a][0],aby=points[b][1]-points[a][1],abz=points[b][2]-points[a][2];
    const acx=points[c][0]-points[a][0],acy=points[c][1]-points[a][1],acz=points[c][2]-points[a][2];
    const nx=aby*acz-abz*acy,ny=abz*acx-abx*acz,nz=abx*acy-aby*acx;
    for(const vertex of triangle){normals[vertex*3]+=nx;normals[vertex*3+1]+=ny;normals[vertex*3+2]+=nz;}
  }
  for(let i=0;i<points.length;i++){
    const size=Math.hypot(normals[i*3],normals[i*3+1],normals[i*3+2]);if(size<1e-10)throw new Error('Degenerate bone axis');
    const scale=1/size;
    for(let axis=0;axis<3;axis++){
      cover.vertices[i*16+axis]=points[i][axis];cover.vertices[i*16+3+axis]=normals[i*3+axis]*scale;
      cover.cage[i*16+axis]=cover.vertices[i*16+axis];cover.cage[i*16+3+axis]=cover.vertices[i*16+3+axis];
    }
  }
}
