import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { PersistenceController } from '../src/ui/persistence-controller.js';
import { RoomWireError, type RoomResult } from '../src/rooms/codec.js';
let memory: WebAssembly.Memory;
beforeAll(async () => { memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory; });
it('preserves a literal leading BOM through native summary, review and current reload', () => {
    const h = SimHandle.from_lot(), loaded = SimHandle.from_lot(), sim = new SimBridge(h, memory), restored = new SimBridge(loaded, memory);
    try {
        value(sim.beginBuild());
        value(sim.stageRoomName(0, '\uFEFFLiteral'));
        expect(value(sim.roomSummaries()).rooms[0].name).toBe('\uFEFFLiteral');
        const review = value(sim.prepareBuildCommit());
        expect(review.rooms[0].name).toBe('\uFEFFLiteral');
        value(sim.commitBuild(review.token));
        expect(restored.loadBytes(sim.saveBytes())).toBe(true);
        expect(value(restored.roomSummaries()).rooms[0].name).toBe('\uFEFFLiteral');
    }
    finally {
        h.free();
        loaded.free();
    }
});
function value<T>(r: RoomResult<T>): T {
    expect(r.ok).toBe(true);
    if (!r.ok)
        throw Error(JSON.stringify(r.error, (_, v) => typeof v === 'bigint' ? String(v) : v));
    return r.value;
}
it('projects sparse inherited choices from the actual prepared matcher', () => {
    const handle = new SimHandle(10, 8), sim = new SimBridge(handle, memory);
    const wall = (x: number, state: number) => {
        for (let y = 1; y <= 5; y++) {
            expect(sim.setWallEdge(0, x, y, state)).toBe(true);
            sim.flushCommands();
            expect(sim.lastWallEditResult()?.reason).toBeNull();
        }
    };
    try {
        expect(sim.buildRoom([1, 1, 7, 5], { axis: 0, x: 8, y: 3 })).toBe(true);
        sim.flushCommands();
        expect(sim.lastRoomResult()?.reason).toBeNull();
        wall(4, 1);
        const before = value(sim.roomSummaries());
        const a = before.rooms.find(room => room.anchor?.[0] === 1)!.id, b = before.rooms.find(room => room.anchor?.[0] === 4)!.id;
        value(sim.beginBuild());
        wall(4, 0);
        wall(3, 1);
        wall(6, 1);
        const review = value(sim.prepareBuildCommit());
        for (const [anchor, want] of [[[1, 1], [a]], [[3, 1], [a, b]], [[6, 1], [b]]] as const)
            expect(value(sim.buildComponentPredecessors(review.token, anchor)).sort()).toEqual([...want].sort());
        const baseline = sim.saveBytes(), revision = sim.roomsRevision();
        expect(sim.prepareBuildCommit({ inheritance: [{ anchor: [1, 1], id: b }], names: [], outsideName: null }, review.token).ok).toBe(false);
        expect(sim.roomsRevision()).toBe(revision);
        expect(sim.saveBytes()).toEqual(baseline);
        value(sim.buildComponentTiles(review.token, [1, 1]));
        expect(sim.buildComponentPredecessors(review.token, [0, 0]).ok).toBe(false);
        value(sim.discardBuildReview());
        expect(sim.buildComponentPredecessors(review.token, [1, 1]).ok).toBe(false);
    }
    finally {
        handle.free();
    }
});
const published = JSON.parse(readFileSync(new URL('../../crates/terri-wasm/tests/fixtures/room-identities-v15/manifest.json', import.meta.url), 'utf8')) as {
    files: {
        file: string;
    }[];
};
it.each(published.files)('migrates authentic V15 $file and retains exact current continuation', ({ file }) => {
    const h = SimHandle.from_lot(), resumed = SimHandle.from_lot();
    try {
        const source = new Uint8Array(readFileSync(new URL(`../../crates/terri-wasm/tests/fixtures/room-identities-v15/${file}`, import.meta.url)));
        expect(h.load_bytes(source)).toBe(true);
        const current = h.save_bytes();
        expect([...current.slice(8, 10)]).toEqual([21, 0]);
        expect(resumed.load_bytes(current)).toBe(true);
        expect(resumed.save_bytes()).toEqual(current);
        for (let n = 0; n < 120; n++) {
            h.tick();
            resumed.tick();
        }
        expect(h.save_bytes()).toEqual(resumed.save_bytes());
    }
    finally {
        h.free();
        resumed.free();
    }
});
it('routes real native Build capture through the persistence controller without a browser baseline', async () => {
    const handle = SimHandle.from_lot(), reload = SimHandle.from_lot();
    const sim = new SimBridge(handle, memory);
    let stored: Uint8Array | null = null;
    const store = { save: async (bytes: Uint8Array) => { stored = bytes.slice(); }, load: async () => stored, clear: async () => { stored = null; }, close: () => { } };
    const status = { textContent: '', setAttribute: () => { }, removeAttribute: () => { } };
    const persistence = new PersistenceController(store, sim, status);
    try {
        const before = sim.saveBytes();
        value(sim.beginBuild());
        value(sim.stageRoomName(0, ' Garden '));
        expect(sim.buildDirty()).toBe(true);
        expect(sim.saveBytes()).toEqual(before);
        const review = value(sim.prepareBuildCommit());
        expect(review.rooms[0].name).toBe('Garden');
        for (const label of ['Game saved', 'Autosaved']) {
            expect(await persistence.save(label)).toBe(true);
            expect(stored).toEqual(before);
            expect(reload.load_bytes(stored!)).toBe(true);
        }
        expect(sim.roomSummaries().ok).toBe(true);
        value(sim.commitBuild(review.token));
        expect(sim.buildActive()).toBe(true);
        expect(sim.buildDirty()).toBe(false);
        expect(sim.saveBytes()).not.toEqual(before);
        value(sim.stageRoomName(0, 'Later'));
        value(sim.cancelBuild());
        expect(value(sim.roomSummaries()).rooms[0].name).toBe('Garden');
        value(sim.endBuild());
        expect(sim.buildActive()).toBe(false);
    }
    finally {
        handle.free();
        reload.free();
    }
});
it('keeps the exact prepared token after malformed choices and refused Load', () => {
    const handle = SimHandle.from_lot(), sim = new SimBridge(handle, memory);
    try {
        value(sim.beginBuild());
        const review = value(sim.prepareBuildCommit()), baseline = sim.saveBytes();
        expect(Array.from(handle.prepare_build_commit(new Uint8Array([1, 2])))).toEqual([1, 1, 13, 0]);
        expect(sim.loadBytes(new Uint8Array())).toBe(false);
        expect(sim.saveBytes()).toEqual(baseline);
        for (const session of [1 as unknown as bigint, -1n, 18446744073709551616n])
            expect(() => sim.commitBuild({ ...review.token, session })).toThrow(RoomWireError);
        expect(() => sim.stageRoomName(0, '\ud800')).toThrow(RoomWireError);
        expect(() => sim.buildComponentTiles(review.token, [1.5, 0])).toThrow(RoomWireError);
        value(sim.commitBuild(review.token));
        expect(sim.commitBuild(review.token).ok).toBe(false);
    }
    finally {
        handle.free();
    }
});
it('successful Load replaces the native active baseline and invalidates the old review', () => {
    const h = SimHandle.from_lot(), incoming = SimHandle.from_lot(), sim = new SimBridge(h, memory);
    try {
        const bytes = new Uint8Array(readFileSync(new URL('../../crates/terri-wasm/tests/fixtures/room-identities-v15/chat-queued.sav', import.meta.url)));
        expect(incoming.load_bytes(bytes)).toBe(true);
        incoming.flush_commands();
        const expected = incoming.save_bytes();
        value(sim.beginBuild());
        value(sim.stageRoomName(0, 'Old draft'));
        const previous = value(sim.prepareBuildCommit()).token;
        expect(sim.loadBytes(bytes)).toBe(true);
        expect(sim.buildActive()).toBe(true);
        expect(sim.buildDirty()).toBe(false);
        expect(sim.saveBytes()).toEqual(expected);
        expect(sim.commitBuild(previous).ok).toBe(false);
        const fresh = value(sim.prepareBuildCommit());
        expect(fresh.token.session).not.toBe(previous.session);
        value(sim.cancelBuild());
        expect(sim.saveBytes()).toEqual(expected);
    }
    finally {
        h.free();
        incoming.free();
    }
});
it('resolves prepared report people by raw entity index rather than SimId', () => {
    const h = SimHandle.from_lot(), sim = new SimBridge(h, memory);
    try {
        expect(sim.loadBytes(new Uint8Array(readFileSync(new URL('../../crates/terri-wasm/tests/fixtures/room-transport-v16/sparse-person-active.sav', import.meta.url))))).toBe(true);
        expect(sim.simIdOf(1)).toBe(0);
        expect(sim.simName(1)).toBe('Index witness');
        value(sim.beginBuild());
        expect(sim.buildRoom([3, 1, 5, 3], { axis: 0, x: 6, y: 2 })).toBe(true);
        sim.flushCommands();
        expect(sim.lastRoomResult()?.reason).toBeNull();
        const review = value(sim.prepareBuildCommit());
        expect([...review.duties.replannedPeople, ...review.duties.unavailablePeople]).toEqual([1]);
        expect(value(sim.roomSummaries()).rooms).toHaveLength(1);
        const newRoom=review.rooms.find(room=>!room.outside)!;
        expect(value(sim.buildComponentPredecessors(review.token,newRoom.anchor!))).toEqual([]);
        expect(sim.simName(review.duties.replannedPeople[0] ?? review.duties.unavailablePeople[0])).toBe('Index witness');
        value(sim.commitBuild(review.token));
        expect(sim.simIdOf(1)).toBe(0);
    }
    finally {
        h.free();
    }
});
it('autosaves native committed bytes at an already reached day boundary while reviewing', async () => {
    const h = SimHandle.from_lot(), sim = new SimBridge(h, memory);
    let stored: Uint8Array | null = null;
    try {
        for (let n = 0; n < sim.dayTicks(); n++)
            sim.tick();
        const baseline = sim.saveBytes();
        const controller = new PersistenceController({ save: async (bytes) => { stored = bytes.slice(); }, load: async () => stored, clear: async () => { }, close: () => { } }, sim, { textContent: '', setAttribute: () => { }, removeAttribute: () => { } });
        value(sim.beginBuild());
        value(sim.stageRoomName(0, 'Daily draft'));
        const review = value(sim.prepareBuildCommit());
        controller.updateAutosave();
        await Promise.resolve();
        await Promise.resolve();
        expect(stored).toEqual(baseline);
        expect(sim.buildDirty()).toBe(true);
        value(sim.commitBuild(review.token));
    }
    finally {
        h.free();
    }
});
it('keeps confirmed membership and predecessor identity in the translated draft frame', () => {
    const h = SimHandle.from_lot(), sim = new SimBridge(h, memory);
    try {
        expect(sim.loadBytes(new Uint8Array(readFileSync(new URL('../../crates/terri-wasm/tests/fixtures/room-transport-v16/funded-fresh.sav', import.meta.url))))).toBe(true);
        const original = value(sim.roomSummaries()), baseline = sim.saveBytes();
        value(sim.beginBuild());
        const revision = sim.roomsRevision();
        for (const side of [0, 2]) {
            expect(sim.landQuote(side)?.affordable).toBe(true);
            expect(sim.buyLand(side)).toBe(true);
            sim.flushCommands();
            expect(sim.lastLandResult()?.reason).toBe(0);
        }
        expect(sim.roomsRevision() > revision).toBe(true);
        const shifted = value(sim.roomSummaries());
        expect([shifted.width, shifted.height]).toEqual([30, 26]);
        for (const old of original.rooms.filter(room => !room.outside)) {
            const current = shifted.rooms.find(room => room.id === old.id)!;
            expect(current.anchor).toEqual([old.anchor![0] + 10, old.anchor![1] + 10]);
            expect(current.name).toBe(old.name);
        }
        expect(sim.saveBytes()).toEqual(baseline);
        const review = value(sim.prepareBuildCommit());
        for (const room of review.rooms.filter(room => !room.outside))
            expect(value(sim.buildComponentPredecessors(review.token, room.anchor!))).toEqual([room.id]);
        value(sim.cancelBuild());
        expect(value(sim.roomSummaries())).toEqual(original);
        expect(sim.buildComponentPredecessors(review.token, [11, 11]).ok).toBe(false);
    }
    finally {
        h.free();
    }
});
