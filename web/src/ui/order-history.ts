import {OrderDiagnostics, type OrderEvent} from './player-orders.js';
import {setTextIfChanged} from './set-text-if-changed.js';

interface HistorySource {
  ids(): Uint32Array;
  kinds(): Uint32Array;
  simName(entity: number): string;
}
interface HistoryElements {
  disclosure: HTMLDetailsElement;
  filter: HTMLSelectElement;
  list: HTMLElement;
  notice: HTMLElement;
  status: HTMLElement;
  copy: HTMLButtonElement;
  summary: HTMLElement;
}

/** History filtering is presentation state, independent of the selected person. */
export class OrderHistoryPanel {
  private source: HistorySource | null = null;
  private signature = '';
  private revision = -1;
  private lastFilter = '';
  private readonly records = new Map<string, {details: HTMLDetailsElement; raw: HTMLElement; event: OrderEvent}>();
  constructor(private readonly doc: Document, private readonly elements: HistoryElements,
    private readonly diagnostics: OrderDiagnostics, private readonly visible: () => boolean,
    private readonly writeClipboard: (text: string) => Promise<void>) {
    elements.filter.value = 'all';
    elements.disclosure.addEventListener('toggle', () => {if (this.source) this.update(this.source);});
    elements.filter.addEventListener('change', () => {
      setTextIfChanged(elements.status, '');
      if (this.source) this.update(this.source);
    });
    elements.copy.addEventListener('click', () => {
      const entity = this.filterEntity();
      void this.writeClipboard(diagnostics.copyHistory(entity)).then(
        () => setTextIfChanged(elements.status, 'Copied'),
        () => setTextIfChanged(elements.status, 'Copy failed. Select the history text and copy it.'),
      );
    });
  }
  private filterEntity(): number | null {
    return this.elements.filter.value === 'all' ? null : Number(this.elements.filter.value);
  }
  update(source: HistorySource): void {
    this.source = source;
    if (!this.visible() || !this.elements.disclosure.open) return;
    const ids = Array.from(source.ids()), kinds = Array.from(source.kinds());
    const people = new Map(ids.flatMap((entity, index): [number, string][] => kinds[index] === 0 ? [[entity, source.simName(entity) || `Person ${entity}`]] : []));
    for (const event of this.diagnostics.events(null)) {
      for (const actor of [event.actor, event.counterpart]) if (actor !== null && !people.has(actor)) {
        people.set(actor, `${this.diagnostics.actorName(actor)} (entity ${actor}, retired or unknown)`);
      }
    }
    const signature = JSON.stringify([...people]);
    if (signature !== this.signature) {
      this.signature = signature;
      const selected = this.elements.filter.value;
      const option = (label: string, value: string) => {
        const node = this.doc.createElement('option'); node.textContent = label; node.value = value; return node;
      };
      this.elements.filter.replaceChildren(option('All', 'all'), ...[...people].map(([actor, name]) => option(name, String(actor))));
      this.elements.filter.value = selected === 'all' || people.has(Number(selected)) ? selected : 'all';
    }
    const filter = this.elements.filter.value;
    setTextIfChanged(this.elements.summary, filter === 'all' ? 'All' : people.get(Number(filter)) ?? `Person ${filter}`);
    if (this.revision === this.diagnostics.revision && this.lastFilter === filter) return;
    this.revision = this.diagnostics.revision; this.lastFilter = filter;
    const events = this.diagnostics.events(this.filterEntity());
    setTextIfChanged(this.elements.notice, this.diagnostics.historyExpired ? 'Earlier events have expired from this session.' : events.length ? '' : 'No order events.');
    const live = new Set(events.map(event => event.sequence));
    for (const [sequence, view] of this.records) if (!live.has(sequence)) {view.details.remove(); this.records.delete(sequence);}
    events.forEach((event, index) => {
      let view = this.records.get(event.sequence);
      if (view && view.event !== event) {view.details.remove(); this.records.delete(event.sequence); view = undefined;}
      if (!view) {
        view = this.createRecord(event); this.records.set(event.sequence, view);
      }
      const before = this.elements.list.children[index] ?? null;
      if (before !== view.details) this.elements.list.insertBefore(view.details, before);
    });
  }
  private createRecord(event: OrderEvent): {details: HTMLDetailsElement; raw: HTMLElement; event: OrderEvent} {
    const details = this.doc.createElement('details'); details.className = 'order-history-record';
    const summary = this.doc.createElement('summary');
    const name = this.doc.createElement('strong'), phase = this.doc.createElement('span'), tick = this.doc.createElement('span');
    name.textContent = `${this.diagnostics.actorName(event.actor)} · ${event.action}`;
    phase.textContent = event.phase; tick.textContent = `Tick ${event.tick}`; summary.append(name, phase, tick);
    const raw = this.doc.createElement('pre');
    details.addEventListener('toggle', () => {if (details.open) setTextIfChanged(raw, JSON.stringify(event, null, 2));});
    details.append(summary, raw);
    return {details, raw, event};
  }
}
