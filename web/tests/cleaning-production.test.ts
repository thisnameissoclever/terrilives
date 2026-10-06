import {beforeAll, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import init, {SimHandle} from '../src/wasm/terri_wasm.js';
import {SimBridge} from '../src/bridge.js';
import {buildInstances, instanceCount, cleaningBinSprite, simBodySprite} from '../src/frame.js';
import {FLOATS_PER_INSTANCE} from '../src/render/instances.js';

let memory: WebAssembly.Memory;
beforeAll(async()=>{memory=(await init({module_or_path:readFileSync('src/wasm/terri_wasm_bg.wasm')})).memory;});

it.each(['counter','dining_table','trashcan'])('plays %s through the compiled boundary, save/load and cancellation',name=>{
  for(let facing=1;facing<=4;facing++) {
    const handle=SimHandle.from_lot(),s=new SimBridge(handle,memory);
    try {
      expect(s.loadBytes(readFileSync(`tests/fixtures/cleaning-animation/cleaning-${name}-${facing}.sav`))).toBe(true);
      const person=s.selectedIndex()!,object=s.ids()[0],action=name==='counter'?15:name==='dining_table'?16:17;
      const restCount=instanceCount(s,null);
      expect(s.cleanChore(person,name==='trashcan'?3:2,object,true)).toBe(true);
      const progress:number[]=[],bodies=new Set<number>();
      let saved:Uint8Array|undefined;
      for(let tick=0;tick<65;tick++) {
        s.tick();
        const row=Array.from(s.ids()).indexOf(person);
        expect(s.choreProgress().length).toBe(s.count);
        if(s.visualActions()[row]!==action) {if(progress.length)break;continue;}
        expect(s.facings()[row]).toBe(facing);
        expect(s.interactionTargets()[row]).toBe(object);
        progress.push(s.choreProgress()[row]);
        const data=buildInstances(s,1,0,0,20,null,1,false,0);
        const body=data[row*FLOATS_PER_INSTANCE+3];bodies.add(body);
        expect(instanceCount(s,null)).toBe(restCount+1);
        expect(data[2*FLOATS_PER_INSTANCE+3]).toBe(body);
        expect(body).toBe(simBodySprite(person,action,facing,0,false,0,0,s.simIds()[row],0,false,s.choreProgress()[row]));
        if(name==='trashcan') {
          expect(s.choreProgress()[0]).toBe(s.choreProgress()[row]);
          expect(data[3]).toBe(cleaningBinSprite(s.sprites()[0],s.choreProgress()[row],false));
        }
        if(tick===10) {
          saved=s.saveBytes();const hash=s.worldHash();
          const pose=Array.from(data.slice(0,3*FLOATS_PER_INSTANCE));
          expect(s.loadBytes(saved)).toBe(true);expect(s.worldHash()).toBe(hash);
          expect(Array.from(buildInstances(s,1,0,0,20,null,1,false,0).slice(0,pose.length))).toEqual(pose);
        }
      }
      expect(bodies.size).toBe(name==='trashcan'?8:6);
      expect(progress.length).toBe(name==='trashcan'?59:44);
      expect(progress.every((p,i)=>i===0||p>progress[i-1])).toBe(true);
      expect(Array.from(s.choreProgress())).toEqual([0,0]);
      expect(s.loadBytes(saved!)).toBe(true);
      expect(s.cancelIntents(person)).toBe(true);s.tick();
      expect(s.visualActions()[1]).not.toBe(action);
      expect(Array.from(s.choreProgress())).toEqual([0,0]);
      expect(instanceCount(s,null)).toBe(restCount);
    } finally {handle.free();}
  }
});
