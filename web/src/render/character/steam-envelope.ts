import type {Geometry} from './bundle.js';
import type {Vec3} from './math.js';

export interface SteamEnvelope {centre:[number,number,number];radii:[number,number,number]}
const bands=[[1.07,1.43],[.69,1.01]] as const;
const selected=new WeakMap<Geometry,{indices:readonly number[][];envelopes:SteamEnvelope[]}>();
const cabins=new WeakMap<Geometry,readonly[number,number]>();

/** Interior planes come from the same opaque panel geometry that renders the shower. */
export function showerSteamCabin(geometry:Geometry,matrices:Float32Array<ArrayBuffer>):readonly[number,number] {
  const source=geometry.fixtureGeometry??geometry,cached=cabins.get(source);if(cached)return cached;
  const bound=(name:string,axis:number,upper:boolean)=>{
    const part=source.description.parts.find(part=>part.name==='Creator clip shower '+name);
    if(!part)throw new Error('Missing shower vapor boundary: '+name);
    let bound=upper?-Infinity:Infinity;
    for(let index=part.start;index<part.start+part.count;index++){
      const at=source.indices[index]*16,v=source.vertices;let point=0;
      for(let influence=0;influence<4;influence++){
        const bone=v[at+6+influence]*16,weight=v[at+10+influence];
        point+=weight*(matrices[bone+axis]*v[at]+matrices[bone+4+axis]*v[at+1]+matrices[bone+8+axis]*v[at+2]+matrices[bone+12+axis]);
      }
      bound=upper?Math.max(bound,point):Math.min(bound,point);
    }
    if(!Number.isFinite(bound))throw new Error('Invalid shower vapor boundary: '+name);
    return bound;
  };
  const result=[bound('Shower side panel',0,true),bound('Shower rear panel',1,false)] as const;
  cabins.set(source,result);return result;
}

/** Follow the posed bare chest and pelvis, including configured body proportions. */
export function showerSteamEnvelopes(geometry:Geometry,shaped:Float32Array<ArrayBuffer>,matrices:Float32Array<ArrayBuffer>,
  angle:number,offset:Vec3):readonly SteamEnvelope[] {
  let cached=selected.get(geometry);
  if(!cached){
    const indices=bands.map(([low,high])=>{
      const result:number[]=[];
      for(let i=0;i<geometry.cage.length;i+=16)if([2,3].includes(geometry.cage[i+15])&&geometry.cage[i+2]>=low&&geometry.cage[i+2]<=high)result.push(i);
      if(!result.length)throw new Error('The shower body has no steam coverage surface.');
      return result;
    });
    cached={indices,envelopes:bands.map(()=>({centre:[0,0,0],radii:[0,0,0]}))};
    selected.set(geometry,cached);
  }
  const c=Math.cos(angle),s=Math.sin(angle);
  for(let band=0;band<cached.indices.length;band++){
    const vertices=cached.indices[band],result=cached.envelopes[band];
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for(const at of vertices){
      let px=0,py=0,pz=0;
      for(let influence=0;influence<4;influence++){
        const bone=shaped[at+6+influence]*16,weight=shaped[at+10+influence];
        const x=shaped[at],y=shaped[at+1],z=shaped[at+2];
        px+=weight*(matrices[bone]*x+matrices[bone+4]*y+matrices[bone+8]*z+matrices[bone+12]);
        py+=weight*(matrices[bone+1]*x+matrices[bone+5]*y+matrices[bone+9]*z+matrices[bone+13]);
        pz+=weight*(matrices[bone+2]*x+matrices[bone+6]*y+matrices[bone+10]*z+matrices[bone+14]);
      }
      const x=c*(px+offset[0])-s*(py+offset[1]),y=s*(px+offset[0])+c*(py+offset[1]),z=pz+offset[2];
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
    }
    result.centre[0]=(minX+maxX)/2;result.centre[1]=(minY+maxY)/2;result.centre[2]=(minZ+maxZ)/2;
    result.radii[0]=(maxX-minX)/2+.22;result.radii[1]=(maxY-minY)/2+.22;result.radii[2]=(maxZ-minZ)/2+.10;
  }
  return cached.envelopes;
}
