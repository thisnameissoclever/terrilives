import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {CharacterContactOwner,CharacterContactRoster} from '../src/render/character/contact-admission.js';
import {loadPreparedCharacterState} from '../src/render/character/prepared-character-load.js';
import {defaultAppearance} from '../src/character/schema.js';
import {CharacterDraft} from '../src/character/draft.js';
import {AdmissionTestService} from './fixtures/contact-admission-service.js';
import {guardedCharacterStressSource} from '../src/render/character/stress-admission.js';
import init,{SimHandle} from '../src/wasm/terri_wasm.js';
import {SimBridge} from '../src/bridge.js';
import {BuildSession} from '../src/ui/build-session.js';

it('adopts a prepared load through the build session so cancellation keeps the loaded household',async()=>{
  const main=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
  expect(main).toMatch(/loadPreparedCharacterState\(bytes,\s*buildSession,/);
  const service=new AdmissionTestService(),roster=new CharacterContactRoster(service),appearance=defaultAppearance();
  let bytes=new Uint8Array([1]),restored=0;
  const source={saveBytes:()=>bytes.slice(),loadBytes(next:Uint8Array){bytes=next.slice();return true;},clockTick:()=>0,dayTicks:()=>1,flushCommands(){}};
  const build=new BuildSession(source,{prepare:()=>true,settled:()=>true,restored(){restored++;}});
  expect(build.begin()).toBe(true);
  const pending=loadPreparedCharacterState(new Uint8Array([2]),build,()=>({loadBytes:()=>true,
    characterAppearances:()=>[{entity:1,appearance}],flushCommands(){},free(){}}),roster);
  expect(source.saveBytes()).toEqual(new Uint8Array([1]));service.finishAll();expect(await pending).toBe(true);
  expect(build.saveBytes()).toEqual(new Uint8Array([2]));bytes=new Uint8Array([3]);
  expect(build.cancel()).toBe(true);expect(source.saveBytes()).toEqual(new Uint8Array([2]));expect(restored).toBe(1);roster.dispose();
});

it('keeps the live bytes untouched until candidate contacts are prepared and frees a cancelled candidate',async()=>{
  const appearance=defaultAppearance(),before=new Uint8Array([1,2,3]),incoming=new Uint8Array([8,9,10]);
  let saved=before.slice(),freed=0,flushed=0,finish!:()=>void;
  const prepared=new Promise<void>(resolve=>{finish=resolve;});
  const roster={stage(){return {ready:prepared,commit(){},release(){}};}} as unknown as CharacterContactRoster;
  const abort=new AbortController();
  const pending=loadPreparedCharacterState(incoming,{loadBytes(bytes){saved=bytes.slice();return true;}},()=>({
    loadBytes:()=>true,characterAppearances:()=>[{entity:1,appearance}],flushCommands(){flushed++;},free(){freed++;},
  }),roster,abort.signal);
  expect(saved).toEqual(before);expect(flushed).toBe(1);abort.abort();
  await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(saved).toEqual(before);expect(freed).toBe(1);
  finish();
});

it('never adopts an already-ready load superseded before its continuation',async()=>{
  const service=new AdmissionTestService(),roster=new CharacterContactRoster(service),a=defaultAppearance(),b=defaultAppearance('feminine');b.body.height=73;
  const warm=new CharacterContactOwner(service),warming=warm.prepare(a);service.finish(a);await warming;
  const mutations:number[]=[],freed:number[]=[],live={loadBytes(bytes:Uint8Array){mutations.push(bytes[0]);return true;}};
  const candidate=()=>{let id=0;return {loadBytes(bytes:Uint8Array){id=bytes[0];return true;},
    characterAppearances:()=>[{entity:1,appearance:id===1?a:b}],flushCommands(){},free(){freed.push(id);}};};
  const first=loadPreparedCharacterState(new Uint8Array([1]),live,candidate,roster);
  const second=loadPreparedCharacterState(new Uint8Array([2]),live,candidate,roster);service.finish(b);
  await expect(first).rejects.toMatchObject({name:'AbortError'});expect(await second).toBe(true);
  expect(mutations).toEqual([2]);expect(freed.sort()).toEqual([1,2]);roster.dispose();warm.dispose();expect(service.owners.size).toBe(0);
});

it('retains exact live owners and bytes when native adoption rejects ready candidate bytes',async()=>{
  const service=new AdmissionTestService(),roster=new CharacterContactRoster(service),old=defaultAppearance(),next=defaultAppearance('feminine');
  const initial=roster.prepareCurrent([{entity:1,appearance:old}]);service.finish(old);await initial;
  const owners=[...service.owners.keys()],artifact=roster.require(1,old),bytes=new Uint8Array([4,5,6]);let freed=0,attempts=0;
  const pending=loadPreparedCharacterState(new Uint8Array([8,9]),{loadBytes(){attempts++;return false;}},()=>({loadBytes:()=>true,
    characterAppearances:()=>[{entity:2,appearance:next}],flushCommands(){},free(){freed++;}}),roster);
  expect(attempts).toBe(0);service.finish(next);expect(await pending).toBe(false);
  expect(bytes).toEqual(new Uint8Array([4,5,6]));expect([...service.owners.keys()]).toEqual(owners);expect(roster.require(1,old)).toBe(artifact);expect(freed).toBe(1);roster.dispose();
});

it('pins queued outcomes through same-entity key transfer, refusal, removal and re-entry',async()=>{
  const service=new AdmissionTestService(),roster=new CharacterContactRoster(service),a=defaultAppearance(),b=defaultAppearance();b.body.height=80;
  const initial=roster.prepareCurrent([{entity:1,appearance:a},{entity:2,appearance:a}]);service.finish(a);await initial;
  const creator=new CharacterContactOwner(service,roster),preparing=creator.prepare(b);service.finish(b);await preparing;
  expect(creator.queue(b,()=>false)).toBe(false);expect(roster.diagnostics().queued).toBe(0);
  expect(creator.queue(b,()=>true)).toBe(true);creator.dispose();expect(roster.diagnostics().queued).toBe(1);
  roster.afterCommands([{entity:1,appearance:b},{entity:2,appearance:a}]);expect(roster.require(1,b)).toBeDefined();expect(roster.require(2,a)).toBeDefined();expect(roster.diagnostics().queued).toBe(0);
  const colors=structuredClone(b);colors.colors.skin=[1,2,3];roster.afterCommands([{entity:1,appearance:colors}]);expect(service.entries.size).toBe(1);expect(service.requests).toBe(2);
  const reentry=roster.prepareCurrent([{entity:1,appearance:colors},{entity:2,appearance:a}]);expect(service.requests).toBe(3);service.finish(a);await reentry;
  roster.dispose();expect(service.entries.size).toBe(0);expect(service.owners.size).toBe(0);
});

it('keeps a queued native save byte-exact until the actual live command drain',async()=>{
  const wasm=await init({module_or_path:readFileSync('src/wasm/terri_wasm_bg.wasm')}),handle=SimHandle.from_lot_with_seed(42,0),sourceHandle=SimHandle.from_lot(),controlHandle=SimHandle.from_lot();
  const live=new SimBridge(handle,wasm.memory),source=new SimBridge(sourceHandle,wasm.memory),control=new SimBridge(controlHandle,wasm.memory);
  const service=new AdmissionTestService(),roster=new CharacterContactRoster(service);let freed=0;let outcomes:unknown;
  try{
    const initial=roster.prepareCurrent(live.characterAppearances());service.finishAll();await initial;
    const draft=CharacterDraft.create(321,source.characterCatalog(),source.characterAppearances().map(row=>({sim_id:row.sim,name:source.characterSnapshot(row.sim)!.name})));
    draft.set('name','Queued arrival');draft.set('appearance.body.height',81);expect(source.createCharacter(9111,draft.resolve())).toBe(true);
    const queued=source.saveBytes(),before=live.saveBytes();
    const makeCandidate=()=>{const candidate=SimHandle.from_lot(),bridge=new SimBridge(candidate,wasm.memory);
      return {loadBytes:(bytes:Uint8Array)=>bridge.loadBytes(bytes),characterAppearances:()=>bridge.characterAppearances(),flushCommands(){bridge.flushCommands();outcomes=bridge.characterResults();},free(){freed++;candidate.free();}};};
    const abort=new AbortController(),hash=live.worldHash(),cancelled=loadPreparedCharacterState(queued,live,makeCandidate,roster,abort.signal);
    abort.abort();await expect(cancelled).rejects.toMatchObject({name:'AbortError'});expect(live.saveBytes()).toEqual(before);expect(live.worldHash()).toBe(hash);expect(freed).toBe(1);
    const pending=loadPreparedCharacterState(queued,live,makeCandidate,roster);
    expect(live.saveBytes()).toEqual(before);service.finishAll();expect(await pending).toBe(true);
    expect(live.saveBytes()).toEqual(queued);expect(roster.diagnostics().queued,JSON.stringify(outcomes)).toBe(1);expect(freed).toBe(2);
    expect(control.loadBytes(queued)).toBe(true);control.flushCommands();live.flushCommands();roster.afterCommands(live.characterAppearances());
    expect(live.saveBytes()).toEqual(control.saveBytes());expect(live.worldHash()).toBe(control.worldHash());expect(roster.diagnostics().queued).toBe(0);
  }finally{roster.dispose();handle.free();sourceHandle.free();controlHandle.free();}
});

it('guards only the stress facade and rejects raw mutation before touching native state',()=>{
  let mutations=0;const source={value:7,loadBytes(){mutations++;return true;},createCharacter(){mutations++;return true;},editCharacter(){mutations++;return true;},read(){return this.value;}};
  const facade=guardedCharacterStressSource(source);
  for(const method of ['loadBytes','createCharacter','editCharacter'] as const)expect(()=>facade[method]()).toThrow('Use await __terriStress.characters.');
  expect(mutations).toBe(0);expect(facade.read()).toBe(7);expect(source.loadBytes()).toBe(true);expect(mutations).toBe(1);
});
