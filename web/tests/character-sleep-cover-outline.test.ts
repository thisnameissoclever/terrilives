import {expect,it} from 'vitest';
import type {Geometry,Material} from '../src/render/character/bundle.js';
import {authoredOutline} from '../src/render/character/authored-surfaces.js';
import {outlineDrawRanges} from '../src/render/character/draw-ranges.js';
import {addSleepingCover} from '../src/render/character/sleep-cover.js';
import {appendStaticMesh} from '../src/render/character/static-mesh.js';

function emptyScene():Geometry {
  return {manifest:{materials:[]},description:{vertexCount:0,cageCount:0,indexCount:0,coefficientCount:0,parts:[]},
    vertices:new Float32Array(),cage:new Float32Array(),indices:new Uint32Array(),stencilRanges:new Uint32Array(),
    stencilWeights:new ArrayBuffer(0),normalRanges:new Uint32Array(),normalTriangles:new Uint32Array()} as unknown as Geometry;
}

it('draws bed and bunk covers as shaded fabric without an inflated outline hull',()=>{
  expect(authoredOutline('Configured shared sleeping cover')).toBe(false);
  for(const bunk of [false,true]){
    const scene=emptyScene(),cover=addSleepingCover(scene,[],bunk),part=cover.description.parts.at(-1)!;
    expect(part.name).toBe('Configured shared sleeping cover');
    expect(part.outline).toBe(false);
    expect(outlineDrawRanges(cover.description.parts)).toEqual([]);
    expect(cover.description.indexCount).toBeGreaterThan(6000);
    expect(cover.manifest.materials.at(-1)?.unlit).toBe(false);
    expect(cover.vertices.every(Number.isFinite)).toBe(true);
    expect(scene.description.parts).toEqual([]);
  }
});

it('uses authored ownership for generated metadata without changing surface geometry',()=>{
  const source=emptyScene(),material={name:'Test fabric'} as Material;
  const points=[[0,0,0],[1,0,0],[0,1,0]] as const,triangles:[number,number,number][]=[[0,1,2]];
  const fabric=appendStaticMesh(source,'Configured shared sleeping cover',points,triangles,material);
  const structural=appendStaticMesh(source,'Sculpted head',points,triangles,material);
  expect(fabric.description.parts[0].outline).toBe(false);
  expect(structural.description.parts[0].outline).toBe(true);
  for(const key of ['vertices','cage','indices','stencilRanges','stencilWeights','normalRanges','normalTriangles'] as const)expect(fabric[key]).toEqual(structural[key]);
  expect(()=>appendStaticMesh(source,'Unowned generated surface',points,triangles,material)).toThrow('outline ownership');
});
