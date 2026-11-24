import retained from './pool-entry-defect-witnesses.json';
import {expect,it} from 'vitest';
import type {Geometry} from '../src/render/character/bundle.js';
import type {PreparedPoolPatch} from '../src/render/character/pool-contact-patch.js';
import type {PoolFixtureV1,PoolSupport} from '../src/render/character/pool-contact-types.js';
import type {PoolObservation} from '../src/render/character/pool-observer.js';
import {observePoolPatchSupport,poolSupportRequired} from '../src/render/character/pool-support-observer.js';
import {poolFixture} from './pool-observer-fixture.js';

const clear={violations:[]} as unknown as PoolObservation;
const patch={part:'Synthetic contact patch',sourceTriangles:[0]} as unknown as PreparedPoolPatch;
function surface(points:readonly (readonly number[])[]){return {geometry:{indices:new Uint32Array([0,1,2]),description:{parts:[{name:patch.part,start:0,count:3}]}} as unknown as Geometry,
  points:new Float32Array(points.flat())};}
const sole:PoolSupport={mode:'support',surface:'ground',interval:[0,1],region:{kind:'top-face'}};
const fixture={...poolFixture,ground:{id:'ground',bounds:[[0,0,0],[1,1,0]]}} as PoolFixtureV1;

it('requires the whole finite sole projection and preserves exact release-start ownership',()=>{
  const inside=surface([[.25,.25,0],[.75,.25,0],[.25,.75,0]]);
  expect(observePoolPatchSupport(fixture,[inside],patch,sole,.5,clear)).toMatchObject({satisfied:true,projectedArea:.125,coveredArea:.125});
  const slid=surface([[.75,.25,0],[1.25,.25,0],[.75,.75,0]]);
  expect(observePoolPatchSupport(fixture,[slid],patch,sole,.5,clear).reasons).toContain('finite patch leaves its support');
  const release={...sole,mode:'release' as const,interval:[.6,.8] as [number,number]};
  expect(poolSupportRequired(release,.6)).toBe(true);expect(poolSupportRequired(release,.60001)).toBe(false);
  const lifted=surface([[.25,.25,.01],[.75,.25,.01],[.25,.75,.01]]);
  expect(observePoolPatchSupport(fixture,[lifted],patch,release,.6,clear).reasons).toContain('support contact is lost');
});

it('rejects contact on the correct rail outside its actual permitted facet interval',()=>{
  const solid=poolFixture.solids.find(solid=>solid.id==='Pool ladder rail 1')!;
  const support:PoolSupport={mode:'support',surface:solid.id,interval:[0,1],region:{kind:'rail',parameter:[1,5]}};
  const allowed=surface(solid.triangles[360].map(id=>solid.vertices[id]));
  expect(observePoolPatchSupport(poolFixture,[allowed],patch,support,.2,clear).satisfied).toBe(true);
  const outside=surface(solid.triangles[0].map(id=>solid.vertices[id]));
  expect(observePoolPatchSupport(poolFixture,[outside],patch,support,.2,clear).satisfied).toBe(false);
});

it('rejects a supported patch when the remaining selected body crosses a solid',()=>{
  const inside=surface([[.25,.25,0],[.75,.25,0],[.25,.75,0]]);
  const collision={violations:[{part:'Shin',surface:'Tread',signedClearance:-.001}]} as unknown as PoolObservation;
  expect(observePoolPatchSupport(fixture,[inside],patch,sole,.5,collision).reasons).toContain('selected body intersects a fixture solid');
});

it('retains rejection of all three frozen failed entry-node observations',()=>{
  const inside=surface([[.25,.25,0],[.75,.25,0],[.25,.75,0]]);
  for(const phase of [.2,.5,.6]){
    const observation=retained.records.find(record=>record.phase===phase)! as unknown as PoolObservation;
    expect(observation.violations.length).toBeGreaterThan(0);
    expect(observePoolPatchSupport(fixture,[inside],patch,sole,phase,observation).satisfied).toBe(false);
  }
});
