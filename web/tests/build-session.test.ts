import { readFileSync } from 'node:fs';
import { beforeAll, expect, it, vi } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { BuildSession } from '../src/ui/build-session.js';
import { FurnitureBuilder } from '../src/ui/builder.js';
import { OverlayPauseController } from '../src/ui/overlay-pause.js';
import { RoomReviewController } from '../src/ui/room-review.js';

it('reopens retained final-room choices after wall reversal removes every native review group', async () => {
  const handle = new SimHandle(10, 8), sim = new SimBridge(handle, memory);
  let finish: ((value: boolean) => void) | null = null;
  const review = new RoomReviewController(sim, { completed: adopted => finish?.(adopted) });
  const session = new BuildSession(sim, { prepare: () => true, settled: () => true, restored() {},
    needsReview: () => review.hasChoices,
    review: prepared => new Promise<boolean>(resolve => { finish = resolve; review.open(prepared); }) });
  try {
    sim.buildRoom([1, 1, 7, 5], { axis: 0, x: 8, y: 3 }); sim.flushCommands(); session.begin();
    const before = sim.saveBytes();
    for (let y = 1; y <= 5; y++) { sim.setWallEdge(0, 4, y, 1); sim.flushCommands(); }
    const pending = session.confirm();
    review.setName([1, 1], 'Retained name'); review.setName([4, 1], 'Child without a target'); review.back();
    expect(await pending).toBe(false);
    for (let y = 1; y <= 5; y++) { sim.setWallEdge(0, 4, y, 0); sim.flushCommands(); }
    const reopened = session.confirm();
    expect(review.active).toBe(true); expect(review.review!.groups).toHaveLength(0);
    expect(review.name([1, 1])).toBe('Retained name'); expect(review.unavailableChoices).toHaveLength(1);
    expect(sim.saveBytes()).toEqual(before); expect(await review.confirm()).toBe(false);
    review.removeUnavailableChoices(); expect(await review.confirm()).toBe(false);
    expect(sim.saveBytes()).toEqual(before); expect(await review.confirm()).toBe(true); expect(await reopened).toBe(true);
  } finally { handle.free(); }
});

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});
function fixture() {
  const handle = SimHandle.from_lot();
  const sim = new SimBridge(handle, memory);
  const hooks: import('../src/ui/build-session.js').BuildSessionHooks = { prepare: () => true, settled: () => true, restored: vi.fn() };
  return { handle, sim, hooks, session: new BuildSession(sim, hooks) };
}

it('keeps queued and applied edits out of saves and cancels the complete draft', () => {
  const { handle, sim, hooks, session } = fixture();
  try {
    const before = sim.saveBytes();
    expect(session.begin()).toBe(true);
    expect(sim.placeObject(15, 7, 0, sim.objectFacing(15)!)).toBe(true);
    expect(session.saveBytes()).toEqual(before);
    sim.flushCommands();
    expect(sim.lastPlacementResult()?.reason).toBeNull();
    expect(sim.buildActive()).toBe(true);
    expect(sim.buildDirty()).toBe(true);
    expect(sim.saveBytes()).toEqual(before);
    expect(session.saveBytes()).toEqual(before);
    expect(session.cancel()).toBe(true);
    expect(sim.saveBytes()).toEqual(before);
    expect(hooks.restored).toHaveBeenCalledOnce();
  } finally { handle.free(); }
});

it('confirms one batch and exit discards only subsequent queued changes', () => {
  const { handle, sim, session } = fixture();
  try {
    session.begin();
    expect(sim.placeObject(15, 7, 0, sim.objectFacing(15)!)).toBe(true);
    expect(session.confirm()).toBe(true);
    const confirmed = session.saveBytes();
    expect(sim.setColourway(15, 1)).toBe(true);
    expect(session.end()).toBe(true);
    expect(session.active).toBe(false);
    sim.flushCommands();
    expect(sim.saveBytes()).toEqual(confirmed);
  } finally { handle.free(); }
});

it('settles commands queued before entry and drains chained edits before confirmation', () => {
  const { handle, sim, hooks, session } = fixture();
  try {
    expect(sim.placeObject(15, 7, 0, sim.objectFacing(15)!)).toBe(true);
    session.begin();
    const before = session.saveBytes();
    let checks = 0;
    hooks.settled = () => {
      if (checks++ === 0) { expect(sim.setColourway(15, 1)).toBe(true); return false; }
      return true;
    };
    expect(session.confirm()).toBe(true);
    expect(sim.objectColourway(15)).toBe(1);
    expect(session.saveBytes()).not.toEqual(before);
    expect(session.end()).toBe(true);
    expect(sim.objectColourway(15)).toBe(1);
  } finally { handle.free(); }
});

it('preserves the draft and baseline when rollback fails', () => {
  const { handle, sim, hooks, session } = fixture();
  try {
    session.begin();
    vi.spyOn(sim, 'endBuild').mockReturnValue({ ok: false, error: { code: 10, detail: 7n } });
    expect(session.end()).toBe(false);
    expect(session.active).toBe(true);
    expect(hooks.restored).not.toHaveBeenCalled();
  } finally { handle.free(); }
});

it('successful Load replaces the baseline while a rejected Load preserves it', () => {
  const { handle, sim, session } = fixture();
  try {
    const before = sim.saveBytes();
    sim.placeObject(15, 7, 0, sim.objectFacing(15)!); sim.flushCommands();
    const different = sim.saveBytes();
    session.begin();
    expect(session.loadBytes(new Uint8Array())).toBe(false);
    expect(session.saveBytes()).toEqual(different);
    expect(session.loadBytes(before)).toBe(true);
    expect(session.end()).toBe(true);
    expect(sim.saveBytes()).toEqual(before);
  } finally { handle.free(); }
});

it('does not confirm an invalid preview or an unsettled controller', () => {
  const { handle, hooks, session } = fixture();
  try {
    session.begin();
    const before = session.saveBytes();
    hooks.prepare = () => false;
    expect(session.confirm()).toBe(false);
    expect(session.saveBytes()).toEqual(before);
    hooks.prepare = () => true; hooks.settled = () => false;
    expect(session.confirm()).toBe(false);
    expect(session.saveBytes()).toEqual(before);
  } finally { handle.free(); }
});

it('restores funds, purchased objects, sold objects, walls and floors together', () => {
  const { handle, sim, session } = fixture();
  try {
    session.begin();
    const before = session.saveBytes(), funds = sim.funds(), count = sim.count;
    const sale = Array.from(sim.ids()).map(id => ({ id, ...sim.salePreview(id) }))
      .filter(quote => quote.reason === null).sort((a, b) => b.payout - a.payout)[0];
    expect(sale).toBeDefined();
    expect(sim.sellObject(sale.id)).toBe(true); sim.flushCommands();
    expect(sim.lastSaleResult()?.reason).toBeNull();
    expect(sim.funds()).toBe(funds + sale.payout);
    const item = sim.catalogue().find(item => item.price <= sim.funds()
      && sim.purchasePreview(item.definition, 17, 14, item.baseFacing).valid)!;
    expect(item).toBeDefined();
    expect(sim.buyObject(item.definition, 17, 14, item.baseFacing)).toBe(true);
    sim.flushCommands();
    expect(sim.lastPurchaseResult()?.reason).toBeNull();
    expect(sim.funds()).toBe(funds + sale.payout - item.price);
    expect(sim.count).toBe(count);
    expect(sim.setWallEdge(0, 8, 1, 2)).toBe(true);
    expect(sim.setFloor(17, 13, 1)).toBe(true);
    sim.flushCommands();
    expect(sim.lastWallEditResult()?.reason).toBeNull();
    expect(sim.lastFloorEditResult()?.reason).toBe(0);
    expect(session.saveBytes()).toEqual(before);
    expect(session.cancel()).toBe(true);
    expect(sim.funds()).toBe(funds); expect(sim.count).toBe(count);
    expect(sim.saveBytes()).toEqual(before);
  } finally { handle.free(); }
});

it('confirms a perimeter room and reviews enclosure loss before restoring its outer wall', async () => {
  const { handle, sim, session, hooks } = fixture();
  hooks.review = async review => sim.commitBuild(review.token).ok;
  const outerWallPresent = () => {
    const edges = Array.from(sim.wallEdges()!);
    return edges.some((value, i) => i % 4 === 0 && value === 1
      && edges[i + 1] === 17 && edges[i + 2] === 16 && edges[i + 3] === 0);
  };
  try {
    session.begin();
    expect(sim.buildRoom([17, 15, 18, 15], null)).toBe(true);
    expect(await session.confirm()).toBe(true);
    expect(sim.lastRoomResult()?.reason).toBeNull();
    expect(outerWallPresent()).toBe(true);
    expect(sim.setWallEdge(1, 17, 16, 0)).toBe(true);
    expect(await session.confirm()).toBe(true);
    expect(sim.lastWallEditResult()?.reason).toBeNull();
    expect(outerWallPresent()).toBe(false);
    expect(session.loadBytes(session.saveBytes())).toBe(true);
    expect(outerWallPresent()).toBe(false);
    expect(sim.setWallEdge(1, 17, 16, 1)).toBe(true);
    expect(await session.confirm()).toBe(true);
    expect(sim.lastWallEditResult()?.reason).toBeNull();
    expect(outerWallPresent()).toBe(true);
    expect(session.end()).toBe(true);
    expect(outerWallPresent()).toBe(true);
  } finally { handle.free(); }
});

// Leaving Build mode asks first only when the draft differs from the last
// Confirm, so an applied edit counts and an undone or confirmed one does not.
it('reports changes only while the draft differs from the last confirmed world', () => {
  const { handle, sim, session } = fixture();
  try {
    expect(session.hasChanges()).toBe(false);
    expect(session.begin()).toBe(true);
    expect(session.hasChanges()).toBe(false);
    expect(sim.placeObject(15, 7, 0, sim.objectFacing(15)!)).toBe(true);
    sim.flushCommands();
    expect(sim.lastPlacementResult()?.reason).toBeNull();
    expect(session.hasChanges()).toBe(true);
    expect(session.confirm()).toBe(true);
    expect(session.hasChanges()).toBe(false);
    expect(sim.setColourway(15, 1)).toBe(true);
    sim.flushCommands();
    expect(session.hasChanges()).toBe(true);
    expect(session.cancel()).toBe(true);
    expect(session.hasChanges()).toBe(false);
    expect(session.end()).toBe(true);
    expect(session.hasChanges()).toBe(false);
  } finally { handle.free(); }
});

// The session half of discarding on the way out: a builder whose exit ends the
// session, as the exit dialog's Discard changes does, drops an edit still on
// its way. Asking first is BuildExit's job, in build-exit.test.ts.
it('ending the session drops an in-flight furniture edit, so a builder leaving through it resumes play', () => {
  const { handle, sim, session, hooks } = fixture();
  const speed = vi.fn();
  const builder = new FurnitureBuilder(sim, new OverlayPauseController({ setSpeed: speed }, () => {}, 1), {
    enter() {}, exit() {}, changed() {}, beforeEnter: () => session.begin(), beforeExit: () => session.end(),
  });
  hooks.restored = vi.fn(() => builder.resetAfterLoad());
  try {
    const before = sim.saveBytes();
    builder.enter(); builder.select(15); builder.moveTo(7, 0); builder.confirm();
    expect(builder.pending).toBe(true); expect(builder.canExit).toBe(true);
    builder.exit(); sim.flushCommands();
    expect(builder.active).toBe(false); expect(builder.pending).toBe(false);
    expect(sim.saveBytes()).toEqual(before);
    expect(speed).toHaveBeenLastCalledWith(1);
  } finally { handle.free(); }
});
