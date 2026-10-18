import { expect, it } from 'vitest';
import { decodeBuildReview, decodeRoomSummary, decodeRoomUnit, encodeRoomChoices, encodeRoomName, RoomWireError } from '../src/rooms/codec.js';
const wide = { session: 9007199254740993n, revision: 9007199254740995n, preparation: 18446744073709551615n };
const witness = new Uint8Array([
    1, 0, 129, 128, 128, 128, 128, 128, 128, 16, 131, 128, 128, 128, 128, 128, 128, 16,
    255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 0, 1, 0, 0, 1, 79, 0, 0, 0, 0, 0, 0, 0,
]);
it('decodes the independent native literal without rounding unequal wide token fields', () => {
    expect(decodeBuildReview(witness, { width: 1, height: 1 })).toEqual({
        ok: true, value: {
            token: wide, groups: [], rooms: [
                { id: 0, anchor: null, name: 'O', previousName: null, previousArea: 0, area: 0, outside: true },
            ], retiredNames: [], duties: { duties: [], replannedPeople: [], unavailablePeople: [] }
        }
    });
});
it('rejects every truncated witness and trailing bytes', () => {
    for (let n = 0; n < witness.length; n++)
        expect(() => decodeBuildReview(witness.slice(0, n), { width: 1, height: 1 })).toThrow(RoomWireError);
    expect(() => decodeBuildReview(new Uint8Array([...witness, 0]), { width: 1, height: 1 })).toThrow(RoomWireError);
});
it('encodes exact token fields and explicit fresh inheritance with native postcard order', () => {
    expect(Array.from(encodeRoomChoices({ inheritance: [{ anchor: [2, 3], id: null }], names: [], outsideName: null }, wide))).toEqual([
        1, 1, 129, 128, 128, 128, 128, 128, 128, 16, 131, 128, 128, 128, 128, 128, 128, 16,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 1, 2, 3, 0, 0, 0,
    ]);
});
it('rejects duplicate request keys and malformed integer representations before use', () => {
    expect(() => encodeRoomChoices({ inheritance: [{ anchor: [1, 1], id: null }, { anchor: [1, 1], id: null }], names: [], outsideName: null }, wide)).toThrow(RoomWireError);
    expect(() => encodeRoomChoices({ inheritance: [], names: [{ anchor: [1, 1], name: 'A' }, { anchor: [1, 1], name: 'B' }], outsideName: null }, wide)).toThrow(RoomWireError);
    expect(() => encodeRoomChoices({ inheritance: [{ anchor: [1, 1], id: 0 }], names: [], outsideName: null }, wide)).toThrow(RoomWireError);
    for (const bytes of [[1, 0, 128, 0, 1, 1, 0, 0, 1, 79, 0], [1, 0, 255, 255, 255, 255, 31, 1, 1, 0, 0, 1, 79, 0]])
        expect(() => decodeRoomSummary(new Uint8Array(bytes))).toThrow(RoomWireError);
});
it('preserves valid long raw whitespace but rejects controls and lone surrogates', () => {
    expect(encodeRoomName(0, ' '.repeat(2000) + 'X' + ' '.repeat(2000)).length).toBeGreaterThan(4000);
    for (const name of ['X\n', '\ud800', '\udc00', 'X'.repeat(49)])
        expect(() => encodeRoomName(0, name)).toThrow(RoomWireError);
    expect(encodeRoomName(0, '\u2003' + '🙂'.repeat(48) + '\u2003')).toBeDefined();
});
it('refuses malformed summary relationships, options, UTF-8 and hostile counts', () => {
    expect(()=>decodeRoomSummary(new Uint8Array([1,0,2,1,2,0,0,1,79,0,0,0,1,79,0]))).toThrow(RoomWireError);
    for (const bytes of [[1, 0, 1, 1, 1, 0, 2], [1, 0, 1, 1, 1, 0, 0, 1, 255, 0], [1, 0, 1, 1, 255, 255, 255, 255, 15],
        [1, 0, 1, 1, 1, 1, 0, 1, 88, 1], [1, 0, 1, 1, 1, 0, 0, 1, 88, 2]]) {
        expect(() => decodeRoomSummary(new Uint8Array(bytes))).toThrow(RoomWireError);
    }
});
it('keeps every chore and duty tag distinct and accepts owner zero', () => {
    const prefix = [1, 0, 1, 2, 3, 0, 1, 0, 0, 1, 79, 0, 0, 0, 0];
    for (let chore = 0; chore < 6; chore++)
        for (const kind of [0, 2, 3, 4]) {
            const previous = kind === 2 || kind === 3 ? null : { kind: chore, target: 0 }, owner = kind === 3 ? null : 0;
            const bytes = new Uint8Array([...prefix, 1, chore, 0, ...(previous ? [1, chore, 0] : [0]), ...(owner === null ? [0] : [1, 0]), kind, 0, 0]);
            const decoded = decodeBuildReview(bytes, { width: 1, height: 1 });
            expect(decoded.ok).toBe(true);
            if (decoded.ok)
                expect(decoded.value.duties.duties).toEqual([{ key: { kind: chore, target: 0 }, previous, owner, kind }]);
        }
    expect(() => decodeBuildReview(new Uint8Array([...prefix, 1, 6, 0, 0, 0, 0, 0, 0]), { width: 1, height: 1 })).toThrow(RoomWireError);
    const reassigned = decodeBuildReview(new Uint8Array([...prefix, 1, 2, 0, 1, 2, 1, 1, 0, 1, 0, 0]), { width: 1, height: 1 });
    expect(reassigned.ok && reassigned.value.duties.duties[0].kind).toBe(1);
    for (const invalid of [[...prefix, 1, 0, 0, 0, 1, 0, 0, 0, 0], [...prefix, 1, 0, 0, 1, 0, 0, 0, 2, 0, 0]])
        expect(() => decodeBuildReview(new Uint8Array(invalid), { width: 1, height: 1 })).toThrow(RoomWireError);
});
it('decodes literal pure summary and enforces native error detail shapes', () => {
    const bom = decodeRoomSummary(new Uint8Array([1, 0, 1, 1, 1, 0, 0, 4, 239, 187, 191, 88, 0]));
    expect(bom.ok && bom.value.rooms[0].name).toBe('\uFEFFX');
    expect(decodeRoomSummary(new Uint8Array([1, 0, 2, 1, 1, 0, 0, 1, 79, 2]))).toEqual({ ok: true, value: { width: 2, height: 1, rooms: [{ id: 0, anchor: null, name: 'O', area: 2, outside: true }] } });
    expect(decodeRoomUnit(new Uint8Array([1, 1, 7, 1, 9]))).toEqual({ ok: false, error: { code: 7, detail: 9n } });
    for (const bytes of [[1, 1, 7, 0], [1, 1, 1, 1, 0], [1, 1, 15, 0], [1, 1, 10, 1, 11], [1, 0, 0]])
        expect(() => decodeRoomUnit(new Uint8Array(bytes))).toThrow(RoomWireError);
});
it('checks each group kind and rejects impossible group relationships', () => {
    const cases = [
        { kind: 0, old: [1, 1], anchors: [2, 0, 0, 1, 0], rooms: [3, 0, 0, 1, 79, 0, 0, 0, 1, 1, 0, 0, 1, 65, 0, 0, 1, 2, 1, 1, 0, 1, 66, 0, 0, 1], retired: [0] },
        { kind: 1, old: [2, 1, 2], anchors: [1, 0, 0], rooms: [2, 0, 0, 1, 79, 0, 0, 0, 1, 1, 0, 0, 1, 65, 0, 0, 1], retired: [1, 2, 1, 66] },
        { kind: 2, old: [2, 1, 2], anchors: [2, 0, 0, 1, 0], rooms: [3, 0, 0, 1, 79, 0, 0, 0, 1, 1, 0, 0, 1, 65, 0, 0, 1, 2, 1, 1, 0, 1, 66, 0, 0, 1], retired: [0] },
        { kind: 3, old: [1, 1], anchors: [0], rooms: [1, 0, 0, 1, 79, 0, 0, 2], retired: [1, 1, 1, 65] },
    ];
    for (const c of cases) {
        const bytes = new Uint8Array([1, 0, 1, 2, 3, 1, c.kind, ...c.old, ...c.anchors, 1, 0, 0, 1, 0, 1, 0, ...c.rooms, ...c.retired, 0, 0, 0]);
        const decoded = decodeBuildReview(bytes, { width: 2, height: 1 });
        expect(decoded.ok).toBe(true);
        if (decoded.ok)
            expect(decoded.value.groups[0].kind).toBe(c.kind);
        const wrong = bytes.slice();
        wrong[6] = 4;
        expect(() => decodeBuildReview(wrong, { width: 2, height: 1 })).toThrow(RoomWireError);
    }
});
