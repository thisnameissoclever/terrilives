import {expect,it} from 'vitest';
import {decodeChoreRows,decodeChoreHistory} from '../src/ui/chores-board.js';
it('decodes the exact assignment, dirt and daily outcome columns without confusing entity and Sim IDs',()=>{
  expect(decodeChoreRows(new Uint32Array([1,45,2,700,6]))).toEqual([{kind:1,target:45,owner:2,dirt:700,outcome:6}]);
  expect(()=>decodeChoreRows(new Uint32Array([1,45]))).toThrow();expect(()=>decodeChoreRows(new Uint32Array([9,0,0,0,0]))).toThrow();
});
it('keeps actual performers, settled outcomes and full day identities in history',()=>{
  expect(decodeChoreHistory(new Uint32Array([4,1,3,18,2,0,5,1]))).toEqual([{day:4294967300,kind:3,target:18,owner:2,performer:0,outcome:5,settled:true}]);
  expect(()=>decodeChoreHistory(new Uint32Array([4,0,3,18,2,0,5]))).toThrow();
  expect(()=>decodeChoreHistory(new Uint32Array([0,0,3,18,2,0,99,1]))).toThrow();
});

import {surfaceMenuEntries} from '../src/ui/object-menu.js';
it.each([[0,0],[1,0],[0,1],[1,1]])('offers only available table actions, preserving interaction identities (%s,%s)',(sit,eat)=>{
  const menu=surfaceMenuEntries({entityName:()=> 'Table',interactionLabels:()=>['Sit'],tableActions:()=>new Uint32Array([sit,eat])},7);
  expect(menu.entries.map(e=>e.label)).toEqual([...(sit?['Sit']:[]),...(eat?['Eat prepared food']:[]),'Enter build mode','Nothing']);
  expect(menu.entries.filter(e=>e.action.kind==='use').map(e=>e.action)).toEqual([
    ...(sit?[{kind:'use',object:7,interaction:0}]:[]),...(eat?[{kind:'use',object:7,interaction:1}]:[])]);
});
