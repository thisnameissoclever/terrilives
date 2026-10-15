import type {Geometry} from '../src/render/character/bundle.js';
import type {Vec3} from '../src/render/character/math.js';

function clip(polygon:Vec3[],distance:(p:Vec3)=>number):Vec3[]{
  const output:Vec3[]=[];
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],da=distance(a),db=distance(b);
    if(da>=0)output.push(a);
    if((da>=0)!==(db>=0)){const t=da/(da-db);output.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t]);}
  }
  return output;
}
const area=(points:Vec3[])=>Math.abs(points.reduce((sum,p,i)=>{const next=points[(i+1)%points.length];return sum+p[0]*next[1]-next[0]*p[1];},0))/2;

/** Exact projected triangle overlap, independent of the fitter's sampled height grid. */
export function reclineSupport(geometry:Geometry,points:Float32Array<ArrayBuffer>,bodyNames:string[],fixtureNames:string[]){
  const triangles=(names:string[])=>geometry.description.parts.filter(part=>names.includes(part.name)).flatMap(part=>{
    const out:Vec3[][]=[];
    for(let at=part.start;at<part.start+part.count;at+=3)out.push([0,1,2].map(k=>{const id=geometry.indices[at+k]*3;return [points[id],points[id+1],points[id+2]];}));
    return out;
  });
  const body=triangles(bodyNames),fixture=triangles(fixtureNames),top=Math.max(...fixture.flat().map(p=>p[2]));
  const flats=fixture.filter(row=>row.every(p=>Math.abs(p[2]-top)<1e-6));
  let minGap=Infinity,contactArea=0;
  for(const surface of flats){
    const xs=surface.map(p=>p[0]),ys=surface.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const winding=Math.sign((surface[1][0]-surface[0][0])*(surface[2][1]-surface[0][1])-(surface[1][1]-surface[0][1])*(surface[2][0]-surface[0][0]));
    for(const triangle of body){
      if(triangle.every(p=>p[0]<minX)||triangle.every(p=>p[0]>maxX)||triangle.every(p=>p[1]<minY)||triangle.every(p=>p[1]>maxY))continue;
      let patch=triangle;
      for(let i=0;i<3&&patch.length;i++){const a=surface[i],b=surface[(i+1)%3];patch=clip(patch,p=>winding*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])));}
      if(area(patch)<1e-10)continue;
      minGap=Math.min(minGap,...patch.map(p=>p[2]-top));
      patch=clip(clip(patch,p=>p[2]-top),p=>top+.01-p[2]);contactArea+=area(patch);
    }
  }
  return {minGap,contactArea};
}
