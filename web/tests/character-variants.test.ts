import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { decodeGeometry,geometryBuffers,type Bundle } from '../src/render/character/bundle.js';
import { selectGeometry } from '../src/render/character/variants.js';
import { defaultAppearance, appearanceChoices } from '../src/character/schema.js';
import { neutralAppearance } from '../src/render/character/appearance.js';
import { posedPositions } from '../src/render/character/geometry-proof.js';
import { anatomicalHeight } from '../src/render/character/shape.js';

function source(creator=false){
  const base=new URL(`../../assets/models/sims/character-creator/${creator?'export':'baseline'}/`,import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL('manifest.json',base),'utf8')) as Bundle;
  const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(manifest.runtime[key],base))).buffer]));
  const geometry=decodeGeometry(manifest,'runtime',buffers as Record<typeof geometryBuffers[number],ArrayBuffer>);
  if(!creator)geometry.description.parts=geometry.description.parts.map(part=>({...part,conditions:part.region===8?[{hairstyle:['curl'],bald:[false]}]:part.region===9?[{hairstyle:['bob'],bald:[false]}]:part.region===10?[{fixture:['armchair']}]:part.region===7?[{prop:['book']}]:[]}));
  return geometry;
}

it('selects actual parts, without keeping invisible hair or furniture in the GPU mesh',()=>{
  const base=source(),a=defaultAppearance();
  const curl=selectGeometry(base,a,{wear:'clothed',prop:'none',fixture:'none',eyes_closed:false});
  expect(curl.description.parts.some(p=>p.region===8)).toBe(true);
  expect(curl.description.parts.some(p=>[7,9,10].includes(p.region))).toBe(false);
  expect(curl.description.vertexCount).toBeLessThan(base.description.vertexCount);
  const bald=selectGeometry(base,{...a,bald:true},{wear:'clothed',prop:'none',fixture:'none',eyes_closed:false});
  expect(bald.description.parts.some(p=>[8,9].includes(p.region))).toBe(false);
  expect(()=>selectGeometry(base,a,{wear:'clothed',prop:'book',fixture:'unknown',eyes_closed:false})).toThrow('fixture');
});

it('loads each authored selection and keeps geometry unchanged for material edits',()=>{
  const base=source(true),context={wear:'clothed' as const,prop:'none',fixture:'none',eyes_closed:false};
  for(const key of ['hairstyle','facial_hair','scar','top','sleeves','bottoms','footwear','glasses_style','earrings']){
    for(const value of appearanceChoices[key]){
      const appearance={...defaultAppearance(),[key]:value,glasses:key==='glasses_style'};
      const geometry=selectGeometry(base,appearance,context);
      expect(geometry.indices.length).toBeGreaterThan(0);
      expect(geometry.indices.every(index=>index<geometry.description.vertexCount)).toBe(true);
    }
  }
  const appearance=defaultAppearance(),geometry=selectGeometry(base,appearance,context);
  appearance.colors.eyes=[1,2,3];appearance.colors.facial_hair=[200,100,40];
  expect(selectGeometry(base,appearance,context)).toBe(geometry);
});

it('keeps bare ankles joined to feet and jacket fronts facing outward',()=>{
  const base=source(true);
  const points=(name:string)=>{
    const part=base.description.parts.find(part=>part.name===name)!;
    expect(part,name).toBeDefined();
    return [...base.indices.slice(part.start,part.start+part.count)].map(index=>Array.from(base.vertices.slice(index*16,index*16+3)));
  };
  for(const side of ['L','R']){
    const foot=points(`Creator bare foot ${side}`),leg=points(`Creator bare leg ${side}`);
    expect(Math.max(...foot.map(p=>p[2]))).toBeGreaterThan(Math.min(...leg.map(p=>p[2])));
    expect(Math.min(...foot.map(p=>p[2]))).toBeCloseTo(.0191481,3);
  }
  for(const side of [-1,1]){
    const lapel=points(`Creator jacket lapel ${side}`);
    let normalY=0;
    for(let i=0;i<lapel.length;i+=3){const [a,b,c]=lapel.slice(i,i+3);normalY+=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);}
    expect(normalY).toBeLessThan(0);
  }
});

it('preserves every retained animated triangle after remapping cages and subdivision rows',()=>{
  const base=source(),a=defaultAppearance();
  const filtered=selectGeometry(base,a,{wear:'clothed',prop:'book',fixture:'armchair',eyes_closed:false});
  const top=anatomicalHeight(base.vertices);
  const whole=posedPositions(base,neutralAppearance(),'read',1.5,top);
  const selected=posedPositions(filtered,neutralAppearance(),'read',1.5,top);
  let maxError=0;
  for(const part of filtered.description.parts){
    const original=base.description.parts.find(p=>p.name===part.name)!;
    for(let i=0;i<part.count;i++)for(let axis=0;axis<3;axis++)
      maxError=Math.max(maxError,Math.abs(whole[base.indices[original.start+i]*3+axis]-selected[filtered.indices[part.start+i]*3+axis]));
  }
  expect(maxError).toBeLessThan(1e-6);
});
