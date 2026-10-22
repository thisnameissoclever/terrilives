/** Developer diagnostics read current projections without changing gameplay state. */
import { setTextIfChanged } from './set-text-if-changed.js';

/** What the panel reads. `SimBridge` satisfies it structurally. */
export interface DebugSource {
  readonly count: number;
  kinds(): Uint32Array;
  ids(): Uint32Array;
  activities(): Uint32Array;
  simName(entityIndex: number): string;
  simIdOf(entityIndex: number): number | null;
  /** The M2e second axis, or null for a sim with no ledger. */
  satisfactionOf(entityIndex: number): number | null;
  needsOf(entityIndex: number): Float32Array;
  personalityOf(entityIndex: number): Float32Array;
  relationshipsOf(entityIndex: number): Float32Array;
  needNames(): readonly string[];
  /** The household's money - E4. World state, printed once at the top. */
  funds(): number;
  /** Interleaved [pack trait index, state, ...] pairs, or empty - E3. */
  traitsOf(entityIndex: number): Float32Array;
  /** One label per pack trait, aligned with traitKinds. */
  traitLabels(): string[];
  /** "disposition" | "capability" | "condition" per pack trait. */
  traitKinds(): string[];
  /** The sim's job label, or null for the unemployed - E4. */
  careerOf(entityIndex: number): string | null;
  /** The sim's mid-errand status line, or null when it is not on one - K4. */
  chainStatusOf(entityIndex: number): string | null;
  /** Why the sim is not acting, or null when nothing holds it back. */
  stallReasonOf(entityIndex: number): string | null;
  /** How many player orders the sim still has waiting; 0 for none. */
  queuedOrdersOf(entityIndex: number): number;
}

/** The one DOM dependency, structural like the needs panel's. */
export interface DebugRoot {
  hidden: boolean;
  textContent: string | null;
}

const KIND_AGENT = 0;

const ACTIVITY_NAMES = [
  'idle',
  'walking',
  'waiting',
  'eating',
  'talking',
  'sleeping',
  'at work',
  'using object',
  'reading',
  'exercising',
  'watching fish',
  'sitting',
  'showering',
  'using the toilet',
  'watching TV',
  'lying down',
  'washing hands',
  'washing dishes',
  'listening to the radio',
  'handling correspondence',
  'bathing',
  'getting ingredients',
  'preparing food',
  'cooking',
] as const;

/** How a trait's mutable state is worded, by kind. A disposition's 0 is
 * meaningless (it carries no state) and prints nothing. */
function traitStateLabel(kind: string, state: number): string {
  if (kind === 'capability') return `, level ${state.toFixed(2)}`;
  if (kind === 'condition') return `, severity ${state.toFixed(2)}`;
  return '';
}

export const DEBUG_SECTIONS = ['Overview', 'Traits', 'Needs', 'Need rates', 'Relationships'] as const;
type DebugSection = typeof DEBUG_SECTIONS[number];
type DebugField = readonly [label: string, value: string];
interface DebugPerson { entity: number; simId: number | null; name: string; activity: string }

function debugRoster(source: DebugSource): DebugPerson[] {
  // Each boundary read may grow memory. Retain copies before the next call.
  const kinds = Array.from(source.kinds()), ids = Array.from(source.ids()), activities = Array.from(source.activities());
  return ids.slice(0, source.count).flatMap((entity, row) => kinds[row] !== KIND_AGENT ? [] : [{
    entity, simId: source.simIdOf(entity), name: source.simName(entity) || `entity ${entity}`,
    activity: ACTIVITY_NAMES[activities[row]] ?? `activity ${activities[row]}`,
  }]);
}

function diagnosticFields(source: DebugSource, entity: number, section: DebugSection,
  names: ReadonlyMap<number, string>): DebugField[] {
  const fields: DebugField[] = [];
  if (section === 'Overview') {
    const satisfaction = source.satisfactionOf(entity);
    if (satisfaction !== null) fields.push(['life satisfaction', satisfaction.toFixed(1)]);
    const career = source.careerOf(entity);
    if (career !== null) fields.push(['career', career]);
    const chain = source.chainStatusOf(entity);
    if (chain !== null) fields.push(['chain', chain]);
    const stall = source.stallReasonOf(entity);
    if (stall !== null) fields.push(['stalled reason', stall]);
    const orders = source.queuedOrdersOf(entity);
    if (orders > 0) fields.push(['player orders waiting', String(orders)]);
  } else if (section === 'Traits') {
    const labels = source.traitLabels(), kinds = source.traitKinds(), worn = source.traitsOf(entity);
    for (let i = 0; i + 1 < worn.length; i += 2) {
      const which = worn[i], kind = kinds[which] ?? 'unknown';
      fields.push(['traits', `${labels[which] ?? `trait#${which}`} (${kind}${traitStateLabel(kind, worn[i + 1])})`]);
    }
  } else if (section === 'Needs') {
    const labels = source.needNames(), needs = source.needsOf(entity);
    fields.push(...Array.from(needs, (level, i): DebugField => [labels[i] ?? `need${i}`, level.toFixed(1)]));
  } else if (section === 'Need rates') {
    const labels = source.needNames(), personality = source.personalityOf(entity);
    if (personality.length === labels.length * 2) {
      for (const [offset, label] of [[0, 'need decay'], [labels.length, 'need refill']] as const) {
        const deviations = Array.from(personality.subarray(offset, offset + labels.length))
          .map((v, i) => ({need: labels[i], v})).filter(({v}) => Math.abs(v - 1) > .0001)
          .map(({need, v}) => `${need} x${v.toFixed(2)}`).join(', ');
        if (deviations) fields.push([label, deviations]);
      }
    }
  } else {
    const pairs = source.relationshipsOf(entity);
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const value = pairs[i + 1];
      fields.push([names.get(pairs[i]) ?? `sim#${pairs[i]}`, `${value >= 0 ? '+' : ''}${value.toFixed(2)}`]);
    }
  }
  return fields;
}

/** The full report shares every field computation with the visible disclosures. */
export function formatDebugReport(source: DebugSource): string {
  const people = debugRoster(source);
  const names = new Map(people.filter(person => person.simId !== null).map(person => [person.simId!, person.name]));
  const lines = [`household funds: ${source.funds()}`, ''];
  for (const person of people) {
    lines.push(`${person.name}  (entity ${person.entity}, SimId ${person.simId ?? 'none'})  doing: ${person.activity}`);
    for (const section of DEBUG_SECTIONS) {
      const fields = diagnosticFields(source, person.entity, section, names);
      if (section === 'Needs') {
        if (fields.length) lines.push(`  needs: ${fields.map(([key, value]) => `${key} ${value}`).join('  ')}`);
      } else if (section === 'Relationships') {
        lines.push(`  relationships: ${fields.map(([key, value]) => `${key} ${value}`).join(', ') || 'nobody yet'}`);
      } else lines.push(...fields.map(([key, value]) => `  ${key}: ${value}`));
    }
    lines.push('');
  }
  return lines.join('\n');
}

export interface DebugSurface { render(source: DebugSource): void }

/** Keyed people and fields keep native disclosures and keyboard focus stable. */
export function createStructuredDebugSurface(doc: Document, root: HTMLElement, visible: () => boolean = () => true): DebugSurface {
  interface SectionView { details: HTMLDetailsElement; body: HTMLElement; rows: HTMLTableRowElement[]; empty: HTMLElement }
  interface PersonView { details: HTMLDetailsElement; name: HTMLElement; activity: HTMLElement; identity: HTMLElement; sections: Map<DebugSection, SectionView> }
  const people = new Map<number, PersonView>();
  const funds = doc.createElement('p'); funds.className = 'diagnostic-funds'; root.append(funds);
  let currentSource: DebugSource | null = null;
  let currentNames: ReadonlyMap<number, string> = new Map();
  const updateSection = (view: SectionView, entity: number, section: DebugSection) => {
    if (!currentSource || !visible() || !view.details.open) return;
    const fields = diagnosticFields(currentSource, entity, section, currentNames);
    while (view.rows.length > fields.length) view.rows.pop()!.remove();
    fields.forEach(([label, value], index) => {
      let row = view.rows[index];
      if (!row) {
        row = doc.createElement('tr');
        const heading = doc.createElement('th'); heading.setAttribute('scope', 'row');
        row.append(heading, doc.createElement('td')); view.body.append(row); view.rows.push(row);
      }
      setTextIfChanged(row.children[0], label); setTextIfChanged(row.children[1], value);
    });
    view.empty.hidden = fields.length > 0;
  };
  const createPerson = (entity: number): PersonView => {
    const details = doc.createElement('details'); details.className = 'diagnostic-person'; details.open = true;
    const summary = doc.createElement('summary'), name = doc.createElement('strong'), activity = doc.createElement('span');
    summary.append(name, activity);
    const identity = doc.createElement('p'); identity.className = 'diagnostic-identity'; details.append(summary, identity);
    const sections = new Map<DebugSection, SectionView>();
    for (const section of DEBUG_SECTIONS) {
      const inner = doc.createElement('details'); inner.className = 'diagnostic-section';
      const heading = doc.createElement('summary'); heading.textContent = section;
      const table = doc.createElement('table'); table.setAttribute('aria-label', section);
      const body = doc.createElement('tbody'); table.append(body);
      const empty = doc.createElement('p'); empty.className = 'diagnostic-empty';
      empty.textContent = section === 'Relationships' ? 'Nobody yet' : section === 'Need rates' ? 'No personality deviations' : 'No values';
      inner.append(heading, table, empty); details.append(inner);
      const view = {details: inner, body, rows: [], empty}; sections.set(section, view);
      inner.addEventListener('toggle', () => {if (details.open) updateSection(view, entity, section);});
    }
    details.addEventListener('toggle', () => {if (details.open) for (const [section, view] of sections) updateSection(view, entity, section);});
    return {details, name, activity, identity, sections};
  };
  return {render(source) {
    currentSource = source;
    const roster = debugRoster(source);
    currentNames = new Map(roster.filter(person => person.simId !== null).map(person => [person.simId!, person.name]));
    setTextIfChanged(funds, `Household funds: ${source.funds()}`);
    const live = new Set(roster.map(person => person.entity));
    for (const [entity, view] of people) if (!live.has(entity)) {view.details.remove(); people.delete(entity);}
    roster.forEach((person, index) => {
      let view = people.get(person.entity);
      if (!view) {view = createPerson(person.entity); people.set(person.entity, view);}
      setTextIfChanged(view.name, person.name); setTextIfChanged(view.activity, person.activity);
      setTextIfChanged(view.identity, `entity ${person.entity}, SimId ${person.simId ?? 'none'}`);
      const before = root.children[index + 1] ?? null;
      if (before !== view.details) root.insertBefore(view.details, before);
      if (view.details.open) for (const [section, part] of view.sections) updateSection(part, person.entity, section);
    });
  }};
}

/** The panel: a throttle around `formatDebugReport`, nothing more. */
export class DebugPanel {
  private lastReadMs = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly source: DebugSource,
    private readonly root: DebugRoot,
    private readonly refreshMs: number,
    private readonly surface?: DebugSurface,
  ) {}

  toggle(): void {
    this.root.hidden = !this.root.hidden;
    // A panel opened after a quiet stretch shows NOW, not the stale
    // report from before it was hidden.
    this.lastReadMs = Number.NEGATIVE_INFINITY;
  }

  update(nowMs: number): void {
    if (this.root.hidden) return;
    if (nowMs - this.lastReadMs < this.refreshMs) return;
    this.lastReadMs = nowMs;
    if (this.surface) this.surface.render(this.source);
    else this.root.textContent = formatDebugReport(this.source);
  }
}
