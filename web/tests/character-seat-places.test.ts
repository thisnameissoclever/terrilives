import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import init,{SimHandle} from '../src/wasm/terri_wasm.js';
import {SimBridge} from '../src/bridge.js';
import {CharacterScenePlan} from '../src/render/character/scene-plan.js';
import {InteractionSelection} from '../src/render/interaction-sprites.js';

it('keeps stable sofa places aligned with authored cushions in all four facings without editing saves',async()=>{
  const wasm=await init({module_or_path:readFileSync('src/wasm/terri_wasm_bg.wasm')}),handle=SimHandle.from_lot();
  const sim=new SimBridge(handle,wasm.memory);
  try{
    const person=sim.characterAppearances().find(row=>row.sim===1)!;
    const fixture=Array.from(sim.ids()).find(id=>sim.objectModel(id)?.id==='long_sofa')!;
    expect(sim.useObjectFirst(person.entity,fixture,1)).toBe(true);sim.flushCommands();
    let personRow=-1;
    for(let tick=0;tick<500;tick++){
      sim.tick();personRow=Array.from(sim.ids()).indexOf(person.entity);
      if(sim.seatedFurniture()[personRow]===fixture&&sim.visualActions()[personRow]===8)break;
    }
    expect(sim.seatedFurniture()[personRow]).toBe(fixture);
    const saved=sim.saveBytes(),source=Object.create(sim) as SimBridge;
    for(let facing=0;facing<4;facing++)for(let ordinal=0;ordinal<3;ordinal++){
      source.objectFacing=entity=>entity===fixture?facing:sim.objectFacing(entity);
      source.seatedPlaces=()=>{const values=sim.seatedPlaces().slice();values[personRow]=ordinal;return values;};
      const plan=new CharacterScenePlan(()=>4),interactions=new InteractionSelection({},()=> 'green');
      plan.sync(source);interactions.updateSource(source,sim.clockTick(),false);plan.update(source,interactions,1,sim.clockTick(),false);
      const actor=plan.actors.find(actor=>actor.entity===person.entity)!;
      expect(actor.action.clip).toBe('seat_sofa_sit');
      expect(actor.offset).toEqual([0,(1-ordinal)*.52,0]);
      const projectedX=-Math.sin(actor.angle)*actor.offset[1],projectedY=-Math.cos(actor.angle)*actor.offset[1];
      const expected=[[-1,0],[0,-1],[1,0],[0,1]][facing];
      expect(projectedX).toBeCloseTo(expected[0]*(1-ordinal)*.52,8);
      expect(projectedY).toBeCloseTo(expected[1]*(1-ordinal)*.52,8);
    }
    expect(sim.saveBytes()).toEqual(saved);
  }finally{handle.free();}
});
