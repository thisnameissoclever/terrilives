import type {Vec3} from './math.js';

interface TriangleCoefficients {
  readonly cx:number;readonly cy:number;
  readonly az:number;readonly bz:number;readonly cz:number;
  readonly byMinusCy:number;readonly cxMinusBx:number;readonly cyMinusAy:number;readonly axMinusCx:number;
  readonly determinant:number;
}

/** Vertical surface queries use the exported triangles, including bevels. */
export class SupportSurface {
  private readonly buckets=new Map<number,Map<number,TriangleCoefficients[]>>();
  readonly bounds:[number,number,number,number];
  readonly maximumZ:number;
  constructor(points:readonly Vec3[],triangles:readonly [number,number,number][],private readonly cell=.025){
    let maximumZ=-Infinity,minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(let i=0;i<points.length;i++){
      // A skipped map entry previously reached Math.min/max as undefined.
      if(!(i in points)){maximumZ=minX=maxX=minY=maxY=NaN;continue;}
      const point=points[i];maximumZ=Math.max(maximumZ,point[2]);
      minX=Math.min(minX,point[0]);maxX=Math.max(maxX,point[0]);minY=Math.min(minY,point[1]);maxY=Math.max(maxY,point[1]);
    }
    this.maximumZ=maximumZ;this.bounds=[minX,maxX,minY,maxY];
    triangles.forEach(triangle=>{
      const a=points[triangle[0]],b=points[triangle[1]],c=points[triangle[2]];
      const byMinusCy=b[1]-c[1],cxMinusBx=c[0]-b[0],cyMinusAy=c[1]-a[1],axMinusCx=a[0]-c[0];
      const row:TriangleCoefficients={cx:c[0],cy:c[1],az:a[2],bz:b[2],cz:c[2],byMinusCy,cxMinusBx,cyMinusAy,axMinusCx,
        determinant:byMinusCy*axMinusCx+cxMinusBx*(a[1]-c[1])};
      const minX=Math.floor(Math.min(a[0],b[0],c[0])/cell),maxX=Math.floor(Math.max(a[0],b[0],c[0])/cell);
      const minY=Math.floor(Math.min(a[1],b[1],c[1])/cell),maxY=Math.floor(Math.max(a[1],b[1],c[1])/cell);
      for(let x=minX;x<=maxX;x++){
        let column=this.buckets.get(x);if(!column){column=new Map();this.buckets.set(x,column);}
        for(let y=minY;y<=maxY;y++){let rows=column.get(y);if(!rows){rows=[];column.set(y,rows);}rows.push(row);}
      }
    });
  }
  height(x:number,y:number,side:'top'|'bottom'):number|undefined {
    const rows=this.buckets.get(Math.floor(x/this.cell))?.get(Math.floor(y/this.cell));if(!rows)return undefined;
    let result=side==='top'?-Infinity:Infinity;
    for(const row of rows){
      const determinant=row.determinant;if(Math.abs(determinant)<1e-12)continue;
      const dx=x-row.cx,dy=y-row.cy;
      const u=(row.byMinusCy*dx+row.cxMinusBx*dy)/determinant;
      const v=(row.cyMinusAy*dx+row.axMinusCx*dy)/determinant,w=1-u-v;
      if(u< -1e-7||v< -1e-7||w< -1e-7)continue;
      const z=u*row.az+v*row.bz+w*row.cz;result=side==='top'?Math.max(result,z):Math.min(result,z);
    }
    return Number.isFinite(result)?result:undefined;
  }
}
