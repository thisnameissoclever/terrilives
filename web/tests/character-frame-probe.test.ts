import {expect,it,vi} from 'vitest';
import {CharacterWorld,type CharacterFrameProbe} from '../src/render/character/world.js';

it('copies only primitive frame fields into existing caller slots and rejects undersized storage',()=>{
  const actor={entity:15,sim:2,action:{clip:'mop',sample:6},get appearance(){throw new Error('Appearance was walked');}};
  const resources={resourceId:41,renderer:{metrics:{bodyCompactions:1,bodyShapeChanges:2,attachmentChanges:3}},get geometry(){throw new Error('Geometry was walked');}};
  const world=Object.assign(Object.create(CharacterWorld.prototype),{displayed:[{actor,resources}],currentView:{originX:3,originY:4,scale:2,width:900,height:700}}) as CharacterWorld;
  const slot={entity:0,sim:0,clip:'',sample:0,resourceId:0,bodyCompactions:0,bodyShapeChanges:0,attachmentChanges:0};
  const target:CharacterFrameProbe={count:0,hasView:false,originX:0,originY:0,scale:0,width:0,height:0,actors:[slot]};
  const clone=vi.spyOn(globalThis,'structuredClone').mockImplementation(()=>{throw new Error('Probe cloned data');});
  try{world.probeFrame(target);expect(target.actors[0]).toBe(slot);expect(target).toEqual({count:1,hasView:true,originX:3,originY:4,scale:2,width:900,height:700,
    actors:[{entity:15,sim:2,clip:'mop',sample:6,resourceId:41,bodyCompactions:1,bodyShapeChanges:2,attachmentChanges:3}]});
    expect(()=>world.probeFrame({...target,actors:[]})).toThrow('insufficient actor slots');resources.resourceId=42;world.probeFrame(target);expect(slot.resourceId).toBe(42);
  }finally{clone.mockRestore();}
});
