import type {Geometry} from './bundle.js';
import type {Vec3} from './math.js';

const skinParts=new Set(['Sculpted head','Small rounded nose']);
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const smooth=(a:number,b:number,x:number)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const hash=(x:number,y:number)=>{const n=Math.sin(x*127.1+y*311.7)*43758.5453;return n-Math.floor(n);};

/** Rest-sculpt coordinates interpolate with the same triangles through every deformation. */
export function freckleCoordinates(geometry:Geometry):Float32Array<ArrayBuffer> {
  const output=new Float32Array(geometry.description.vertexCount*4);
  for(const part of geometry.description.parts)if(skinParts.has(part.name))for(let i=part.start;i<part.start+part.count;i++){
    const vertex=geometry.indices[i],base=vertex*16;
    output.set([geometry.vertices[base],geometry.vertices[base+1],geometry.vertices[base+2],1],vertex*4);
  }
  return output;
}

/** CPU sample of the authored cheek, nose and forehead mask used by mesh.wgsl. */
export function freckleCoverage(point:Vec3,density:number):number {
  const [x,y,z]=point;
  const front=smooth(.045,.11,-y),sides=1-smooth(.15,.195,Math.abs(x));
  const cheeks=smooth(1.565,1.605,z)*(1-smooth(1.653,1.683,z));
  const forehead=smooth(1.752,1.785,z)*(1-smooth(1.845,1.875,z));
  const mask=front*sides*Math.max(cheeks,forehead*.70);
  if(mask===0||density<=0)return 0;
  const u=(x+.23)/.017,v=(z-1.42)/.017,cx=Math.floor(u),cy=Math.floor(v);
  const px=.2+.6*hash(cx,cy),py=.2+.6*hash(cx+37,cy+19);
  const radius=.16+.12*hash(cx+73,cy+41);
  const spot=1-smooth(radius*.65,radius,Math.hypot(u-cx-px,v-cy-py));
  const activation=smooth(hash(cx+11,cy+83)*.82,hash(cx+11,cy+83)*.82+.18,clamp(density));
  return mask*spot*activation;
}
