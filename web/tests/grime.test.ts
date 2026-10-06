import {expect,it} from 'vitest';
import {buildGrimeInstances,grimeSpriteTable,GRIME_PAGE,grimeMarks} from '../src/render/grime-decals.js';
import {FLOATS_PER_INSTANCE,OFFSET_TINT_R} from '../src/render/instances.js';
import {FLOOR_DEPTH,layeredDepth} from '../src/render/iso.js';
import {FLOATS_PER_SPRITE} from '../src/render/sprite-table-layout.js';
it('draws localized floor stains above the floor and behind furniture without recolouring the material',()=>{
  const source={count:0,floorGrime:()=>new Uint32Array([41,900]),surfaceGrime:()=>new Uint32Array(),
    binWaste:()=>new Uint32Array(),positions:()=>new Float32Array(),sprites:()=>new Uint32Array(),ids:()=>new Uint32Array(),
    footprintWidths:()=>new Uint32Array(),footprintDepths:()=>new Uint32Array()};
  const batch=buildGrimeInstances(source,20,36,100,100,1,5000);
  expect(batch.count).toBe(1);
  expect(batch.opacity[0]).toBeCloseTo(.9);
  for(let i=0;i<batch.count;i++){
    const at=i*FLOATS_PER_INSTANCE;
    expect([...batch.instances.slice(at+OFFSET_TINT_R,at+OFFSET_TINT_R+3)]).toEqual([1,1,1]);
    expect(batch.instances[at+2]).toBeLessThan(FLOOR_DEPTH);
    expect(batch.instances[at+2]).toBeGreaterThan(layeredDepth(1,2,36,1));
  }
  expect(buildGrimeInstances({...source,floorGrime:()=>new Uint32Array()},20,36,100,100,1,5000).count).toBe(0);
});
it('keeps grime in its additional atlas page with distinct floor, counter and bin sizes',()=>{
  const rows=grimeSpriteTable();expect(rows.length).toBe(12*FLOATS_PER_SPRITE);
  for(let i=0;i<12;i++)expect(rows[i*FLOATS_PER_SPRITE+10]).toBe(GRIME_PAGE);
  expect(rows[4]).toBe(64);expect(rows[4*FLOATS_PER_SPRITE+4]).toBe(32);
  expect([0,74,75,450,1000].map(grimeMarks)).toEqual([0,1,1,1,1]);
});

it('keeps a stable stain while opacity follows actual dirt down to zero',()=>{
  const source={count:0,floorGrime:()=>new Uint32Array([41,100]),surfaceGrime:()=>new Uint32Array(),binWaste:()=>new Uint32Array(),positions:()=>new Float32Array(),sprites:()=>new Uint32Array(),ids:()=>new Uint32Array(),footprintWidths:()=>new Uint32Array(),footprintDepths:()=>new Uint32Array()};
  for(const amount of [100,500,1000,42,1]) {
    const batch=buildGrimeInstances({...source,floorGrime:()=>new Uint32Array([41,amount])},20,36,100,100,1,5000);
    expect(batch.count).toBe(1);expect(batch.opacity[0]).toBeCloseTo(amount/1000);
  }
});
