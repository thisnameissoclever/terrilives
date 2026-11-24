import { beforeAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { RoomReviewController, RoomReviewControls } from '../src/ui/room-review.js';
import { BuildSession } from '../src/ui/build-session.js';
import type { BuildReview } from '../src/rooms/codec.js';
import type { RoomBridge } from '../src/ui/room-selection.js';

let memory: WebAssembly.Memory;
beforeAll(async () => { memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory; });

function fixture(groups: BuildReview['groups'] = []) {
  const review: BuildReview = { token: { session: 1n, revision: 2n, preparation: 3n }, groups,
    rooms: [], retiredNames: [], duties: { duties: [], replannedPeople: [], unavailablePeople: [] },
    access: { regions: [{ tiles: [[1, 2]], people: [], targets: [], externalAccess: false, unreachableBy: [] }], blockedTargets: [] } };
  const source = { roomSummaries: () => ({ ok: true, value: { width: 5, height: 5, rooms: [] } }),
    buildComponentPredecessors: () => ({ ok: true, value: [] }), buildComponentTiles: () => ({ ok: true, value: [] }),
    discardBuildReview: vi.fn(() => ({ ok: true })), prepareBuildCommit: vi.fn(() => ({ ok: true, value: review })),
    commitBuild: vi.fn(() => ({ ok: true })), commitBuildWithAccessAck: vi.fn(() => ({ ok: true })),
    buildActive: () => true, flushCommands() {}, takeBuildError: () => ({ ok: true, value: null }) };
  const controller = new RoomReviewController(source as unknown as RoomBridge);
  return { review, source, controller };
}

function renderAccessSummary(access: BuildReview['access'], personName: (id:number) => string, objectName: (id:number) => string): string[] {
  const f = fixture(); f.review.access = access;
  class Element {
    textContent = ''; value = ''; hidden = false; disabled = false; dataset: Record<string,string> = {}; nodes: Element[] = [];
    addEventListener() {} focus() {} closest() { return null; } matches() { return false; }
    append(...nodes: Element[]) { this.nodes.push(...nodes); } replaceChildren() { this.nodes = []; }
  }
  const nodes = new Map(['builder-controls','room-review','room-review-heading','room-review-group','room-review-body','room-review-status','room-review-back','room-review-confirm'].map(id=>[`#${id}`,new Element()]));
  const doc = { activeElement: null, querySelector: (selector:string) => nodes.get(selector), createElement: () => new Element() };
  const controls = new RoomReviewControls(doc as unknown as Document, f.controller, () => {}, () => '', personName, () => {}, objectName);
  f.controller.open(f.review); controls.render();
  return nodes.get('#room-review-body')!.nodes.map(node => node.textContent);
}

it('summarizes equivalent empty areas once with the actual count and deduplicated people', () => {
  const f = fixture();
  f.review.access.regions = [
    { tiles: [[1,1]], people: [], targets: [], externalAccess: false, unreachableBy: [7,8] },
    { tiles: [[3,3]], people: [], targets: [], externalAccess: false, unreachableBy: [8,7] },
  ];
  expect(renderAccessSummary(f.review.access, id => id === 7 ? 'Alex' : 'Robin', () => 'Chair')).toEqual([
    '2 highlighted areas have no external access.', 'Alex, Robin cannot reach 2 highlighted areas.'
  ]);
});

it('distinguishes different enclosed people and reachability while preserving blocked object consequences', () => {
  const f = fixture();
  f.review.access.regions = [
    { tiles: [[1,1]], people: [7], targets: [], externalAccess: false, unreachableBy: [8] },
    { tiles: [[3,3]], people: [8], targets: [], externalAccess: true, unreachableBy: [7] },
  ];
  f.review.access.blockedTargets = [{ target: 9, tiles: [[4,4]] }, { target: 10, tiles: [[5,5]] }];
  expect(renderAccessSummary(f.review.access, id => id === 7 ? 'Alex' : 'Robin', () => 'Chair')).toEqual([
    'Alex cannot reach outside from the highlighted area.',
    'Robin cannot reach the highlighted area containing Alex.',
    'Alex cannot reach the highlighted area containing Robin.',
    '2 objects have no reachable approach: Chair (2).',
  ]);
});

it('keeps a larger equivalent report concise without dropping areas or repeating the same person', () => {
  const f = fixture();
  f.review.access.regions = Array.from({ length: 120 }, (_, x) =>
    ({ tiles: [[x,1]], people: [], targets: [], externalAccess: false, unreachableBy: [7] }));
  expect(renderAccessSummary(f.review.access, () => 'Alex', () => 'Chair')).toEqual([
    '120 highlighted areas have no external access.', 'Alex cannot reach 120 highlighted areas.',
  ]);
});

it('counts occupied areas separately from empty areas and deduplicates people across equivalent consequences', () => {
  const f = fixture();
  f.review.access.regions = [
    { tiles: [[1,1]], people: [7], targets: [], externalAccess: false, unreachableBy: [9] },
    { tiles: [[3,3]], people: [8], targets: [], externalAccess: false, unreachableBy: [9] },
    { tiles: [[5,5]], people: [], targets: [], externalAccess: false, unreachableBy: [9] },
  ];
  const names = new Map([[7,'Alex'],[8,'Robin'],[9,'Sam']]);
  expect(renderAccessSummary(f.review.access, id => names.get(id)!, () => 'Chair')).toEqual([
    '1 highlighted area has no external access.',
    '2 highlighted areas contain people who cannot reach outside: Alex, Robin.',
    'Sam cannot reach 3 highlighted areas. People inside: Alex, Robin.',
  ]);
});
it('routes access-only candidates through review instead of strict adoption', async () => {
  const f = fixture(); const review = vi.fn(async () => false);
  const session = new BuildSession(f.source as never, { prepare: () => true, settled: () => true, restored() {}, review });
  expect(await session.confirm()).toBe(false); expect(review).toHaveBeenCalledWith(f.review);
  expect(f.source.commitBuild).not.toHaveBeenCalled();
});
it('acknowledges only the candidate displayed in the access phase and ignores repeated confirmation', async () => {
  const f = fixture(); f.controller.open(f.review);
  expect(f.controller.accessActive).toBe(true);
  expect(await f.controller.confirm()).toBe(true); expect(await f.controller.confirm()).toBe(false);
  expect(f.source.commitBuildWithAccessAck).toHaveBeenCalledExactlyOnceWith(f.review.token);
  expect(f.source.commitBuild).not.toHaveBeenCalled();
});
it('retains native ground when returning and clears it when geometry changes', () => {
  const f = fixture(); f.controller.open(f.review); f.controller.back();
  expect(f.controller.active).toBe(false); expect(f.controller.highlight()?.tiles).toEqual([[1, 2]]);
  f.controller.geometryChanged(); expect(f.controller.highlight()).toBeNull();
});
it('finishes room preparation before showing access acknowledgment', async () => {
  const f = fixture([{ kind: 3, oldIds: [1], finalAnchors: [], formerTiles: [[2, 2]], openings: [] }]);
  f.controller.open(f.review); expect(f.controller.accessActive).toBe(false);
  expect(await f.controller.confirm()).toBe(false); expect(f.controller.accessActive).toBe(true);
  expect(f.source.commitBuildWithAccessAck).not.toHaveBeenCalled();
  expect(await f.controller.confirm()).toBe(true);
});
it('keeps the access prompt and exact token on stale-candidate failure', async () => {
  const f = fixture(); f.source.commitBuildWithAccessAck.mockReturnValue({ ok: false, error: { code: 11, detail: 0n } } as never);
  f.controller.open(f.review); expect(await f.controller.confirm()).toBe(false);
  expect(f.controller.active).toBe(true); expect(f.controller.error).toContain('out of date');
  expect(f.source.prepareBuildCommit).not.toHaveBeenCalled();
});

it('adopts a sealed area with no on-lot person only after access acknowledgment, then saves without another prompt', async () => {
  const handle = new SimHandle(5, 5), source = new SimBridge(handle, memory);
  try {
    const before = source.saveBytes(); expect(source.beginBuild().ok).toBe(true);
    source.buildRoom([1, 1, 2, 2], null); source.flushCommands();
    const prepared = source.prepareBuildCommit(); expect(prepared.ok).toBe(true); if (!prepared.ok) return;
    expect(prepared.value.access.regions).not.toHaveLength(0);
    expect(prepared.value.access.regions.every(region => region.people.length === 0)).toBe(true);
    const controller = new RoomReviewController(source); controller.open(prepared.value);
    expect(source.commitBuild(prepared.value.token).ok).toBe(false);
    expect(source.saveBytes()).toEqual(before);
    if (!controller.accessActive) { expect(await controller.confirm()).toBe(false); }
    expect(await controller.confirm()).toBe(true);
    const saved = source.saveBytes(); expect(saved).not.toEqual(before); expect(source.loadBytes(saved)).toBe(true);
    expect(source.saveBytes()).toEqual(saved); expect(controller.active).toBe(false);
  } finally { handle.free(); }
});

it('focuses Return, exposes exactly two access actions, and treats Escape as Return', () => {
  const f = fixture(); f.review.access.regions[0].people = [7];
  f.review.access.blockedTargets = [{ target: 8, tiles: [[2, 2]] }];
  class Element {
    textContent = ''; value = ''; hidden = false; disabled = false; isConnected = true; dataset: Record<string,string> = {};
    nodes: Element[] = []; listeners = new Map<string, (event: unknown) => void>();
    addEventListener(type: string, listener: (event: unknown) => void) { this.listeners.set(type, listener); }
    append(...nodes: Element[]) { this.nodes.push(...nodes); } replaceChildren() { this.nodes = []; }
    focus() { doc.activeElement = this; } closest() { return null; } matches() { return false; }
  }
  const nodes = new Map(['builder-controls','room-review','room-review-heading','room-review-group','room-review-body','room-review-status','room-review-back','room-review-confirm'].map(id=>[`#${id}`,new Element()]));
  const doc = { activeElement: null as Element|null, querySelector: (selector: string) => nodes.get(selector), createElement: () => new Element() };
  const controls = new RoomReviewControls(doc as unknown as Document, f.controller, () => {}, () => '', () => 'Alex', () => {}, () => 'Chair');
  f.controller.open(f.review); controls.render();
  expect(nodes.get('#room-review-back')!.textContent).toBe('Return to build mode');
  expect(nodes.get('#room-review-confirm')!.textContent).toBe('Confirm');
  expect(doc.activeElement).toBe(nodes.get('#room-review-back'));
  expect(nodes.get('#room-review-group')!.hidden).toBe(true);
  expect(nodes.get('#room-review-body')!.nodes.map(node => node.textContent)).toEqual([
    'Alex cannot reach outside from the highlighted area.', 'Chair has no reachable approach.'
  ]);
  nodes.get('#room-review')!.listeners.get('keydown')!({ key:'Escape', repeat:false, preventDefault(){}, stopPropagation(){} });
  expect(f.controller.active).toBe(false); expect(f.controller.highlight()?.tiles).toContainEqual([1, 2]);
});
