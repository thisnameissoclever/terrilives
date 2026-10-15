import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {afterAll,expect,it,vi} from 'vitest';
import {SupportSurface} from '../src/render/character/support-surface.js';
import {SupportSurface as OriginalSurface} from './fixtures/support-surface/original.js';
import {fitBike as originalFit} from './fixtures/support-surface/bike-original.js';
import * as bike from '../src/render/character/bike-fit.js';
import {decodeGeometry,geometryBuffers,type Bundle,type Geometry,type MeshDescription,type MeshPart} from '../src/render/character/bundle.js';
import {combineClipFamily,type ClipLibrary,type ClipParts} from '../src/render/character/clip-runtime.js';
import {selectGeometry} from '../src/render/character/variants.js';
import {defaultAppearance} from '../src/character/schema.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {posedPositions} from '../src/render/character/geometry-proof.js';
import {configuredPoseForProof as configuredPose} from '../src/render/character/pose.js';
import type {Vec3} from '../src/render/character/math.js';

const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const originalHash='9e3a5ad79cb1fd0ec4d41f127166288700c85d64a30474891f18855f24b57d67';
const goldenBytes=readFileSync(new URL('./fixtures/support-surface/bike-fit-golden.json',import.meta.url));
const golden=JSON.parse(goldenBytes.toString()) as {sourceReceiptSha256:string;cases:{presentation:'masculine'|'feminine';bits:number;
  body:{height:number;build:number;shoulders:number;hips:number;torso:number};queries:{top:number;bottom:number};frames:{frame:number;fit:bike.BikeFit}[]}[]};
const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('export/manifest.json',directory),'utf8')) as Bundle;
const library=JSON.parse(readFileSync(new URL('clips/clips.json',directory),'utf8')) as ClipLibrary;
function load(description:MeshDescription,folder:string){
  const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(folder+'/'+description[key],directory))).buffer]));
  return decodeGeometry({...manifest,runtime:description},'runtime',buffers as Record<typeof geometryBuffers[number],ArrayBuffer>);
}
const parts=JSON.parse(readFileSync(new URL('clips/exercise/parts.json',directory),'utf8')) as ClipParts;
const source=combineClipFamily(load(manifest.runtime,'export'),load(parts.geometry!,'clips/exercise'),parts,library,'exercise');
const context={wear:'clothed' as const,prop:'none',fixture:'none',eyes_closed:false,clip:'exercise',grip:'relaxed' as const};
const currentFit=bike.fitBike,currentHeight=SupportSurface.prototype.height,originalHeight=OriginalSurface.prototype.height;
const evidence={surfaces:[] as unknown[],fits:[] as unknown[],firstFits:[] as unknown[]};

it('pins the independent old surface and the previously recorded complete bike fits',()=>{
  const original=readFileSync(new URL('./fixtures/support-surface/original.ts',import.meta.url),'utf8')
    .replaceAll("from '../../../src/render/character/","from './").replaceAll('\r\n','\n');
  expect(digest(original)).toBe(originalHash);
  const originalBike=readFileSync(new URL('./fixtures/support-surface/bike-original.ts',import.meta.url),'utf8')
    .replaceAll("from '../../../src/render/character/","from './").replace("from './original.js'","from './support-surface.js'").replaceAll('\r\n','\n');
  expect(digest(originalBike)).toBe('eae951a918bef165c15a1ea935041d6005530b56c0b0ca5fca504f479a15e696');
  expect(digest(goldenBytes)).toBe('bcf8cad384b6b53734e7e6cc72c20b9bd3609ce40f11f6e03b7b48d88e033b94');
  expect(golden.sourceReceiptSha256).toBe('82ff54c69a97b5960167a8b79d49073e4a722cfe42de901c2998fc196fc2fe89');
  expect(golden.cases).toHaveLength(64);
  expect(golden.cases.every(row=>row.frames.length===16)).toBe(true);
});

function compareSurface(label:string,points:readonly Vec3[],triangles:readonly [number,number,number][],cell=.025){
  const original=new OriginalSurface(points,triangles,cell),current=new SupportSurface(points,triangles,cell);
  expect(current.bounds).toStrictEqual(original.bounds);expect(current.maximumZ).toBe(original.maximumZ);
  const queries:[number,number][]=[];
  const [minX,maxX,minY,maxY]=original.bounds;
  for(let x=0;x<=40;x++)for(let y=0;y<=40;y++)queries.push([minX-cell+(maxX-minX+2*cell)*x/40,minY-cell+(maxY-minY+2*cell)*y/40]);
  for(const p of points)queries.push([p[0],p[1]],[p[0]-1e-10,p[1]],[p[0]+1e-10,p[1]],[p[0],p[1]-1e-10],[p[0],p[1]+1e-10]);
  for(const triangle of triangles){
    const [a,b,c]=triangle.map(index=>points[index]);
    queries.push([(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3]);
    for(const [u,v] of [[a,b],[b,c],[c,a]])queries.push([(u[0]+v[0])/2,(u[1]+v[1])/2]);
  }
  for(let x=Math.floor(minX/cell)-1;x<=Math.ceil(maxX/cell)+1&&x-Math.floor(minX/cell)<200;x++){
    const px=x*cell,y=(minY+maxY)/2;queries.push([px,y],[px-1e-10,y],[px+1e-10,y]);
  }
  queries.push([NaN,0],[Infinity,0],[-Infinity,0],[0,NaN],[0,Infinity],[0,-Infinity],[-0,0],[0,-0]);
  let defined=0;
  for(const [x,y] of queries)for(const side of ['top','bottom'] as const){
    const expected=original.height(x,y,side),actual=current.height(x,y,side);
    if(!Object.is(actual,expected))throw new Error(`${label}: ${side} at (${x},${y}) differs: ${actual} versus ${expected}`);
    if(expected!==undefined)defined++;
  }
  expect(defined,label).toBeGreaterThan(0);
  const elapsed={original:0,current:0};
  const measure=(surface:OriginalSurface|SupportSurface,lane:'original'|'current')=>{
    const started=performance.now();let total=0;
    for(const [x,y] of queries)for(const side of ['top','bottom'] as const)total+=surface.height(x,y,side)??0;
    elapsed[lane]+=performance.now()-started;return total;
  };
  for(let repeat=0;repeat<6;repeat++){
    let before:number,after:number;
    if(repeat%2){after=measure(current,'current');before=measure(original,'original');}
    else{before=measure(original,'original');after=measure(current,'current');}
    expect(after).toBe(before);
  }
  evidence.surfaces.push({label,vertices:points.length,triangles:triangles.length,cell,queries:queries.length*2,defined,
    bounds:current.bounds,maximumZ:current.maximumZ,elapsed,batches:6});
}

function partSurface(geometry:Geometry,part:MeshPart,points:Float32Array<ArrayBuffer>){
  const ids=[...new Set(geometry.indices.slice(part.start,part.start+part.count))],remap=new Map(ids.map((id,index)=>[id,index]));
  const triangles:[number,number,number][]=[];
  for(let at=part.start;at<part.start+part.count;at+=3)triangles.push([remap.get(geometry.indices[at])!,remap.get(geometry.indices[at+1])!,remap.get(geometry.indices[at+2])!]);
  return {points:ids.map(id=>[points[id*3],points[id*3+1],points[id*3+2]] as Vec3),triangles};
}

it.each((['masculine','feminine'] as const).flatMap(presentation=>[0,100].map(size=>({presentation,size}))))
('matches actual saddle, hip and sole surface queries for $presentation endpoint $size',({presentation,size})=>{
  const appearance=defaultAppearance(presentation);appearance.footwear='trainers';appearance.bottoms='shorts';appearance.top='jacket';appearance.sleeves='short';
  appearance.body={height:size,build:size,shoulders:size,hips:size,torso:size};
  // A distinct geometry identity keeps these contact setups out of the fit comparison's cache.
  const geometry={...selectGeometry(source,appearance,context)},shape={presentation,...appearance.body,face:appearance.face};
  const points=posedPositions(geometry,shape,'exercise',0,anatomicalHeight(geometry.vertices));
  for(const name of ['Creator clip exercise Bike saddle','Trouser hip bridge','Creator trainer sole L','Creator trainer sole R']){
    const part=geometry.description.parts.find(part=>part.name===name);expect(part,name).toBeDefined();
    const data=partSurface(geometry,part!,points);compareSurface(presentation+' '+size+' '+name,data.points,data.triangles);
  }
},30000);

it('preserves degeneracies, winding, layers, sparse coordinates and signed zero',()=>{
  const points:Vec3[]=[[0,0,-0],[.1,0,-0],[0,.1,-0],[0,0,0],[.1,0,0],[0,.1,0],
    [0,0,2],[.1,0,2],[0,.1,2],[0,0,-3],[.1,0,-3],[0,.1,-3],
    [1,1,1],[1+1e-7,1,2],[1,1+1e-7,3],[-1e6,1e6,5],[-1e6+.05,1e6,5],[-1e6,1e6+.05,5]];
  const triangles:[number,number,number][]=[[0,1,2],[3,4,5],[6,7,8],[9,11,10],[0,0,0],[12,13,14],[15,16,17]];
  compareSurface('edge cases',points,triangles);
  for(const z of [-0,0]){
    const vertices:Vec3[]=[[0,0,z],[1,0,z],[0,1,z]],before=new OriginalSurface(vertices,[[0,1,2]]),after=new SupportSurface(vertices,[[0,1,2]]);
    for(const side of ['top','bottom'] as const)expect(Object.is(after.height(.25,.25,side),before.height(.25,.25,side))).toBe(true);
  }
  const before=new OriginalSurface([],[]),after=new SupportSurface([],[]);
  expect(after.bounds).toStrictEqual(before.bounds);expect(after.maximumZ).toBe(before.maximumZ);expect(after.height(0,0,'top')).toBeUndefined();
});

it.each(golden.cases)('preserves complete fit values and query counts for $presentation corner $bits',row=>{
  const appearance=defaultAppearance(row.presentation);appearance.footwear='trainers';appearance.bottoms='shorts';appearance.top='jacket';appearance.sleeves='short';appearance.body=row.body;
  const geometry=selectGeometry(source,appearance,context),shape={presentation:row.presentation,...row.body,face:appearance.face},top=anatomicalHeight(geometry.vertices);
  const queries={original:{top:0,bottom:0},current:{top:0,bottom:0}},elapsed={original:0,current:0},frames:unknown[]=[];let calls=0,phase=0;
  const fits=vi.spyOn(bike,'fitBike').mockImplementation((...args:Parameters<typeof currentFit>)=>{
    let before:bike.BikeFit,after:bike.BikeFit,started:number;
    if(row.bits%2){started=performance.now();after=currentFit(...args);elapsed.current+=performance.now()-started;started=performance.now();before=originalFit(...args);elapsed.original+=performance.now()-started;}
    else{started=performance.now();before=originalFit(...args);elapsed.original+=performance.now()-started;started=performance.now();after=currentFit(...args);elapsed.current+=performance.now()-started;}
    expect(after).toStrictEqual(before);
    expect(JSON.stringify(after)).toBe(JSON.stringify(row.frames[calls].fit));
    frames.push({frame:phase,fit:structuredClone(after)});calls++;return after;
  });
  try{
    OriginalSurface.prototype.height=function(x,y,side){queries.original[side]++;return originalHeight.call(this,x,y,side);};
    SupportSurface.prototype.height=function(x,y,side){queries.current[side]++;return currentHeight.call(this,x,y,side);};
    for(phase=0;phase<8;phase+=.5)configuredPose(geometry.manifest,shape,'exercise',phase,top,undefined,geometry);
    expect(calls).toBe(16);expect(queries.current).toEqual(queries.original);expect(queries.current).toEqual(row.queries);
    evidence.fits.push({presentation:row.presentation,bits:row.bits,body:row.body,queries,elapsed,frames});
  }finally{fits.mockRestore();OriginalSurface.prototype.height=originalHeight;SupportSurface.prototype.height=currentHeight;}
},30000);

it.each(['masculine','feminine'] as const)('measures neutral first-fit setup with original and compiled surfaces: %s',presentation=>{
  const appearance=defaultAppearance(presentation),geometry=selectGeometry(source,appearance,context);
  const shape={presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(geometry.vertices);
  const queries={original:{top:0,bottom:0},current:{top:0,bottom:0}},elapsed={original:0,current:0};
  let calls=0,outputs:{original:bike.BikeFit;current:bike.BikeFit}|undefined;
  const fits=vi.spyOn(bike,'fitBike').mockImplementation((...args:Parameters<typeof currentFit>)=>{
    let before:bike.BikeFit,after:bike.BikeFit,started:number;
    if(presentation==='feminine'){started=performance.now();after=currentFit(...args);elapsed.current+=performance.now()-started;started=performance.now();before=originalFit(...args);elapsed.original+=performance.now()-started;}
    else{started=performance.now();before=originalFit(...args);elapsed.original+=performance.now()-started;started=performance.now();after=currentFit(...args);elapsed.current+=performance.now()-started;}
    expect(after).toStrictEqual(before);calls++;outputs=structuredClone({original:before,current:after});return after;
  });
  try{
    OriginalSurface.prototype.height=function(x,y,side){queries.original[side]++;return originalHeight.call(this,x,y,side);};
    SupportSurface.prototype.height=function(x,y,side){queries.current[side]++;return currentHeight.call(this,x,y,side);};
    configuredPose(geometry.manifest,shape,'exercise',0,top,undefined,geometry);
    expect(calls).toBe(1);expect(queries.current).toEqual(queries.original);expect(queries.current.bottom).toBeGreaterThan(0);
    evidence.firstFits.push({presentation,appearance,queries,elapsed,outputs});
  }finally{fits.mockRestore();OriginalSurface.prototype.height=originalHeight;SupportSurface.prototype.height=currentHeight;}
},30000);

afterAll(()=>{
  if(!process.env.SUPPORT_SURFACE_EVIDENCE)return;
  const folder=new URL('../../docs/evidence/2026-10-13-creator-repair/support-surface-equivalence/',import.meta.url);mkdirSync(folder,{recursive:true});
  const file=process.env.SUPPORT_SURFACE_EVIDENCE==='neutral'?'receipt-neutral.json':'receipt.json';
  writeFileSync(new URL(file,folder),JSON.stringify({originalHash,currentHash:digest(readFileSync(new URL('../src/render/character/support-surface.ts',import.meta.url))),
    goldenReceiptHash:golden.sourceReceiptSha256,...evidence},null,2),'utf8');
});
