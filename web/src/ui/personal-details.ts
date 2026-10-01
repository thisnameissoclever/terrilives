import type { SimDetails } from '../bridge.js';

export interface PersonalDetailsSource {
  selectedIndex(): number | null;
  simDetailsOf(entity: number): SimDetails | null;
  dayTicks(): number;
}

export type PersonalDetailsState =
  | { kind: 'unselected' | 'unavailable' }
  | { kind: 'ready'; sleep: string; needs: readonly { name: string; drain: string; refill: string }[];
    repeated: readonly { key: string; object: string; activity: string; percent: number }[] };

export interface PersonalDetailsSurface { render(state: PersonalDetailsState): void; }

/** Game-time conversion also works for content packs with a different day length. */
export function sleepTiming(offset: number, dayTicks: number): string | null {
  if (!Number.isFinite(offset) || !Number.isFinite(dayTicks) || dayTicks <= 0) return null;
  if (offset === 0) return 'Usual schedule';
  const minutes = Math.round(Math.abs(offset) * 1440 / dayTicks * 10) / 10;
  return `${minutes} game min ${offset < 0 ? 'earlier' : 'later'}`;
}

export function personalDetailsState(source: PersonalDetailsSource, names: readonly string[]): PersonalDetailsState {
  const selected = source.selectedIndex();
  if (selected === null) return { kind: 'unselected' };
  const details = source.simDetailsOf(selected);
  if (!details || details.drain.length !== names.length || details.refill.length !== names.length) return { kind: 'unavailable' };
  const sleep = sleepTiming(details.sleepOffsetTicks, source.dayTicks());
  if (sleep === null) return { kind: 'unavailable' };
  return { kind: 'ready', sleep,
    needs: names.map((name, index) => ({ name: name.charAt(0).toUpperCase() + name.slice(1),
      drain: `${Math.round(details.drain[index] * 100)}%`, refill: `${Math.round(details.refill[index] * 100)}%` })),
    repeated: details.repeated.map(row => ({ ...row, percent: Math.round(row.repetition * 100) })) };
}

/** Closed disclosures do no periodic reads; opening or loading forces a fresh one. */
export class PersonalDetailsPanel {
  private lastRenderMs: number | null = null;

  constructor(private readonly source: PersonalDetailsSource, private readonly names: readonly string[],
    private readonly surface: PersonalDetailsSurface, private readonly refreshMs: number,
    private readonly active: () => boolean) {
    if (!Number.isFinite(refreshMs) || refreshMs <= 0) throw new Error('Personal details refresh interval must be positive and finite');
  }

  update(nowMs: number, force = false): boolean {
    if (!force && (!this.active() || (this.lastRenderMs !== null && nowMs - this.lastRenderMs < this.refreshMs))) return false;
    this.surface.render(personalDetailsState(this.source, this.names));
    this.lastRenderMs = nowMs;
    return true;
  }
}

export function createPersonalDetailsSurface(doc: Document, empty: HTMLElement, content: HTMLElement): PersonalDetailsSurface {
  const text = (tag: string, value: string, className = ''): HTMLElement => {
    const element = doc.createElement(tag);
    element.textContent = value;
    element.className = className;
    return element;
  };
  const table = doc.createElement('table');
  table.append(text('caption', 'Personality factors'));
  const headings = doc.createElement('tr');
  for (const label of ['Need', 'Drain', 'Refill']) {
    const heading = doc.createElement('th');
    heading.scope = 'col';
    heading.textContent = label;
    headings.append(heading);
  }
  const head = doc.createElement('thead');
  head.append(headings);
  const body = doc.createElement('tbody');
  table.append(head, body);
  const factorsHelp = text('p', '100% is the normal personality factor. Sleep, work and traits also affect needs.', 'personal-details-note');
  const sleep = text('p', '');
  const sleepHelp = text('p', 'Sleep timing depends on needs and available beds.', 'personal-details-note');
  const repeatedHeading = text('h3', 'Repeated activities');
  const repeatedHelp = text('p', 'Recent repetition reduces an activity\'s appeal. It fades with time and is shared across objects of the same type.', 'personal-details-note');
  const noRepetition = text('p', 'No repeated activities recorded.', 'personal-details-note');
  const list = doc.createElement('ul');
  list.className = 'personal-repetition';
  const needs: { name: HTMLElement; drain: HTMLElement; refill: HTMLElement }[] = [];
  const rows = new Map<string, { root: HTMLElement; object: HTMLElement; activity: HTMLElement; meter: HTMLMeterElement; value: HTMLElement }>();
  content.append(table, factorsHelp, sleep, sleepHelp, repeatedHeading, repeatedHelp, noRepetition, list);

  return { render(state): void {
    content.hidden = state.kind !== 'ready';
    empty.hidden = state.kind === 'ready';
    empty.textContent = state.kind === 'unselected' ? 'Select a person to see their personality and habits.' : 'Personal details unavailable.';
    const data = state.kind === 'ready' ? state : null;
    sleep.textContent = data ? `Sleep rhythm: ${data.sleep}` : '';
    const needData = data?.needs ?? [];
    if (needs.length !== needData.length) {
      body.replaceChildren();
      needs.length = 0;
      for (const need of needData) {
        const row = doc.createElement('tr');
        const name = doc.createElement('th');
        name.scope = 'row';
        name.textContent = need.name;
        const drain = doc.createElement('td');
        const refill = doc.createElement('td');
        row.append(name, drain, refill);
        body.append(row);
        needs.push({ name, drain, refill });
      }
    }
    needData.forEach((need, index) => {
      needs[index].name.textContent = need.name;
      needs[index].drain.textContent = need.drain;
      needs[index].refill.textContent = need.refill;
    });
    const repeated = data?.repeated ?? [];
    const keys = new Set(repeated.map(row => row.key));
    for (const [key, row] of rows) {
      if (!keys.has(key)) { row.root.remove(); rows.delete(key); }
    }
    for (const [index, entry] of repeated.entries()) {
      let row = rows.get(entry.key);
      if (!row) {
        const root = doc.createElement('li');
        const label = doc.createElement('div');
        const object = text('strong', '');
        const activity = text('span', '', 'personal-details-note');
        label.append(object, activity);
        const measurement = doc.createElement('div');
        measurement.className = 'personal-repetition-value';
        const meter = doc.createElement('meter');
        meter.min = 0; meter.max = 100;
        const value = text('span', '');
        measurement.append(meter, value);
        root.append(label, measurement);
        row = { root, object, activity, meter, value };
        rows.set(entry.key, row);
      }
      row.object.textContent = entry.object;
      row.activity.textContent = entry.activity;
      row.meter.value = entry.percent;
      row.meter.setAttribute('aria-label', `${entry.object}: ${entry.activity}, recent repetition`);
      row.value.textContent = `${entry.percent}%`;
      const at = list.children.item(index);
      if (at !== row.root) list.insertBefore(row.root, at);
    }
    noRepetition.hidden = repeated.length > 0;
    list.hidden = repeated.length === 0;
  } };
}
