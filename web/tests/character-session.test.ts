import {expect,it} from 'vitest';
import {creationInstinctBands} from './helpers/creation-instinct-bands.js';
import {CreatorSession,type CreatorSource} from '../src/ui/character-creator/session.js';
import {neutralDraft} from '../src/character/schema.js';
import type {CharacterResult} from '../src/character/codec.js';
import {CharacterContactOwner} from '../src/render/character/contact-admission.js';
import {AdmissionTestService} from './fixtures/contact-admission-service.js';
function fixture(){
  const saved=neutralDraft('Original'),results:CharacterResult[]=[],requests:number[]=[],selected:number[]=[];
  const source:CreatorSource={characterCatalog:()=>({version:2,self_preservation_bands:creationInstinctBands,name_limit:24,max_traits:4,max_household:6,traits:[],affinities:[],skills:[],hobbies:[],activities:[],personalities:[]}),
    characterSnapshot:()=>structuredClone(saved),characterResults:()=>results.splice(0),characterAppearances:()=>[{entity:99,sim:7,appearance:saved.appearance}],householdSize:()=>[1,6],
    createCharacter:request=>{requests.push(request);return true;},editCharacter:request=>{requests.push(request);return true;}};
  return {source,saved,results,requests,selected,session:new CreatorSession(source,123,[],7,entity=>selected.push(entity))};
}
it('preloads exactly and stages one command despite repeated submission',()=>{
  const f=fixture();expect(f.session.draft.resolve()).toEqual(f.saved);
  f.session.draft.set('name','Changed');expect(f.session.submit()).toBe(true);expect(f.session.submit()).toBe(false);expect(f.requests).toHaveLength(1);
  f.results.push({request:f.requests[0],sim:7,reason:null});f.session.afterCommands();expect(f.selected).toEqual([99]);expect(f.session.pending).toBe(false);
});
it('ignores unrelated results and retains the complete draft after refusal',()=>{
  const f=fixture();f.session.draft.set('name','Changed');f.session.submit();
  f.results.push({request:f.requests[0]+1,sim:7,reason:null});f.session.afterCommands();expect(f.session.pending).toBe(true);
  f.results.push({request:f.requests[0],sim:null,reason:10});f.session.afterCommands();
  expect(f.session.draft.resolve().name).toBe('Changed');expect(f.session.error).toContain('relationship');expect(f.selected).toEqual([]);
});

it('never submits when preparation finishes after A-B-A edits or cancellation',async()=>{
  const f=fixture(),service=new AdmissionTestService(),owner=new CharacterContactOwner(service);
  const session=new CreatorSession(f.source,123,[],7,entity=>f.selected.push(entity),owner),random=session.draft.randomState;
  const a=session.draft.value.appearance,first=session.prepareAppearance(a);void first.catch(()=>{});
  session.draft.set('appearance.body.height',80);const b=session.draft.value.appearance,second=session.prepareAppearance(b);void second.catch(()=>{});
  session.draft.set('appearance.body.height',a.body.height);const latest=session.prepareAppearance(session.draft.value.appearance);
  expect(session.submit()).toBe(false);expect(f.requests).toEqual([]);service.finish(a);await latest;
  await expect(first).rejects.toMatchObject({name:'AbortError'});await expect(second).rejects.toMatchObject({name:'AbortError'});
  expect(f.requests).toEqual([]);expect(session.draft.randomState).toBe(random);
  session.destroy();expect(session.submit()).toBe(false);expect(f.requests).toEqual([]);expect(service.owners.size).toBe(0);
});

it('retains ready contacts through non-contact edits and keeps refused native changes private',async()=>{
  const f=fixture(),service=new AdmissionTestService(),owner=new CharacterContactOwner(service);
  const session=new CreatorSession(f.source,123,[],7,entity=>f.selected.push(entity),owner),ready=session.prepareAppearance(session.draft.value.appearance);
  service.finishAll();await ready;const requests=service.requests;
  session.draft.set('name','Changed');session.draft.set('behavior.shyness',75);session.draft.set('appearance.colors.skin',[1,2,3]);
  await session.prepareAppearance(session.draft.value.appearance);expect(service.requests).toBe(requests);
  expect(session.submit()).toBe(true);f.results.push({request:f.requests[0],sim:null,reason:10});session.afterCommands();
  expect(session.draft.value.name).toBe('Changed');expect(f.selected).toEqual([]);expect(session.error).toContain('relationship');
  expect(f.saved.name).toBe('Original');session.destroy();expect(service.owners.size).toBe(0);
});
