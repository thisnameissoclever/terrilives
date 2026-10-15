import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { shapePoint, shapeVertices } from '../src/render/character/shape.js';
import { neutralAppearance } from '../src/render/character/appearance.js';
import { defaultAppearance } from '../src/character/schema.js';

const base=new URL('../../assets/models/sims/character-creator/baseline/',import.meta.url);
const reference=JSON.parse(readFileSync(new URL('shapes.json',base),'utf8'));
const buffer=Uint8Array.from(readFileSync(new URL('runtime.cage.bin',base))).buffer;

it('retains every accepted rest shape when independent controls match the legacy build',()=>{
  for(const row of reference.rows){
    const a={...neutralAppearance(),presentation:row.presentation,height:row.height,build:row.build,
      shoulders:row.build,hips:row.build,torso:50,face:defaultAppearance().face};
    const shape=shapeVertices(new Float32Array(buffer),a,reference.top);
    expect(createHash('sha256').update(new Uint8Array(shape.buffer)).digest('hex')).toBe(row.sha256);
  }
},30000);

it('changes shoulder and hip span independently while retaining floor registration',()=>{
  const a={...neutralAppearance(),shoulders:50,hips:50,torso:50};
  const wide={...a,shoulders:100};
  expect(shapePoint([.23,0,1.3],4,wide)[0]).toBeGreaterThan(shapePoint([.23,0,1.3],4,a)[0]+.05);
  expect(shapePoint([.124,0,.86],3,wide)).toEqual(shapePoint([.124,0,.86],3,a));
  const broad={...a,hips:100};
  expect(shapePoint([.124,0,.86],3,broad)[0]).toBeGreaterThan(shapePoint([.124,0,.86],3,a)[0]+.02);
  expect(shapePoint([.124,0,.019],6,broad)[2]).toBe(.019);
  expect(shapePoint([.23,0,1.3],4,broad)).toEqual(shapePoint([.23,0,1.3],4,a));
});

it('changes torso proportions without changing standing height or arm length',()=>{
  const a={...neutralAppearance(),torso:50},long={...a,torso:100};
  expect(shapePoint([0,0,.86],3,long)[2]).toBeCloseTo(shapePoint([0,0,.86],3,a)[2]-.05,10);
  expect(shapePoint([0,0,reference.top],1,long)).toEqual(shapePoint([0,0,reference.top],1,a));
  const distance=(p:number[],q:number[])=>Math.hypot(...p.map((v,i)=>v-q[i]));
  expect(distance(shapePoint([.23,0,1.3],4,long),shapePoint([.32,0,.81],4,long)))
    .toBeCloseTo(distance(shapePoint([.23,0,1.3],4,a),shapePoint([.32,0,.81],4,a)),10);
});

it('gives each facial slider a localized geometric effect without changing the body',()=>{
  const a={...neutralAppearance(),face:defaultAppearance().face};
  const probes:{key:keyof typeof a.face;point:[number,number,number]}[]=[
    {key:'cheeks',point:[.16,-.15,1.61]},{key:'jaw',point:[.13,-.12,1.48]},
    {key:'chin',point:[0,-.13,1.45]},{key:'eye_size',point:[.12,-.18,1.70]},
    {key:'brow_thickness',point:[.09,-.18,1.762]},{key:'nose_width',point:[.025,-.20,1.625]},
    {key:'mouth_fullness',point:[.02,-.181,1.55]},{key:'ears',point:[.248,.014,1.69]},
  ];
  for(const {key,point} of probes){
    const changed={...a,face:{...a.face,[key]:100}};
    expect(Math.hypot(...shapePoint(point,1,changed).map((v,i)=>v-shapePoint(point,1,a)[i])),key).toBeGreaterThan(.001);
    expect(shapePoint([.12,0,.8],3,changed)).toEqual(shapePoint([.12,0,.8],3,a));
  }
});
