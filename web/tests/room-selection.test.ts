import { readFileSync } from 'node:fs';
import { beforeAll, expect, it, vi } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { RoomSelection, RoomSelectionControls, RoomsTool, roomNameError } from '../src/ui/room-selection.js';
import { RoomTool } from '../src/ui/room-tool.js';
let memory: WebAssembly.Memory;
beforeAll(async () => { memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory; });
it('selects native floor membership including Outside and preserves raw invalid text across choices', () => {
  const h = SimHandle.from_lot(), sim = new SimBridge(h, memory), selection = new RoomSelection(sim);
  try {
    expect(sim.beginBuild().ok).toBe(true);
    selection.refresh(); selection.select(0); selection.edit('bad\nname');
    const room = selection.rooms.find(row => row.id !== 0)!;
    selection.select(room.id); selection.edit('<b>Hall</b>');
    expect(selection.select(999999)).toBe(false);
    selection.select(0); expect(selection.text).toBe('bad\nname');
    expect(selection.validate()).toBe(false); expect(selection.hasLocalChanges()).toBe(true);
    selection.edit('  Garden  '); expect(selection.validate()).toBe(true);
    expect(selection.chooseTile(room.anchor!)).toBe(true); expect(selection.selected).toBe(room.id);
    expect(selection.text).toBe('<b>Hall</b>');
    expect(selection.highlight()?.tiles.length).toBe(room.area);
    expect(selection.label(room)).toContain(`${room.anchor![0]}, ${room.anchor![1]}`);
  } finally { h.free(); }
});
it('matches native scalar, raw-control and Rust whitespace rules', () => {
  for (const name of ['😀'.repeat(48), ' '.repeat(2000) + 'Garden' + ' '.repeat(2000), '\uFEFF', '\u2003Garden\u2003']) expect(roomNameError(name)).toBeNull();
  for (const name of ['', '😀'.repeat(49), '\ud800', '\nGarden', 'Garden\t', '\u0085Garden']) expect(roomNameError(name)).not.toBeNull();
});
it('refreshes native membership and labels for unequal bigint revisions above the safe integer range', () => {
  const h = SimHandle.from_lot(), sim = new SimBridge(h, memory), selection = new RoomSelection(sim);
  try {
    sim.beginBuild(); let revision = 9007199254740992n;
    vi.spyOn(sim, 'roomsRevision').mockImplementation(() => revision);
    const summaries = vi.spyOn(sim, 'roomSummaries');
    selection.select(0); selection.highlight(); selection.refresh(); expect(summaries).toHaveBeenCalledOnce();
    sim.stageRoomName(0, 'Changed'); revision++;
    selection.refresh(); expect(selection.rooms[0].name).toBe('Changed'); expect(summaries).toHaveBeenCalledTimes(2);
  } finally { h.free(); }
});
it('does not invent a room before Confirm and preserves the last confirmed batch on Cancel', () => {
  const h = new SimHandle(10, 8), sim = new SimBridge(h, memory), selection = new RoomSelection(sim);
  try {
    sim.beginBuild(); selection.refresh(); expect(selection.rooms).toHaveLength(1);
    sim.buildRoom([1, 1, 7, 5], { axis: 0, x: 8, y: 3 }); sim.flushCommands();
    selection.refresh(); expect(selection.rooms).toHaveLength(1);
    const review = sim.prepareBuildCommit(); expect(review.ok).toBe(true);
    if (!review.ok) throw Error('prepare failed');
    expect(sim.commitBuild(review.value.token).ok).toBe(true);
    selection.reset(); const room = selection.rooms.find(row => row.id !== 0)!;
    expect(room.name).toMatch(/^Room /); selection.select(room.id); selection.edit('Hall');
    const rename = sim.prepareBuildCommit(); if (!rename.ok) throw Error('rename failed');
    sim.commitBuild(rename.value.token); selection.reset(); selection.select(room.id); selection.edit('Later');
    sim.cancelBuild(); selection.reset(); selection.select(room.id); expect(selection.text).toBe('Hall');
  } finally { h.free(); }
});

it('keeps Enter and composition inside the actual name-field listeners and retains drafts across modes', () => {
  const h = SimHandle.from_lot(), sim = new SimBridge(h, memory);
  class Element {
    value = ''; textContent = ''; hidden = false; disabled = false;
    children: Element[] = []; attributes = new Map<string, string>(); listeners = new Map<string, (event: any) => void>();
    append(child: Element) { this.children.push(child); } replaceChildren() { this.children = []; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    addEventListener(name: string, listener: (event: any) => void) { this.listeners.set(name, listener); }
    fire(name: string, event: any = {}) { this.listeners.get(name)?.(event); }
  }
  const nodes = new Map(['room-selection', 'room-name', 'room-name-status', 'room-mode-select', 'room-mode-build', 'room-select-controls', 'room-build-controls'].map(id => [`#${id}`, new Element()]));
  const doc = { querySelector: (selector: string) => nodes.get(selector), createElement: () => new Element() };
  let view: RoomSelectionControls;
  const selection = new RoomSelection(sim, () => view?.render());
  const tool = new RoomsTool(selection, new RoomTool(sim, h.lot_width(), h.lot_height(), { changed() {} }), () => view?.render());
  try {
    sim.beginBuild(); tool.enter(); view = new RoomSelectionControls(doc as unknown as Document, tool);
    const select = nodes.get('#room-selection')!, name = nodes.get('#room-name')!;
    select.value = '0'; select.fire('change'); expect(name.disabled).toBe(false);
    const before = sim.saveBytes(); name.value = 'Pending name'; name.fire('input');
    const prevented = vi.fn(), stopped = vi.fn(); name.fire('keydown', { key: 'Enter', preventDefault: prevented, stopPropagation: stopped });
    expect(prevented).toHaveBeenCalledOnce(); expect(stopped).toHaveBeenCalledOnce(); expect(sim.saveBytes()).toEqual(before);
    name.fire('compositionstart'); name.value = 'Composing'; name.fire('input'); expect(selection.text).toBe('Pending name');
    name.fire('compositionend'); expect(selection.text).toBe('Composing');
    nodes.get('#room-mode-build')!.fire('click'); expect(tool.mode).toBe('build'); tool.exit(); tool.enter();
    nodes.get('#room-mode-select')!.fire('click'); expect(name.value).toBe('Composing');
    name.value = '😀'.repeat(49); name.fire('input'); tool.exit(); tool.enter(); expect(name.value).toBe('😀'.repeat(49));
    expect(selection.validate()).toBe(false); expect(sim.saveBytes()).toEqual(before);
  } finally { h.free(); }
});
