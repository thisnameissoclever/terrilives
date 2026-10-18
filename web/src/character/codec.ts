import { PostcardReader } from '../books/codec.js';
import type { CharacterCatalog } from './catalog.js';
import { bodyFields, colorFields, draftGroups, neutralDraft, validateAppearance, validateDraftStructure,
  floatValue, type CharacterAppearanceV1, type CharacterBehaviorDraft, type CharacterDraftV1, type CharacterPatchV1, type F32Bits, type Rgb } from './schema.js';

class Writer {
  readonly bytes: number[] = [];
  byte(value: number): void { if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error('Invalid byte.'); this.bytes.push(value); }
  uint(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error('Invalid unsigned integer.');
    do { const low = value % 128; value = Math.floor(value / 128); this.bytes.push(low | (value ? 128 : 0)); } while (value);
  }
  int(value: number): void { if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new Error('Invalid signed integer.'); this.uint(((value << 1) ^ (value >> 31)) >>> 0); }
  text(value: string): void { const bytes = new TextEncoder().encode(value); this.uint(bytes.length); this.bytes.push(...bytes); }
  bool(value: boolean): void { this.byte(Number(value)); }
  list<T>(values: readonly T[], write: (value: T) => void): void { this.uint(values.length); values.forEach(write); }
  result(): Uint8Array { if (this.bytes.length > 262144) throw new Error('Character command is too large.'); return Uint8Array.from(this.bytes); }
}
const faceLayout = ['shape','cheeks','jaw','chin','eyes','eye_size','brows','brow_thickness','nose','nose_width','mouth','mouth_fullness','ears'] as const;
const appearanceLayout = ['undertone','hairstyle','bald','facial_hair','freckles','freckle_density','scar','top','sleeves','bottoms','footwear','glasses','glasses_style','earrings'] as const;
function writeAppearance(w: Writer, a: CharacterAppearanceV1): void {
  w.byte(a.version); w.text(a.presentation); bodyFields.forEach(key => w.byte(a.body[key]));
  for (const key of faceLayout) { const value = a.face[key]; if (typeof value === 'string') w.text(value); else w.byte(value); }
  colorFields.forEach(key => a.colors[key].forEach(value => w.byte(value)));
  for (const key of appearanceLayout) { const value = a[key]; if (typeof value === 'string') w.text(value); else if (typeof value === 'boolean') w.bool(value); else w.byte(value); }
}
function readAppearance(r: PostcardReader): CharacterAppearanceV1 {
  const a = neutralDraft('Decode').appearance;
  Object.assign(a, { version: r.byte(), presentation: r.text() });
  bodyFields.forEach(key => { a.body[key] = r.byte(); });
  for (const key of faceLayout) Object.assign(a.face, { [key]: typeof a.face[key] === 'string' ? r.text() : r.byte() });
  colorFields.forEach(key => { a.colors[key] = [r.byte(), r.byte(), r.byte()] as Rgb; });
  for (const key of appearanceLayout) Object.assign(a, { [key]: typeof a[key] === 'string' ? r.text() : typeof a[key] === 'boolean' ? r.bool() : r.byte() });
  return validateAppearance(a);
}
function writeBehavior(w: Writer, b: CharacterBehaviorDraft): void {
  w.byte(b.shyness); w.uint(b.cleanliness); w.byte(b.self_preservation); w.int(b.chronotype_offset_ticks);
  b.drain.forEach(value => w.uint(value)); b.recovery.forEach(value => w.uint(value));
  w.list(b.dispositions, row => { w.text(row.object); w.text(row.action); w.uint(row.weight); });
}
function readBehavior(r: PostcardReader): CharacterBehaviorDraft {
  const shyness = r.byte(), cleanliness = r.number() as F32Bits, self_preservation = r.byte(), offset = r.number();
  return { shyness, cleanliness, self_preservation, chronotype_offset_ticks: (offset >>> 1) ^ -(offset & 1),
    drain: Array.from({ length: 7 }, () => r.number() as F32Bits), recovery: Array.from({ length: 7 }, () => r.number() as F32Bits),
    dispositions: r.list(() => ({ object: r.text(), action: r.text(), weight: r.number() as F32Bits }), 3) };
}
type Group = typeof draftGroups[number];
function writeGroup(w: Writer, key: Group, draft: CharacterDraftV1): void {
  switch (key) {
    case 'name': case 'pronouns': w.text(draft[key]); break;
    case 'appearance': writeAppearance(w, draft.appearance); break;
    case 'behavior': writeBehavior(w, draft.behavior); break;
    case 'traits': w.list(draft.traits, row => { w.text(row.id); w.uint(row.state); }); break;
    case 'affinities': w.list(draft.affinities, row => { w.text(row.id); w.uint(row.value); }); break;
    case 'hobbies': w.list(draft.hobbies, value => w.text(value)); break;
    case 'skills': w.list(draft.skills, row => { w.text(row.id); w.uint(row.practice); }); break;
    case 'ties': w.list(draft.ties, row => { w.uint(row[0]); w.bool(row[1] !== null); if (row[1] !== null) w.uint(row[1]); }); break;
  }
}
function readDraft(r: PostcardReader): CharacterDraftV1 {
  const value = { version: r.byte(), name: r.text(), pronouns: r.text(), appearance: readAppearance(r), behavior: readBehavior(r),
    traits: r.list(() => ({ id: r.text(), state: r.number() as F32Bits }), 2),
    affinities: r.list(() => ({ id: r.text(), value: r.number() as F32Bits }), 2), hobbies: r.list(() => r.text()),
    skills: r.list(() => ({ id: r.text(), practice: r.number() as F32Bits }), 2),
    ties: r.list(() => [r.number(), r.option(() => r.number())] as [number, number | null], 2) };
  return validateDraftStructure(value);
}
export function encodeCreateCharacter(request: number, draft: CharacterDraftV1): Uint8Array {
  validateDraftStructure(draft);
  const w = new Writer(); w.uint(30); w.uint(0); w.uint(request); w.byte(draft.version);
  draftGroups.forEach(key => writeGroup(w, key, draft)); return w.result();
}
export function encodeEditCharacter(request: number, sim: number, patch: CharacterPatchV1): Uint8Array {
  if (patch.version !== 1 || Object.keys(patch).some(key => key !== 'version' && !draftGroups.includes(key as Group))) throw new Error('Invalid character patch.');
  const resolved = { ...neutralDraft('Validation'), ...patch }; validateDraftStructure(resolved);
  const w = new Writer(); w.uint(30); w.uint(1); w.uint(request); w.uint(sim); w.byte(patch.version);
  for (const key of draftGroups) { const present = Object.hasOwn(patch, key); w.bool(present); if (present) writeGroup(w, key, resolved); }
  return w.result();
}
export function decodeCharacterSnapshot(bytes: Uint8Array): CharacterDraftV1 | null {
  const r = new PostcardReader(bytes), value = r.option(() => readDraft(r)); r.done(); return value;
}
export interface CharacterResult { request: number; sim: number | null; reason: number | null }
export function decodeCharacterResults(bytes: Uint8Array): CharacterResult[] {
  const r = new PostcardReader(bytes), rows = r.list(() => ({ request: r.number(), sim: r.option(() => r.number()), reason: r.option(() => r.byte()) }), 3);
  r.done();
  for (const row of rows) if ((row.sim === null) === (row.reason === null) || row.reason !== null && (row.reason < 1 || row.reason > 13)) throw new Error('Invalid character result.');
  return rows;
}

export function decodeCharacterAppearances(bytes: Uint8Array): { entity: number; sim: number; appearance: CharacterAppearanceV1 }[] {
  const r = new PostcardReader(bytes), rows = r.list(() => ({ entity: r.number(), sim: r.number(), appearance: readAppearance(r) }), 3);
  r.done();
  if (new Set(rows.map(row => row.entity)).size !== rows.length || new Set(rows.map(row => row.sim)).size !== rows.length) throw new Error('Duplicate character identity.');
  return rows;
}

export function decodeCharacterCatalog(bytes: Uint8Array): CharacterCatalog {
  const r = new PostcardReader(bytes);
  const bits = (): F32Bits => { const value = r.number() as F32Bits; floatValue(value); return value; };
  const signed = () => { const value = r.number(); return (value >>> 1) ^ -(value & 1); };
  const result: CharacterCatalog = {
    version: r.byte() as 1|2, name_limit: r.number(), max_traits: r.number(), max_household: r.number(),
    self_preservation_bands: [],
    traits: r.list(() => {
      const id = r.text(), label = r.text(), description = r.text(), kind = r.text();
      if (kind !== 'disposition' && kind !== 'capability' && kind !== 'condition') throw new Error('Unknown trait mechanism.');
      return { id, label, description, kind, initial_state: bits(), weights: r.list(() => ({ tag: r.text(), value: bits() }), 2) };
    }, 6),
    affinities: r.list(() => ({ id: r.text(), label: r.text(), description: r.text() }), 3),
    skills: r.list(() => ({ id: r.text(), label: r.text(), description: r.text(), thresholds: r.list(bits) }), 4),
    hobbies: r.list(() => ({ id: r.text(), label: r.text() }), 2),
    activities: r.list(() => ({ object: r.text(), action: r.text(), label: r.text(), tags: r.list(() => r.text()) }), 4),
    personalities: r.list(() => ({ id: r.text(), label: r.text(), description: r.text(), values: {
      cleanliness: bits(), chronotype_offset_ticks: signed(), drain: Array.from({ length: 7 }, bits), recovery: Array.from({ length: 7 }, bits),
      dispositions: r.list(() => ({ object: r.text(), action: r.text(), weight: bits() }), 3),
    } }), 7),
  };
  if(result.version===2)result.self_preservation_bands=r.list(()=>({min:r.byte(),max:r.byte(),weight:r.byte()}),3);
  r.done();
  if ((result.version !== 1 && result.version !== 2) || result.name_limit < 1 || result.max_traits > 100 || result.max_household < 1) throw new Error('Invalid character catalog limits.');
  if(result.version===2 && (result.self_preservation_bands.length!==7
    ||result.self_preservation_bands.reduce((sum,b)=>sum+b.weight,0)!==100
    ||result.self_preservation_bands.some((b,i)=>b.min<11||b.max>95||b.min>b.max||b.weight<1||(i>0&&b.min<=result.self_preservation_bands[i-1].max))))throw new Error('Invalid creation instinct probabilities.');
  for (const rows of [result.traits, result.affinities, result.skills, result.hobbies, result.personalities]) {
    if (rows.some(row => !row.id.trim()) || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Invalid catalog identifiers.');
  }
  for (const skill of result.skills) if (!skill.thresholds.length || floatValue(skill.thresholds[0]) !== 0 || skill.thresholds.some((value, index) => index > 0 && floatValue(value) <= floatValue(skill.thresholds[index - 1]))) throw new Error('Invalid skill ladder.');
  return result;
}
