import {readFileSync,writeFileSync} from 'node:fs';
import {expect,it,vi} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {anatomicalHeight,shapeVertices} from '../src/render/character/shape.js';
import {configuredPoseForProof} from '../src/render/character/pose.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import * as bike from '../src/render/character/bike-fit.js';
import {sampleBikeFit} from '../src/render/character/bike-contact-sample.js';
import {fitBike as frozenFit} from './fixtures/support-surface/bike-original.js';
import {bikeGeometry} from './bike-contact-fixture.js';

const folder=new URL('../../docs/evidence/2026-10-13-creator-repair/bike-contact-compilation/',import.meta.url);
const encode=(_key:string,value:unknown)=>typeof value==='number'&&Object.is(value,-0)?{negativeZero:true}:value;
const decode=(_key:string,value:unknown)=>value&&typeof value==='object'&&'negativeZero' in value&&value.negativeZero===true?-0:value;

it('measures the recorded first-entry phase change without changing production fitting',()=>{
  const appearance=defaultAppearance(),geometry=bikeGeometry(appearance),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const top=anatomicalHeight(geometry.vertices),recorded=JSON.parse(readFileSync(new URL('cold-neutral-phases.json',folder),'utf8')) as {rows:{phase:number;fit:bike.BikeFit}[]};
  const fits=new Map<number,bike.BikeFit>();let firstPhase=0;
  const observed=vi.spyOn(bike,'fitBike').mockImplementation((...args:Parameters<typeof bike.fitBike>)=>{
    const result=frozenFit({...args[0]},...args.slice(1) as Parameters<typeof frozenFit> extends [unknown,...infer Rest]?Rest:never);
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(recorded.rows.find(row=>row.phase===firstPhase)!.fit);
    fits.set(firstPhase,result);return result;
  });
  try{
    for(firstPhase of [0,2])configuredPoseForProof(geometry.manifest,shape,'exercise',firstPhase,top,undefined,geometry);
    const canonical=fits.get(0)!,phaseTwo=fits.get(2)!;
    const injection={reference:'Frozen independent pre-compilation fitter; neutral masculine loafers; first entry at phase 2.',phase:2,appearance,fit:phaseTwo};
    const encoded=JSON.stringify(injection,encode,2);
    expect(JSON.parse(encoded,decode).fit).toStrictEqual(phaseTwo);
    if(process.env.BIKE_CONTACT_INPUT_EVIDENCE)writeFileSync(new URL('old-phase-two-fit-signed.json',folder),encoded,'utf8');
    expect(canonical.hip).toStrictEqual(phaseTwo.hip);expect(canonical.pelvisRotation).toStrictEqual(phaseTwo.pelvisRotation);
    expect(canonical.pitch).toBe(phaseTwo.pitch);expect(canonical.supportSamples).toBe(phaseTwo.supportSamples);
    const selected=bikeGeometry(appearance,true),cage=shapeVertices(selected.cage,shape,top),rows=[];
    for(const phase of [2,3,4,5]){
      observed.mockImplementation((...args)=>sampleBikeFit(phaseTwo,args[8]??0));
      const oldBones=configuredPoseForProof(selected.manifest,shape,'exercise',phase,top,undefined,selected),oldSurface=posedCageSurface(selected,cage,oldBones);
      observed.mockImplementation((...args)=>sampleBikeFit(canonical,args[8]??0));
      const newBones=configuredPoseForProof(selected.manifest,shape,'exercise',phase,top,undefined,selected),newSurface=posedCageSurface(selected,cage,newBones);
      const bones=selected.manifest.bones.flatMap((bone,index)=>{let changed=0,maxDelta=0;for(let i=index*16;i<(index+1)*16;i++){if(!Object.is(oldBones[i],newBones[i]))changed++;maxDelta=Math.max(maxDelta,Math.abs(oldBones[i]-newBones[i]));}return changed?[{name:bone.name,changed,maxDelta}]:[];});
      const changedVertices=new Set<number>(),axis=[0,0,0];let maxDistance=0;
      for(let i=0;i<oldSurface.length;i+=3){let d2=0;for(let j=0;j<3;j++){const d=Math.abs(oldSurface[i+j]-newSurface[i+j]);axis[j]=Math.max(axis[j],d);d2+=d*d;if(!Object.is(oldSurface[i+j],newSurface[i+j]))changedVertices.add(i/3);}maxDistance=Math.max(maxDistance,Math.sqrt(d2));}
      const parts=selected.description.parts.flatMap(part=>{const ids=new Set(selected.indices.subarray(part.start,part.start+part.count));const changed=[...ids].filter(id=>changedVertices.has(id)).length;return changed?[{name:part.name,changed,total:ids.size}]:[];});
      const projected=[0,1,2,3].map(facing=>{const c=Math.cos(facing*Math.PI/2),s=Math.sin(facing*Math.PI/2);let maxX=0,maxY=0;for(const id of changedVertices){const dx=newSurface[id*3]-oldSurface[id*3],dy=newSurface[id*3+1]-oldSurface[id*3+1],dz=newSurface[id*3+2]-oldSurface[id*3+2],rx=c*dx-s*dy,ry=s*dx+c*dy;maxX=Math.max(maxX,Math.abs(32*(rx+ry)));maxY=Math.max(maxY,Math.abs(21*(rx-ry)-Math.sqrt(1166)*dz));}return {facing,maxX,maxY};});
      rows.push({phase,bones,vertices:oldSurface.length/3,changedVertices:changedVertices.size,maxAxisDelta:axis,maxDistance,parts,projectedAtUnitScale:projected});
    }
    if(process.env.BIKE_CONTACT_INPUT_EVIDENCE)writeFileSync(new URL('phase-two-cpu-impact.json',folder),JSON.stringify({appearance,fit0:canonical,fit2:phaseTwo,rows},encode,2),'utf8');
    expect(rows).toHaveLength(4);expect(rows.every(row=>row.changedVertices>0)).toBe(true);
  }finally{observed.mockRestore();}
},30000);
