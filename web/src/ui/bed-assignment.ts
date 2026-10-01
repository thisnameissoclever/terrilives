import type { BedAssignmentResult, BedPlace, BedPlaceStatus } from '../bridge.js';
import { setTextIfChanged } from './set-text-if-changed.js';

export interface BedAssignmentSource {
  selectedIndex(): number | null;
  bedPlacesOf(agent: number): readonly BedPlaceStatus[] | null;
  setBedAssignment(agent: number, place: BedPlace | null): boolean;
  lastBedAssignmentResult(): BedAssignmentResult | null;
}

export interface BedAssignmentState {
  readonly agent: number | null;
  readonly places: readonly BedPlaceStatus[] | null;
  readonly choice: BedPlace | null;
  readonly pending: boolean;
  readonly status: string;
}

function samePlace(a: BedPlace | null, b: BedPlace | null): boolean {
  return a === null ? b === null : b !== null && a.bed === b.bed && a.ordinal === b.ordinal;
}

/** One pending UI command; the simulation remains the authority on assignment conflicts. */
export class BedAssignmentPanel {
  private agent: number | null = null;
  private places: readonly BedPlaceStatus[] | null = null;
  private choice: BedPlace | null = null;
  private status = '';
  private pending: { agent: number; place: BedPlace | null; after: bigint } | null = null;
  private lastRead: number | null = null;

  constructor(private readonly source: BedAssignmentSource,
    private readonly render: (state: BedAssignmentState) => void,
    private readonly refreshMs: number, private readonly active: () => boolean) {
    if (!Number.isFinite(refreshMs) || refreshMs <= 0) throw new Error('Bed assignment refresh interval must be positive and finite');
  }

  private show(): void {
    this.render({ agent: this.agent, places: this.places, choice: this.choice,
      pending: this.pending !== null, status: this.status });
  }

  private syncSelection(): boolean {
    const agent = this.source.selectedIndex();
    if (agent === this.agent) return false;
    this.agent = agent;
    this.places = null;
    this.choice = null;
    this.pending = null;
    this.status = '';
    this.lastRead = null;
    this.show();
    return true;
  }

  update(nowMs: number, force = false): void {
    const changed = this.syncSelection();
    if (!force && (!this.active() || (!changed && this.lastRead !== null && nowMs - this.lastRead < this.refreshMs))) return;
    this.readPlaces();
    this.lastRead = nowMs;
    this.show();
  }

  private readPlaces(): void {
    this.places = this.agent === null ? null : this.source.bedPlacesOf(this.agent);
    if (!this.places) {
      this.choice = null;
      this.pending = null;
    } else if (this.choice && !this.places.some(row => samePlace(row, this.choice))) {
      this.choice = null;
    }
  }

  choose(place: BedPlace | null): void {
    if (this.syncSelection() || this.pending) return;
    const row = this.places?.find(row => samePlace(row, place));
    if (place !== null && (!row || (row.assignee !== null && row.assignee !== this.agent))) return;
    this.choice = place === null ? null : { bed: place.bed, ordinal: place.ordinal };
    this.status = '';
    this.show();
  }

  assign(): void {
    if (this.choice !== null) this.stage(this.choice);
  }

  clear(): void { this.stage(null); }

  private stage(place: BedPlace | null): void {
    if (this.syncSelection() || this.pending || this.agent === null) return;
    // Recheck before enqueue: sale, death or another assignment may have changed the open sheet.
    this.readPlaces();
    const current = this.places?.find(row => row.assignee === this.agent);
    const selected = this.places?.find(row => samePlace(row, place));
    if (!this.places || (place === null ? !current : !selected || samePlace(current ?? null, place)
      || (selected.assignee !== null && selected.assignee !== this.agent))) {
      this.status = 'That assignment is no longer available. Check the current places.';
      this.show();
      return;
    }
    const after = this.source.lastBedAssignmentResult()?.sequence ?? 0n;
    if (this.source.setBedAssignment(this.agent, place)) {
      this.pending = { agent: this.agent, place, after };
      this.status = 'Applying assignment…';
    } else {
      this.status = 'That assignment could not be sent.';
    }
    this.show();
  }

  afterCommands(): void {
    if (this.syncSelection() || !this.pending) return;
    const result = this.source.lastBedAssignmentResult();
    if (!result || result.sequence <= this.pending.after) return;
    const matches = result.agent === this.pending.agent && samePlace(result.place, this.pending.place);
    this.pending = null;
    this.status = matches
      ? result.reason ?? (result.place === null ? 'Assignment cleared.' : 'Sleeping place assigned.')
      : 'Another assignment was handled. Check the current assignment.';
    this.readPlaces();
    this.show();
  }

  resetAfterLoad(): void {
    this.agent = this.source.selectedIndex();
    this.places = null;
    this.choice = null;
    this.pending = null;
    this.status = '';
    this.lastRead = null;
    this.show();
  }
}

export function createBedAssignmentSurface(doc: Document, parent: HTMLElement,
  actions: { choose(place: BedPlace | null): void; assign(): void; clear(): void }): (state: BedAssignmentState) => void {
  const root = doc.createElement('section');
  root.className = 'bed-assignment';
  root.tabIndex = -1;
  root.setAttribute('aria-label', 'Sleeping place');
  const fieldset = doc.createElement('fieldset');
  const legend = doc.createElement('legend');
  legend.textContent = 'Sleeping place';
  const current = doc.createElement('p');
  const label = doc.createElement('label');
  label.textContent = 'Choose a place';
  const select = doc.createElement('select');
  select.setAttribute('aria-label', 'Choose a sleeping place');
  const placeholder = doc.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose a place';
  select.append(placeholder);
  label.append(select);
  const occupancy = doc.createElement('p');
  occupancy.className = 'personal-details-note';
  const controls = doc.createElement('div');
  controls.className = 'bed-assignment-actions';
  const assign = doc.createElement('button');
  assign.type = 'button';
  assign.textContent = 'Assign';
  const clear = doc.createElement('button');
  clear.type = 'button';
  clear.textContent = 'Clear assignment';
  controls.append(assign, clear);
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  fieldset.append(legend, current, label, occupancy, controls);
  root.append(fieldset, status);
  parent.append(root);
  const options = new Map<string, { option: HTMLOptionElement; place: BedPlace }>();
  let wasPending = false;
  select.addEventListener('change', () => actions.choose(options.get(select.value)?.place ?? null));
  assign.addEventListener('click', () => actions.assign());
  clear.addEventListener('click', () => actions.clear());
  return state => {
    const focusedHere = root.contains(doc.activeElement);
    const rows = state.places ?? [];
    const currentPlace = rows.find(row => row.assignee === state.agent);
    const chosen = rows.find(row => samePlace(row, state.choice));
    setTextIfChanged(current, state.agent === null ? 'Select a Sim to assign a place.'
      : state.places === null ? 'Sleeping places unavailable.'
      : currentPlace ? `Assigned: ${currentPlace.label}`
      : rows.length === 0 ? 'No beds on this lot.' : 'No assigned sleeping place.');
    const keys = new Set(rows.map(row => `${row.bed}:${row.ordinal}`));
    for (const [key, entry] of options) {
      if (!keys.has(key)) { entry.option.remove(); options.delete(key); }
    }
    for (const [index, row] of rows.entries()) {
      const key = `${row.bed}:${row.ordinal}`;
      let entry = options.get(key);
      if (!entry) {
        const option = doc.createElement('option');
        option.value = key;
        entry = { option, place: { bed: row.bed, ordinal: row.ordinal } };
        options.set(key, entry);
      }
      setTextIfChanged(entry.option, `${row.label} (${row.assigneeName ?? 'unassigned'})`);
      entry.option.disabled = row.assignee !== null && row.assignee !== state.agent;
      const at = select.children.item(index + 1);
      if (at !== entry.option) select.insertBefore(entry.option, at);
    }
    select.value = state.choice ? `${state.choice.bed}:${state.choice.ordinal}` : '';
    const disabled = state.agent === null || state.places === null || state.pending;
    // Disabling a focused native control otherwise sends keyboard users back to the page.
    if (focusedHere && disabled && doc.activeElement !== root) root.focus();
    fieldset.disabled = disabled;
    select.disabled = rows.length === 0;
    assign.disabled = !chosen || samePlace(currentPlace ?? null, chosen)
      || (chosen.assignee !== null && chosen.assignee !== state.agent);
    clear.disabled = !currentPlace;
    const shown = chosen ?? currentPlace;
    setTextIfChanged(occupancy, shown ? (shown.occupantName ? `In use or reserved by ${shown.occupantName}.` : 'Not currently in use.') : '');
    occupancy.hidden = !shown;
    setTextIfChanged(status, state.status);
    status.hidden = state.status === '';
    if (wasPending && !state.pending && doc.activeElement === root && !disabled && rows.length > 0) select.focus();
    wasPending = state.pending;
  };
}
