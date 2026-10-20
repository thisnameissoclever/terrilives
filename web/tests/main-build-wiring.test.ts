import { appendFileSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { beforeAll, expect, it, vi } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { BuildSession } from '../src/ui/build-session.js';
import { BuildExit, confirmRefusal, hasUnconfirmedChanges } from '../src/ui/build-exit.js';
import { BuildToolSwitch, routeBuildKey } from '../src/ui/build-tools.js';
import { FurnitureBuilder } from '../src/ui/builder.js';
import { WallTool } from '../src/ui/wall-tool.js';
import { RoomTool } from '../src/ui/room-tool.js';
import { RoomSelection, RoomsTool } from '../src/ui/room-selection.js';
import { RoomReviewController } from '../src/ui/room-review.js';
import { BuyTool } from '../src/ui/buy-tool.js';
import { FloorTool } from '../src/ui/floor-tool.js';
import { LandTool } from '../src/ui/land-tool.js';
import { OverlayPauseController } from '../src/ui/overlay-pause.js';
import { OrderDiagnostics } from '../src/ui/player-orders.js';
import { frameElapsedMs } from '../src/frame.js';
import type { BuildReview } from '../src/rooms/codec.js';

const main = readFileSync(process.env.BUILD_MAIN_SOURCE ?? new URL('../src/main.ts', import.meta.url), 'utf8');
let memory: WebAssembly.Memory;
beforeAll(async () => { memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory; });

/** Extract complete top-level bindings and the contiguous frame prefix, never individual predicates. */
function wiring(source: string): string {
  const file = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const one = <T>(rows: readonly T[], name: string): T => { if (rows.length !== 1) throw Error(`Expected exactly one ${name}`); return rows[0]; };
  const body = one(file.statements.filter(ts.isFunctionDeclaration).filter(node => node.name?.text === 'main'), 'main').body!;
  const declaration = (name: string) => one(body.statements.filter(ts.isVariableStatement).filter(node => node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === name)), name).getText(file);
  const functionBody = (name: string) => one(body.statements.filter(ts.isFunctionDeclaration).filter(node => node.name?.text === name), name).getText(file);
  const assignment = (name: string) => one(body.statements.filter(ts.isExpressionStatement).filter(node =>
    ts.isBinaryExpression(node.expression) && node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && node.expression.left.getText(file) === name), `${name} assignment`).getText(file);
  const listener = one(body.statements.filter(ts.isExpressionStatement).filter(node => {
    const call = node.expression;
    return ts.isCallExpression(call) && call.expression.getText(file) === 'canvas.addEventListener'
      && ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === 'keydown';
  }), 'canvas keydown');
  const frame = one(body.statements.filter(ts.isFunctionDeclaration).filter(node => node.name?.text === 'frame'), 'frame').body!;
  const end = frame.statements.findIndex(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(file) === 'landTool.setBlocked');
  if (end < 0) throw Error('Missing complete frame blocking prefix');
  return ts.transpile(`${declaration('replaceBuildLocalState')}\n${declaration('hasRetainedReviewChoices')}\n${declaration('requestRoomReview')}
    ${declaration('roomsTool')}\n${declaration('finishReview')}\n${declaration('roomReview')}
    ${assignment('hasRetainedReviewChoices')}\n${assignment('requestRoomReview')}
    ${declaration('buildTools')}\n${functionBody('confirmBuildBatch')}\n${declaration('buildExit')}\n${assignment('replaceBuildLocalState')}\n${assignment('toolSwitch')}\n${listener.getText(file)}
    function blockedFrame(nowMs: number, presenting = true) { ${frame.statements.slice(0, end + 1).map(node => node.getText(file)).join('\n')} }
    return { roomsTool, roomReview, buildTools, buildExit, toolSwitch, confirmBuildBatch, blockedFrame, hasRetainedReviewChoices, requestRoomReview, replaceBuildLocalState };`, { target: ts.ScriptTarget.ES2022 });
}

class Element {
  disabled = false; isConnected = true; open = false; hidden = false; returnValue = ''; textContent = '';
  listeners = new Map<string, ((event: any) => void)[]>();
  constructor(readonly doc: DocumentModel) {}
  addEventListener(type: string, fn: (event: any) => void) { this.listeners.set(type, [...this.listeners.get(type) ?? [], fn]); }
  fire(type: string, event: any = {}) { for (const fn of this.listeners.get(type) ?? []) fn(event); }
  focus() { this.doc.activeElement = this; } closest() { return null; }
  setAttribute() {} querySelectorAll() { return []; }
  showModal() { this.open = true; } close(value = '') { this.open = false; this.returnValue = value; this.fire('close'); }
}
class DocumentModel {
  activeElement: Element | null = null; body = new Element(this);
  nodes = new Map<string, Element>(); listeners = new Map<string, ((event: any) => void)[]>();
  querySelector(selector: string) { if (!this.nodes.has(selector)) this.nodes.set(selector, new Element(this)); return this.nodes.get(selector)!; }
  addEventListener(type: string, fn: (event: any) => void) { this.listeners.set(type, [...this.listeners.get(type) ?? [], fn]); }
  key(canvas: Element, key: string, repeat = false) {
    const event = { target: canvas, key, repeat, defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false,
      preventDefault() { this.defaultPrevented = true; } };
    canvas.fire('keydown', event); for (const fn of this.listeners.get('keydown') ?? []) fn(event); return event;
  }
}
function fixture(source = main) {
  const handle = new SimHandle(10, 8), sim = new SimBridge(handle, memory), document = new DocumentModel(), canvas = new Element(document);
  for (const id of ['build-batch-confirm', 'build-batch-cancel', 'build-exit-dialog', 'build-exit-title', 'build-exit-keep']) document.nodes.set(`#${id}`, new Element(document));
  const overlayPause = new OverlayPauseController({ setSpeed() {} }, () => {}, 1), changed = () => {};
  const wallTool = new WallTool(sim, 10, 8, { changed }), roomTool = new RoomTool(sim, 10, 8, { changed });
  const buyTool = new BuyTool(sim, 10, 8, { changed }), floorTool = new FloorTool(sim, 10, 8, { changed });
  const landTool = new LandTool(sim, 10, 8, { changed });
  const roomSelection = new RoomSelection(sim);
  let exit: BuildExit;
  let lifecycle = { needsReview: () => false, review: async (_review: BuildReview) => false,
    replaced: (_reason: 'load' | 'cancel' | 'end') => {} };
  const buildSession = new BuildSession(sim, { prepare: () => roomSelection.validate(), settled: () => true, restored() {},
    needsReview: () => lifecycle.needsReview(), review: review => lifecycle.review(review), replaced: reason => lifecycle.replaced(reason) });
  const left = vi.fn();
  const builder = new FurnitureBuilder(sim, overlayPause, { beforeEnter: () => buildSession.begin(), beforeExit: () => exit.gate(), changed, enter() {}, exit: left });
  const buildDraft = { session: buildSession, furniture: builder, tools: [wallTool, roomTool, buyTool, floorTool, landTool], pendingBookCommands: () => 0 };
  const commandStatus = { textContent: '', setAttribute: vi.fn() };
  const orderDiagnostics = new OrderDiagnostics(commandStatus);
  const feedbackBubbles = new Element(document);
  const buildBatchStatus = { textContent: '' };
  const context = { RoomsTool, RoomReviewController, BuildExit, BuildToolSwitch, routeBuildKey, hasUnconfirmedChanges, confirmRefusal, roomSelection, roomTool, wallTool, buyTool, floorTool, landTool,
    document, canvas, builder, buildDraft, buildSession, buildBatchStatus,
    windowTool: { handleKey() {} }, choresBoard: { update() {} }, refreshBuildArchitecture() {},
    selectionControls: undefined, reviewControls: undefined, toolSwitch: undefined, placementActions: undefined, cameraDirty: false,
    overlayPause, optionsMenu: { close() {} }, menu: { close() {}, isShowing: () => false },
    previousFrameMs: 0, frameElapsedMs, syncSystemLighting() {}, driver: {}, frameSimulation: {}, startingNewGame: false,
    MAX_TICKS_PER_FRAME: 5, BACKGROUND_MAX_TICKS: 300,
    persistence: { updateAutosave() {} }, sim, commandStatus, audio: { emit() {} }, bookResults: { drain() {} },
    orderDiagnostics, feedbackBubbles, floorScene: { visible: true }, graphicsRecovering: false,
    advanceSimulationFrame: () => { sim.flushCommands(); return 0; },
    advanceFrameWithCommandFeedback: (advance: () => number, after: () => void) => { const result = advance(); after(); return result; } };
  const bound = new Function('ctx', `with(ctx) { ${wiring(source)} }`)(context) as {
    roomsTool: RoomsTool; roomReview: RoomReviewController;
    buildTools: (WallTool | RoomsTool | BuyTool | FloorTool | LandTool)[]; buildExit: BuildExit; toolSwitch: BuildToolSwitch; blockedFrame(now: number): void;
    confirmBuildBatch(): Promise<boolean>; hasRetainedReviewChoices(): boolean; requestRoomReview(review: BuildReview): Promise<boolean>; replaceBuildLocalState(reason: 'load' | 'cancel' | 'end'): void };
  exit = bound.buildExit;
  lifecycle = { needsReview: bound.hasRetainedReviewChoices, review: bound.requestRoomReview, replaced: bound.replaceBuildLocalState };
  return { handle, sim, document, canvas, overlayPause, wallTool, roomTool, buyTool, floorTool, landTool, roomSelection, buildSession, buildBatchStatus, builder, left, ...bound,
    key: (key: string, repeat = false) => document.key(canvas, key, repeat), dialog: document.nodes.get('#build-exit-dialog')! };
}

async function reverseReviewedSplit(f: ReturnType<typeof fixture>, retainName = true) {
  expect(f.sim.buildRoom([1, 1, 7, 5], { axis: 0, x: 8, y: 3 })).toBe(true); f.sim.flushCommands();
  f.builder.enter(); const baseline = f.sim.saveBytes();
  for (let y = 1; y <= 5; y++) { expect(f.sim.setWallEdge(0, 4, y, 1)).toBe(true); f.sim.flushCommands(); }
  const opening = f.buildSession.confirm();
  let token;
  try {
    expect(f.roomReview.active).toBe(true); token = f.roomReview.review!.token;
    if (retainName) f.roomReview.setName([1, 1], 'Retained final name');
    f.roomReview.back(); expect(await opening).toBe(false);
  } finally { if (f.roomReview.active) f.roomReview.back(); await opening; }
  for (let y = 1; y <= 5; y++) { expect(f.sim.setWallEdge(0, 4, y, 0)).toBe(true); f.sim.flushCommands(); }
  f.wallTool.enter(); f.wallTool.clearSelection();
  expect(f.sim.buildDirty()).toBe(false); expect(f.roomSelection.hasLocalChanges()).toBe(false);
  expect(f.roomReview.hasChoices).toBe(retainName); expect(f.sim.saveBytes()).toEqual(baseline);
  return { baseline, token };
}

it('protects retained review text on clean reversal, keeps it on Keep building and adopts it before leaving once', async () => {
  const f = fixture(); let confirmation: boolean | Promise<boolean> = false;
  try {
    const { baseline, token } = await reverseReviewedSplit(f);
    f.key('Escape'); expect(f.dialog.open).toBe(true); expect(f.builder.active).toBe(true);
    expect(f.left).not.toHaveBeenCalled(); expect(f.roomReview.name([1, 1])).toBe('Retained final name');
    f.dialog.close('keep'); expect(f.roomReview.hasChoices).toBe(true); expect(f.sim.saveBytes()).toEqual(baseline);
    const prepare = vi.spyOn(f.sim, 'prepareBuildCommit'), commit = vi.spyOn(f.sim, 'commitBuild'), end = vi.spyOn(f.sim, 'endBuild');
    confirmation = f.buildExit.confirmAndLeave();
    expect(f.roomReview.active).toBe(true); expect(f.roomReview.review!.groups).toHaveLength(0);
    expect(f.roomReview.review!.token).not.toEqual(token); expect(f.roomReview.name([1, 1])).toBe('Retained final name');
    expect(prepare).toHaveBeenCalledOnce(); expect(commit).not.toHaveBeenCalled(); expect(f.left).not.toHaveBeenCalled();
    expect(f.buildExit.confirmAndLeave()).toBe(false);
    expect(await f.roomReview.confirm()).toBe(false); expect(f.sim.saveBytes()).toEqual(baseline); expect(f.left).not.toHaveBeenCalled();
    expect(await f.roomReview.confirm()).toBe(true); expect(await confirmation).toBe(true);
    expect(commit).toHaveBeenCalledOnce(); expect(end).toHaveBeenCalledOnce(); expect(f.left).toHaveBeenCalledOnce();
    expect(f.builder.active).toBe(false); expect(f.sim.buildActive()).toBe(false); expect(f.roomReview.hasChoices).toBe(false);
    const summaries = f.sim.roomSummaries(); expect(summaries.ok && summaries.value.rooms.some(room => room.name === 'Retained final name')).toBe(true);
  } finally { f.buildExit.dismiss(); f.roomReview.reset(); await confirmation; f.handle.free(); }
});

it.each(['discard', 'cancel'] as const)('clears retained review input only through explicit %s after a clean reversal', async action => {
  const f = fixture();
  try {
    const { baseline } = await reverseReviewedSplit(f); f.key('Escape'); expect(f.dialog.open).toBe(true);
    if (action === 'discard') f.dialog.close('discard');
    else { f.dialog.close('keep'); f.document.nodes.get('#build-batch-cancel')!.fire('click'); }
    expect(f.roomReview.hasChoices).toBe(false); expect(f.sim.saveBytes()).toEqual(baseline);
    expect(f.sim.buildDirty()).toBe(false); expect(f.builder.active).toBe(false);
    expect(f.left).toHaveBeenCalledOnce();
  } finally { f.handle.free(); }
});

it('leaves an exact reversal clean when the review has no retained choices', async () => {
  const f = fixture();
  try {
    const { baseline } = await reverseReviewedSplit(f, false); f.key('Escape');
    expect(f.dialog.open).toBe(false); expect(f.builder.active).toBe(false); expect(f.left).toHaveBeenCalledOnce();
    expect(f.sim.saveBytes()).toEqual(baseline);
  } finally { f.handle.free(); }
});

function escapeScenario(source = main): void {
  const f = fixture(source);
  try {
    f.builder.enter(); f.sim.stageRoomName(0, 'Dirty draft'); const saved = f.sim.saveBytes();
    f.wallTool.enter(); f.wallTool.choose({ axis: 0, x: 4, y: 3 }); expect(f.buildSession.hasChanges()).toBe(true);
    f.key('Escape'); expect(f.wallTool.highlight()).toBeNull(); expect(f.dialog.open).toBe(false);
    expect(f.buildSession.hasChanges()).toBe(true); expect(f.sim.saveBytes()).toEqual(saved);
    f.key('Escape', true); expect(f.dialog.open).toBe(false);
    f.key('Escape'); expect(f.dialog.open).toBe(true); expect(f.builder.active).toBe(true);
  } finally { f.handle.free(); }
}
function reviewEscapeScenario(source = main): void {
  const f = fixture(source);
  try {
    f.sim.buildRoom([1, 1, 7, 5], { axis: 0, x: 8, y: 3 }); f.sim.flushCommands(); f.builder.enter();
    for (let y = 1; y <= 5; y++) { f.sim.setWallEdge(0, 4, y, 1); f.sim.flushCommands(); }
    const result = f.sim.prepareBuildCommit(); if (!result.ok) throw Error('Native preparation refused');
    f.roomReview.open(result.value); f.key('Escape');
    expect(f.roomReview.active).toBe(false); expect(f.builder.active).toBe(true); expect(f.buildSession.hasChanges()).toBe(true);
    expect(f.sim.buildComponentTiles(result.value.token, [1, 1]).ok).toBe(false); expect(f.dialog.open).toBe(false);
  } finally { f.handle.free(); }
}
function roomsScenario(source = main): void {
  const f = fixture(source);
  try {
    f.builder.enter(); f.roomsTool.enter(); f.roomSelection.select(0); f.roomSelection.edit('Pending');
    const furniture = vi.spyOn(f.builder, 'handleKey'); f.key('Enter'); expect(f.buildSession.hasChanges()).toBe(true); expect(furniture).not.toHaveBeenCalled();
    f.key('Escape'); expect(f.roomSelection.selected).toBeNull(); expect(f.dialog.open).toBe(false);
    f.roomsTool.setMode('build'); f.roomTool.choosePoint(2, 2); f.key('Escape'); expect(f.roomTool.first).toBeNull();
  } finally { f.handle.free(); }
}
function blockingScenario(source: string, overlay: boolean, review: boolean): void {
  const f = fixture(source);
  try {
    f.builder.enter(); f.wallTool.enter(); f.wallTool.choose({ axis: 0, x: 4, y: 3 });
    if (overlay) f.overlayPause.suspend('graphics');
    if (review) { const prepared = f.sim.prepareBuildCommit(); if (!prepared.ok) throw Error('Prepare refused'); f.roomReview.open(prepared.value); }
    f.blockedFrame(10); f.wallTool.handleKey('w'); f.sim.flushCommands();
    expect(f.sim.lastWallEditResult() !== null).toBe(!overlay && !review);
    if (!overlay && !review) expect(f.sim.lastWallEditResult()).toMatchObject({ axis: 0, x: 4, y: 3, state: 1, reason: null });
  } finally { f.handle.free(); }
}
it('executes the actual canvas/document Escape route without discarding the native draft', () => escapeScenario());
it('executes review Back before any ordinary tool or exit action', () => reviewEscapeScenario());
it('routes both Rooms modes through the actual page array', () => roomsScenario());
it.each([[false, false], [true, false], [false, true], [true, true]])('blocks real wall staging for overlay=%s review=%s', (overlay, review) => blockingScenario(main, overlay, review));
it.each(['walls', 'buy', 'floors', 'land'] as const)('routes the actual %s destination without reaching hidden furniture', name => {
  const f = fixture();
  try {
    f.builder.enter(); const tool = { walls: f.wallTool, buy: f.buyTool, floors: f.floorTool, land: f.landTool }[name]; tool.enter();
    const read = vi.spyOn(tool, 'handleKey'), furniture = vi.spyOn(f.builder, 'handleKey'); f.key('ArrowLeft');
    expect(read).toHaveBeenCalledOnce(); expect(furniture).not.toHaveBeenCalled();
  } finally { f.handle.free(); }
});

it.each(['confirm', 'discard', 'keep'] as const)('executes actual pending Land page bindings: %s', async answer => {
  const f = fixture();
  try {
    f.builder.enter(); f.roomsTool.enter(); f.roomSelection.select(0); f.roomSelection.edit('Renamed outside');
    const tick = f.sim.clockTick();
    expect(f.toolSwitch.select('build-tool-land')).toBe(false);
    expect(f.dialog.open).toBe(true); expect(f.landTool.active).toBe(false);
    expect(f.document.querySelector('#build-exit-title').textContent).toBe('Switch to Land?');
    expect(f.roomSelection.text).toBe('Renamed outside');
    f.dialog.close(answer); await Promise.resolve(); await Promise.resolve();
    expect(f.builder.active).toBe(true); expect(f.buildSession.active).toBe(true);
    expect(f.landTool.active).toBe(answer !== 'keep'); expect(f.sim.clockTick()).toBe(tick);
    expect(f.left).not.toHaveBeenCalled();
    if (answer === 'keep') {
      expect(f.roomSelection.text).toBe('Renamed outside'); expect(f.buildSession.hasChanges()).toBe(true);
    } else {
      expect(f.buildSession.hasChanges()).toBe(false);
      const rooms = new RoomSelection(f.sim); rooms.select(0);
      expect(rooms.text).toBe(answer === 'confirm' ? 'Renamed outside' : 'Outside');
    }
  } finally { f.handle.free(); }
});

it('Land keeps an invalid raw name unchanged until an explicit decision', () => {
  const f = fixture();
  try {
    f.builder.enter(); f.roomsTool.enter(); f.roomSelection.select(0); f.roomSelection.edit('');
    f.toolSwitch.select('build-tool-land'); expect(f.dialog.open).toBe(true);
    f.dialog.close('keep'); expect(f.roomSelection.text).toBe(''); expect(f.roomSelection.error).not.toBe('');
    expect(f.landTool.active).toBe(false); expect(f.roomsTool.active).toBe(true);
  } finally { f.handle.free(); }
});

it.each(['footer', 'exit', 'land'] as const)('correcting refused review input preserves an ordinary exit and cancels only a Land destination: %s', async route => {
  const f = fixture();
  try {
    expect(f.sim.buildRoom([1, 1, 7, 5], { axis: 0, x: 8, y: 3 })).toBe(true); f.sim.flushCommands();
    f.builder.enter(); const baseline = f.sim.saveBytes(), tick = f.sim.clockTick();
    for (let y = 1; y <= 5; y++) { expect(f.sim.setWallEdge(0, 4, y, 1)).toBe(true); f.sim.flushCommands(); }
    const commit = vi.spyOn(f.sim, 'commitBuild');
    if (route === 'footer') f.document.nodes.get('#build-batch-confirm')!.fire('click');
    else {
      if (route === 'land') f.toolSwitch.select('build-tool-land');
      else f.key('Escape');
      expect(f.dialog.open).toBe(true); f.dialog.close('confirm');
    }
    expect(f.roomReview.active).toBe(true);
    f.roomReview.setName([1, 1], '');
    expect(await f.roomReview.confirm()).toBe(false);
    expect(f.roomReview.error).not.toBe(''); expect(f.roomReview.name([1, 1])).toBe('');
    expect(f.roomReview.active).toBe(true); expect(f.builder.active).toBe(true);
    expect(f.sim.saveBytes()).toEqual(baseline); expect(commit).not.toHaveBeenCalled();
    f.roomReview.setName([1, 1], 'Corrected room');
    expect(await f.roomReview.confirm()).toBe(false);
    expect(f.roomReview.active).toBe(true); expect(commit).not.toHaveBeenCalled();
    expect(await f.roomReview.confirm()).toBe(true);
    await vi.waitFor(() => expect(f.buildExit.resolving).toBe(false));
    expect(commit).toHaveBeenCalledOnce(); expect(f.sim.clockTick()).toBe(tick);
    const summaries = f.sim.roomSummaries();
    expect(summaries.ok && summaries.value.rooms.some(room => room.name === 'Corrected room')).toBe(true);
    expect(f.builder.active).toBe(route === 'land'); expect(f.buildSession.active).toBe(route === 'land');
    expect(f.landTool.active).toBe(false); expect(f.left).toHaveBeenCalledTimes(route === 'land' ? 0 : 1);
  } finally { f.buildExit.dismiss(); f.roomReview.reset(); f.handle.free(); }
});

it('actual clean Land switch starts a fresh native session without leaving Build', () => {
  const f = fixture();
  try {
    f.builder.enter(); const tick = f.sim.clockTick();
    expect(f.toolSwitch.select('build-tool-land')).toBe(true);
    expect(f.landTool.active).toBe(true); expect(f.dialog.open).toBe(false);
    expect(f.builder.active).toBe(true); expect(f.buildSession.active).toBe(true);
    expect(f.buildSession.hasChanges()).toBe(false); expect(f.sim.clockTick()).toBe(tick);
    expect(f.left).not.toHaveBeenCalled();
  } finally { f.handle.free(); }
});

it('same-tool Land selection keeps its chosen strip and session without a prompt', () => {
  const f = fixture();
  try {
    f.builder.enter(); f.landTool.enter(); f.landTool.choose(0); f.sim.stageRoomName(0, 'Draft outside');
    expect(f.toolSwitch.select('build-tool-land')).toBe(true);
    expect(f.dialog.open).toBe(false); expect(f.landTool.side).toBe(0);
    expect(f.buildSession.hasChanges()).toBe(true); expect(f.landTool.active).toBe(true);
  } finally { f.handle.free(); }
});

it.each(['build-tool-walls', 'build-tool-furniture'])('does not stage another tool behind a pending Land purchase: %s', button => {
  const f = fixture();
  try {
    f.builder.enter(); f.landTool.enter();
    vi.spyOn(f.landTool, 'pending', 'get').mockReturnValue(true);
    expect(f.toolSwitch.select(button)).toBe(false);
    expect(f.landTool.active).toBe(true); expect(f.wallTool.active).toBe(false);
    expect(f.dialog.open).toBe(false); expect(f.builder.active).toBe(true);
  } finally { f.handle.free(); }
});

it.each(['back', 'load', 'graphics'] as const)('cancels native Land review continuation on %s', async action => {
  const f = fixture();
  try {
    f.sim.buildRoom([1, 1, 7, 5], { axis: 0, x: 8, y: 3 }); f.sim.flushCommands();
    f.builder.enter(); const baseline = f.sim.saveBytes(), tick = f.sim.clockTick();
    for (let y = 1; y <= 5; y++) { f.sim.setWallEdge(0, 4, y, 1); f.sim.flushCommands(); }
    f.toolSwitch.select('build-tool-land'); f.dialog.close('confirm');
    expect(f.roomReview.active).toBe(true); expect(f.landTool.active).toBe(false);
    f.roomReview.setName([1, 1], 'Retained review name');
    if (action === 'back') f.roomReview.back();
    else if (action === 'load') expect(f.buildSession.loadBytes(baseline)).toBe(true);
    else {
      f.buildExit.dismiss();
      expect(await f.roomReview.confirm()).toBe(false);
      expect(await f.roomReview.confirm()).toBe(true);
    }
    await vi.waitFor(() => expect(f.buildExit.resolving).toBe(false));
    expect(f.landTool.active).toBe(false); expect(f.builder.active).toBe(true);
    expect(f.buildSession.active).toBe(true); expect(f.sim.clockTick()).toBe(tick);
    expect(f.left).not.toHaveBeenCalled();
    if (action === 'back') expect(f.roomReview.name([1, 1])).toBe('Retained review name');
  } finally { f.buildExit.dismiss(); f.roomReview.reset(); f.handle.free(); }
});

it('ordinary review Back preserves native/raw choices and clears status without reporting a failure', async () => {
  const f = fixture(); let result: Promise<boolean> | undefined;
  try {
    f.sim.buildRoom([1, 1, 7, 5], { axis: 0, x: 8, y: 3 }); f.sim.flushCommands();
    f.builder.enter(); const baseline = f.sim.saveBytes();
    for (let y = 1; y <= 5; y++) { f.sim.setWallEdge(0, 4, y, 1); f.sim.flushCommands(); }
    f.buildBatchStatus.textContent = 'Old status'; result = f.confirmBuildBatch();
    expect(f.roomReview.active).toBe(true); f.roomReview.setName([1, 1], '  raw review name  ');
    f.roomReview.back(); expect(await result).toBe(false);
    expect(f.buildBatchStatus.textContent).toBe('');
    expect(f.roomReview.name([1, 1])).toBe('  raw review name  ');
    expect(f.sim.buildDirty()).toBe(true); expect(f.sim.saveBytes()).toEqual(baseline);
    expect(f.builder.active).toBe(true); expect(f.buildSession.active).toBe(true);
    vi.spyOn(f.sim, 'prepareBuildCommit').mockReturnValue({ ok: false, error: { code: 10, detail: 7n } });
    expect(await f.confirmBuildBatch()).toBe(false);
    expect(f.buildSession.confirmationCancelled).toBe(false);
    expect(f.buildBatchStatus.textContent).toBe(f.buildSession.error);
    expect(f.buildBatchStatus.textContent).not.toBe('');
  } finally { f.roomReview.reset(); await result; f.handle.free(); }
});

it('a genuinely invalid room name keeps a useful refusal in the actual page status', async () => {
  const f = fixture();
  try {
    f.builder.enter(); f.roomSelection.select(0); f.roomSelection.edit('');
    expect(await f.confirmBuildBatch()).toBe(false);
    expect(f.buildBatchStatus.textContent).toBe(f.roomSelection.error);
    expect(f.buildBatchStatus.textContent).not.toBe('');
    expect(f.builder.active).toBe(true); expect(f.roomSelection.text).toBe('');
  } finally { f.handle.free(); }
});

const faults = [
  ['M1 preventDefault', 'buildExit.pressEscape(event.repeat); event.preventDefault(); return;', 'buildExit.pressEscape(event.repeat); return;', escapeScenario],
  ['M2 review Back', "if (roomReview.active) roomReview.back(); else routeBuildKey('Escape', buildTools, builder);", "routeBuildKey('Escape', buildTools, builder);", reviewEscapeScenario],
  ['M3 Rooms wrapper', '[wallTool, roomsTool, buyTool, floorTool, landTool] as const', '[wallTool, roomTool, buyTool, floorTool, landTool] as const', roomsScenario],
  ['M4 review blocker', "wallTool.setBlocked(overlayPause.suspendedExcept('builder') || roomReview.active);", "wallTool.setBlocked(overlayPause.suspendedExcept('builder'));", (source: string) => blockingScenario(source, false, true)],
  ['M5 overlay blocker', "wallTool.setBlocked(overlayPause.suspendedExcept('builder') || roomReview.active);", 'wallTool.setBlocked(roomReview.active);', (source: string) => blockingScenario(source, true, false)],
  ['M6 always blocked', "wallTool.setBlocked(overlayPause.suspendedExcept('builder') || roomReview.active);", 'wallTool.setBlocked(true);', (source: string) => blockingScenario(source, false, false)],
] as const;
it.each(faults)('rejects the isolated %s defect through a behavioral assertion', (_name, before, after, scenario) => {
  expect(main.split(before)).toHaveLength(2);
  try { scenario(main.replace(before, after)); throw Error('Fault survived'); }
  catch (error) {
    expect(error).toMatchObject({ name: 'AssertionError' });
    if (process.env.R7_WIRING_RECEIPTS) appendFileSync(process.env.R7_WIRING_RECEIPTS,
      JSON.stringify({ fault: _name, rejected: true, message: (error as Error).message }) + '\n');
  }
});
