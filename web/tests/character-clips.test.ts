import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {decodeGeometry,geometryBuffers,type Bundle,type MeshDescription} from '../src/render/character/bundle.js';
import {combineClipFamily,type ClipLibrary,type ClipParts} from '../src/render/character/clip-runtime.js';
import {defaultAppearance} from '../src/character/schema.js';
import {configuredPoseForProof as configuredPose} from '../src/render/character/pose.js';
import {anatomicalHeight,shapeVertices} from '../src/render/character/shape.js';
import {WORLD_CHARACTER_FRAME,characterPixelScale} from '../src/render/character/camera.js';
import {clipSample,interpolateAffine} from '../src/render/character/motion.js';
import {identity} from '../src/render/character/math.js';
import {selectGeometry} from '../src/render/character/variants.js';
import type {PoseDiagnostics} from '../src/render/character/contact-types.js';
const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const library=JSON.parse(readFileSync(new URL('clips/clips.json',directory),'utf8')) as ClipLibrary;
const manifest=JSON.parse(readFileSync(new URL('export/manifest.json',directory),'utf8')) as Bundle;
function readGeometry(description:MeshDescription,folder:string,header=manifest){
  const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(folder+'/'+description[key],directory))).buffer]));
  return decodeGeometry({...header,runtime:description},'runtime',buffers as Record<typeof geometryBuffers[number],ArrayBuffer>);
}
it('keeps terminal progress samples and independently interpolates prop scale',()=>{
  expect(clipSample(8,80,'progress')).toEqual({index:7,next:7,t:0});
  expect(clipSample(8,7.5,'loop')).toEqual({index:7,next:0,t:.5});
  const left=identity(),right=identity();right[5]=3;
  expect(interpolateAffine(left,right,.5)[5]).toBe(2);
});
it('contains tall fridge reaching geometry and outlines in all four world facings',()=>{
  const base=readGeometry(manifest.runtime,'export'),parts=JSON.parse(readFileSync(new URL('clips/fridge/parts.json',directory),'utf8')) as ClipParts;
  const source=combineClipFamily(base,readGeometry(parts.geometry!,'clips/fridge'),parts,library,'fridge');
  const a=defaultAppearance();a.body.height=100;
  const geometry=selectGeometry(source,a,{wear:'clothed',prop:'none',fixture:'none',clip:'fridge',eyes_closed:false});
  const shape={presentation:a.presentation,...a.body,face:a.face},top=anatomicalHeight(geometry.vertices),cage=shapeVertices(geometry.cage,shape,top);
  const frame=WORLD_CHARACTER_FRAME,scale=characterPixelScale(frame.size,frame.size)*frame.zoom;
  expect(scale).toBe(2);
  for(const phase of [3,7]){
    const bones=configuredPose(geometry.manifest,shape,'fridge',phase,top,undefined,geometry);
    for(let facing=0;facing<4;facing++){
      const c=Math.cos(facing*Math.PI/2),s=Math.sin(facing*Math.PI/2);
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(let i=0;i<cage.length;i+=16){
        if(bones[cage[i+6]*16+15]<0)continue;
        const p=[0,0,0];
        if(cage[i+15]===10)p.splice(0,3,...cage.subarray(i,i+3));
        else for(let influence=0;influence<4;influence++){
          const b=cage[i+6+influence]*16,w=cage[i+10+influence];
          for(let axis=0;axis<3;axis++)p[axis]+=w*(bones[b+axis]*cage[i]+bones[b+4+axis]*cage[i+1]+bones[b+8+axis]*cage[i+2]+bones[b+12+axis]);
        }
        const x=c*p[0]-s*p[1],y=s*p[0]+c*p[1];
        const px=frame.size/2+(x+y)*32*scale,py=frame.size*frame.groundFraction-(-(x-y)*21+p[2]*Math.sqrt(1166))*scale;
        minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);
      }
      expect(minX).toBeGreaterThan(1);expect(maxX).toBeLessThan(frame.size-1);
      expect(minY).toBeGreaterThan(1);expect(maxY).toBeLessThan(frame.size-1);
    }
  }
});
it.each(Object.keys(library.sources).flatMap(family=>(['masculine','feminine'] as const).map(presentation=>[family,presentation] as const)))('solves %s %s clips at proof endpoints and independent body corners',(family,presentation)=>{
  const base=readGeometry(manifest.runtime,'export'),top=anatomicalHeight(base.vertices),failures:string[]=[];
    const parts=JSON.parse(readFileSync(new URL(`clips/${family}/parts.json`,directory),'utf8')) as ClipParts;
    const extra=parts.geometry?readGeometry(parts.geometry,`clips/${family}`):null;
    const geometry=combineClipFamily(base,extra,parts,library,family);
    for(const [name,clip] of Object.entries(library.clips))if(clip.family===family){
      const profiles=[...Array.from({length:32},(_,bits)=>({height:bits&1?100:0,build:bits&2?100:0,shoulders:bits&4?100:0,hips:bits&8?100:0,torso:bits&16?100:0})),
        ...[0,50,100].flatMap(height=>[0,50,100].map(build=>({height,build,shoulders:build,hips:build,torso:50})))];
      for(const profile of profiles){
        const a=defaultAppearance(presentation);a.body=profile;
        const selected=selectGeometry(geometry,a,{wear:['bath','shower'].includes(name)?'bare':'clothed',prop:clip.samples[0].bookVisible?'book':'none',fixture:'none',eyes_closed:clip.samples[0].eyesClosed,clip:name,grip:name==='mop'?'mop':'relaxed'});
        for(let frame=0;frame<clip.samples.length;frame+=.5){
          try{const audit:PoseDiagnostics={contacts:[],assemblies:{}};
            const pose=configuredPose(selected.manifest,{presentation,...a.body,face:a.face},name,frame,top,audit,selected);
            if(pose.some(value=>!Number.isFinite(value)))throw new Error('Non-finite pose');
            if(audit.contacts.some(contact=>contact.error>1e-5))throw new Error('A palm lost its physical target');
          }
          catch(error){failures.push(`${name} ${presentation} ${JSON.stringify(profile)} f${frame}: ${String(error)}`);break;}
        }
      }
    }
  expect(failures).toEqual([]);
},30000);

it('keeps the accepted walking and reading solvers valid at independent body corners',()=>{
  const base=readGeometry(manifest.runtime,'export'),top=anatomicalHeight(base.vertices),failures:string[]=[];
  for(const presentation of ['masculine','feminine'] as const)for(let bits=0;bits<32;bits++){
    const body={height:bits&1?100:0,build:bits&2?100:0,shoulders:bits&4?100:0,hips:bits&8?100:0,torso:bits&16?100:0};
    for(const action of ['walk','read'])for(let frame=0;frame<base.manifest.actions[action].length;frame+=.5){
      try{configuredPose(base.manifest,{presentation,...body},action,frame,top);}catch(error){failures.push(`${action} ${presentation} ${JSON.stringify(body)} ${String(error)}`);break;}
    }
  }
  expect(failures).toEqual([]);
});

it.each(['masculine','feminine'] as const)('fits configured trainers and shorts on the bike: %s',presentation=>{
  const base=readGeometry(manifest.runtime,'export'),parts=JSON.parse(readFileSync(new URL('clips/exercise/parts.json',directory),'utf8')) as ClipParts;
  const source=combineClipFamily(base,readGeometry(parts.geometry!,'clips/exercise'),parts,library,'exercise'),failures:string[]=[];
  for(let bits=0;bits<32;bits++){
    const a=defaultAppearance(presentation);a.footwear='trainers';a.bottoms='shorts';a.top='jacket';a.sleeves='short';
    a.body={height:bits&1?100:0,build:bits&2?100:0,shoulders:bits&4?100:0,hips:bits&8?100:0,torso:bits&16?100:0};
    const geometry=selectGeometry(source,a,{wear:'clothed',prop:'none',fixture:'none',eyes_closed:false,clip:'exercise',grip:'relaxed'});
    for(let frame=0;frame<8;frame+=.5)try{configuredPose(geometry.manifest,{presentation,...a.body,face:a.face},'exercise',frame,anatomicalHeight(geometry.vertices),undefined,geometry);}
      catch(error){failures.push(JSON.stringify(a.body)+': '+String(error));break;}
  }
  expect(failures).toEqual([]);
},30000);
