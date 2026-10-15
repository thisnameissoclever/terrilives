import { expect, it } from 'vitest';
import { encodeCreateCharacter, encodeEditCharacter, decodeCharacterSnapshot, decodeCharacterResults } from '../src/character/codec.js';
import { floatBits, neutralDraft } from '../src/character/schema.js';

it('pins appended command tags and exact option fields',()=>{
  expect([...encodeEditCharacter(7,3,{version:1,name:'Ann'})]).toEqual([30,1,7,3,1,1,3,65,110,110,0,0,0,0,0,0,0,0]);
  expect([...encodeCreateCharacter(7,neutralDraft('Mira')).slice(0,4)]).toEqual([30,0,7,1]);
});
it('keeps signed sleep timing and exact float bits in snapshots',()=>{
  const draft=neutralDraft('Mira');draft.behavior.chronotype_offset_ticks=-123;draft.behavior.drain[0]=floatBits(.1234567);
  const bytes=Uint8Array.from([1,...encodeCreateCharacter(7,draft).slice(3)]);
  expect(decodeCharacterSnapshot(bytes)).toEqual(draft);
  expect(()=>decodeCharacterSnapshot(bytes.slice(0,-1))).toThrow();
  expect(()=>decodeCharacterSnapshot(Uint8Array.from([...bytes,0]))).toThrow();
  expect(decodeCharacterSnapshot(Uint8Array.of(0))).toBeNull();
});
it('refuses malformed commands before serialization and ambiguous results',()=>{
  const draft=neutralDraft('Mira');draft.appearance.body.height=101;
  expect(()=>encodeCreateCharacter(1,draft)).toThrow();
  expect(()=>encodeEditCharacter(-1,0,{version:1})).toThrow();
  expect(()=>encodeEditCharacter(1,0,{version:1,appearance:undefined})).toThrow();
  expect(decodeCharacterResults(Uint8Array.of(1,7,1,3,0))).toEqual([{request:7,sim:3,reason:null}]);
  expect(()=>decodeCharacterResults(Uint8Array.of(1,7,0,0))).toThrow();
});
