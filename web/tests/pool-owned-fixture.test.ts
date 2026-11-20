import {readFileSync} from 'node:fs';
import {expect,it,vi} from 'vitest';
import fixtureImport from '../../assets/models/sims/character-creator/clips/pool/contacts-v2.json';
import productionFixture from '../../assets/models/sims/character-creator/clips/pool/contacts-v3.json';
import * as identity from '../src/render/character/pool-contact-identity.js';
import * as protocol from '../src/render/character/pool-contact-protocol.js';
import * as owned from '../src/render/character/pool-owned-fixture.js';
import {poolContactFixture,poolContactSourceRevisions} from '../src/render/character/pool-contact-preparation.js';
import {sleepContactDigest} from '../src/render/character/sleep-contact-protocol.js';
import {observePool,poolPointClearance,requirePoolObservedSurface} from '../src/render/character/pool-observer.js';
import type {PoolFixtureV1} from '../src/render/character/pool-contact-types.js';
import type {Geometry} from '../src/render/character/bundle.js';
import type {Vec3} from '../src/render/character/math.js';

const text=readFileSync(new URL('../../assets/models/sims/character-creator/clips/pool/contacts-v2.json',import.meta.url),'utf8');
const raw=()=>JSON.parse(text) as PoolFixtureV1;
const originalKey=(fixture:PoolFixtureV1)=>identity.canonicalPoolValue({ground:fixture.ground,solids:fixture.solids,revisions:fixture.revisions});
function assertGraph(actual:unknown,expected:unknown):void {
 if(expected===null||typeof expected!=='object'){expect(Object.is(actual,expected)).toBe(true);return;}
 expect(actual).not.toBe(expected);expect(Object.isFrozen(actual)).toBe(true);
 expect(Object.getPrototypeOf(actual)).toBe(Array.isArray(expected)?Array.prototype:Object.prototype);
 expect(Object.keys(actual as object)).toEqual(Object.keys(expected));
 for(const key of Object.keys(expected)){
  const descriptor=Object.getOwnPropertyDescriptor(actual,key)!;expect('value' in descriptor).toBe(true);expect(descriptor.get).toBeUndefined();expect(descriptor.set).toBeUndefined();
  assertGraph(Reflect.get(actual as object,key),Reflect.get(expected,key));
 }
}
function probe(){
 const points=new Float32Array([4,4,2,4.1,4,2,4,4.1,2]);
 const geometry={indices:new Uint32Array([0,1,2]),description:{vertexCount:3,parts:[{name:'probe',start:0,count:3}]}} as unknown as Geometry;
 return {geometry,points};
}

it('preserves every parsed value and property order, including coverage and signed zero',()=>{
 const extended=text.trimEnd().slice(0,-1)+',"signedZero":-0,"ordered":{"z":1,"a":2}}';
 const parsed=owned.parseOwnedPoolFixture(extended),expected=JSON.parse(extended);
 assertGraph(parsed,expected);expect(Reflect.get(parsed,'coverage')).toEqual(Reflect.get(fixtureImport,'coverage'));
 expect(Object.is(Reflect.get(parsed,'signedZero'),-0)).toBe(true);
 expect(owned.poolPhysicalFixtureKey(parsed)).toBe(originalKey(parsed));
});

it('freezes owned descendants even if validation has already frozen the root',()=>{
 const validate:typeof protocol.validatePoolFixture=protocol.validatePoolFixture;
 const spy=vi.spyOn(protocol,'validatePoolFixture').mockImplementation((value:unknown):asserts value is PoolFixtureV1=>{validate(value);Object.freeze(value);});
 try{const parsed=owned.parseOwnedPoolFixture(text);expect(spy).toHaveBeenCalledOnce();assertGraph(parsed,raw());}
 finally{spy.mockRestore();}
});

it('caches the exact physical key only after owned JSON construction',()=>{
 const parsed=owned.parseOwnedPoolFixture(text),expected=originalKey(parsed),spy=vi.spyOn(identity,'canonicalPoolValue');
 try{
  expect(owned.poolPhysicalFixtureKey(parsed)).toBe(expected);expect(owned.poolPhysicalFixtureKey(parsed)).toBe(expected);
  expect(spy).not.toHaveBeenCalled();
 }finally{spy.mockRestore();}
});

it('keeps mutable, shallow-frozen and equal-valued copied fixtures dynamic',()=>{
 for(const fixture of [raw(),Object.freeze(raw()),structuredClone(owned.parseOwnedPoolFixture(text))]){
  const before=owned.poolPhysicalFixtureKey(fixture),vertex=fixture.solids[0].vertices[0];expect(Reflect.set(vertex,0,vertex[0]+.125)).toBe(true);
  expect(owned.poolPhysicalFixtureKey(fixture)).toBe(originalKey(fixture));expect(owned.poolPhysicalFixtureKey(fixture)).not.toBe(before);
 }
});

it('detaches the owned graph and exposes no caller registration or skip authority',()=>{
 const input=raw(),parsed=owned.parseOwnedPoolFixture(JSON.stringify(input)),before=owned.poolPhysicalFixtureKey(parsed);
 const vertex=input.solids[0].vertices[0];expect(Reflect.set(vertex,0,vertex[0]+10)).toBe(true);
 expect(owned.poolPhysicalFixtureKey(parsed)).toBe(before);expect(Reflect.set(parsed.solids[0].vertices[0],0,42)).toBe(false);
 expect(Object.keys(owned).sort()).toEqual(['parseOwnedPoolFixture','poolPhysicalFixtureKey']);
});

it('refuses object, accessor and typed-array constructor arguments before coercion',()=>{
 let calls=0;const accessor={get solids(){calls++;return [];},[Symbol.toPrimitive](){calls++;return text;}};
 for(const value of [raw(),accessor,new Uint8Array([1,2]),new ArrayBuffer(4),new String(text)])expect(()=>Reflect.apply(owned.parseOwnedPoolFixture,undefined,[value])).toThrow('JSON text');
 expect(calls).toBe(0);
});

it('requires the existing full fixture validation before returning an owned graph',()=>{
 expect(()=>owned.parseOwnedPoolFixture('{')).toThrow();
 expect(()=>owned.parseOwnedPoolFixture('{"version":1}')).toThrow('Invalid evaluated pool fixture');
 const invalid=raw();invalid.solids[0].triangles[0][0]=invalid.solids[0].vertices.length;
 expect(()=>owned.parseOwnedPoolFixture(JSON.stringify(invalid))).toThrow('invalid vertex');
});

it('never caches raw graphs with accessors, typed arrays or forged ownership markers',()=>{
 const fixture=raw(),vertices=fixture.solids[0].vertices,typed=new Float32Array(vertices[0]);
 Reflect.set(vertices,0,typed);Reflect.set(fixture,'owned',true);Object.freeze(fixture);
 const before=owned.poolPhysicalFixtureKey(fixture);typed[0]+=.5;expect(owned.poolPhysicalFixtureKey(fixture)).not.toBe(before);
 const getter=raw();let solids=getter.solids;Object.defineProperty(getter,'solids',{get:()=>solids});Object.freeze(getter);
 const key=owned.poolPhysicalFixtureKey(getter);solids=structuredClone(solids);expect(Reflect.set(solids[0].vertices[0],0,solids[0].vertices[0][0]+.5)).toBe(true);
 expect(owned.poolPhysicalFixtureKey(getter)).not.toBe(key);
});

it('preserves distinct fixture owners even when owned physical values are equal',()=>{
 const left=owned.parseOwnedPoolFixture(text),right=owned.parseOwnedPoolFixture(text),surface=probe(),observation=observePool(left,[surface]);
 expect(owned.poolPhysicalFixtureKey(left)).toBe(owned.poolPhysicalFixtureKey(right));
 expect(()=>requirePoolObservedSurface(left,observation,surface)).not.toThrow();
 expect(()=>requirePoolObservedSurface(right,observation,surface)).toThrow('actual observed');
});

it('keeps warm raw indices current after vertices, bounds and triangle order change',()=>{
 const fixture=Object.freeze(raw()),solid=fixture.solids.find(s=>s.id==='Pool outside ladder tread 1')!,point:Vec3=[-.5,.955,.2375];
 poolPointClearance(fixture,point);
 for(const vertex of solid.vertices)expect(Reflect.set(vertex,1,vertex[1]+10)).toBe(true);
 for(const bound of solid.bounds)expect(Reflect.set(bound,1,bound[1]+10)).toBe(true);
 expect(poolPointClearance(fixture,point)).toEqual(poolPointClearance(structuredClone(fixture),point));
 solid.triangles.reverse();const moved:Vec3=[point[0],point[1]+10,point[2]];
 expect(poolPointClearance(fixture,moved)).toEqual(poolPointClearance(structuredClone(fixture),moved));
});

it('rejects a raw fixture restored after its observation',()=>{
 const fixture=raw(),surface=probe(),solid=fixture.solids[0],saved=structuredClone(solid),move=(point:Vec3):Vec3=>[point[0]+10,point[1],point[2]];
 solid.vertices=solid.vertices.map(move);solid.bounds=[move(solid.bounds[0]),move(solid.bounds[1])];
 const observation=observePool(fixture,[surface]);Object.assign(solid,saved);
 expect(()=>requirePoolObservedSurface(fixture,observation,surface)).toThrow('actual acceleration source');
});

it('keeps production parsed values and exact revision hashing unchanged',async()=>{
 const fixture=poolContactFixture();assertGraph(fixture,productionFixture);
 expect(poolContactFixture()).toBe(fixture);
 expect((await poolContactSourceRevisions()).fixture).toBe(await sleepContactDigest(productionFixture));
});

it('retains the v2 fixture geometry and source timing under the v3 motion revision',()=>{
 const previous=raw(),active=poolContactFixture();
 expect(active.revisions.poseProducer).not.toBe(previous.revisions.poseProducer);
 expect({...active,revisions:{...active.revisions,poseProducer:previous.revisions.poseProducer}}).toEqual(previous);
});
