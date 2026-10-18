import { appendFileSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { beforeAll, expect, it, vi } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { BuildSession } from '../src/ui/build-session.js';
import { BuildExit, hasUnconfirmedChanges } from '../src/ui/build-exit.js';
import { routeBuildKey } from '../src/ui/build-tools.js';
import { FurnitureBuilder } from '../src/ui/builder.js';
import { WallTool } from '../src/ui/wall-tool.js';
import { RoomTool } from '../src/ui/room-tool.js';
import { RoomSelection, RoomsTool } from '../src/ui/room-selection.js';
import { RoomReviewController } from '../src/ui/room-review.js';
import { BuyTool } from '../src/ui/buy-tool.js';
import { FloorTool } from '../src/ui/floor-tool.js';
import { LandTool } from '../src/ui/land-tool.js';
import { OverlayPauseController } from '../src/ui/overlay-pause.js';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
let memory: WebAssembly.Memory;
beforeAll(async () => { memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory; });

/** Extract complete top-level bindings and the contiguous frame prefix, never individual predicates. */
function wiring(source: string): string {
  const file = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const one = <T>(rows: readonly T[], name: string): T => { if (rows.length !== 1) throw Error(`Expected exactly one ${name}`); return rows[0]; };
  const body = one(file.statements.filter(ts.isFunctionDeclaration).filter(node => node.name?.text === 'main'), 'main').body!;
  const declaration = (name: string) => one(body.statements.filter(ts.isVariableStatement).filter(node => node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === name)), name).getText(file);
  const listener = one(body.statements.filter(ts.isExpressionStatement).filter(node => {
    const call = node.expression;
    return ts.isCallExpression(call) && call.expression.getText(file) === 'canvas.addEventListener'
      && ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === 'keydown';
  }), 'canvas keydown');
  const frame = one(body.statements.filter(ts.isFunctionDeclaration).filter(node => node.name?.text === 'frame'), 'frame').body!;
  const end = frame.statements.findIndex(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(file) === 'landTool.setBlocked');
  if (end < 0) throw Error('Missing complete frame blocking prefix');
  return ts.transpile(`${declaration('roomsTool')}\n${declaration('buildTools')}\n${declaration('buildExit')}\n${listener.getText(file)}
    function blockedFrame(nowMs: number) { ${frame.statements.slice(0, end + 1).map(node => node.getText(file)).join('\n')} }
    return { roomsTool, buildTools, buildExit, blockedFrame };`, { target: ts.ScriptTarget.ES2022 });
}

class Element {
  disabled = false; isConnected = true; open = false; returnValue = ''; textContent = '';
  listeners = new Map<string, ((event: any) => void)[]>();
  constructor(readonly doc: DocumentModel) {}
  addEventListener(type: string, fn: (event: any) => void) { this.listeners.set(type, [...this.listeners.get(type) ?? [], fn]); }
  fire(type: string, event: any = {}) { for (const fn of this.listeners.get(type) ?? []) fn(event); }
  focus() { this.doc.activeElement = this; } closest() { return null; }
  showModal() { this.open = true; } close(value = '') { this.open = false; this.returnValue = value; this.fire('close'); }
}
class DocumentModel {
  activeElement: Element | null = null; body = new Element(this);
  nodes = new Map<string, Element>(); listeners = new Map<string, ((event: any) => void)[]>();
  querySelector(selector: string) { return this.nodes.get(selector); }
  addEventListener(type: string, fn: (event: any) => void) { this.listeners.set(type, [...this.listeners.get(type) ?? [], fn]); }
  key(canvas: Element, key: string, repeat = false) {
    const event = { target: canvas, key, repeat, defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false,
      preventDefault() { this.defaultPrevented = true; } };
    canvas.fire('keydown', event); for (const fn of this.listeners.get('keydown') ?? []) fn(event); return event;
  }
}
function fixture(source = main) {
  const handle = new SimHandle(10, 8), sim = new SimBridge(handle, memory), document = new DocumentModel(), canvas = new Element(document);
  for (const id of ['build-batch-confirm', 'build-batch-cancel', 'build-exit-dialog', 'build-exit-keep']) document.nodes.set(`#${id}`, new Element(document));
  const overlayPause = new OverlayPauseController({ setSpeed() {} }, () => {}, 1), changed = () => {};
  const wallTool = new WallTool(sim, 10, 8, { changed }), roomTool = new RoomTool(sim, 10, 8, { changed });
  const buyTool = new BuyTool(sim, 10, 8, { changed }), floorTool = new FloorTool(sim, 10, 8, { changed });
  const landTool = new LandTool(sim, 10, 8, { changed });
  const roomSelection = new RoomSelection(sim);
  let exit: BuildExit;
  const roomReview = new RoomReviewController(sim, { completed: () => exit.clearExitIntent() });
  const buildSession = new BuildSession(sim, { prepare: () => true, settled: () => true, restored() {} });
  const builder = new FurnitureBuilder(sim, overlayPause, { beforeEnter: () => buildSession.begin(), beforeExit: () => exit.gate(), changed, enter() {}, exit() {} });
  const buildDraft = { session: buildSession, furniture: builder, tools: [wallTool, roomTool, buyTool, floorTool, landTool], pendingBookCommands: () => 0 };
  const context = { RoomsTool, BuildExit, routeBuildKey, hasUnconfirmedChanges, roomSelection, roomReview, roomTool, wallTool, buyTool, floorTool, landTool,
    document, canvas, builder, buildDraft, buildSession, buildBatchStatus: { textContent: '' }, confirmBuildBatch: () => buildSession.confirm(),
    selectionControls: undefined, toolSwitch: undefined, placementActions: undefined, cameraDirty: false,
    overlayPause, optionsMenu: { close() {} }, menu: { close() {}, isShowing: () => false },
    previousFrameMs: 0, syncSystemLighting() {}, driver: {}, frameSimulation: {}, startingNewGame: false,
    persistence: { updateAutosave() {} }, sim, commandStatus: {}, audio: { emit() {} }, bookResults: { drain() {} },
    advanceSimulationFrame: () => { sim.flushCommands(); return 0; },
    advanceFrameWithCommandFeedback: (advance: () => number, after: () => void) => { const result = advance(); after(); return result; } };
  const bound = new Function('ctx', `with(ctx) { ${wiring(source)} }`)(context) as {
    roomsTool: RoomsTool; buildTools: (WallTool | RoomsTool | BuyTool | FloorTool | LandTool)[]; buildExit: BuildExit; blockedFrame(now: number): void };
  exit = bound.buildExit;
  return { handle, sim, document, canvas, overlayPause, wallTool, roomTool, buyTool, floorTool, landTool, roomSelection, roomReview, buildSession, builder, ...bound,
    key: (key: string, repeat = false) => document.key(canvas, key, repeat), dialog: document.nodes.get('#build-exit-dialog')! };
}

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
