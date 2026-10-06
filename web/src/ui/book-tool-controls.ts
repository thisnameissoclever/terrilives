import { baselineLength, bookLocation, copyLabel, genreLabel, type BookTool } from './book-tool.js';
import { formatFunds } from './game-hud.js';
import { createObjectIdentity } from './object-identity.js';
import { furnitureLabel } from './furniture-label.js';

export class BookToolControls {
  private readonly title: HTMLSelectElement;
  private readonly destination: HTMLSelectElement;
  private readonly facts: HTMLElement;
  private readonly description: HTMLElement;
  private readonly owned: HTMLElement;
  private readonly status: HTMLElement;
  private readonly buy: HTMLButtonElement;
  private lastTitle: string | null = null;
  private ownedSignature = '';
  private wasActive = false;
  private transferFocusId: string | null = null;
  private dispose: (() => void) | undefined;
  constructor(private readonly doc: Document, private readonly tool: BookTool) {
    const required = <T extends HTMLElement>(id: string): T => { const node = doc.querySelector<T>(`#${id}`); if (!node) throw new Error(`Missing book control: ${id}`); return node; };
    this.title = required('book-title'); this.destination = required('book-destination'); this.facts = required('book-facts');
    this.description = required('book-description'); this.owned = required('book-owned'); this.status = required('book-status'); this.buy = required('book-buy');
    this.status.tabIndex = -1;
    this.title.replaceChildren(this.option('', 'Choose a title'), ...tool.titles.map(title => this.option(title.id, `${title.title} (${formatFunds(title.price)})`)));
    this.title.addEventListener('change', () => tool.choose(this.title.value || null));
    this.destination.addEventListener('change', () => tool.setDestination(this.destination.value === '' ? null : Number(this.destination.value)));
    this.buy.addEventListener('click', () => tool.buy());
    this.render();
  }
  private option(value: string, label: string): HTMLOptionElement { const node = this.doc.createElement('option'); node.value = value; node.textContent = label; return node; }
  resetAfterLoad(): void { this.transferFocusId = null; this.ownedSignature = ''; }
  focusCopy(copyId: number): boolean {
    this.render();
    const button = this.doc.getElementById(`book-copy-transfer-${copyId}`) as HTMLButtonElement | null;
    if (!button) return false;
    button.scrollIntoView?.({ block: 'nearest' });
    button.focus();
    return true;
  }
  private destinations(): HTMLOptionElement[] {
    return [this.option('', 'Household inventory'), ...this.tool.state.shelves.map(shelf => {
      return this.option(String(shelf.entity), `${furnitureLabel(this.tool.source, shelf.entity)} (${shelf.visible.filter(id => id !== null).length} shelved, ${shelf.reserved.filter(id => id !== null).length}/${shelf.capacity} reserved)`);
    })];
  }
  render(): void {
    const tool = this.tool, title = tool.chosen;
    if (tool.active && !this.wasActive) {
      const disclosure = this.description.querySelector?.<HTMLDetailsElement>('details');
      if (disclosure) disclosure.open = false;
    }
    this.wasActive = tool.active;
    this.title.value = tool.titleId ?? ''; this.title.disabled = tool.blocked || tool.pending;
    this.destination.replaceChildren(...this.destinations());
    if (tool.destination !== null && !tool.state.shelves.some(shelf => shelf.entity === tool.destination)) this.destination.append(this.option(String(tool.destination), 'Selected bookcase is unavailable'));
    this.destination.value = tool.destination === null ? '' : String(tool.destination); this.destination.disabled = tool.blocked || tool.pending;
    this.buy.disabled = !tool.canBuy;
    const person = tool.source.selectedIndex();
    const interest = title && person !== null ? tool.source.bookInterest(person, title.id) : null;
    const memory = title && person !== null ? tool.source.readingProgress(person, title.id) : null;
    this.facts.textContent = title ? `${genreLabel(title.genre)}. Price: ${formatFunds(title.price)}. ${baselineLength(title)}. ${person === null ? 'Select a person to see current interest.' : `${tool.source.simName(person)}'s current interest: ${interest === null ? 'unavailable' : `${Math.round(interest * 100)}% (100% is typical interest)`}. Progress this pass: ${Math.min(100, Math.floor(((memory?.progressTicks ?? 0) + (memory?.progressFraction ?? 0)) / title.readingMinutes * 100))}%.`} Interest changes with familiarity. Shelve a copy before reading. Fetching and returning add time.` : 'Choose a title. Each purchase buys one copy.';
    if (this.lastTitle !== tool.titleId) {
      this.lastTitle = tool.titleId; this.dispose?.(); this.description.replaceChildren();
      if (title) { const identity = createObjectIdentity(this.doc, title.title, { modelName: genreLabel(title.genre), description: title.description }); this.dispose = identity.dispose; this.description.append(identity.element); }
    }
    const signature = JSON.stringify([tool.state, tool.pending, tool.blocked, tool.error], (_, value) => typeof value === 'bigint' ? value.toString() : value);
    if (signature !== this.ownedSignature) {
      const focused = this.doc.activeElement as HTMLElement | null;
      const focusId = focused && this.owned.contains?.(focused) ? focused.id : null;
      const selections = new Map(Array.from(this.owned.querySelectorAll?.('select') ?? [], node => [node.id, node.value]));
      this.ownedSignature = signature; this.owned.replaceChildren();
      if (tool.state.copies.length === 0) { const p = this.doc.createElement('p'); p.textContent = 'No household books.'; this.owned.append(p); }
      for (const copy of tool.state.copies) {
        const row = this.doc.createElement('div'); row.className = 'book-copy';
        const label = this.doc.createElement('p'); label.textContent = `${tool.titles.find(t => t.id === copy.titleId)?.title ?? copy.titleId} - ${copyLabel(copy.id).toLowerCase()}. ${bookLocation(copy, tool.source)}.`;
        const select = this.doc.createElement('select'); select.setAttribute('aria-label', `Destination for ${copyLabel(copy.id).toLowerCase()}`); select.append(...this.destinations());
        select.id = `book-copy-destination-${copy.id}`;
        const previous = selections.get(select.id);
        if (previous !== undefined && (previous === '' || tool.state.shelves.some(shelf => String(shelf.entity) === previous))) select.value = previous;
        const button = this.doc.createElement('button'); button.type = 'button'; button.className = 'hud-button'; button.textContent = copy.location.kind === 'lot' ? 'Recover copy' : 'Move copy';
        button.id = `book-copy-transfer-${copy.id}`;
        button.disabled = select.disabled = tool.pending || tool.blocked || copy.borrowerSimId !== null || tool.error !== null;
        button.addEventListener('click', event => {
          if (event.detail === 0 && this.doc.activeElement === button) this.transferFocusId = button.id;
          tool.transfer(copy.id, select.value === '' ? null : Number(select.value));
          if (!tool.pending) this.transferFocusId = null;
        });
        row.append(label, select, button); this.owned.append(row);
      }
      if (this.transferFocusId) {
        if (tool.pending) {
          if (focusId === this.transferFocusId) this.status.focus();
        } else {
          const id = this.transferFocusId; this.transferFocusId = null;
          if (tool.active && focused === this.status) {
            const replacement = this.doc.getElementById(id) as HTMLButtonElement | null;
            if (replacement && !replacement.disabled) replacement.focus();
          }
        }
      } else if (!tool.pending && tool.active && focusId) {
        const replacement = this.doc.getElementById(focusId) as HTMLButtonElement | HTMLSelectElement | null;
        if (replacement && !replacement.disabled) replacement.focus();
      }
    }
    this.status.textContent = tool.error ?? tool.status;
  }
}
