import {expect,it} from 'vitest';
import {ChoresBoard,decodeChoreRows,decodeChoreHistory, type ChoresSource} from '../src/ui/chores-board.js';

it('refreshes a paused chore label when only its room name changes', () => {
  class Element {
    textContent = ''; className = ''; value = ''; checked = false; disabled = false; nodes: Element[] = [];
    constructor(readonly ownerDocument: typeof doc) {}
    append(...nodes: Element[]) { this.nodes.push(...nodes); }
    replaceChildren(...nodes: Element[]) { this.nodes = nodes; }
    addEventListener() {} setAttribute() {} removeAttribute() {}
    text(): string { return this.textContent + this.nodes.map(node => node.text()).join(' '); }
  }
  const doc = { createElement: () => new Element(doc), createTextNode: (text: string) => { const node = new Element(doc); node.textContent = text; return node; } };
  let room = 'Hall';
  const source: ChoresSource = { choreRows: () => Uint32Array.of(1, 3, 7, 400, 0), choreHistory: () => new Uint32Array(),
    choreLocation: () => room, choreProfileOf: () => new Int32Array(), selectedIndex: () => null,
    ids: () => Uint32Array.of(8), simIds: () => Uint32Array.of(7), kinds: () => Uint32Array.of(0), positions: () => new Float32Array(),
    simName: () => 'Taylor', entityName: () => '', clockTick: () => 0, dayTicks: () => 1440, lotWidth: () => 20,
    choreBoardEnabled: () => true, setChoreBoard: () => true, setChoreProfile: () => true, cleanChore: () => true };
  const board = new ChoresBoard(source, doc as unknown as Document);
  board.update(); expect((board.element() as unknown as Element).text()).toContain('in Hall');
  room = '<b>Hall</b>'; board.update(); expect((board.element() as unknown as Element).text()).toContain('in <b>Hall</b>');
  expect((board.element() as unknown as Element).text()).toContain('Taylor');
});
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
