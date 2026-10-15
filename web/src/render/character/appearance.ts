export interface AppearanceProofV1 {
  version: 1;
  presentation: 'masculine' | 'feminine';
  height: number; build: number;
  hairstyle: 'curl' | 'bob';
  skin: string; hair: string; shirt: string; trousers: string; shoes: string;
}
export type AppearanceField = Exclude<keyof AppearanceProofV1, 'version'>;
export const appearanceFields: readonly AppearanceField[] = ['presentation', 'height', 'build', 'hairstyle', 'skin', 'hair', 'shirt', 'trousers', 'shoes'];
export const colorFields = ['skin', 'hair', 'shirt', 'trousers', 'shoes'] as const;
const palette: Record<typeof colorFields[number], readonly string[]> = {
  skin: ['#efd4bc', '#d7ae8d', '#be8f6b', '#a87552', '#855a40', '#69462f', '#503522', '#35241c'],
  hair: ['#2b211d', '#65452e', '#997146', '#d1b777', '#a95a36', '#a6a09b'],
  shirt: ['#6b9f9b', '#456a99', '#b37150', '#b5954b', '#b7b7ad', '#78815f'],
  trousers: ['#394650', '#38465f', '#55504b', '#69665e', '#443f42'],
  shoes: ['#4c4037', '#242528', '#716052', '#a0907e'],
};

export function neutralAppearance(): AppearanceProofV1 {
  return { version: 1, presentation: 'masculine', height: 50, build: 50, hairstyle: 'curl',
    skin: '#be8f6b', hair: '#65452e', shirt: '#6b9f9b', trousers: '#394650', shoes: '#4c4037' };
}

export function parseAppearance(text: string): AppearanceProofV1 {
  const a = JSON.parse(text);
  if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).length !== 10 || a.version !== 1
      || !['masculine', 'feminine'].includes(a.presentation) || !['curl', 'bob'].includes(a.hairstyle)
      || ![a.height, a.build].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100)
      || !colorFields.every(k => typeof a[k] === 'string' && /^#[0-9a-fA-F]{6}$/.test(a[k]))) {
    throw new Error('Invalid appearance record. Expected version 1, known selections, shape values 0-100, and six-digit colors.');
  }
  return { version: 1, presentation: a.presentation, height: a.height, build: a.build,
    hairstyle: a.hairstyle, skin: a.skin, hair: a.hair, shirt: a.shirt, trousers: a.trousers, shoes: a.shoes };
}

export class AppearanceDraft {
  value: AppearanceProofV1;
  readonly locks = new Set<AppearanceField>();
  private randomState: number;
  private previous: { value: AppearanceProofV1; state: number } | null = null;
  constructor(seed: number, saved?: AppearanceProofV1) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid draft seed');
    this.randomState = seed || 0x9e3779b9;
    this.value = saved ? parseAppearance(JSON.stringify(saved)) : neutralAppearance();
    if (!saved) { this.randomize(); this.previous = null; }
  }
  serialize(): string {
    return JSON.stringify({ draftVersion: 1, appearance: this.value, randomState: this.randomState,
      locks: appearanceFields.filter(field => this.locks.has(field)), previous: this.previous });
  }
  static restore(text: string): AppearanceDraft {
    const data = JSON.parse(text);
    // Earlier proof builds saved appearance only. Preserve those values explicitly.
    if (data?.version === 1) return new AppearanceDraft(0x9e3779b9, parseAppearance(text));
    if (data?.draftVersion !== 1 || !Number.isInteger(data.randomState) || data.randomState <= 0 || data.randomState > 0xffffffff
        || !Array.isArray(data.locks) || new Set(data.locks).size !== data.locks.length
        || !data.locks.every((field: unknown) => appearanceFields.includes(field as AppearanceField))) throw new Error('Invalid proof draft');
    const draft = new AppearanceDraft(data.randomState, parseAppearance(JSON.stringify(data.appearance)));
    for (const field of data.locks) draft.locks.add(field);
    if (data.previous !== null) {
      if (!data.previous || !Number.isInteger(data.previous.state) || data.previous.state <= 0 || data.previous.state > 0xffffffff) throw new Error('Invalid undo state');
      draft.previous = { value: parseAppearance(JSON.stringify(data.previous.value)), state: data.previous.state };
    }
    return draft;
  }
  private below(count: number): number {
    const limit = Math.floor(0x100000000 / count) * count;
    for (let attempt = 0; attempt < 32; attempt++) {
      let x = this.randomState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      this.randomState = x >>> 0;
      if (this.randomState < limit) return this.randomState % count;
    }
    throw new Error('Draft random generator exceeded its draw bound');
  }
  randomize(fields: readonly AppearanceField[] = appearanceFields): void {
    this.previous = { value: { ...this.value }, state: this.randomState };
    const next = { ...this.value };
    for (const field of fields) {
      if (this.locks.has(field)) continue;
      if (field === 'presentation') next.presentation = this.below(2) === 0 ? 'masculine' : 'feminine';
      else if (field === 'hairstyle') next.hairstyle = this.below(2) === 0 ? 'curl' : 'bob';
      else if (field === 'height' || field === 'build') next[field] = this.below(101);
      else next[field] = palette[field][this.below(palette[field].length)];
    }
    this.value = next;
  }
  set(field: AppearanceField, value: string | number): void {
    const next = parseAppearance(JSON.stringify({ ...this.value, [field]: value }));
    this.previous = { value: { ...this.value }, state: this.randomState }; this.value = next;
  }
  undo(): void {
    if (!this.previous) return;
    this.value = this.previous.value; this.randomState = this.previous.state; this.previous = null;
  }
}
