import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import init,{SimHandle} from '../src/wasm/terri_wasm.js';
import {SimBridge} from '../src/bridge.js';
import {CharacterScenePlan} from '../src/render/character/scene-plan.js';
import {InteractionSelection} from '../src/render/interaction-sprites.js';

it('renders actual shower use from its validated native fixture and clears it afterward',async()=>{
 const wasm=await init({module_or_path:readFileSync('src/wasm/terri_wasm_bg.wasm')}),handle=SimHandle.from_lot(),sim=new SimBridge(handle,wasm.memory);
 try{
  const person=sim.characterAppearances().find(row=>row.sim===1)!,fixture=Array.from(sim.ids()).find(id=>sim.objectModel(id)?.id==='shower')!;
  expect(sim.useObject(person.entity,fixture,sim.defaultInteraction(fixture))).toBe(true);sim.flushCommands();
  let found=false;
  for(let tick=0;tick<200;tick++){sim.tick();const row=Array.from(sim.ids()).indexOf(person.entity);if(sim.activities()[row]===12){found=true;break;}}
  expect(found).toBe(true);
  const plan=new CharacterScenePlan(()=>4),interactions=new InteractionSelection({},()=> 'green');
  const project=()=>{plan.sync(sim);interactions.updateSource(sim,sim.clockTick(),false);plan.update(sim,interactions,1,sim.clockTick(),false);return plan.actors.find(actor=>actor.sim===1)!;};
  const actor=project();expect(actor.action.clip).toBe('shower');expect(actor.fixtureEntity).toBe(fixture);expect(actor.includeFixture).toBe(true);
  const personRow=Array.from(sim.ids()).indexOf(person.entity);expect(sim.visualActions()[personRow]).toBe(0);
  for(let tick=0;tick<100;tick++){sim.tick();if(sim.activities()[Array.from(sim.ids()).indexOf(person.entity)]!==12)break;}
  expect(project().action.clip).not.toBe('shower');
 }finally{handle.free();}
});
