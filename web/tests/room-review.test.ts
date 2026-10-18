import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { RoomReviewController, RoomReviewControls } from '../src/ui/room-review.js';
import type { BuildReview, RoomResult } from '../src/rooms/codec.js';
import type { RoomBridge } from '../src/ui/room-selection.js';
let memory: WebAssembly.Memory;
beforeAll(async () => { memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory; });
function value<T>(result: RoomResult<T>): T { if (!result.ok) throw Error(`Native error ${result.error.code}`); return result.value; }
function fixture() {
  const handle = new SimHandle(10, 8), sim = new SimBridge(handle, memory);
  sim.buildRoom([1, 1, 7, 5], { axis: 0, x: 8, y: 3 }); sim.flushCommands();
  const old = value(sim.roomSummaries()).rooms.find(room => room.id !== 0)!;
  value(sim.beginBuild()); value(sim.stageRoomName(old.id, 'Original'));
  for (let y = 1; y <= 5; y++) { sim.setWallEdge(0, 4, y, 1); sim.flushCommands(); }
  const controller = new RoomReviewController(sim);
  controller.open(value(sim.prepareBuildCommit()));
  return { handle, sim, old, controller };
}
it('uses native predecessor choices and retains explicit names and inheritance after Back and fresh preparation', async () => {
  const { handle, sim, old, controller: review } = fixture();
  try {
    const originalToken = review.review!.token;
    const anchors = review.review!.groups[0].finalAnchors;
    expect(review.predecessors(anchors[1])).toContain(old.id);
    review.setInheritance(anchors[0], null); review.setInheritance(anchors[1], old.id);
    review.setName(anchors[0], '<b>Child</b>'); review.back();
    expect(sim.buildActive()).toBe(true); expect(sim.buildDirty()).toBe(true);
    review.open(value(sim.prepareBuildCommit()));
    expect(review.review!.token.preparation).not.toBe(originalToken.preparation);
    expect(review.name(anchors[0])).toBe('<b>Child</b>'); expect(review.inheritance(anchors[1])).toBe(old.id);
    expect(await review.confirm()).toBe(false); // Updated choices must be displayed before adoption.
    expect(review.review!.rooms.find(room => room.id === old.id)?.anchor).toEqual(anchors[1]);
    expect(review.review!.rooms.find(room => room.id === old.id)?.name).toBe('Original');
    expect(await review.confirm()).toBe(true); expect(review.active).toBe(false);
    expect(value(sim.roomSummaries()).rooms.some(room => room.name === '<b>Child</b>')).toBe(true);
  } finally { handle.free(); }
});
it('refuses a stale token without silently preparing another review or committing', async () => {
  const { handle, sim, controller: review } = fixture();
  try {
    const before = sim.saveBytes(), token = review.review!.token;
    value(sim.stageRoomName(0, 'Changed'));
    expect(await review.confirm()).toBe(false); expect(review.active).toBe(true);
    expect(review.review!.token).toEqual(token); expect(sim.saveBytes()).toEqual(before);
    expect(review.error).toContain('out of date');
  } finally { handle.free(); }
});
it('keeps invalid raw review text and uses native lost-enclosure geometry for Show opening', () => {
  const { handle, sim, controller: review } = fixture();
  try {
    const anchor = review.review!.groups[0].finalAnchors[0]; review.setName(anchor, 'bad\ntext');
    review.back(); review.open(value(sim.prepareBuildCommit())); expect(review.name(anchor)).toBe('bad\ntext');
    review.back();
    for (let x = 1; x <= 7; x++) { sim.setWallEdge(1, x, 1, 0); sim.flushCommands(); }
    review.open(value(sim.prepareBuildCommit()));
    const lost = review.review!.groups.findIndex(group => group.kind === 3); expect(lost).toBeGreaterThanOrEqual(0);
    review.selectGroup(lost); expect(review.highlight()?.tiles).toEqual(review.review!.groups[lost].formerTiles);
    expect(review.opening()).not.toBeNull();
  } finally { handle.free(); }
});

it('retains separate names while changing between two native review groups', async () => {
  const handle = new SimHandle(20, 8), sim = new SimBridge(handle, memory), review = new RoomReviewController(sim);
  try {
    for (const x of [1, 11]) { sim.buildRoom([x, 1, x + 6, 5], { axis: 0, x: x + 7, y: 3 }); sim.flushCommands(); }
    value(sim.beginBuild());
    for (const x of [4, 14]) for (let y = 1; y <= 5; y++) { sim.setWallEdge(0, x, y, 1); sim.flushCommands(); }
    review.open(value(sim.prepareBuildCommit())); expect(review.review!.groups).toHaveLength(2);
    const first = review.review!.groups[0].finalAnchors[0], second = review.review!.groups[1].finalAnchors[0];
    review.setName(first, 'Same name'); review.selectGroup(1); review.setName(second, 'Same name');
    review.selectGroup(0); expect(review.name(first)).toBe('Same name'); expect(review.name(second)).toBe('Same name');
    expect(await review.confirm()).toBe(false); expect(await review.confirm()).toBe(true);
    expect(value(sim.roomSummaries()).rooms.filter(room => room.name === 'Same name')).toHaveLength(2);
  } finally { handle.free(); }
});

it('offers a retiring custom merge name separately from the retained identity', async () => {
  const handle = new SimHandle(10, 8), sim = new SimBridge(handle, memory), review = new RoomReviewController(sim);
  try {
    sim.buildRoom([1, 1, 7, 5], { axis: 0, x: 8, y: 3 }); sim.flushCommands();
    for (let y = 1; y <= 5; y++) { sim.setWallEdge(0, 4, y, 1); sim.flushCommands(); }
    const rooms = value(sim.roomSummaries()).rooms.filter(room => room.id !== 0);
    value(sim.beginBuild()); value(sim.stageRoomName(rooms[0].id, 'First')); value(sim.stageRoomName(rooms[1].id, 'Retiring custom name'));
    for (let y = 1; y <= 5; y++) { sim.setWallEdge(0, 4, y, 0); sim.flushCommands(); }
    review.open(value(sim.prepareBuildCommit())); const anchor = review.review!.groups[0].finalAnchors[0];
    review.setInheritance(anchor, rooms[0].id); review.setName(anchor, 'Retiring custom name');
    expect(await review.confirm()).toBe(false); expect(await review.confirm()).toBe(true);
    const result = value(sim.roomSummaries()).rooms.find(room => room.id === rooms[0].id)!;
    expect(result.name).toBe('Retiring custom name'); expect(value(sim.roomSummaries()).rooms).toHaveLength(2);
  } finally { handle.free(); }
});

it.each(['owner-zero', 'unassigned', 'no-duty'] as const)('shows the receiving Outside metadata in lost-enclosure review: %s', mode => {
  const outside = { id: 0, name: '<b>Garden</b>', anchor: null, area: 100, outside: true, previousName: 'Outside', previousArea: 80 };
  const review: BuildReview = { token: { session: 1n, revision: 2n, preparation: 3n }, rooms: [outside], retiredNames: [{ id: 1, name: 'Former room' }],
    groups: [{ kind: 3, oldIds: [1], finalAnchors: [], formerTiles: [[1, 1]], openings: [{ axis: 0, x: 1, y: 1 }] }],
    duties: { duties: mode === 'no-duty' ? [] : [{ key: { kind: 1, target: 0 }, previous: { kind: 1, target: 0 }, owner: mode === 'owner-zero' ? 0 : null, kind: 0 }], replannedPeople: [], unavailablePeople: [] } };
  const source: RoomBridge = { roomsRevision: () => 1n, roomSummaries: () => ({ ok: true, value: { width: 10, height: 10, rooms: [outside] } }),
    roomTiles: () => ({ ok: true, value: [] }), stageRoomName: () => ({ ok: true, value: undefined }), prepareBuildCommit: () => ({ ok: true, value: review }),
    commitBuild: () => ({ ok: true, value: undefined }), discardBuildReview: () => ({ ok: true, value: undefined }),
    buildComponentTiles: () => ({ ok: true, value: [] }), buildComponentPredecessors: () => ({ ok: true, value: [] }) };
  class Element {
    textContent = ''; value = ''; hidden = false; disabled = false; isConnected = true; dataset: Record<string, string> = {}; nodes: Element[] = [];
    append(...nodes: Element[]) { this.nodes.push(...nodes); } replaceChildren() { this.nodes = []; }
    addEventListener() {} focus() {} closest() { return null; } matches() { return false; }
    text(): string { return this.textContent + this.nodes.map(node => node.text()).join(' '); }
  }
  const nodes = new Map(['builder-controls', 'room-review', 'room-review-heading', 'room-review-group', 'room-review-body', 'room-review-status', 'room-review-back', 'room-review-confirm'].map(id => [`#${id}`, new Element()]));
  const doc = { activeElement: null, querySelector: (selector: string) => nodes.get(selector), createElement: () => new Element() };
  const controller = new RoomReviewController(source); controller.open(review);
  const controls = new RoomReviewControls(doc as unknown as Document, controller, () => {}, id => id === 0 ? 'Person zero' : 'Wrong person', () => '', () => {});
  controls.render(); const text = nodes.get('#room-review-body')!.text();
  expect(text).toContain('Outside destination: <b>Garden</b>'); expect(text).toContain('80 → 100 tiles');
  expect(text).toContain(mode === 'owner-zero' ? 'Person zero' : mode === 'unassigned' ? 'Unassigned' : 'No floor duty in this review.');
});
