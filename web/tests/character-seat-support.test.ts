import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {decodeGeometry,geometryBuffers,type Bundle,type MeshDescription,type Geometry} from '../src/render/character/bundle.js';
import {combineClipFamily,type ClipLibrary,type ClipParts} from '../src/render/character/clip-runtime.js';
import {defaultAppearance} from '../src/character/schema.js';
import {selectGeometry} from '../src/render/character/variants.js';
import {posedPositions} from '../src/render/character/geometry-proof.js';
import {anatomicalHeight,shapePoint} from '../src/render/character/shape.js';
import {configuredPoseForProof} from '../src/render/character/pose.js';
import {queryConfiguredSurface} from '../src/render/character/surface-query.js';
import {identity,inverseAffine,length,sub,transform} from '../src/render/character/math.js';
import type {PoseDiagnostics} from '../src/render/character/contact-types.js';
import {SupportSurface} from '../src/render/character/support-surface.js';
import type {Vec3} from '../src/render/character/math.js';
import {configuredJointSetup} from '../src/render/character/pose-joints.js';
import {applySeatedPoseFit,compileSeatedPoseFit,fitSeatedPose} from '../src/render/character/seat-fit.js';

const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('export/manifest.json',directory),'utf8')) as Bundle;
const library=JSON.parse(readFileSync(new URL('clips/clips.json',directory),'utf8')) as ClipLibrary;
function readGeometry(description:MeshDescription,folder:string){
  const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(folder+'/'+description[key],directory))).buffer]));
  return decodeGeometry({...manifest,runtime:description},'runtime',buffers as Record<typeof geometryBuffers[number],ArrayBuffer>);
}
const base=readGeometry(manifest.runtime,'export');
const supports={seat_armchair:'Seat cushion',seat_reading:'Chair seat cushion',seat_dining:'Seat',seat_office:'Seat cushion',seat_ottoman:'Cushion',seat_sofa:'Seat cushion 1',dining:'Seat'};
function source(family:string):Geometry{
  const parts=JSON.parse(readFileSync(new URL('clips/'+family+'/parts.json',directory),'utf8')) as ClipParts;
  return combineClipFamily(base,readGeometry(parts.geometry!,'clips/'+family),parts,library,family);
}
function bounds(geometry:Geometry,points:Float32Array,names:string[]){
  const value=[Infinity,-Infinity,Infinity,-Infinity,Infinity,-Infinity];
  for(const part of geometry.description.parts)if(names.includes(part.name))for(let at=part.start;at<part.start+part.count;at++){
    const id=geometry.indices[at]*3;
    for(let axis=0;axis<3;axis++){value[axis*2]=Math.min(value[axis*2],points[id+axis]);value[axis*2+1]=Math.max(value[axis*2+1],points[id+axis]);}
  }
  return value;
}
function meshSurface(geometry:Geometry,points:Float32Array,name:string):SupportSurface{
  const part=geometry.description.parts.find(part=>part.name===name)!;
  const triangles:[number,number,number][]=[];
  for(let at=part.start;at<part.start+part.count;at+=3)triangles.push(Array.from(geometry.indices.slice(at,at+3)) as [number,number,number]);
  const ids=[...new Set(triangles.flat())],map=new Map(ids.map((id,index)=>[id,index]));
  return new SupportSurface(ids.map(id=>Array.from(points.slice(id*3,id*3+3)) as unknown as Vec3),triangles.map(row=>row.map(id=>map.get(id)!) as [number,number,number]));
}
function supportedPatch(geometry:Geometry,points:Float32Array,seatName:string){
  const pelvis=meshSurface(geometry,points,'Trouser hip bridge'),seat=meshSurface(geometry,points,seatName),near=new Map<string,[number,number]>();
  let minGap=Infinity;
  for(let x=Math.max(pelvis.bounds[0],seat.bounds[0])+.005,ix=0;x<Math.min(pelvis.bounds[1],seat.bounds[1]);x+=.01,ix++)
    for(let y=Math.max(pelvis.bounds[2],seat.bounds[2])+.005,iy=0;y<Math.min(pelvis.bounds[3],seat.bounds[3]);y+=.01,iy++){
      const bottom=pelvis.height(x,y,'bottom'),top=seat.height(x,y,'top');if(bottom===undefined||top===undefined)continue;
      const gap=bottom-top;minGap=Math.min(minGap,gap);if(gap>=0&&gap<=.005)near.set(ix+','+iy,[ix,iy]);
    }
  expect(minGap).toBeGreaterThanOrEqual(-.0001);
  let largest=0;
  while(near.size){
    const first=near.values().next().value!,queue=[first];near.delete(first.join(','));const component:[number,number][]=[];
    while(queue.length){const [x,y]=queue.pop()!;component.push([x,y]);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const key=(x+dx)+','+(y+dy),value=near.get(key);if(value){near.delete(key);queue.push(value);}}
    }
    if(new Set(component.map(row=>row[0])).size>1&&new Set(component.map(row=>row[1])).size>1)largest=Math.max(largest,component.length);
  }
  expect(largest).toBeGreaterThanOrEqual(8);
}
const collisionQueries=new WeakMap<Geometry,{solids:{name:string;surface:SupportSurface}[];calves:number[]}>();
function clearCalves(geometry:Geometry,points:Float32Array){
  let query=collisionQueries.get(geometry);
  if(!query){
    const solids=geometry.description.parts.filter(part=>part.region===12).map(part=>({name:part.name,surface:meshSurface(geometry,points,part.name)}));
    const calves=new Set<number>();
    for(const part of geometry.description.parts)if(part.name.startsWith('Tailored trouser leg'))for(let at=part.start;at<part.start+part.count;at++){
      const id=geometry.indices[at],bone=geometry.manifest.bones[geometry.vertices[id*16+6]];
      if(bone.name.startsWith('shin.')&&geometry.vertices[id*16+10]>.8)calves.add(id);
    }
    expect(solids.length).toBeGreaterThan(0);expect(calves.size).toBeGreaterThan(0);
    query={solids,calves:[...calves]};collisionQueries.set(geometry,query);
  }
  const intersections:string[]=[];
  for(const id of query.calves){const x=points[id*3],y=points[id*3+1],z=points[id*3+2];
    for(const {name,surface} of query.solids){const bottom=surface.height(x,y,'bottom'),top=surface.height(x,y,'top');
      if(bottom!==undefined&&top!==undefined&&z>bottom+.015&&z<top-.015)intersections.push(name+' vertex '+id);
    }
  }
  expect(intersections.length,intersections.slice(0,8).join('\n')).toBe(0);
}
it.each(Object.entries(supports))('places the seated pelvis over the finite %s cushion, rather than its front edge',(family,support)=>{
  const combined=source(family),appearance=defaultAppearance();
  const clip=family==='dining'?'seated_eat':family+'_read';
  const geometry=selectGeometry(combined,appearance,{wear:'clothed',prop:'book',fixture:'none',clip,eyes_closed:false});
  const points=posedPositions(geometry,{presentation:appearance.presentation,...appearance.body,face:appearance.face},clip,0,anatomicalHeight(geometry.vertices));
  const hip=bounds(geometry,points,['Trouser hip bridge']),seat=bounds(geometry,points,['Creator clip '+family+' '+support]);
  expect(hip.every(Number.isFinite)).toBe(true);expect(seat.every(Number.isFinite)).toBe(true);
  supportedPatch(geometry,points,'Creator clip '+family+' '+support);
});

it.each(Object.entries(supports))('supports every body corner through every %s seated cycle',(family,support)=>{
  const combined=source(family),failures:string[]=[];
  const actions=family==='dining'?['seated_eat']:[family+'_sit',family+'_read'];
  for(const presentation of ['masculine','feminine'] as const)for(let bits=0;bits<32;bits++){
    const appearance=defaultAppearance(presentation);
    appearance.body={height:bits&1?100:0,build:bits&2?100:0,shoulders:bits&4?100:0,hips:bits&8?100:0,torso:bits&16?100:0};
    for(const clip of actions){
      const geometry=selectGeometry(combined,appearance,{wear:'clothed',prop:clip.endsWith('_read')?'book':'none',fixture:'none',clip,eyes_closed:false});
      const shape={presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(geometry.vertices);
      for(let frame=0;frame<library.clips[clip].samples.length;frame+=.5)try{
        const audit:PoseDiagnostics={contacts:[],assemblies:{}};
        const matrices=configuredPoseForProof(geometry.manifest,shape,clip,frame,top,audit,geometry);
        for(const contact of audit.contacts)expect(contact.error).toBeLessThan(1e-5);
        const points=queryConfiguredSurface(geometry,geometry.description.parts.filter(part=>part.region===3||part.region===12),shape,top,
          geometry.manifest.bones.map((_,index)=>Array.from(matrices.slice(index*16,index*16+16))),geometry.manifest.bones.map(identity));
        supportedPatch(geometry,points,'Creator clip '+family+' '+support);
        clearCalves(geometry,points);
        const setup=configuredJointSetup(geometry.manifest,shape,clip,frame,top),rig=library.clips[clip].samples[0].rig;
        for(const side of ['L','R']){
          const foot=geometry.manifest.bones.findIndex(bone=>bone.name==='foot.'+side),bone=geometry.manifest.bones[foot];
          const actual=transform(matrices.subarray(foot*16,foot*16+16),shapePoint(bone.head,6,shape,top));
          expect(actual[2]).toBeCloseTo(transform(rig,setup.source[foot].slice(12,15) as unknown as Vec3)[2],5);
          const local=transform(inverseAffine(rig),actual);
          expect(local[0]).toBeCloseTo(setup.source[foot][12],5);
          const thigh=geometry.manifest.bones.findIndex(bone=>bone.name==='thigh.'+side),range=library.clips[clip].contacts.feet!.forwardRange;
          expect(local[1]-setup.source[thigh][13]).toBeGreaterThanOrEqual(range[0]-1e-5);
          expect(local[1]-setup.source[thigh][13]).toBeLessThanOrEqual(range[1]+1e-5);
          for(const [first,second,region] of [['thigh.','shin.',3],['shin.','foot.',6]] as const){
            const id=geometry.manifest.bones.findIndex(bone=>bone.name===first+side),b=geometry.manifest.bones[id],matrix=matrices.subarray(id*16,id*16+16);
            const head=shapePoint(b.head,3,shape,top),tail=shapePoint(b.tail,region,shape,top);
            expect(length(sub(transform(matrix,tail),transform(matrix,head)))).toBeCloseTo(length(sub(tail,head)),5);
          }
        }
      }catch(error){failures.push(JSON.stringify({presentation,bits,clip,frame,error:String(error)}));}
    }
  }
  expect(failures).toEqual([]);
},60000);

it.each(['seat_sofa','seat_reading','seat_ottoman','seat_office','seat_dining'])('keeps the shortest configured calves outside the %s fixture solids',family=>{
  const appearance=defaultAppearance('feminine');appearance.body={height:0,build:100,shoulders:100,hips:0,torso:100};
  const clip=family+'_read',combined=source(family);
  const geometry=selectGeometry(combined,appearance,{wear:'clothed',prop:'book',fixture:'none',clip,eyes_closed:false});
  const points=posedPositions(geometry,{presentation:appearance.presentation,...appearance.body,face:appearance.face},clip,0,anatomicalHeight(geometry.vertices));
  clearCalves(geometry,points);
});

it('compiles contacts without mutating the input and applies them without freezing upper-body animation',()=>{
  const appearance=defaultAppearance('feminine');appearance.body={height:0,build:100,shoulders:100,hips:0,torso:100};
  const family='seat_sofa',clip=family+'_read',geometry=selectGeometry(source(family),appearance,{wear:'clothed',prop:'book',fixture:'none',clip,eyes_closed:false});
  const shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(geometry.vertices);
  const setup=configuredJointSetup(geometry.manifest,shape,clip,0,top),before=structuredClone(setup.matrices),rig=library.clips[clip].samples[0].rig,range=library.clips[clip].contacts.feet!.forwardRange;
  const fit=compileSeatedPoseFit(geometry,shape,top,family,setup.matrices,setup.rest,rig,setup.source,range);
  expect(setup.matrices).toEqual(before);
  const expected=structuredClone(before);fitSeatedPose(geometry,shape,top,family,expected,setup.rest,rig,setup.source,range);
  const actual=structuredClone(before),head=geometry.manifest.bones.findIndex(bone=>bone.name==='head');
  for(let id=0;id<17;id++)actual[id][14]+=.25;
  actual[head][12]+=.012;
  applySeatedPoseFit(geometry,actual,fit);
  expected[head][12]+=.012;
  for(let id=0;id<17;id++)for(let axis=0;axis<16;axis++)expect(actual[id][axis]).toBeCloseTo(expected[id][axis],9);
});
