import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { outlineDrawRanges } from '../src/render/character/draw-ranges.js';

it('never outlines the unmarked triangles between outlined parts', () => {
  const parts = [
    { start: 0, count: 6, outline: true },
    { start: 6, count: 3, outline: true },
    { start: 9, count: 6, outline: false },
    { start: 15, count: 3, outline: true },
  ];
  const before=JSON.stringify(parts);
  expect(outlineDrawRanges(parts)).toEqual([{ start: 0, count: 9 }, { start: 15, count: 3 }]);
  expect(JSON.stringify(parts)).toBe(before);
  expect(outlineDrawRanges([])).toEqual([]);
});

it('preserves exactly the authored outline triangles of both actual meshes', () => {
  const manifest=JSON.parse(readFileSync(new URL('../../assets/models/sims/appearance-proof/export-v2/manifest.json',import.meta.url),'utf8'));
  for(const mesh of [manifest.original,manifest.runtime]) {
    const expected=new Uint8Array(mesh.indexCount),actual=new Uint8Array(mesh.indexCount);
    for(const part of mesh.parts)if(part.outline)expected.fill(1,part.start,part.start+part.count);
    const ranges=outlineDrawRanges(mesh.parts);
    for(const range of ranges)for(let i=range.start;i<range.start+range.count;i++)actual[i]++;
    expect(actual).toEqual(expected);
    expect(ranges.length).toBeLessThan(mesh.parts.filter((p:{outline:boolean})=>p.outline).length);
  }
});
