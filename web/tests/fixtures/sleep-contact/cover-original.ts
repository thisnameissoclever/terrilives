import type {Geometry,Material} from '../../../src/render/character/bundle.js';
import {SupportSurface} from '../../../src/render/character/support-surface.js';
import {appendStaticMesh} from '../../../src/render/character/static-mesh.js';
import type {Vec3} from '../../../src/render/character/math.js';

export interface SleepingSurface {geometry:Geometry;points:Float32Array<ArrayBuffer>;offsetX:number}

/** One shared cover follows all occupied bodies without changing the mattress or person. */
export function addSleepingCover(scene:Geometry,sleepers:readonly SleepingSurface[],bunk:boolean):Geometry {return sleepingCover(scene,sleepers,bunk,true);}

/** A cover owns only its fabric; it never copies or reshapes the sleepers. */
export function createSleepingCover(scene:Geometry,sleepers:readonly SleepingSurface[],bunk:boolean):Geometry {return sleepingCover(scene,sleepers,bunk,false);}

function sleepingCover(scene:Geometry,sleepers:readonly SleepingSurface[],bunk:boolean,append:boolean):Geometry {
  const surfaces=sleepers.map(({geometry,points,offsetX})=>{
    const vertices:Vec3[]=Array.from({length:points.length/3},(_,i)=>[points[i*3]+offsetX,points[i*3+1],points[i*3+2]]);
    const triangles:[number,number,number][]=[];
    for(const part of geometry.description.parts)if(part.region!==10&&part.region!==12)for(let i=part.start;i<part.start+part.count;i+=3)triangles.push([geometry.indices[i],geometry.indices[i+1],geometry.indices[i+2]]);
    return new SupportSurface(vertices,triangles,.05);
  });
  const width=bunk?.78:1.53,nx=bunk?25:49,ny=45,minimumY=-.94,maximumY=.225,base=bunk?.47539448:.478;
  const dx=width/(nx-1),dy=(maximumY-minimumY)/(ny-1),height=new Float32Array(nx*ny).fill(base);
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)for(const surface of surfaces){
    const top=surface.height(x*dx-width/2,minimumY+y*dy,'top');if(top!==undefined)height[y*nx+x]=Math.max(height[y*nx+x],top+.035);
  }
  const draped=height.slice(),radius=.24;
  for(let oy=-Math.ceil(radius/dy);oy<=Math.ceil(radius/dy);oy++)for(let ox=-Math.ceil(radius/dx);ox<=Math.ceil(radius/dx);ox++){
    const distance=(ox*dx)**2+(oy*dy)**2;if(distance>radius*radius)continue;
    for(let y=Math.max(0,oy);y<Math.min(ny,ny+oy);y++)for(let x=Math.max(0,ox);x<Math.min(nx,nx+ox);x++)draped[y*nx+x]=Math.max(draped[y*nx+x],height[(y-oy)*nx+x-ox]-6*distance);
  }
  const points:Vec3[]=Array.from({length:nx*ny},(_,i)=>[(i%nx)*dx-width/2,minimumY+Math.floor(i/nx)*dy,draped[i]]),triangles:[number,number,number][]=[];
  for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++){const a=y*nx+x;triangles.push([a,a+1,a+nx],[a+1,a+nx+1,a+nx]);}
  const border=[...Array.from({length:nx},(_,i)=>i),...Array.from({length:ny-1},(_,i)=>(i+1)*nx+nx-1),
    ...Array.from({length:nx-1},(_,i)=>ny*nx-2-i),...Array.from({length:ny-2},(_,i)=>(ny-2-i)*nx)];
  for(let i=0;i<border.length;i++){
    const a=border[i],b=border[(i+1)%border.length],c=points.length,d=c+1;
    points.push([points[a][0],points[a][1],base-.07],[points[b][0],points[b][1],base-.07]);triangles.push([a,c,b],[b,c,d]);
  }
  const reference=scene.manifest.materials.find(material=>/sage duvet/i.test(material.name));
  const material:Material=reference??{name:'Sleeping sage cover',group:5,unlit:false,colour:[.30,.43,.37,1],interpolation:'EASE',
    ramp:[{position:0,colour:[.15,.215,.185,1]},{position:.45,colour:[.24,.344,.296,1]},{position:.75,colour:[.30,.43,.37,1]}]};
  const source=append?scene:{...scene,description:{vertexCount:0,cageCount:0,indexCount:0,coefficientCount:0,parts:[]},
    vertices:new Float32Array(0),cage:new Float32Array(0),indices:new Uint32Array(0),stencilRanges:new Uint32Array(0),stencilWeights:new ArrayBuffer(0),normalRanges:new Uint32Array(0),normalTriangles:new Uint32Array(0)};
  return appendStaticMesh(source,'Configured shared sleeping cover',points,triangles,material);
}
