import { PostcardReader } from '../books/codec.js';
export interface BuildToken {
    readonly session: bigint;
    readonly revision: bigint;
    readonly preparation: bigint;
}
export type Point = readonly [
    number,
    number
];
export interface RoomFailure {
    readonly code: number;
    readonly detail: bigint | null;
}
export type RoomResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: RoomFailure;
};
/** A malformed transport packet, distinct from a native refusal. Keep the draft on either failure. */
export class RoomWireError extends Error {
    constructor() { super('Malformed room transport.'); this.name = 'RoomWireError'; }
}
export interface RoomSummary {
    id: number;
    anchor: Point | null;
    name: string;
    area: number;
    outside: boolean;
}
export interface RoomContext {
    width: number;
    height: number;
}
export interface RoomSnapshot extends RoomContext {
    rooms: RoomSummary[];
}
export interface ReviewRoom extends RoomSummary {
    previousName: string | null;
    previousArea: number;
}
export interface ReviewGroup {
    kind: number;
    oldIds: number[];
    finalAnchors: Point[];
    formerTiles: Point[];
    openings: {
        axis: number;
        x: number;
        y: number;
    }[];
}
export interface ChoreKey {
    kind: number;
    target: number;
}
export interface DutyChange {
    key: ChoreKey;
    previous: ChoreKey | null;
    owner: number | null;
    kind: number;
}
export interface BuildReview {
    token: BuildToken;
    groups: ReviewGroup[];
    rooms: ReviewRoom[];
    retiredNames: {
        id: number;
        name: string;
    }[];
    duties: {
        duties: DutyChange[];
        replannedPeople: number[];
        unavailablePeople: number[];
    };
}
export interface RoomChoices {
    inheritance: readonly {
        anchor: Point;
        id: number | null;
    }[];
    names: readonly {
        anchor: Point;
        name: string;
    }[];
    outsideName: string | null;
}
export const EMPTY_ROOM_CHOICES: RoomChoices = { inheritance: [], names: [], outsideName: null };
const U64_MAX = 18446744073709551615n, MAX_TILES = 1048576, MAX_ENTITIES = 100000, INGRESS = 16777216;
function check(value: unknown): asserts value {
    if (!value)
        throw new RoomWireError();
}
function word(value: number): number { check(Number.isInteger(value) && value >= 0 && value <= 0xffffffff); return value; }
export function checkBuildToken(value: BuildToken): void {
    check(value !== null && typeof value === 'object');
    for (const n of [value.session, value.revision, value.preparation])
        check(typeof n === 'bigint' && n >= 0n && n <= U64_MAX);
}
function dimensions(context: RoomContext): number { check(Number.isInteger(context.width) && context.width > 0 && Number.isInteger(context.height) && context.height > 0); const cells = context.width * context.height; check(Number.isSafeInteger(cells) && cells <= MAX_TILES); return cells; }
function canonical(value: string): string { check(typeof value === 'string'); check(!/[\uD800-\uDFFF]/u.test(value) && !/[\p{Cc}]/u.test(value)); const trimmed = value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, ''); check(Array.from(trimmed).length >= 1 && Array.from(trimmed).length <= 48); return trimmed; }
function name(value: string): string { check(canonical(value) === value && new TextEncoder().encode(value).length <= 192); return value; }
function unique<T>(rows: readonly T[], key: (row: T) => string | number): void { check(new Set(rows.map(key)).size === rows.length); }
const pointKey = (p: Point) => `${p[0]},${p[1]}`;
function point(r: PostcardReader, c: RoomContext): Point { const p: Point = [r.number(), r.number()]; check(p[0] < c.width && p[1] < c.height); return p; }
function list<T>(r: PostcardReader, max: number, min: number, read: () => T): T[] { const count = r.count(min); check(count <= max); return Array.from({ length: count }, read); }
function failure(r: PostcardReader): RoomFailure {
    const code = r.byte(), detail = r.option(() => r.uint(64));
    check(code >= 1 && code <= 14);
    check((code === 7 || code === 8 || code === 10) === (detail !== null));
    if (code === 7)
        check(detail! >= 1n && detail! <= 13n);
    if (code === 10)
        check(detail! >= 1n && detail! <= 10n);
    return { code, detail };
}
function packet<T>(bytes: Uint8Array, read: (r: PostcardReader) => T): RoomResult<T> {
    try {
        const r = new PostcardReader(bytes);
        check(r.byte() === 1);
        const status = r.byte();
        check(status <= 1);
        const result: RoomResult<T> = status === 1 ? { ok: false, error: failure(r) } : { ok: true, value: read(r) };
        r.done();
        return result;
    }
    catch {
        throw new RoomWireError();
    }
}
export function decodeRoomUnit(bytes: Uint8Array): RoomResult<void> { return packet(bytes, () => undefined); }
export function decodeBuildError(bytes: Uint8Array): RoomResult<RoomFailure | null> { return packet(bytes, r => r.option(() => failure(r))); }
function summary(r: PostcardReader, c: RoomContext): RoomSummary { const id = r.number(), anchor = r.option(() => point(r, c)), label = name(r.text()), area = r.number(); check((id === 0) === (anchor === null)); check(area <= dimensions(c) && (id === 0 || area > 0)); return { id, anchor, name: label, area, outside: id === 0 }; }
function roomRelations(rooms: readonly RoomSummary[]): void { unique(rooms, r => r.id); unique(rooms.filter(r => r.anchor !== null), r => pointKey(r.anchor!)); check(rooms.filter(r => r.outside).length === 1); }
export function decodeRoomSummary(bytes: Uint8Array): RoomResult<RoomSnapshot> { return packet(bytes, r => { const context = { width: r.number(), height: r.number() }, cells = dimensions(context); const rooms = list(r, cells + 1, 4, () => summary(r, context)); roomRelations(rooms); check(rooms.reduce((n, room) => n + room.area, 0) <= cells); return { ...context, rooms }; }); }
export function decodeRoomTiles(bytes: Uint8Array, context: RoomContext): RoomResult<Point[]> { return packet(bytes, r => { const tiles = list(r, dimensions(context), 2, () => point(r, context)); unique(tiles, pointKey); return tiles; }); }
export function decodeRoomPredecessors(bytes: Uint8Array): RoomResult<number[]> { return packet(bytes, r => { const ids = list(r, MAX_TILES, 1, () => r.number()); check(ids.every(id => id > 0)); unique(ids, id => id); return ids; }); }
export function decodeBuildReview(bytes: Uint8Array, context: RoomContext): RoomResult<BuildReview> {
    return packet(bytes, r => {
        const cells = dimensions(context), token = { session: r.uint(64), revision: r.uint(64), preparation: r.uint(64) };
        const groups = list(r, MAX_TILES, 5, () => {
            const kind = r.byte();
            check(kind <= 3);
            const oldIds = list(r, MAX_TILES, 1, () => r.number());
            check(oldIds.length > 0 && oldIds.every(id => id > 0));
            unique(oldIds, id => id);
            const finalAnchors = list(r, cells, 2, () => point(r, context)), formerTiles = list(r, cells, 2, () => point(r, context));
            unique(finalAnchors, pointKey);
            unique(formerTiles, pointKey);
            check(kind === 0 ? oldIds.length === 1 && finalAnchors.length > 1 : kind === 1 ? oldIds.length > 1 && finalAnchors.length === 1 : kind === 2 ? oldIds.length > 1 && finalAnchors.length > 1 : finalAnchors.length === 0);
            const openings = list(r, 2 * cells + context.width + context.height, 3, () => { const axis = r.byte(), x = r.number(), y = r.number(); check(axis <= 1); check(axis === 0 ? x <= context.width && y < context.height : x < context.width && y <= context.height); return { axis, x, y }; });
            return { kind, oldIds, finalAnchors, formerTiles, openings };
        });
        const rooms = list(r, cells + 1, 7, () => { const id = r.number(), anchor = r.option(() => point(r, context)), label = name(r.text()), previousName = r.option(() => name(r.text())), previousArea = r.number(), area = r.number(); check((id === 0) === (anchor === null)); check(previousArea <= MAX_TILES && area <= cells && (id === 0 || area > 0)); return { id, anchor, name: label, previousName, previousArea, area, outside: id === 0 }; });
        roomRelations(rooms);
        check(rooms.reduce((n, room) => n + room.area, 0) <= cells);
        const retiredNames = list(r, MAX_TILES, 2, () => { const id = r.number(); check(id > 0); return { id, name: name(r.text()) }; });
        unique(retiredNames, row => row.id);
        check(retiredNames.every(old => !rooms.some(room => room.id === old.id)));
        const known = new Set([...rooms.map(row => row.id), ...retiredNames.map(row => row.id)]), anchors = new Set(rooms.flatMap(row => row.anchor ? [pointKey(row.anchor)] : []));
        unique(groups.flatMap(group => group.oldIds), id => id);
        unique(groups.flatMap(group => group.finalAnchors), pointKey);
        check(groups.every(group => group.oldIds.every(id => known.has(id)) && group.finalAnchors.every(p => anchors.has(pointKey(p)))));
        const readKey = (): ChoreKey => { const kind = r.byte(), target = r.number(); check(kind <= 5); check(kind === 0 ? target === 0 : kind === 2 || kind === 3 ? target < MAX_ENTITIES : known.has(target)); return { kind, target }; };
        const maxDuties = 2 * (1 + 3 * (cells + 1) + MAX_ENTITIES);
        const duties = list(r, maxDuties, 5, () => {
            const key = readKey(), previous = r.option(readKey), owner = r.option(() => r.number()), kind = r.byte();
            check(kind <= 4 && (owner === null || owner < MAX_ENTITIES));
            const same = previous !== null && previous.kind === key.kind && previous.target === key.target;
            check(kind === 0 || kind === 4 ? same : kind === 1 ? previous !== null && !same : kind === 2 ? previous === null && owner !== null : previous === null && owner === null);
            return { key, previous, owner, kind };
        });
        const people = () => { const rows = list(r, MAX_ENTITIES, 1, () => r.number()); check(rows.every(id => id < MAX_ENTITIES)); unique(rows, id => id); return rows; };
        const replannedPeople = people(), unavailablePeople = people();
        check(replannedPeople.every(id => !unavailablePeople.includes(id)));
        return { token, groups, rooms, retiredNames, duties: { duties, replannedPeople, unavailablePeople } };
    });
}
class Writer {
    bytes: number[] = [];
    uint(value: number | bigint): void {
        let n = typeof value === 'bigint' ? value : BigInt(word(value));
        check(n >= 0n && n <= U64_MAX);
        do {
            const byte = Number(n & 127n);
            n >>= 7n;
            this.bytes.push(n ? byte | 128 : byte);
        } while (n);
        this.limit();
    }
    byte(n: number): void { this.bytes.push(n); this.limit(); }
    option<T>(value: T | null, write: (value: T) => void): void {
        this.byte(value === null ? 0 : 1);
        if (value !== null)
            write(value);
    }
    text(value: string): void {
        canonical(value);
        const bytes = new TextEncoder().encode(value);
        this.uint(bytes.length);
        check(this.bytes.length + bytes.length <= INGRESS);
        for (const byte of bytes)
            this.bytes.push(byte);
    }
    point(p: Point): void { this.uint(p[0]); this.uint(p[1]); }
    token(t: BuildToken): void { checkBuildToken(t); this.uint(t.session); this.uint(t.revision); this.uint(t.preparation); }
    limit(): void { check(this.bytes.length <= INGRESS); }
    finish(): Uint8Array { return new Uint8Array(this.bytes); }
}
export function encodeRoomName(id: number, rawName: string): Uint8Array { const w = new Writer(); w.byte(1); w.uint(id); w.text(rawName); return w.finish(); }
export function encodeRoomChoices(choices: RoomChoices = EMPTY_ROOM_CHOICES, expected: BuildToken | null = null): Uint8Array {
    check(expected !== null || (!choices.inheritance.length && !choices.names.length && choices.outsideName === null));
    unique(choices.inheritance, row => pointKey(row.anchor));
    unique(choices.names, row => pointKey(row.anchor));
    const w = new Writer();
    w.byte(1);
    w.option(expected, t => w.token(t));
    const sorted = <T extends {
        anchor: Point;
    }>(rows: readonly T[]) => [...rows].sort((a, b) => a.anchor[0] - b.anchor[0] || a.anchor[1] - b.anchor[1]);
    w.uint(choices.inheritance.length);
    for (const row of sorted(choices.inheritance)) {
        w.point(row.anchor);
        w.option(row.id, id => { check(id > 0); w.uint(id); });
    }
    w.uint(choices.names.length);
    for (const row of sorted(choices.names)) {
        w.point(row.anchor);
        w.text(row.name);
    }
    w.option(choices.outsideName, value => w.text(value));
    return w.finish();
}
