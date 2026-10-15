import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {afterAll,expect,it,vi} from 'vitest';
import {decodeGeometry,geometryBuffers,type Bundle,type MeshDescription} from '../src/render/character/bundle.js';
import {combineClipFamily,type ClipLibrary,type ClipParts} from '../src/render/character/clip-runtime.js';
import {defaultAppearance} from '../src/character/schema.js';
import {configuredPoseForProof as configuredPose} from '../src/render/character/pose.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {selectGeometry} from '../src/render/character/variants.js';
import {SupportSurface} from '../src/render/character/support-surface.js';
import * as bike from '../src/render/character/bike-fit.js';
import {fitBike as originalFit} from './fixtures/bike-fit/original.js';

const originalHash='c3058cf5ae7a3c9b33e281a6bb1ff21a41c516a509764776a589f7cb82713cee';
const originalLfHash='54c93637b5408e37fee53a41390f8b3b59b17e98735ae8e44150308558032b67';
const originalPath=new URL('./fixtures/bike-fit/original.ts',import.meta.url);
const productionPath=new URL('../src/render/character/bike-fit.ts',import.meta.url);
const digest=(text:string|Buffer)=>createHash('sha256').update(text).digest('hex');
const restoredOriginal=readFileSync(originalPath,'utf8').replaceAll("from '../../../src/render/character/","from './");
const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('export/manifest.json',directory),'utf8')) as Bundle;
const library=JSON.parse(readFileSync(new URL('clips/clips.json',directory),'utf8')) as ClipLibrary;
function readGeometry(description:MeshDescription,folder:string){
  const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(folder+'/'+description[key],directory))).buffer]));
  return decodeGeometry({...manifest,runtime:description},'runtime',buffers as Record<typeof geometryBuffers[number],ArrayBuffer>);
}
const parts=JSON.parse(readFileSync(new URL('clips/exercise/parts.json',directory),'utf8')) as ClipParts;
const source=combineClipFamily(readGeometry(manifest.runtime,'export'),readGeometry(parts.geometry!,'clips/exercise'),parts,library,'exercise');
const currentFit=bike.fitBike,height=SupportSurface.prototype.height;
const cases=(['masculine','feminine'] as const).flatMap(presentation=>Array.from({length:32},(_,bits)=>({presentation,bits})));
const evidence:unknown[]=[];

it('retains the isolated original fitter after import relocation and checkout line-ending conversion',()=>{
  expect(digest(restoredOriginal.replaceAll('\r\n','\n'))).toBe(originalLfHash);
});

it.each(cases)('preserves every bike fit value for $presentation body corner $bits',({presentation,bits})=>{
  const appearance=defaultAppearance(presentation);
  appearance.footwear='trainers';appearance.bottoms='shorts';appearance.top='jacket';appearance.sleeves='short';
  appearance.body={height:bits&1?100:0,build:bits&2?100:0,shoulders:bits&4?100:0,hips:bits&8?100:0,torso:bits&16?100:0};
  const geometry=selectGeometry(source,appearance,{wear:'clothed',prop:'none',fixture:'none',eyes_closed:false,clip:'exercise',grip:'relaxed'});
  const shape={presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(geometry.vertices);
  const queries={original:{top:0,bottom:0},current:{top:0,bottom:0}},elapsed={original:0,current:0};
  const frames:{frame:number;original:bike.BikeFit;current:bike.BikeFit}[]=[];
  let lane:'original'|'current'='original',calls=0,frame=0;
  const countHeight:typeof height=function(this:SupportSurface,...args:Parameters<typeof height>){
    queries[lane][args[2]]++;
    return height.apply(this,args);
  };
  const fits=vi.spyOn(bike,'fitBike').mockImplementation((...args:Parameters<typeof currentFit>)=>{
    calls++;
    lane='original';let started=performance.now();const expected=originalFit(...args);elapsed.original+=performance.now()-started;
    lane='current';started=performance.now();const actual=currentFit(...args);elapsed.current+=performance.now()-started;
    expect(actual).toStrictEqual(expected);
    if(process.env.BIKE_FIT_EVIDENCE)frames.push(structuredClone({frame,original:expected,current:actual}));
    return actual;
  });
  try{
    SupportSurface.prototype.height=countHeight;
    for(frame=0;frame<8;frame+=.5){
      const pose=configuredPose(geometry.manifest,shape,'exercise',frame,top,undefined,geometry);
      expect(pose.every(Number.isFinite)).toBe(true);
    }
    expect(calls).toBe(16);
    expect(queries.current.top).toBeGreaterThan(0);
    expect(queries.current.top).toBeLessThan(queries.original.top);
    expect(queries.current.bottom).toBe(queries.original.bottom);
    if(process.env.BIKE_FIT_EVIDENCE)evidence.push({presentation,bits,body:appearance.body,queries,elapsed,frames});
  }finally{fits.mockRestore();SupportSurface.prototype.height=height;}
},30000);

afterAll(()=>{
  if(!process.env.BIKE_FIT_EVIDENCE)return;
  const directory=new URL('../../docs/evidence/2026-10-13-creator-repair/bike-fit-equivalence/',import.meta.url);
  mkdirSync(directory,{recursive:true});
  writeFileSync(new URL('receipt.json',directory),JSON.stringify({originalHash,originalLfHash,currentHash:digest(readFileSync(productionPath)),
    expectedCases:64,observedCases:evidence.length,phasesPerCase:16,cases:evidence},null,2),'utf8');
});
