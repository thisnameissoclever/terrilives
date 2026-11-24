import { expect, it } from 'vitest';
import { buildArchitectureWallGeometry } from '../src/render/architecture-geometry.js';
import { buildEdgeWallGeometry } from '../src/render/edge-walls.js';
import { rearWallLines } from '../src/render/rear-wall-lines.js';
import { wallFaces } from '../src/ui/wall-pick.js';

it('rejects the known implicit-shell result and renders only saved current walls', () => {
  const source = { width: 6, height: 5, house: [4, 3] as const, edges: new Uint32Array(), windows: [], catalogue: [], cutaway: false };
  expect(buildArchitectureWallGeometry(source).length).toBeGreaterThan(0);
  expect(buildArchitectureWallGeometry({ ...source, explicit: true })).toEqual([]);
  expect(buildEdgeWallGeometry(6,5,new Uint32Array(),[],[4,3],true,[],false,[],[0,0],true)).toEqual([]);
});
it('wall picking cannot select a deleted original shell', () => {
  expect(wallFaces({ width: 6, height: 5, house: [4,3], houseOrigin: [0,0], edges: [], windowLines: [], hinged: [], horizontalHinged: [], low: false, raised: new Set(), explicit: true })).toEqual([]);
});
it('rear presentation follows current saved boundaries after relocation', () => {
  expect([...rearWallLines([0,4,2,0,0,6,2,0,1,4,3,0,1,4,5,0])].sort()).toEqual(['0/4/2','1/4/3']);
  expect([...rearWallLines([0,8,5,0,0,10,5,0,1,8,6,0,1,8,8,0])].sort()).toEqual(['0/8/5','1/8/6']);
});
