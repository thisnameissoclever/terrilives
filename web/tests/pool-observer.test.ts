import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {observePool,poolPointClearance,poolTriangleCrossing} from '../src/render/character/pool-observer.js';
import {validatePoolFixture} from '../src/render/character/pool-contact-protocol.js';
import type {PoolFixtureV1,PoolSupport,PoolLimb} from '../src/render/character/pool-contact-types.js';
import type {Geometry} from '../src/render/character/bundle.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {add,identity,scale,transform,type Vec3} from '../src/render/character/math.js';
import {triangleDistance,type Triangle} from '../src/render/character/pool-solid.js';

const fixture=JSON.parse(readFileSync(new URL('../../assets/models/sims/character-creator/clips/pool/contacts-v1.json',import.meta.url),'utf8')) as PoolFixtureV1;

it('measures an interior rail-patch gap even when all hand vertices are far away',()=>{
  const hand:Triangle=[[-2,-2,.01],[2,-2,.01],[0,2,.01]],rail:Triangle=[[-.01,0,0],[.01,0,0],[0,.01,0]];
  expect(triangleDistance(hand,rail)).toBeCloseTo(.01,12);
  expect(triangleDistance(rail,hand)).toBeCloseTo(.01,12);
});

it('keeps fixture acceleration tied to the actual current geometry source',()=>{
  const current=structuredClone(fixture),solid=current.solids.find(s=>s.id==='Pool outside ladder tread 3')!;current.solids=[solid];
  const centre=solid.bounds[0].map((value,axis)=>(value+solid.bounds[1][axis])/2) as [number,number,number];centre[0]+=10;
  const surface=patch([centre,centre,centre],'probe');observePool(current,[surface]);
  solid.vertices=solid.vertices.map((v):Vec3=>[v[0]+10,v[1],v[2]]);solid.bounds=solid.bounds.map((v):Vec3=>[v[0]+10,v[1],v[2]]) as [Vec3,Vec3];
  const cached=observePool(current,[surface]),fresh=observePool(structuredClone(current),[surface]);
  const actual=fresh.violations.find(v=>v.surface===solid.id);expect(actual).toBeDefined();expect(actual!.signedClearance).toBeLessThan(0);
  expect(cached.violations).toEqual(fresh.violations);
});

it('separates the evaluated liner, beveled coping, floor and visibility-only water',()=>{
  expect(()=>validatePoolFixture(fixture)).not.toThrow();
  expect(poolPointClearance(fixture,[0,.855,.78]).signedClearance).toBeGreaterThan(0);
  expect(poolPointClearance(fixture,[0,.861,.78]).signedClearance).toBeLessThan(0);
  expect(poolPointClearance(fixture,[0,.855,.88]).signedClearance).toBeLessThan(0);
  const floor=poolPointClearance(fixture,[.17192471027374268,.6190026998519897,.05877458304166794]);
  expect(floor.surface).toBe('Pool basin floor');expect(floor.signedClearance).toBeCloseTo(-.001225416,7);
  expect(fixture.solids.some(s=>s.id==='Pool water surface')).toBe(false);
});

it('rejects a triangle passing through the coping while all three vertices are legal',()=>{
  const triangle:Triangle=[[0,.84,.84],[0,1.1,1.1],[.4,1.1,1.1]];
  for(const p of triangle)expect(poolPointClearance(fixture,p).signedClearance).toBeGreaterThan(0);
  const witness=poolTriangleCrossing(fixture,triangle);
  expect(witness).not.toBeNull();expect(witness!.signedClearance).toBeLessThan(0);
});

function patch(triangle:Triangle,bone:string):{geometry:Geometry;points:Float32Array<ArrayBuffer>}{
  const vertices=new Float32Array(48);triangle.forEach((p,i)=>{vertices.set(p,i*16);vertices[i*16+10]=1;});
  return {points:Float32Array.from(triangle.flat()),geometry:{vertices,indices:Uint32Array.from([0,1,2]),
    manifest:{bones:[{name:bone}]},description:{vertexCount:3,parts:[{name:bone,start:0,count:3,region:bone.startsWith('hand')?4:6}]}}} as unknown as {geometry:Geometry;points:Float32Array<ArrayBuffer>};
}
const free=():PoolSupport=>({mode:'free',surface:null,interval:null,region:null});
const supports=(limb:PoolLimb,support:PoolSupport):Record<PoolLimb,PoolSupport>=>({...Object.fromEntries(['handL','handR','footL','footR'].map(name=>[name,free()])),[limb]:support}) as Record<PoolLimb,PoolSupport>;

it('measures finite sole overlap on actual top faces and rejects a shifted tread',()=>{
  const solid=fixture.solids.find(s=>s.id==='Pool outside ladder tread 1')!,z=solid.bounds[1][2];
  const region=fixture.clips.pool_enter.samples.flatMap(s=>Object.values(s.limbs)).find(s=>s.surface===solid.id&&s.region?.kind==='top-face')!.region!;
  const feet=patch([[-.64,1.01,z],[-.64,1.06,z],[-.54,1.01,z]],'foot.L');
  const contact=supports('footL',{mode:'support',surface:solid.id,interval:[.1,.2],region});
  const before=observePool(fixture,[feet],contact).contacts.find(c=>c.limb==='footL')!;
  expect(before.projectedOverlap).toBeGreaterThan(0);expect(before.minimumObservedGap).toBeCloseTo(0,7);
  const moved=structuredClone(fixture),tread=moved.solids.find(s=>s.id===solid.id)!;
  tread.vertices=tread.vertices.map((v):Vec3=>[v[0],v[1]+.3,v[2]]);tread.bounds=tread.bounds.map((v):Vec3=>[v[0],v[1]+.3,v[2]]) as [Vec3,Vec3];
  const after=observePool(moved,[feet],contact).contacts.find(c=>c.limb==='footL')!;
  expect(after.projectedOverlap).toBe(0);expect(after.minimumObservedGap).toBeNull();
});

it('measures the actual hand patch against rail geometry and rejects a displaced rail',()=>{
  const rail=fixture.solids.find(s=>s.id==='Pool ladder rail 1')!;
  const face=rail.triangles.find(ids=>ids.every(i=>rail.vertices[i][2]>1.1)&&ids.reduce((sum,i)=>sum+rail.vertices[i][0],0)/3>-.67)!;
  expect(face).toBeDefined();const hand=patch(face.map(i=>rail.vertices[i]) as unknown as Triangle,'hand.L');
  const contact=supports('handL',{mode:'support',surface:rail.id,interval:[.1,.48],region:{kind:'rail',parameter:[1,5]}});
  expect(observePool(fixture,[hand],contact).contacts.find(c=>c.limb==='handL')!.minimumObservedGap).toBeCloseTo(0,7);
  const moved=structuredClone(fixture),solid=moved.solids.find(s=>s.id===rail.id)!;
  solid.vertices=solid.vertices.map((v):Vec3=>[v[0]-.2,v[1],v[2]]);solid.bounds=solid.bounds.map((v):Vec3=>[v[0]-.2,v[1],v[2]]) as [Vec3,Vec3];
  expect(observePool(moved,[hand],contact).contacts.find(c=>c.limb==='handL')!.minimumObservedGap).toBeGreaterThan(.1);
});

it('rejects the opposite deformation order with an independently calculable floor witness',()=>{
  const cage=new Float32Array(32);cage.set([-.3,0,.1],0);cage[10]=1;cage.set([.3,0,.1],16);cage[22]=1;cage[26]=1;
  const weights=new ArrayBuffer(16),ids=new Uint32Array(weights),values=new Float32Array(weights);ids[0]=0;ids[2]=1;values[1]=values[3]=.5;
  const geometry={cage,description:{vertexCount:1},stencilRanges:Uint32Array.from([0,2,0,0]),stencilWeights:weights} as unknown as Geometry;
  const turn=[0,0,-1,0,0,1,0,0,1,0,0,0,0,0,0,1],matrices=Float32Array.from([...turn,...identity()]);
  const correct=posedCageSurface(geometry,cage,matrices);expect(correct[2]).toBeCloseTo(.2,7);
  const restAverage:Vec3=[0,0,.1],wrong=scale(add(transform(turn,restAverage),restAverage),.5);
  expect(poolPointClearance(fixture,[correct[0],correct[1],correct[2]]).signedClearance).toBeGreaterThan(0);
  expect(poolPointClearance(fixture,wrong).signedClearance).toBeLessThan(0);
});

it('preserves signed clearance in all four registrations and rejects an unmatched fixture basis',()=>{
  const turn=(p:Vec3,quarter:number):Vec3=>quarter===0?p:quarter===1?[-p[1],p[0],p[2]]:quarter===2?[-p[0],-p[1],p[2]]:[p[1],-p[0],p[2]];
  const bounds=(points:Vec3[]):[Vec3,Vec3]=>[[0,1,2].map(axis=>Math.min(...points.map(p=>p[axis]))) as unknown as Vec3,[0,1,2].map(axis=>Math.max(...points.map(p=>p[axis]))) as unknown as Vec3];
  const witness:Vec3=[-.5,1.035,.19],original=poolPointClearance(fixture,witness);
  expect(original.signedClearance).toBeLessThan(0);
  for(let quarter=0;quarter<4;quarter++){
    const rotated=structuredClone(fixture);
    for(const solid of rotated.solids){solid.vertices=solid.vertices.map(p=>turn(p,quarter));solid.bounds=bounds(solid.vertices);}
    const [low,high]=fixture.ground.bounds;
    rotated.ground.bounds=bounds([low,high,[low[0],high[1],0],[high[0],low[1],0]].map(p=>turn(p as Vec3,quarter)));
    const actual=poolPointClearance(rotated,turn(witness,quarter));
    expect(actual.surface).toBe(original.surface);expect(actual.signedClearance).toBeCloseTo(original.signedClearance,12);
    if(quarter)expect(poolPointClearance(rotated,witness).signedClearance).toBeGreaterThan(0);
  }
  expect(poolPointClearance(fixture,[-.5,1.5,-.001]).surface).toBe('ground:approach');
  expect(poolPointClearance(fixture,[-.5,1.5,-.001]).signedClearance).toBeCloseTo(-.001,12);
});
