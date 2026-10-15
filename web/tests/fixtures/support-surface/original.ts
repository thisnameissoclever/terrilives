import type {Vec3} from '../../../src/render/character/math.js';

/** Vertical surface queries use the exported triangles, including bevels. */
export class SupportSurface {
  private readonly buckets=new Map<string,number[]>();
  readonly bounds:[number,number,number,number];
  readonly maximumZ:number;
  constructor(private readonly points:readonly Vec3[],private readonly triangles:readonly [number,number,number][],private readonly cell=.025){
    this.maximumZ=Math.max(...points.map(point=>point[2]));
    this.bounds=[Math.min(...points.map(p=>p[0])),Math.max(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[1]))];
    triangles.forEach((triangle,index)=>{
      const p=triangle.map(i=>points[i]);
      const minX=Math.floor(Math.min(...p.map(p=>p[0]))/cell),maxX=Math.floor(Math.max(...p.map(p=>p[0]))/cell);
      const minY=Math.floor(Math.min(...p.map(p=>p[1]))/cell),maxY=Math.floor(Math.max(...p.map(p=>p[1]))/cell);
      for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++){const key=x+','+y;let rows=this.buckets.get(key);if(!rows){rows=[];this.buckets.set(key,rows);}rows.push(index);}
    });
  }
  height(x:number,y:number,side:'top'|'bottom'):number|undefined {
    const rows=this.buckets.get(Math.floor(x/this.cell)+','+Math.floor(y/this.cell));if(!rows)return undefined;
    let result=side==='top'?-Infinity:Infinity;
    for(const row of rows){const [a,b,c]=this.triangles[row].map(index=>this.points[index]);
      const determinant=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(determinant)<1e-12)continue;
      const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/determinant;
      const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/determinant,w=1-u-v;
      if(u< -1e-7||v< -1e-7||w< -1e-7)continue;
      const z=u*a[2]+v*b[2]+w*c[2];result=side==='top'?Math.max(result,z):Math.min(result,z);
    }
    return Number.isFinite(result)?result:undefined;
  }
}
