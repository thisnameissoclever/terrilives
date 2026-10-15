import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {makeBikeContactInput,verifyBikeContactInput,validateBikeContactInput,validateBikeContactArtifact,validateBikeContactRequest,validateBikeContactResponse,freezeBikeContactArtifact} from '../src/render/character/bike-contact-protocol.js';
import {testInput,testArtifact} from './bike-contact-service-fixture.js';

const input=await testInput(defaultAppearance());
it('binds signed zero and declared source revisions into the input key',async()=>{
  const {key:_,...base}=structuredClone(input),negative=structuredClone(base);negative.hip=[-0,negative.hip[1],negative.hip[2]];base.hip=[0,base.hip[1],base.hip[2]];
  const left=await makeBikeContactInput(base),right=await makeBikeContactInput(negative);expect(left.key).not.toBe(right.key);
  await verifyBikeContactInput(right);expect(Object.is(structuredClone(right).hip[0],-0)).toBe(true);
  const wrong=structuredClone(right);wrong.revisions.fixture='changed';await expect(verifyBikeContactInput(wrong)).rejects.toThrow('does not match');
});
it.each([
  ['hip hole',(value:any)=>{value.hip=new Array(3);}],
  ['matrix hole',(value:any)=>{value.soles[0].source=new Array(16);}],
  ['point hole',(value:any)=>{value.hipSurface.points=new Array(1);}],
  ['point vector hole',(value:any)=>{value.saddle.points[0]=[0,,0];}],
  ['triangle hole',(value:any)=>{value.saddle.triangles=new Array(1);}],
  ['thigh hole',(value:any)=>{value.thighOffsets=new Array(2);}],
  ['missing dimensions',(value:any)=>{delete value.dimensions;}],
  ['missing radius',(value:any)=>{delete value.dimensions.radius;}],
  ['missing source phase',(value:any)=>{delete value.sourcePhase;}],
  ['noncanonical phase',(value:any)=>{value.sourcePhase=.25;}],
  ['nonfinite point',(value:any)=>{value.hipSurface.points[0][0]=Infinity;}],
  ['bad index',(value:any)=>{value.saddle.triangles[0][0]=999;}],
  ['bad version',(value:any)=>{value.version=2;}],
] as const)('rejects malformed contact input: %s',(_name,mutate)=>{const value=structuredClone(input);mutate(value);expect(()=>validateBikeContactInput(value)).toThrow();});
it.each([
  ['cycle hole',(value:any)=>{value.fit.hipCycle=new Array(64);}],
  ['cycle vector hole',(value:any)=>{value.fit.hipCycle=Array.from({length:64},()=>[0,0,0]);value.fit.hipCycle[3]=new Array(3);}],
  ['foot hole',(value:any)=>{value.fit.feet=new Array(2);}],
  ['missing hip',(value:any)=>{delete value.fit.hip;}],
  ['missing orientation',(value:any)=>{delete value.fit.feet[0].rotation;}],
  ['missing key',(value:any)=>{delete value.key;}],
  ['noncanonical phase',(value:any)=>{value.sourcePhase=1;}],
] as const)('rejects malformed contact artifact: %s',(_name,mutate)=>{const value=testArtifact(input);mutate(value);expect(()=>validateBikeContactArtifact(value)).toThrow();});
it('validates request/response identity and freezes complete admitted results',()=>{
  expect(()=>validateBikeContactRequest({version:1,id:0,input})).toThrow();expect(()=>validateBikeContactRequest({version:1,id:1})).toThrow();
  expect(()=>validateBikeContactResponse({version:1,id:1,ok:true})).toThrow();expect(()=>validateBikeContactResponse({version:1,id:1,ok:false})).toThrow();
  const artifact=freezeBikeContactArtifact(testArtifact(input));expect(Object.isFrozen(artifact)).toBe(true);expect(Object.isFrozen(artifact.fit.feet[0].rotation)).toBe(true);
  expect(Reflect.set(artifact.fit.hip,'0',999)).toBe(false);
});
