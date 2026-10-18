import { characterFields, type CharacterField, type FieldValue, type Section } from './fields.js';
import type { CharacterCatalog, HouseholdChoice } from './catalog.js';
import { defaultAppearance, floatBits, makePatch, neutralDraft, type CharacterDraftV1, type CharacterPatchV1, type TraitDraft } from './schema.js';
import { validateDraft } from './validate.js';
import { namesForPresentation } from './names.js';
import { DraftRandom } from './random.js';
import { activityCategories, categoryMembers } from './activity-categories.js';

export type DraftScope = 'all' | Section | string;
interface Checkpoint { value: CharacterDraftV1; state: number; locks: Set<string>; retainedTraits: TraitDraft[] }
const traitId = (id: string) => JSON.stringify(['trait', id]);
const severityId = (id: string) => JSON.stringify(['severity', id]);

export class CharacterDraft {
  readonly fields: readonly CharacterField[];
  readonly mode: 'create' | 'edit';
  private current: CharacterDraftV1;
  private initial: CharacterDraftV1;
  private rng: DraftRandom;
  private locked = new Set<string>();
  // Draft-only toggle memory belongs to Undo, never to a submitted character.
  private retainedTraits: TraitDraft[];
  private previous: Checkpoint | null = null;

  private constructor(value: CharacterDraftV1, seed: number, mode: 'create' | 'edit', readonly catalog: CharacterCatalog,
    private readonly household: readonly HouseholdChoice[], private readonly person?: number) {
    this.current = structuredClone(value); this.initial = structuredClone(value);
    this.retainedTraits = structuredClone(value.traits);
    this.rng = new DraftRandom(seed); this.mode = mode;
    this.fields = characterFields(catalog, household, person);
  }
  static create(seed: number, catalog: CharacterCatalog, household: readonly HouseholdChoice[]): CharacterDraft {
    const draft = new CharacterDraft(neutralDraft('New housemate'), seed, 'create', catalog, household);
    draft.randomize('all'); draft.initial = draft.resolve(); draft.previous = null;
    return draft;
  }
  static edit(snapshot: CharacterDraftV1, seed: number, catalog: CharacterCatalog, household: readonly HouseholdChoice[], person?: number): CharacterDraft {
    validateDraft(snapshot, catalog, snapshot, household, person);
    return new CharacterDraft(snapshot, seed, 'edit', catalog, household, person);
  }
  get value(): CharacterDraftV1 { return structuredClone(this.current); }
  get randomState(): number { return this.rng.state; }
  get canUndo(): boolean { return this.previous !== null; }
  get locks(): ReadonlySet<string> { return new Set(this.locked); }
  resolve(): CharacterDraftV1 {
    return structuredClone(validateDraft(this.current, this.catalog, this.mode === 'edit' ? this.initial : undefined, this.household, this.person));
  }
  patch(): CharacterPatchV1 { return makePatch(this.initial, this.resolve()); }
  private field(id: string): CharacterField {
    const field = this.fields.find(field => field.id === id);
    if (!field) throw new Error(`Unknown character field: ${id}`);
    return field;
  }
  private select(scope: DraftScope): readonly CharacterField[] {
    if (scope === 'all') return this.fields;
    if (scope === 'traits') return this.fields.filter(field=>field.group==='Traits'||field.group==='Conditions');
    const section = this.fields.filter(field => field.section === scope);
    return ['identity','appearance','personality','needs','interests','household'].includes(scope) ? section : [this.field(scope)];
  }
  private checkpoint(): Checkpoint {
    return { value: this.value, state: this.randomState, locks: new Set(this.locked), retainedTraits: structuredClone(this.retainedTraits) };
  }
  private restore(checkpoint: Checkpoint): void {
    this.current = structuredClone(checkpoint.value); this.rng = new DraftRandom(checkpoint.state); this.locked = new Set(checkpoint.locks);
    this.retainedTraits = structuredClone(checkpoint.retainedTraits);
  }
  private rememberTraits(): void {
    for (const trait of this.current.traits) {
      const index = this.retainedTraits.findIndex(row => row.id === trait.id);
      if (index < 0) this.retainedTraits.push(structuredClone(trait));
      else this.retainedTraits[index] = structuredClone(trait);
    }
  }
  private setField(field: CharacterField, value: FieldValue): void {
    const retained = this.retainedTraits.find(trait => value === true && traitId(trait.id) === field.id);
    const reselecting = retained && !this.current.traits.some(trait => trait.id === retained.id);
    field.set(this.current, value);
    if (retained && reselecting) {
      const selected = this.current.traits;
      this.current.traits = this.retainedTraits.flatMap(trait => {
        const row = selected.find(row => row.id === trait.id);
        return row ? [trait.id === retained.id ? structuredClone(retained) : row] : [];
      }).concat(selected.filter(row => !this.retainedTraits.some(trait => trait.id === row.id)));
    }
  }
  private transact(change: () => void): void {
    const before = this.checkpoint();
    try { change(); this.resolve(); this.rememberTraits(); }
    catch (error) { this.restore(before); throw error; }
    this.previous = before;
  }
  set(id: string, value: FieldValue): void {
    const field = this.field(id);
    this.transact(() => this.setField(field, value));
  }
  lock(id: string, enabled: boolean): void {
    this.field(id);
    if (enabled) this.locked.add(id); else this.locked.delete(id);
  }
  undo(): void {
    if (!this.previous) return;
    this.restore(this.previous); this.previous = null;
  }
  private randomValue(field: CharacterField): FieldValue {
    if (field.id === 'name') return this.rng.choose(namesForPresentation(this.current.appearance.presentation));
    if(field.id==='behavior.self_preservation'){
      const bucket=this.rng.index(100);let end=0;
      for(const band of this.catalog.self_preservation_bands){
        end+=band.weight;if(bucket<end)return band.min+this.rng.index(band.max-band.min+1);
      }
      throw new Error('Creation instinct probabilities are unavailable.');
    }
    if (field.choices) return structuredClone(this.rng.choose(field.choices).value);
    if (field.kind === 'boolean') return this.rng.index(2) === 1;
    if (field.min === undefined || field.max === undefined || !field.step) throw new Error(`No randomization domain: ${field.id}`);
    const count = Math.round((field.max - field.min) / field.step) + 1;
    const pick=this.rng.index(count+(field.extraValues?.length??0));
    if(pick>=count)return structuredClone(field.extraValues![pick-count]);
    const value = field.min + pick * field.step;
    return field.kind === 'float' ? floatBits(value) : value;
  }
  private randomTraits(): void {
    const protectedIds = new Set(this.catalog.traits.filter(trait => this.locked.has(traitId(trait.id)) || this.locked.has(severityId(trait.id))).map(trait => trait.id));
    const preserved = this.current.traits.filter(trait => protectedIds.has(trait.id));
    const candidates = this.catalog.traits.filter(trait => !protectedIds.has(trait.id));
    const slots = Math.max(0,Math.min(this.catalog.max_traits - preserved.length, candidates.length));
    const minimum=preserved.length===0&&slots>0?1:0;
    const count = minimum+this.rng.index(slots-minimum+1);
    this.current.traits = preserved;
    for (let i = 0; i < count; i++) {
      const [trait] = candidates.splice(this.rng.index(candidates.length), 1);
      this.current.traits.push({ id: trait.id, state: trait.initial_state });
    }
    this.retainedTraits = [...structuredClone(this.current.traits), ...this.retainedTraits.filter(trait => !this.current.traits.some(row => row.id === trait.id))];
  }
  randomize(scope: DraftScope = 'all'): void {
    const fields = this.select(scope), allTraits = ['all','personality','traits'].includes(scope);
    this.transact(() => {
      const gender=fields.find(field=>field.id==='appearance.presentation');
      if(gender&&!this.locked.has(gender.id))gender.set(this.current,this.randomValue(gender));
      if (allTraits) this.randomTraits();
      for (const field of fields) {
        if (field===gender || this.locked.has(field.id) || field.applicable && !field.applicable(this.current)) continue;
        const trait = this.catalog.traits.find(trait => traitId(trait.id) === field.id);
        if (trait) {
          if (allTraits || this.locked.has(severityId(trait.id))) continue;
          if (!field.get(this.current) && this.current.traits.length >= this.catalog.max_traits) continue;
        }
        this.setField(field, this.randomValue(field));
      }
    });
  }
  reset(scope: DraftScope = 'all'): void {
    const defaults = neutralDraft('New housemate'), fields = this.select(scope);
    this.transact(() => {
      this.retainedTraits = this.retainedTraits.filter(trait => !fields.some(field => field.id === traitId(trait.id)));
      for (const field of fields) {
        if(field.restore){field.restore(this.current,defaults);continue;}
        // Absent conditions have no severity to reset. Other hidden controls,
        // such as freckle density, still have a stored default.
        if (field.id.startsWith('["severity",') && !field.applicable?.(this.current)) continue;
        field.set(this.current, field.get(defaults));
      }
    });
  }
  applyPersonalityPreset(id: string): void {
    const preset = this.catalog.personalities.find(preset => preset.id === id);
    if (!preset) throw new Error('Unknown personality preset.');
    this.transact(() => {
      const hidden=this.current.behavior.dispositions.filter(route=>!this.editableRoute(route));
      const values=structuredClone(preset.values);
      values.dispositions=[...values.dispositions.filter(route=>this.editableRoute(route)),...hidden];
      Object.assign(this.current.behavior,values);
    });
  }
  private editableRoute(route:{object:string;action:string}):boolean {
    return activityCategories.some(category=>categoryMembers(category,this.catalog).some(member=>member.object===route.object&&member.action===route.action));
  }
  get personalityPreset(): string | null {
    return this.catalog.personalities.find(preset => Object.entries(preset.values).every(([key, value]) =>
      key==='dispositions'
        ?JSON.stringify(this.current.behavior.dispositions.filter(route=>this.editableRoute(route)))===JSON.stringify(preset.values.dispositions.filter(route=>this.editableRoute(route)))
        :JSON.stringify(this.current.behavior[key as keyof typeof preset.values]) === JSON.stringify(value)))?.id ?? null;
  }
  resetAppearanceToPreset(): void {
    this.transact(() => { this.current.appearance = defaultAppearance(this.current.appearance.presentation); });
  }
}
