import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {afterAll,expect,it} from 'vitest';
import {decodeGeometry,geometryBuffers,type Bundle,type MeshDescription} from '../src/render/character/bundle.js';
import {combineClipFamily,type ClipLibrary,type ClipParts} from '../src/render/character/clip-runtime.js';
import {defaultAppearance} from '../src/character/schema.js';
import {configuredPose} from '../src/render/character/pose.js';
import {anatomicalHeight,shapeVertices} from '../src/render/character/shape.js';
import {selectGeometry} from '../src/render/character/variants.js';
import {clipSample,interpolateAffine,interpolateTransform,sampleMotion} from '../src/render/character/motion.js';
import {multiply,type Vec3} from '../src/render/character/math.js';
import {HeadEnvelope,projectedHeadHeight} from '../src/render/character/head-envelope.js';
import {bubbleAnchorY} from '../src/render/scene-sampling.js';
import {HeadEnvelope as OriginalEnvelope} from './fixtures/head-envelope/original.js';

const originalHash='7fa11f798a1d15260a3da51b4e992ae8c3b0a99aa2079213af9426ae3797d3b2';
const digest=(text:string|Buffer)=>createHash('sha256').update(text).digest('hex');
const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('export/manifest.json',directory),'utf8')) as Bundle;
const library=JSON.parse(readFileSync(new URL('clips/clips.json',directory),'utf8')) as ClipLibrary;
function readGeometry(description:MeshDescription,folder:string){
  const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(folder+'/'+description[key],directory))).buffer]));
  return decodeGeometry({...manifest,runtime:description},'runtime',buffers as Record<typeof geometryBuffers[number],ArrayBuffer>);
}
const base=readGeometry(manifest.runtime,'export');
const reclineParts=JSON.parse(readFileSync(new URL('clips/recline/parts.json',directory),'utf8')) as ClipParts;
const recline=combineClipFamily(base,readGeometry(reclineParts.geometry!,'clips/recline'),reclineParts,library,'recline');
interface PoseRow {name:string;frame:number;kind:'source'|'configured';matrices:Float32Array<ArrayBuffer>}
const phases=(count:number)=>[...new Set([0,(count-1)/2,count-1])];
const sourcePoses:PoseRow[]=[];
for(const name of [...Object.keys(manifest.actions),'sit_down','stand_up','standing_read']){
  const frames=name==='sit_down'||name==='stand_up'?[0,6.5,12,23,24]:name==='standing_read'?[0]:phases(manifest.actions[name].length);
  for(const frame of frames){
    const source=sampleMotion(manifest,name,frame).source,matrices=new Float32Array(manifest.bones.length*16);
    source.forEach((matrix,i)=>matrices.set(multiply(matrix,manifest.bones[i].inverseRest),i*16));
    sourcePoses.push({name,frame,kind:'source',matrices});
  }
}
for(const [name,clip] of Object.entries(library.clips))for(const frame of phases(clip.samples.length)){
  const sampled=clipSample(clip.samples.length,frame,clip.playback),a=clip.samples[sampled.index],b=clip.samples[sampled.next];
  const rig=interpolateAffine(a.rig,b.rig,sampled.t),matrices=new Float32Array(manifest.bones.length*16);
  manifest.bones.forEach((bone,i)=>matrices.set(multiply(rig,multiply(interpolateTransform(a.bones[i],b.bones[i],sampled.t),bone.inverseRest)),i*16));
  sourcePoses.push({name,frame,kind:'source',matrices});
}
const hairstyles=['curl','bob','wave','crop','quiff','bald'] as const;
const cases=(['masculine','feminine'] as const).flatMap(presentation=>hairstyles.flatMap(hairstyle=>[0,100].map(size=>({presentation,hairstyle,size}))));
const evidence:unknown[]=[];

it('retains the isolated original head envelope and covers every exported animation',()=>{
  const original=readFileSync(new URL('./fixtures/head-envelope/original.ts',import.meta.url),'utf8')
    .replaceAll("from '../../../src/render/character/","from './").replaceAll('\r\n','\n');
  expect(digest(original)).toBe(originalHash);
  const covered=new Set(sourcePoses.map(row=>row.name));
  for(const name of [...Object.keys(manifest.actions),...Object.keys(library.clips),'sit_down','stand_up','standing_read'])expect(covered.has(name),name).toBe(true);
});

it.each(cases)('preserves head top and bubble clearance for $presentation $hairstyle at endpoint $size',({presentation,hairstyle,size})=>{
  const appearance=defaultAppearance(presentation);appearance.hairstyle=hairstyle==='bald'?'curl':hairstyle;appearance.bald=hairstyle==='bald';appearance.glasses=true;
  appearance.body={height:size,build:size,shoulders:size,hips:size,torso:size};
  appearance.face={...appearance.face,shape:size?'angular':'round',cheeks:size,jaw:size,chin:size,eye_size:size,brow_thickness:size,nose_width:size,mouth_fullness:size,ears:size};
  const context={wear:'clothed' as const,prop:'none',fixture:'none',eyes_closed:false,includeFixture:false};
  const geometry=selectGeometry(base,appearance,context),shape={presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(geometry.vertices);
  const deformed=shapeVertices(geometry.cage,shape,top),original=new OriginalEnvelope(geometry),current=new HeadEnvelope(geometry);
  original.configure(deformed);current.configure(deformed);
  const reclineGeometry=selectGeometry(recline,appearance,{...context,clip:'sofa_recline'});
  const fitted:PoseRow[]=[
    {name:'read',frame:1.5,kind:'configured',matrices:configuredPose(geometry.manifest,shape,'read',1.5,top,undefined,geometry)},
    {name:'walk',frame:3.5,kind:'configured',matrices:configuredPose(geometry.manifest,shape,'walk',3.5,top,undefined,geometry)},
    {name:'sofa_recline',frame:0,kind:'configured',matrices:configuredPose(reclineGeometry.manifest,shape,'sofa_recline',0,top,undefined,reclineGeometry)},
  ];
  const elapsed={original:0,current:0},poseElapsed={original:0,current:0},rows:unknown[]=[];
  const originalPoints=Reflect.get(original,'points') as Float64Array,currentPoints=Reflect.get(current,'points') as Float64Array;
  const originalBytes=Buffer.from(originalPoints.buffer,originalPoints.byteOffset,originalPoints.byteLength);
  const currentBytes=Buffer.from(currentPoints.buffer,currentPoints.byteOffset,currentPoints.byteLength);
  let comparisons=0,posedArrays=0,comparedPointBytes=0;
  for(const row of [...sourcePoses,...fitted]){
    const pose=(envelope:OriginalEnvelope|HeadEnvelope,lane:'original'|'current')=>{
      const started=performance.now();envelope.pose(row.matrices);poseElapsed[lane]+=performance.now()-started;
    };
    if(posedArrays%2){pose(current,'current');pose(original,'original');}
    else{pose(original,'original');pose(current,'current');}
    expect(currentBytes.equals(originalBytes),row.name+' '+row.frame+' complete posed points').toBe(true);
    posedArrays++;comparedPointBytes+=currentBytes.byteLength;
    const facings:{facing:number;original:Vec3;current:Vec3;anchors:number[]}[]=[];
    for(let facing=0;facing<4;facing++){
      const angle=facing*Math.PI/2;
      const measure=(envelope:OriginalEnvelope|HeadEnvelope,lane:'original'|'current')=>{
        const start=performance.now(),value=envelope.top(angle);elapsed[lane]+=performance.now()-start;return value;
      };
      let expected:Vec3,actual:Vec3;
      if(comparisons%2){actual=measure(current,'current');expected=measure(original,'original');}
      else{expected=measure(original,'original');actual=measure(current,'current');}
      expect(actual,row.name+' '+row.frame+' facing '+facing).toStrictEqual(expected);
      expect(current.top(angle)).toBe(actual);
      const anchors:number[]=[];
      for(const scale of [.75,1,2.5]){
        const headY=-projectedHeadHeight(expected,0)*scale;
        const before=bubbleAnchorY(headY,scale,21,26,25),after=bubbleAnchorY(-projectedHeadHeight(actual,0)*scale,scale,21,26,25);
        expect(after).toBe(before);
        expect(headY-(after+(21-26+25)*scale)).toBeCloseTo(4*scale,10);
        anchors.push(after);
      }
      comparisons++;
      if(process.env.HEAD_ENVELOPE_EVIDENCE)facings.push({facing,original:expected,current:actual,anchors});
    }
    if(process.env.HEAD_ENVELOPE_EVIDENCE)rows.push({name:row.name,frame:row.frame,kind:row.kind,facings});
  }
  expect(comparisons).toBe((sourcePoses.length+fitted.length)*4);
  if(process.env.HEAD_ENVELOPE_EVIDENCE)evidence.push({presentation,hairstyle,size,comparisons,posedArrays,comparedPointBytes,elapsed,poseElapsed,rows});
},30000);

afterAll(()=>{
  if(!process.env.HEAD_ENVELOPE_EVIDENCE)return;
  const directory=new URL('../../docs/evidence/2026-10-13-creator-repair/head-envelope-equivalence/',import.meta.url);
  mkdirSync(directory,{recursive:true});
  const file=process.env.HEAD_ENVELOPE_EVIDENCE==='phase-2'?'receipt-phase-2.json':'receipt.json';
  writeFileSync(new URL(file,directory),JSON.stringify({originalHash,
    currentHash:digest(readFileSync(new URL('../src/render/character/head-envelope.ts',import.meta.url))),
    expectedCases:cases.length,observedCases:evidence.length,sourcePoses:sourcePoses.map(({name,frame,kind})=>({name,frame,kind})),cases:evidence},null,2),'utf8');
});
