/** Strict readers for the native postcard projections; ownership stays in Rust. */
export interface BookTitle { id: string; title: string; description: string; genre: string; readingMinutes: number; price: number }
export interface ShelfSlot { shelf: bigint; slot: number }
export type BookLocation = { kind: 'inventory' } | { kind: 'shelf'; home: ShelfSlot } |
  { kind: 'carried'; simId: number } | { kind: 'lot'; x: number; y: number };
export interface BookCopy { id: number; titleId: string; location: BookLocation; home: ShelfSlot | null; borrowerSimId: number | null }
export interface BookResult { sequence: bigint; copy: number | null; order: bigint | null; refusal: string | null }
export interface BookMemory { simId: number; titleId: string; progressTicks: number; progressFraction: number;
  passNovelty: number | null; familiarity: number; lastReadTick: bigint; completedPasses: number }
export type OptionalStationRole = 'prep_surface' | 'cold_storage' | 'hob' | 'meal_table' | 'dining_seat' | 'dish_sink' | 'eating_surface' | 'turnable_seat';
export interface ModelAction { id: string; label: string; durationTicks: number; capacity: number | null;
  reading: boolean; benefits: readonly [number, number][]; satisfactionPoints: number; readingBenefits: readonly number[]; requirements: readonly string[]; workKind: string;
  /** Canonical optional station-role IDs, separated from display-only condition notes. */
  optionalRequirements: readonly OptionalStationRole[];
  additionalDetails?: readonly string[] }
export interface ModelFacts { definition: number; id: string; typeLabel: string; modelName: string; description: string;
  typeId: string; categoryId: string; categoryLabel: string; rooms: readonly string[];
  width: number; depth: number; shelfCapacity: number; shelfAccessPoints: number; sessionTicks: number; actions: readonly ModelAction[]; roles: readonly string[] }

const STATION_ROLES = new Set(['prep_surface', 'cold_storage', 'hob', 'meal_table', 'dining_seat', 'dish_sink', 'eating_surface', 'turnable_seat']);

/** The existing native wire tail carries role IDs and display notes; notes never determine eligibility. */
export function splitBuyingDetails(wireTail: readonly string[]): Pick<ModelAction, 'optionalRequirements' | 'additionalDetails'> {
  return { optionalRequirements: wireTail.filter((value): value is OptionalStationRole => STATION_ROLES.has(value)),
    additionalDetails: wireTail.filter(value => !STATION_ROLES.has(value)) };
}

function requireValue(ok: boolean): asserts ok { if (!ok) throw new Error('Malformed native book projection.'); }
export class PostcardReader {
  private at = 0;
  constructor(private readonly bytes: Uint8Array) {}
  byte(): number { requireValue(this.at < this.bytes.length); return this.bytes[this.at++]; }
  uint(bits = 32): bigint {
    let value = 0n;
    const count = Math.ceil(bits / 7);
    for (let n = 0; n < count; n++) {
      const byte = this.byte();
      value |= BigInt(byte & 127) << BigInt(n * 7);
      if (byte < 128) {
        requireValue(value < (1n << BigInt(bits)) && (n === 0 || byte !== 0));
        return value;
      }
    }
    throw new Error('Overflowing native integer.');
  }
  number(bits = 32): number { return Number(this.uint(bits)); }
  count(minimum = 1): number { const n = this.number(); requireValue(n <= (this.bytes.length - this.at) / minimum); return n; }
  text(): string {
    const length = this.count();
    const end = this.at + length;
    const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(this.bytes.subarray(this.at, end));
    this.at = end;
    return value;
  }
  float(): number {
    requireValue(this.at + 4 <= this.bytes.length);
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.at, 4).getFloat32(0, true);
    this.at += 4;
    requireValue(Number.isFinite(value));
    return value;
  }
  bool(): boolean { const n = this.byte(); requireValue(n <= 1); return n === 1; }
  option<T>(read: () => T): T | null { return this.bool() ? read() : null; }
  list<T>(read: () => T, minimum = 1): T[] { return Array.from({ length: this.count(minimum) }, read); }
  done(): void { requireValue(this.at === this.bytes.length); }
}
function unique<T>(rows: readonly T[], key: (row: T) => string | number | bigint): void {
  const keys = rows.map(key); requireValue(new Set(keys).size === keys.length);
}
function nonblank(value: string): void { requireValue(value.trim().length > 0); }
export function decodeBookCatalogue(bytes: Uint8Array): BookTitle[] {
  const r = new PostcardReader(bytes);
  const rows = r.list(() => ({ id: r.text(), title: r.text(), description: r.text(), genre: r.text(), readingMinutes: r.number(), price: r.number() }), 6);
  r.done(); unique(rows, row => row.id);
  for (const row of rows) { nonblank(row.id); nonblank(row.title); nonblank(row.genre); requireValue(row.readingMinutes > 0 && row.price > 0); }
  return rows;
}
function slot(r: PostcardReader): ShelfSlot { return { shelf: r.uint(64), slot: r.number(16) }; }
export function shelfEntity(shelf: bigint): number { requireValue(shelf >= 0n && shelf < 0xffffffffn); return Number(shelf); }
export function decodeBookCopies(bytes: Uint8Array, titles?: readonly BookTitle[]): BookCopy[] {
  const r = new PostcardReader(bytes);
  const rows = r.list(() => {
    const id = r.number(); const titleId = r.text(); const tag = r.number();
    let location: BookLocation;
    switch (tag) {
      case 0: location = { kind: 'inventory' }; break;
      case 1: location = { kind: 'shelf', home: slot(r) }; break;
      case 2: location = { kind: 'carried', simId: r.number() }; break;
      case 3: location = { kind: 'lot', x: r.float(), y: r.float() }; break;
      default: throw new Error('Unknown native book location.');
    }
    return { id, titleId, location, home: r.option(() => slot(r)), borrowerSimId: r.option(() => r.number()) };
  }, 5);
  r.done(); unique(rows, row => row.id);
  for (const copy of rows) {
    nonblank(copy.titleId); requireValue(copy.id < 0xffffffff);
    if (titles) requireValue(titles.some(t => t.id === copy.titleId));
    if (copy.location.kind === 'inventory') requireValue(copy.home === null && copy.borrowerSimId === null);
    if (copy.borrowerSimId !== null) requireValue(copy.home !== null);
    if (copy.location.kind === 'shelf') requireValue(copy.home !== null && copy.home.shelf === copy.location.home.shelf && copy.home.slot === copy.location.home.slot);
    if (copy.location.kind === 'carried') requireValue(copy.home !== null && copy.borrowerSimId === copy.location.simId);
  }
  unique(rows.filter(c => c.home !== null), c => `${c.home!.shelf}:${c.home!.slot}`);
  return rows;
}
export function decodeBookMemory(bytes: Uint8Array): BookMemory | null {
  const r = new PostcardReader(bytes);
  const value = r.option(() => ({ simId: r.number(), titleId: r.text(), progressTicks: r.number(), progressFraction: r.float(),
    passNovelty: r.option(() => r.float()), familiarity: r.float(), lastReadTick: r.uint(64), completedPasses: r.number() }));
  r.done();
  if (value) { nonblank(value.titleId); requireValue(value.progressFraction >= 0 && value.progressFraction < 1 && value.familiarity >= 0 && value.familiarity <= 1);
    requireValue(value.passNovelty === null || (value.passNovelty > 0 && value.passNovelty <= 1)); }
  return value;
}
function decimal(value: string, bits: number): bigint {
  requireValue(/^(0|[1-9][0-9]*)$/.test(value));
  const n = BigInt(value); requireValue(n < (1n << BigInt(bits))); return n;
}
export function decodeBookResults(words: readonly string[]): BookResult[] {
  requireValue(words.length % 4 === 0);
  const rows: BookResult[] = [];
  for (let n = 0; n < words.length; n += 4) {
    const sequence = decimal(words[n], 64); requireValue(sequence > (rows.at(-1)?.sequence ?? 0n));
    rows.push({ sequence, copy: words[n + 1] === '' ? null : Number(decimal(words[n + 1], 32)),
      order: words[n + 2] === '' ? null : decimal(words[n + 2], 64), refusal: words[n + 3] || null });
  }
  return rows;
}
export function decodeBookShelves(words: Uint32Array): { entity: number; capacity: number }[] {
  requireValue(words.length % 2 === 0);
  const rows = Array.from({ length: words.length / 2 }, (_, n) => ({ entity: words[n * 2], capacity: words[n * 2 + 1] }));
  unique(rows, row => row.entity);
  for (const row of rows) requireValue(row.entity < 0xffffffff && row.capacity > 0 && row.capacity <= 65535);
  return rows;
}
export function decodeModelFacts(bytes: Uint8Array): ModelFacts[] {
  const r = new PostcardReader(bytes);
  const rows = r.list(() => {
    const definition = r.number(), id = r.text(), typeLabel = r.text(), modelName = r.text(), description = r.text(),
      typeId = r.text(), categoryId = r.text(), categoryLabel = r.text(), rooms = r.list(() => r.text()),
      width = r.number(), depth = r.number(), shelfCapacity = r.number(), shelfAccessPoints = r.number(), sessionTicks = r.number();
    const actions = r.list(() => {
      const action = { id: r.text(), label: r.text(), durationTicks: r.number(), capacity: r.option(() => r.number()), reading: r.bool(),
        benefits: r.list(() => [r.byte(), r.float()] as [number, number], 5), satisfactionPoints: r.float(), readingBenefits: r.list(() => r.float(), 4), requirements: r.list(() => r.text()), workKind: r.text() };
      const wireTail = r.list(() => r.text());
      wireTail.forEach(nonblank); unique(wireTail, value => value);
      return { ...action, ...splitBuyingDetails(wireTail) };
    }, 11);
    const roles = r.list(() => r.text());
    return { definition, id, typeLabel, modelName, description, typeId, categoryId, categoryLabel, rooms, width, depth, shelfCapacity, shelfAccessPoints, sessionTicks, actions, roles };
  }, 14);
  r.done(); unique(rows, row => row.id); unique(rows, row => row.definition);
  for (const row of rows) {
    nonblank(row.id); nonblank(row.typeLabel); nonblank(row.modelName); unique(row.rooms, room => room); unique(row.actions, action => action.id);
    requireValue(row.width > 0 && row.depth > 0 && row.shelfCapacity <= 65535 && (row.shelfCapacity === 0 || row.shelfAccessPoints > 0));
    requireValue(row.definition < 0xffffffff && (row.typeId !== '' ? row.categoryId.trim() !== '' && row.categoryLabel.trim() !== ''
      : row.categoryId === '' && row.categoryLabel === '' && row.rooms.length === 0));
    row.rooms.forEach(nonblank); unique(row.roles, role => role); row.roles.forEach(nonblank);
    for (const action of row.actions) { nonblank(action.id); nonblank(action.label); action.requirements.forEach(nonblank); action.optionalRequirements.forEach(nonblank); unique(action.requirements, value => value); unique(action.optionalRequirements, value => value); requireValue(!action.optionalRequirements.some(value => action.requirements.includes(value))); requireValue(action.durationTicks > 0 && (action.capacity === null ? action.reading && row.shelfCapacity > 0 : action.capacity > 0));
      requireValue(action.readingBenefits.length === (action.reading ? 4 : 0)); unique(action.benefits, entry => entry[0]);
      requireValue(action.satisfactionPoints >= 0 && action.readingBenefits.every(value => value >= 0));
      requireValue(action.benefits.every(([need]) => need < 7)); requireValue(['ordinary', 'recipe', 'dish_cleanup'].includes(action.workKind)); }
  }
  return rows;
}
