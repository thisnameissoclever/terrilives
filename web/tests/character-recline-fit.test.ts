import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {decodeGeometry,geometryBuffers,type Bundle,type MeshDescription} from '../src/render/character/bundle.js';
import {combineClipFamily,type ClipLibrary,type ClipParts} from '../src/render/character/clip-runtime.js';
import {defaultAppearance} from '../src/character/schema.js';
import {selectGeometry} from '../src/render/character/variants.js';
import {posedPositions} from '../src/render/character/geometry-proof.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {SupportSurface} from '../src/render/character/support-surface.js';
import type {Vec3} from '../src/render/character/math.js';
import {length,sub,transform,multiply,inverseAffine} from '../src/render/character/math.js';
import {configuredPose} from '../src/render/character/pose.js';
import {shapePoint} from '../src/render/character/shape.js';
import {reclineSupport} from './recline-measurement.js';
import {CHARACTER_OUTLINE_WIDTH} from '../src/render/character/authored-surfaces.js';

const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('export/manifest.json',directory),'utf8')) as Bundle;
const library=JSON.parse(readFileSync(new URL('clips/clips.json',directory),'utf8')) as ClipLibrary;
function readGeometry(description:MeshDescription,folder:string){
  const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(folder+'/'+description[key],directory))).buffer]));
  return decodeGeometry({...manifest,runtime:description},'runtime',buffers as Record<typeof geometryBuffers[number],ArrayBuffer>);
}
const original=readGeometry(manifest.runtime,'export');
const parts=JSON.parse(readFileSync(new URL('clips/recline/parts.json',directory),'utf8')) as ClipParts;
const source=combineClipFamily(original,readGeometry(parts.geometry!,'clips/recline'),parts,library,'recline');
const wallDepth=JSON.parse(readFileSync(new URL('../../assets/models/architecture-depth.json',import.meta.url),'utf8')).wallAndDoorDepth as number;

it.each(['curl','bob','wave','crop','quiff','bald'])('contains %s with large facial features and glasses on both presentations',hairstyle=>{
  const rows=[];
  for(const presentation of ['masculine','feminine'] as const)for(const faceShape of ['oval','round','angular'])for(const size of [0,100]){
    const appearance=defaultAppearance(presentation);appearance.hairstyle=hairstyle==='bald'?'curl':hairstyle;appearance.bald=hairstyle==='bald';appearance.glasses=true;
    appearance.body={height:100,build:100,shoulders:100,hips:100,torso:0};
    appearance.face={...appearance.face,shape:faceShape,cheeks:size,jaw:size,chin:size,eye_size:size,brow_thickness:size,nose_width:size,mouth_fullness:size,ears:size};
    const geometry=selectGeometry(source,appearance,{wear:'clothed',prop:'none',fixture:'none',clip:'sofa_recline',eyes_closed:false,includeFixture:false});
    const points=posedPositions(geometry,{presentation,...appearance.body,face:appearance.face},'sofa_recline',0,anatomicalHeight(geometry.vertices));
    let minX=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const part of geometry.description.parts)if([1,8,9].includes(part.region))for(let at=part.start;at<part.start+part.count;at++){
      const id=geometry.indices[at]*3;minX=Math.min(minX,points[id]);maxX=Math.max(maxX,points[id]);maxY=Math.max(maxY,points[id+1]);
    }
    expect(minX-CHARACTER_OUTLINE_WIDTH).toBeGreaterThan(-.5+wallDepth/2);
    expect(maxX+CHARACTER_OUTLINE_WIDTH).toBeLessThan(.5-wallDepth/2);
    expect(maxY+CHARACTER_OUTLINE_WIDTH).toBeLessThan(1-wallDepth/2);
    const head=geometry.manifest.bones.findIndex(b=>b.name==='head'),matrices=configuredPose(geometry.manifest,{presentation,...appearance.body,face:appearance.face},'sofa_recline',0,anatomicalHeight(geometry.vertices),undefined,geometry);
    const sourceHead=multiply(library.clips.sofa_recline.samples[0].rig,multiply(library.clips.sofa_recline.samples[0].bones[head],geometry.manifest.bones[head].inverseRest));
    const turn=multiply(Array.from(matrices.slice(head*16,head*16+16)),inverseAffine(sourceHead));
    rows.push({presentation,faceShape,sliderValue:size,head:{minX,maxX,maxY},neckTurnDegrees:Math.atan2(turn[8],turn[0])*180/Math.PI});
  }
  if(process.env.RECLINE_EVIDENCE){const out=new URL('../../docs/evidence/2026-10-13-creator-repair/recline-wall/',import.meta.url);mkdirSync(out,{recursive:true});writeFileSync(new URL('hair-'+hairstyle+'.json',out),JSON.stringify(rows,null,2));}
});

it('supports both presentations and all independent body corners without changing limb length',()=>{
  const failures:string[]=[],cases=[];
  for(const presentation of ['masculine','feminine'] as const)for(let bits=0;bits<32;bits++){
    const appearance=defaultAppearance(presentation);appearance.body={height:bits&1?100:0,build:bits&2?100:0,shoulders:bits&4?100:0,hips:bits&8?100:0,torso:bits&16?100:0};
    const geometry=selectGeometry(source,appearance,{wear:'clothed',prop:'none',fixture:'none',clip:'sofa_recline',eyes_closed:false});
    try{const shape={presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(geometry.vertices),points=posedPositions(geometry,shape,'sofa_recline',0,top);
      let rear=-Infinity,left=Infinity,right=-Infinity;
      for(const part of geometry.description.parts)if([1,8,9].includes(part.region))for(let at=part.start;at<part.start+part.count;at++){
        const id=geometry.indices[at]*3;rear=Math.max(rear,points[id+1]);left=Math.min(left,points[id]);right=Math.max(right,points[id]);
      }
      const contacts={torso:reclineSupport(geometry,points,['Overshirt body','Trouser hip bridge'],[0,1,2].map(i=>'Creator clip recline Seat cushion '+i)),
        footL:reclineSupport(geometry,points,['Fitted rounded shoe sole'],['Creator clip recline Arm left']),footR:reclineSupport(geometry,points,['Fitted rounded shoe sole.001'],['Creator clip recline Arm left'])};
      const matrices=configuredPose(geometry.manifest,shape,'sofa_recline',0,top,undefined,geometry),boneLengthErrors:number[]=[],jointGaps:number[]=[];
      for(const side of ['L','R'])for(const [first,second] of [['thigh.','shin.'],['shin.','foot.'],['upper_arm.','forearm.'],['forearm.','hand.']]){
        const i=geometry.manifest.bones.findIndex(b=>b.name===first+side),next=geometry.manifest.bones.findIndex(b=>b.name===second+side),bone=geometry.manifest.bones[i],child=geometry.manifest.bones[next];
        const region=first.includes('arm')?4:3,head=shapePoint(bone.head,region,shape,top),tail=shapePoint(bone.tail,first==='shin.'?6:region,shape,top);
        const matrix=Array.from(matrices.slice(i*16,i*16+16)),end=transform(matrix,tail),start=transform(matrix,head);
        const childHead=shapePoint(child.head,second==='foot.'?6:region,shape,top),childPoint=transform(Array.from(matrices.slice(next*16,next*16+16)),childHead);
        boneLengthErrors.push(Math.abs(length(sub(end,start))-length(sub(tail,head))));jointGaps.push(length(sub(end,childPoint)));
      }
      const spine=geometry.manifest.bones.findIndex(b=>b.name==='spine'),head=geometry.manifest.bones.findIndex(b=>b.name==='head');
      const spineEnd=transform(Array.from(matrices.slice(spine*16,spine*16+16)),shapePoint(geometry.manifest.bones[head].head,1,shape,top));
      const headStart=transform(Array.from(matrices.slice(head*16,head*16+16)),shapePoint(geometry.manifest.bones[head].head,1,shape,top));
      jointGaps.push(length(sub(spineEnd,headStart)));
      const sourceHead=multiply(library.clips.sofa_recline.samples[0].rig,multiply(library.clips.sofa_recline.samples[0].bones[head],geometry.manifest.bones[head].inverseRest));
      const turn=multiply(Array.from(matrices.slice(head*16,head*16+16)),inverseAffine(sourceHead));
      cases.push({presentation,body:appearance.body,head:{left,right,rear,neckTurnDegrees:Math.atan2(turn[8],turn[0])*180/Math.PI},contacts,boneLengthError:Math.max(...boneLengthErrors),jointGap:Math.max(...jointGaps)});
      expect(rear).toBeLessThan(.925);
      expect(left).toBeGreaterThan(-.415);expect(right).toBeLessThan(.415);
      expect(rear+CHARACTER_OUTLINE_WIDTH).toBeLessThan(1-wallDepth/2);
      expect(left-CHARACTER_OUTLINE_WIDTH).toBeGreaterThan(-.5+wallDepth/2);
      expect(right+CHARACTER_OUTLINE_WIDTH).toBeLessThan(.5-wallDepth/2);
      expect(Math.max(...boneLengthErrors)).toBeLessThan(1e-5);expect(Math.max(...jointGaps)).toBeLessThan(1e-5);
      for(const contact of Object.values(contacts)){expect(contact.minGap).toBeGreaterThanOrEqual(-.001);expect(contact.contactArea).toBeGreaterThan(.0001);}
    }catch(error){failures.push(presentation+' '+JSON.stringify(appearance.body)+' '+String(error));}
  }
  if(process.env.RECLINE_EVIDENCE){const out=new URL('../../docs/evidence/2026-10-13-creator-repair/recline-wall/',import.meta.url);mkdirSync(out,{recursive:true});writeFileSync(new URL('corners.json',out),JSON.stringify(cases,null,2));}
  expect(failures).toEqual([]);
},30000);

it.each(['masculine','feminine'] as const)('preserves clothed and heel support across %s clothing and footwear selectors',presentation=>{
  const rows=[];
  for(const topStyle of ['overshirt','tshirt','jacket'])for(const bottoms of ['trousers','shorts'])for(const footwear of ['loafers','laceups','trainers']){
    const appearance=defaultAppearance(presentation);Object.assign(appearance,{top:topStyle,bottoms,footwear});
    appearance.body={height:100,build:100,shoulders:100,hips:100,torso:0};
    const context={wear:'clothed' as const,prop:'none',fixture:'none',clip:'sofa_recline',eyes_closed:false};
    const geometry=selectGeometry(source,appearance,context),shape={presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(geometry.vertices);
    expect(geometry.description.parts.some(part=>part.name==='Overshirt body')).toBe(true);
    expect(geometry.description.parts.some(part=>part.name==='Trouser hip bridge')).toBe(true);
    const points=posedPositions(geometry,shape,'sofa_recline',0,top);
    const contacts={torso:reclineSupport(geometry,points,['Overshirt body','Trouser hip bridge'],[0,1,2].map(i=>'Creator clip recline Seat cushion '+i)),
      footL:reclineSupport(geometry,points,[footwear==='trainers'?'Creator trainer sole L':'Fitted rounded shoe sole'],['Creator clip recline Arm left']),
      footR:reclineSupport(geometry,points,[footwear==='trainers'?'Creator trainer sole R':'Fitted rounded shoe sole.001'],['Creator clip recline Arm left'])};
    rows.push({top:topStyle,bottoms,footwear,contacts});
    for(const contact of Object.values(contacts)){expect(contact.minGap).toBeGreaterThanOrEqual(-.001);expect(contact.contactArea).toBeGreaterThan(.0001);}
    const hidden=selectGeometry(source,appearance,{...context,includeFixture:false});
    const a=configuredPose(geometry.manifest,shape,'sofa_recline',0,top,undefined,geometry),b=configuredPose(hidden.manifest,shape,'sofa_recline',0,top,undefined,hidden);
    expect(Math.max(...a.map((v,i)=>Math.abs(v-b[i])))).toBeLessThan(1e-5);
  }
  if(process.env.RECLINE_EVIDENCE){const out=new URL('../../docs/evidence/2026-10-13-creator-repair/recline-wall/',import.meta.url);mkdirSync(out,{recursive:true});writeFileSync(new URL(presentation+'-clothing.json',out),JSON.stringify(rows,null,2));}
},30000);

it('keeps the tallest recliner inside the legal two-tile sofa footprint',()=>{
  const cases=[];
  for(const body of [{height:50,build:50,shoulders:50,hips:50,torso:50},{height:100,build:0,shoulders:0,hips:100,torso:0}]){
    const appearance=defaultAppearance();appearance.body=body;
    const geometry=selectGeometry(source,appearance,{wear:'clothed',prop:'none',fixture:'none',clip:'sofa_recline',eyes_closed:false});
    const points=posedPositions(geometry,{presentation:appearance.presentation,...body,face:appearance.face},'sofa_recline',0,anatomicalHeight(geometry.vertices));
    const bounds=geometry.description.parts.map(part=>{
      const ids=[...new Set(geometry.indices.slice(part.start,part.start+part.count))];
      return {name:part.name,region:part.region,bounds:[0,1,2].map(axis=>[Math.min(...ids.map(i=>points[i*3+axis])),Math.max(...ids.map(i=>points[i*3+axis]))])};
    });
    const surface=(names:string[])=>{
      const triangles:[number,number,number][]=[];
      for(const part of geometry.description.parts)if(names.includes(part.name))for(let at=part.start;at<part.start+part.count;at+=3)triangles.push(Array.from(geometry.indices.slice(at,at+3)) as [number,number,number]);
      const ids=[...new Set(triangles.flat())],map=new Map(ids.map((id,i)=>[id,i]));
      return new SupportSurface(ids.map(id=>Array.from(points.slice(id*3,id*3+3)) as unknown as Vec3),triangles.map(row=>row.map(id=>map.get(id)!) as [number,number,number]));
    };
    const support=(bodyNames:string[],fixtureNames:string[])=>{
      const bodySurface=surface(bodyNames),fixture=surface(fixtureNames),gaps=[];
      for(let x=Math.max(bodySurface.bounds[0],fixture.bounds[0])+.0025;x<Math.min(bodySurface.bounds[1],fixture.bounds[1]);x+=.005)
        for(let y=Math.max(bodySurface.bounds[2],fixture.bounds[2])+.0025;y<Math.min(bodySurface.bounds[3],fixture.bounds[3]);y+=.005){
          const low=bodySurface.height(x,y,'bottom'),high=fixture.height(x,y,'top');if(low!==undefined&&high!==undefined)gaps.push(low-high);
        }
      return {min:Math.min(...gaps),closeArea:gaps.filter(gap=>gap>=-.005&&gap<=.01).length*.005*.005};
    };
    cases.push({body,bounds,support:{head:support(['Sculpted head'],['Creator clip recline Arm right']),torso:support(['Overshirt body','Trouser hip bridge'],[0,1,2].map(i=>'Creator clip recline Seat cushion '+i)),footL:support(['Fitted rounded shoe sole'],['Creator clip recline Arm left']),footR:support(['Fitted rounded shoe sole.001'],['Creator clip recline Arm left'])}});
  }
  if(process.env.RECLINE_EVIDENCE){
    const out=new URL('../../docs/evidence/2026-10-13-creator-repair/recline-wall/',import.meta.url);mkdirSync(out,{recursive:true});
    writeFileSync(new URL(process.env.RECLINE_EVIDENCE,out),JSON.stringify(cases,null,2));
  }
  const head=cases[1].bounds.filter(part=>[1,8,9].includes(part.region));
  expect(Math.max(...head.map(part=>part.bounds[1][1]))).toBeLessThan(1);
});
