import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { CharacterContactRoster } from '../src/render/character/contact-admission.js';
import { CharacterContactFrameSync, loadPreparedCharacterState } from '../src/render/character/prepared-character-load.js';
import { advanceSimulationFrame, FixedStepDriver } from '../src/frame.js';
import { BuildSession } from '../src/ui/build-session.js';
import { PreparedBuildCommit } from '../src/ui/prepared-build-commit.js';
import { RoomReviewController } from '../src/ui/room-review.js';
import { AdmissionTestService } from './fixtures/contact-admission-service.js';

let memory: WebAssembly.Memory;
beforeAll(async () => { memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory; });

function stagePool(sim: SimBridge, flush = true) {
  const pool = sim.catalogue().find(item => item.model?.id === 'pool')!;
  expect(pool).toBeDefined();
  if (sim.funds() < pool.price) {
    const sellable = Array.from(sim.ids(), id => ({ id, ...sim.salePreview(id) }))
      .filter(quote => quote.reason === null).sort((a, b) => b.payout - a.payout);
    for (const quote of sellable) {
      expect(sim.sellObject(quote.id)).toBe(true);
      sim.flushCommands();
      if (sim.funds() >= pool.price) break;
    }
  }
  expect(sim.purchasePreview(pool.definition, 17, 13, pool.baseFacing).valid).toBe(true);
  expect(sim.buyObject(pool.definition, 17, 13, pool.baseFacing)).toBe(true);
  if (flush) {
    sim.flushCommands();
    expect(sim.lastPurchaseResult()?.reason).toBeNull();
  }
}

it.each([false, true])('gates first-pool adoption through native Build with access review %s', async reviewed => {
  const handle = SimHandle.from_lot();
  const sim = new SimBridge(handle, memory);
  const service = new AdmissionTestService();
  const roster = new CharacterContactRoster(service);
  const guard = new PreparedBuildCommit(roster, {
    poolRequired: token => sim.buildPoolContactRequired(token), appearances: () => sim.characterAppearances(), pending() {},
  });
  const commit: typeof guard.run = (token, adopt) => guard.run(token, adopt);
  let resolveReview: ((result: boolean) => void) | undefined;
  const review = new RoomReviewController(sim, {
    commit, cancelPending: () => guard.cancel(), completed: adopted => resolveReview?.(adopted),
  });
  const session = new BuildSession(sim, {
    commit, prepare: () => true, settled: () => true, restored() {},
    review: candidate => new Promise<boolean>(resolve => { resolveReview = resolve; review.open(candidate); }),
  });
  try {
    expect(sim.poolContactRequired()).toBe(false);
    const base = roster.prepareCurrent(sim.characterAppearances(), 'base');
    service.finishAll(); await base;
    expect(session.begin()).toBe(true);
    const before = sim.saveBytes();
    stagePool(sim);
    if (reviewed) {
      for (const [axis, x, y] of [[0, 18, 4], [0, 19, 4], [1, 18, 4], [1, 18, 5]]) {
        expect(sim.setWallEdge(axis, x, y, 1)).toBe(true);
        sim.flushCommands(); expect(sim.lastWallEditResult()?.reason).toBeNull();
      }
    }
    expect(sim.poolContactRequired()).toBe(false);
    const pending = session.confirm();
    if (reviewed) {
      expect(review.hasAccess).toBe(true);
      if (!review.accessActive) expect(await review.confirm()).toBe(false);
      expect(review.accessActive).toBe(true);
      const waiting = review.confirm();
      expect(sim.saveBytes()).toEqual(before);
      review.back();
      expect(await waiting).toBe(false);
      expect(await pending).toBe(false);
    } else {
      expect(review.active).toBe(false);
      expect(sim.saveBytes()).toEqual(before);
      expect(guard.cancel()).toBe(true);
      expect(await pending).toBe(false);
    }
    expect(sim.saveBytes()).toEqual(before);
    expect(roster.mode).toBe('base');

    const retry = session.confirm();
    if (reviewed) {
      if (!review.accessActive) expect(await review.confirm()).toBe(false);
      expect(review.accessActive).toBe(true);
      const waiting = review.confirm();
      service.finishAll();
      expect(await waiting).toBe(true);
    } else service.finishAll();
    expect(await retry).toBe(true);
    expect(sim.poolContactRequired()).toBe(true);
    expect(roster.mode).toBe('pool-required');
    expect(sim.saveBytes()).not.toEqual(before);
  } finally {
    guard.cancel(); roster.dispose(); handle.free();
  }
});

it('retains queued first-pool contacts across a running frame with no simulation tick', async () => {
  const producerHandle = SimHandle.from_lot(), liveHandle = SimHandle.from_lot();
  const producer = new SimBridge(producerHandle, memory), live = new SimBridge(liveHandle, memory);
  const service = new AdmissionTestService(), roster = new CharacterContactRoster(service);
  const sync = new CharacterContactFrameSync(live, roster);
  const driver = new FixedStepDriver(10, 30);
  driver.setSpeed(1);
  try {
    stagePool(producer, false);
    expect(producer.poolContactRequired()).toBe(false);
    const loaded = loadPreparedCharacterState(producer.saveBytes(), live, () => {
      const handle = SimHandle.from_lot(), source = new SimBridge(handle, memory);
      return { loadBytes: bytes => source.loadBytes(bytes), flushCommands: () => source.flushCommands(),
        characterAppearances: () => source.characterAppearances(), poolContactRequired: () => source.poolContactRequired(),
        free: () => handle.free() };
    }, roster);
    service.finishAll(); expect(await loaded).toBe(true);
    const hash = live.appearanceHash(), before = live.commandDrainRevision();
    sync.reset();
    advanceSimulationFrame(driver, 15, live);
    sync.afterFrame();
    expect(live.commandDrainRevision()).toBe(before);
    expect(roster.hasQueued).toBe(true);
    expect(roster.mode).toBe('base');
    expect(live.poolContactRequired()).toBe(false);

    advanceSimulationFrame(driver, 100, live);
    sync.afterFrame();
    expect(live.appearanceHash()).toBe(hash);
    expect(live.poolContactRequired()).toBe(true);
    expect(roster.hasQueued).toBe(false);
    expect(roster.mode).toBe('pool-required');
    for (const row of live.characterAppearances()) expect(roster.require(row.entity, row.appearance).pool).toBeDefined();
  } finally { roster.dispose(); liveHandle.free(); producerHandle.free(); }
});
