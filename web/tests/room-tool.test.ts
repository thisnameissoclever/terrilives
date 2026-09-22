import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge, roomReason, type EdgeLine, type RoomPreview, type RoomResult } from '../src/bridge.js';
import { routeBuildKey } from '../src/ui/build-tools.js';
import { CHOOSE_CORNER, RoomTool, roomOutline } from '../src/ui/room-tool.js';
import { RoomToolControls } from '../src/ui/room-tool-controls.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

let wasmMemory: WebAssembly.Memory;
beforeAll(async () => {
  const wasm = await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') });
  wasmMemory = wasm.memory;
});

/** A scripted source: one refusal code for every room, a staging log, a result. */
class FakeRooms {
  code = 0;
  changes = true;
  accept = true;
  staged: [number[], EdgeLine | null][] = [];
  previews = 0;
  result: RoomResult | null = null;
  revision = 0;

  roomEditPreview(): RoomPreview {
    this.previews += 1;
    return { valid: this.code === 0, reason: roomReason(this.code), code: this.code,
      changes: this.code === 0 && this.changes };
  }

  buildRoom(corners: readonly number[], doorway: EdgeLine | null): boolean {
    this.staged.push([[...corners], doorway]);
    return this.accept;
  }

  lastRoomResult(): RoomResult | null { return this.result; }
  lotRevision(): number { return this.revision; }
}

function tool() {
  const source = new FakeRooms();
  const room = new RoomTool(source, 7, 5, { changed: () => undefined });
  return { room, source };
}

/** Tiles are centred on whole numbers; a click at a tile's centre. */
function clickTile(room: RoomTool, x: number, y: number) {
  room.choosePoint(x, y);
}

describe('roomOutline', () => {
  it('lists the interior lines of the outline, top and bottom, then left and right', () => {
    expect(roomOutline(7, 5, [2, 1], [3, 2])).toEqual([
      { axis: 1, x: 2, y: 1 }, { axis: 1, x: 3, y: 1 },
      { axis: 1, x: 2, y: 3 }, { axis: 1, x: 3, y: 3 },
      { axis: 0, x: 2, y: 1 }, { axis: 0, x: 2, y: 2 },
      { axis: 0, x: 4, y: 1 }, { axis: 0, x: 4, y: 2 },
    ]);
    // Either corner order gives the same outline.
    expect(roomOutline(7, 5, [3, 2], [2, 1])).toEqual(roomOutline(7, 5, [2, 1], [3, 2]));
    // The lot's own edge is the outside wall and is left out.
    expect(roomOutline(7, 5, [0, 0], [0, 0])).toEqual([{ axis: 1, x: 0, y: 1 }, { axis: 0, x: 1, y: 0 }]);
    expect(roomOutline(7, 5, [0, 0], [6, 4])).toEqual([]);
  });
});

describe('RoomTool', () => {
  it('asks for a corner, then the opposite corner, and previews the room', () => {
    const { room, source } = tool();
    room.enter();
    expect(room.status).toBe(CHOOSE_CORNER);
    clickTile(room, 2, 1);
    expect([room.first, room.second, room.status, source.previews]).toEqual([[2, 1], null,
      'Choose the opposite corner.', 0]);
    expect(room.highlight()).toEqual({ tiles: [[2, 1]], valid: true });
    clickTile(room, 3, 2);
    expect(room.second).toEqual([3, 2]);
    expect(room.status).toBe('Ready to build. Choose a line of the outline for a doorway.');
    expect(room.highlight()?.tiles).toEqual([[2, 1], [3, 1], [2, 2], [3, 2]]);
    expect(room.canBuild).toBe(true);
  });

  it('ignores a click off the lot and anything before the tool is entered', () => {
    const { room } = tool();
    clickTile(room, 2, 1);
    expect(room.first).toBeNull();
    room.enter();
    clickTile(room, -1, 1);
    clickTile(room, 7, 1);
    expect(room.first).toBeNull();
  });

  it('toggles the doorway with a click on the outline, and starts over elsewhere', () => {
    const { room } = tool();
    room.enter();
    clickTile(room, 2, 1);
    clickTile(room, 3, 2);
    // The right side's line at x = 3.5, row 2.
    room.choosePoint(3.55, 2.0);
    expect(room.doorway).toEqual({ axis: 0, x: 4, y: 2 });
    expect(room.status).toBe('Ready to build, with a doorway.');
    // The tile outside the doorway joins the highlight, so it shows.
    expect(room.highlight()?.tiles).toContainEqual([4, 2]);
    room.choosePoint(3.55, 2.0);
    expect(room.doorway).toBeNull();
    // A click outside the room, away from any outline line, starts again.
    clickTile(room, 5, 3);
    expect([room.first, room.second, room.doorway]).toEqual([[5, 3], null, null]);
  });

  it('says why a room is refused and cannot build it', () => {
    const { room, source } = tool();
    source.code = 11;
    room.enter();
    clickTile(room, 0, 0);
    clickTile(room, 1, 1);
    expect(room.status).toBe('The room would leave furniture out of reach. Choose a doorway.');
    expect([room.canBuild, room.highlight()?.valid]).toEqual([false, false]);
    room.build();
    expect(source.staged).toEqual([]);
    // Found in the played check: with a doorway chosen, asking for one again
    // reads wrong. Another refusal is worded as the bridge words it.
    room.cycleDoorway();
    expect(room.status).toBe('The room would leave furniture out of reach. Try the doorway on another line.');
    source.code = 9;
    room.cycleDoorway();
    expect(room.status).toBe("Someone is standing on the room's outline.");
    // Review finding [F7]: every refusal a doorway can mend gets the hint.
    for (const code of [10, 13]) {
      source.code = code;
      room.cycleDoorway();
      expect(room.status).toMatch(/ (Choose a doorway|Try the doorway on another line)\.$/);
    }
    // [RD-reasons]: a front door tile that is not open floor is not mended by
    // any doorway, so it gets no hint.
    source.code = 12;
    room.cycleDoorway();
    expect(room.status).toBe('The room would cut off the front door.');
  });

  it('stages exactly the room on screen, once, and reports what the drain did', () => {
    const { room, source } = tool();
    room.enter();
    clickTile(room, 3, 2);
    clickTile(room, 2, 1);
    room.choosePoint(3.55, 2.0);
    room.build();
    expect(source.staged).toEqual([[[3, 2, 2, 1], { axis: 0, x: 4, y: 2 }]]);
    expect([room.pending, room.status, room.canBuild]).toEqual([true, 'Building the room…', false]);
    room.build();
    clickTile(room, 5, 3);
    expect(source.staged).toHaveLength(1);
    // Another room's result leaves this one waiting.
    source.result = { corners: [3, 2, 2, 1], doorway: null, reason: null, code: 0 };
    room.afterCommands();
    expect(room.pending).toBe(true);
    source.result = { corners: [3, 2, 2, 1], doorway: { axis: 0, x: 4, y: 2 }, reason: null, code: 0 };
    source.revision += 1;
    room.afterCommands();
    // Built and done with: the choice clears so the same room cannot be sent again.
    expect([room.pending, room.status, room.first, room.canBuild]).toEqual([false, 'Room built.', null, false]);
  });

  // Review finding [F6]: a room that is already built says so and cannot be sent.
  it('says a room is already built and will not send it again', () => {
    const { room, source } = tool();
    source.changes = false;
    room.enter();
    clickTile(room, 2, 1);
    clickTile(room, 3, 2);
    expect([room.status, room.canBuild]).toEqual(['This room is already built.', false]);
    room.build();
    expect(source.staged).toEqual([]);
  });

  // Review finding [F5]: a result for other corners is another room's.
  it('keeps waiting when the drain reports a room with other corners', () => {
    const { room, source } = tool();
    room.enter();
    clickTile(room, 2, 1);
    clickTile(room, 3, 2);
    room.build();
    source.result = { corners: [2, 1, 3, 3], doorway: null, reason: null, code: 0 };
    room.afterCommands();
    expect(room.pending).toBe(true);
    source.result = { corners: [2, 1, 3, 2], doorway: null, reason: null, code: 0 };
    room.afterCommands();
    expect(room.pending).toBe(false);
  });

  it('reports a refusal the drain gave, and one it could not send', () => {
    const { room, source } = tool();
    room.enter();
    clickTile(room, 2, 1);
    clickTile(room, 3, 2);
    room.build();
    source.result = { corners: [2, 1, 3, 2], doorway: null, reason: roomReason(9), code: 9 };
    room.afterCommands();
    expect(room.status).toBe("Someone is standing on the room's outline.");
    // A refused room stays chosen, to be changed.
    expect(room.first).toEqual([2, 1]);
    // Copilot on PR 97: a refusal a doorway can mend keeps its hint when the
    // drain gives it, as the preview's does.
    room.build();
    source.result = { corners: [2, 1, 3, 2], doorway: null, reason: roomReason(11), code: 11 };
    room.afterCommands();
    expect(room.status).toBe('The room would leave furniture out of reach. Choose a doorway.');
    source.accept = false;
    room.build();
    expect([room.pending, room.status]).toEqual([false, 'The room could not be sent.']);
  });

  it('keeps a room on its way through leaving the tool, then forgets it once it lands', () => {
    const { room, source } = tool();
    room.enter();
    clickTile(room, 2, 1);
    clickTile(room, 3, 2);
    room.build();
    room.exit();
    expect([room.active, room.pending, room.highlight()]).toEqual([false, true, null]);
    source.result = { corners: [2, 1, 3, 2], doorway: null, reason: null, code: 0 };
    room.afterCommands();
    expect([room.pending, room.first, room.status]).toEqual([false, null, CHOOSE_CORNER]);
  });

  it('stages nothing while another pause holds', () => {
    const { room, source } = tool();
    room.enter();
    clickTile(room, 2, 1);
    clickTile(room, 3, 2);
    room.setBlocked(true);
    room.build();
    clickTile(room, 5, 3);
    room.cancel();
    expect(source.staged).toEqual([]);
    expect(room.first).toEqual([2, 1]);
  });

  it('uses the keyboard: arrows, Enter to fix a corner then build, D for the doorway, Escape', () => {
    const { room, source } = tool();
    room.enter();
    expect(room.handleKey('Escape')).toBe(false);
    room.handleKey('ArrowLeft');
    expect(room.first).toEqual([3, 2]);
    room.handleKey('ArrowLeft');
    room.handleKey('ArrowUp');
    expect([room.first, room.second]).toEqual([[2, 1], null]);
    room.handleKey('Enter');
    expect(room.second).toEqual([2, 1]);
    room.handleKey('ArrowRight');
    room.handleKey('ArrowDown');
    expect(room.second).toEqual([3, 2]);
    room.handleKey('d');
    expect(room.doorway).toEqual({ axis: 1, x: 2, y: 1 });
    room.handleKey('D');
    expect(room.doorway).toEqual({ axis: 1, x: 3, y: 1 });
    for (let step = 0; step < 6; step += 1) room.handleKey('d');
    expect(room.doorway).toEqual({ axis: 0, x: 4, y: 2 });
    room.handleKey('d');
    expect(room.doorway).toBeNull();
    expect(room.handleKey('q')).toBe(false);
    room.handleKey('Enter');
    expect(source.staged).toEqual([[[2, 1, 3, 2], null]]);
    // Escape waits for a room on its way rather than losing its result.
    expect(room.handleKey('Escape')).toBe(true);
    expect(room.first).toEqual([2, 1]);
    source.result = { corners: [2, 1, 3, 2], doorway: null, reason: null, code: 0 };
    room.afterCommands();
    expect(room.first).toBeNull();
    // With nothing chosen, Escape goes to Build mode.
    expect(room.handleKey('Escape')).toBe(false);
  });

  it('keeps the arrows on the lot', () => {
    const { room } = tool();
    room.enter();
    room.handleKey('ArrowUp');
    for (let step = 0; step < 10; step += 1) room.handleKey('ArrowUp');
    for (let step = 0; step < 10; step += 1) room.handleKey('ArrowRight');
    expect(room.first).toEqual([6, 0]);
  });

  it('re-reads the preview when something else changed the lot', () => {
    const { room, source } = tool();
    room.enter();
    clickTile(room, 2, 1);
    clickTile(room, 3, 2);
    source.code = 10;
    room.afterCommands();
    expect(room.canBuild).toBe(true);
    source.revision += 1;
    room.afterCommands();
    expect(room.canBuild).toBe(false);
  });

  it('forgets everything on Load and takes the loaded lot size', () => {
    const { room } = tool();
    room.enter();
    clickTile(room, 2, 1);
    room.resetAfterLoad(20, 10);
    expect([room.first, room.pending]).toEqual([null, false]);
    clickTile(room, 15, 8);
    expect(room.first).toEqual([15, 8]);
  });

  it('keeps Build mode keys with the Room tool while it is in use', () => {
    const { room } = tool();
    const seen: string[] = [];
    const furniture = { handleKey: (key: string) => { seen.push(key); return true; } };
    const idle = { active: false, handleKey: () => true };
    room.enter();
    expect(routeBuildKey('ArrowLeft', [idle, room, idle], furniture)).toBe(true);
    expect(room.first).toEqual([3, 2]);
    expect(routeBuildKey('Escape', [idle, room, idle], furniture)).toBe(true);
    expect(seen).toEqual([]);
    expect(routeBuildKey('Escape', [idle, room, idle], furniture)).toBe(true);
    expect(seen).toEqual(['Escape']);
  });
});

describe('RoomToolControls', () => {
  class FakeElement {
    hidden = false;
    disabled = false;
    textContent = '';
    readonly listeners: (() => void)[] = [];
    addEventListener(_type: string, listener: () => void) { this.listeners.push(listener); }
    click() { for (const listener of this.listeners) listener(); }
  }

  function controls() {
    const elements = new Map<string, FakeElement>();
    const doc = {
      querySelector: (selector: string) => {
        const id = selector.slice(1);
        if (!elements.has(id)) elements.set(id, new FakeElement());
        return elements.get(id);
      },
    } as unknown as Document;
    const { room, source } = tool();
    const view = new RoomToolControls(doc, room);
    return { room, source, view, element: (id: string) => elements.get(id)! };
  }

  it('enables Build room only for a buildable room, and presses build and cancel', () => {
    const { room, source, view, element } = controls();
    expect([element('room-build').disabled, element('room-cancel').disabled]).toEqual([true, true]);
    room.enter();
    clickTile(room, 2, 1);
    view.render();
    expect([element('room-build').disabled, element('room-cancel').disabled]).toEqual([true, false]);
    clickTile(room, 3, 2);
    view.render();
    expect(element('room-build').disabled).toBe(false);
    expect(element('room-status').textContent).toBe(room.status);
    element('room-build').click();
    expect(source.staged).toHaveLength(1);
    view.render();
    expect([element('room-build').disabled, element('room-cancel').disabled]).toEqual([true, true]);
    source.result = { corners: [2, 1, 3, 2], doorway: null, reason: null, code: 0 };
    room.afterCommands();
    view.render();
    expect([room.first, element('room-cancel').disabled, element('room-status').textContent])
      .toEqual([null, true, 'Room built.']);
  });

  it('shows the touch help on a phone and the keyboard help elsewhere', () => {
    const { view, element } = controls();
    view.setCompact(true);
    expect([element('room-keyboard-help').hidden, element('room-touch-help').hidden]).toEqual([true, false]);
    view.setCompact(false);
    expect([element('room-keyboard-help').hidden, element('room-touch-help').hidden]).toEqual([false, true]);
  });
});

describe('the Room tool on real wasm', () => {
  it('builds a room with a doorway in the shipped house, and words every refusal', () => {
    const bridge = new SimBridge(SimHandle.from_lot(), wasmMemory);
    const room = new RoomTool(bridge, 16, 12, { changed: () => undefined });
    room.enter();
    // The first one-tile room the house accepts with its right side as the
    // doorway, as the Rust boundary test finds one.
    let chosen: [number, number] | null = null;
    for (let y = 1; y < 11 && chosen === null; y += 1) {
      for (let x = 1; x < 15 && chosen === null; x += 1) {
        const door: EdgeLine = { axis: 0, x: x + 1, y };
        const before = bridge.wallEdges() ?? new Uint32Array();
        const alreadyWalled = roomOutline(16, 12, [x, y], [x, y]).every((line) => {
          for (let at = 0; at + 3 < before.length; at += 4) {
            if (before[at] === line.axis && before[at + 1] === line.x && before[at + 2] === line.y) return true;
          }
          return false;
        });
        if (!alreadyWalled && bridge.roomEditPreview([x, y, x, y], door).valid) chosen = [x, y];
      }
    }
    expect(chosen).not.toBeNull();
    const [x, y] = chosen!;
    room.choosePoint(x, y);
    room.choosePoint(x, y);
    room.choosePoint(x + 0.55, y);
    expect(room.doorway).toEqual({ axis: 0, x: x + 1, y });
    const revision = bridge.lotRevision();
    room.build();
    bridge.flushCommands();
    room.afterCommands();
    expect(room.status).toBe('Room built.');
    expect(bridge.lotRevision()).toBe(revision + 1);
    expect(bridge.lastRoomResult()).toEqual({ corners: [x, y, x, y], doorway: { axis: 0, x: x + 1, y },
      reason: null, code: 0 });
    // A refusal crosses with its code, which the doorway hint reads.
    // x = 20 is past the yard's east edge, off the lot.
    expect(bridge.buildRoom([18, 14, 20, 15], null)).toBe(true);
    bridge.flushCommands();
    expect(bridge.lastRoomResult()).toEqual({ corners: [18, 14, 20, 15], doorway: null,
      reason: roomReason(5), code: 5 });
    for (const code of [1, 4, 5, 6, 8, 9, 10, 11, 12, 13]) {
      expect(roomReason(code)).toMatch(/^[A-Z].*\.$/);
    }
    expect(roomReason(0)).toBeNull();
    expect(roomReason(99)).toBe('That room is not possible.');
  });
});

describe('the Room tool in the page', () => {
  const IDS = ['build-tool-room', 'room-tool', 'room-status', 'room-build', 'room-cancel',
    'room-keyboard-help', 'room-touch-help'];

  it.each(IDS)('declares #%s exactly once', (id) => {
    expect(INDEX_HTML.split(`id="${id}"`)).toHaveLength(2);
  });

  it('keeps the room controls inside the build panel, hidden until the tool is chosen', () => {
    const panel = INDEX_HTML.slice(INDEX_HTML.indexOf('id="builder-controls"'),
      INDEX_HTML.indexOf('</section>', INDEX_HTML.indexOf('id="builder-controls"')));
    for (const id of IDS) expect(panel).toContain(`id="${id}"`);
    expect(panel).toContain('<div id="room-tool" class="builder-tool" hidden>');
  });

  // Found in the played check [A-room-tool]: four tool buttons in one row
  // overflowed the side panel and cut Buy off.
  it('lays the four tool buttons out two by two', () => {
    expect(INDEX_HTML).toContain('<div id="build-tools" role="group" aria-label="Build tool">');
    expect(INDEX_HTML).toContain('#build-tools { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }');
  });

  it('is wired into the frame, the click, Load and leaving Build', () => {
    for (const wiring of ['roomTool.afterCommands()', 'roomTool.choosePoint(world[0], world[1])',
      'roomTool.resetAfterLoad(lotWidth, lotHeight)', 'roomTool.exit()',
      "roomTool.setBlocked(overlayPause.suspendedExcept('builder'))",
      'roomControls?.setCompact(event.matches)',
      "{ tool: roomTool, button: 'build-tool-room', panel: 'room-tool' }"]) {
      expect(MAIN_TS).toContain(wiring);
    }
    expect(MAIN_TS.split('wallTool.highlight() ?? roomTool.highlight()')).toHaveLength(3);
  });
});
