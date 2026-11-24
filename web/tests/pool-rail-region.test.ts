import {expect,it} from 'vitest';
import {derivePoolRailRegion} from '../src/render/character/pool-rail-region.js';
import {poolFixture} from './pool-observer-fixture.js';

it('binds the authored handle interval to actual immutable mesh triangles and inner edges',()=>{
  const region=derivePoolRailRegion(poolFixture,'Pool ladder rail 1',[1,5],1);
  expect(region.triangles).toHaveLength(1344);expect(region.triangles[0]).toBe(360);expect(region.triangles.at(-1)).toBe(1703);
  expect(region.edges).toHaveLength(48);expect(region.edges[0].fromParameter).toBe(1);expect(region.edges.at(-1)!.toParameter).toBe(5);
  const solid=poolFixture.solids.find(s=>s.id===region.surface)!;
  for(const edge of region.edges){
    expect(solid.triangles.some(t=>t.includes(edge.from)&&t.includes(edge.to))).toBe(true);
    expect(solid.vertices[edge.from][0]).toBe(solid.bounds[1][0]);
  }
});
it('rejects stale handle geometry and broken evaluated tube topology',()=>{
  const stale=structuredClone(poolFixture),point=stale.rails[0].points[2].point;stale.rails[0].points[2].point=[point[0],point[1],point[2]+.001];
  expect(()=>derivePoolRailRegion(stale,'Pool ladder rail 1',[1,5],1)).toThrow();
  const broken=structuredClone(poolFixture);broken.solids.find(s=>s.id==='Pool ladder rail 1')!.triangles[360][0]=0;
  expect(()=>derivePoolRailRegion(broken,'Pool ladder rail 1',[1,5],1)).toThrow();
});
