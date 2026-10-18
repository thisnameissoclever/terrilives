import type { ActionQueueRow } from './player-orders.js';

export interface ActionQueueSource {
  selectedIndex(): number | null;
  actionQueueOf(entity: number, maxRows?: number): string[];
  actionQueueRowsOf?(entity: number, maxRows?: number): ActionQueueRow[];
}

export function structuredActionCards(rows: readonly ActionQueueRow[]): {label: string; phase: string; orderId: string | null; reason: string | null}[] {
  return rows.filter(row => row.label !== '').map(row => ({label: row.label, orderId: row.orderId, reason: row.reason,
    phase: `${row.role === 'incoming' ? 'Incoming ← · ' : ''}${row.phase.charAt(0).toUpperCase()}${row.phase.slice(1)}`}));
}

/** Entry zero is the current action; an empty entry means nothing is running. */
export function actionCards(actions: readonly string[]): { label: string; phase: string }[] {
  return actions.flatMap((label, index) => label ? [{ label,
    phase: index === 0 ? 'Now' : index === 1 ? 'Next' : 'Queued' }] : []);
}

export class ActionQueue {
  private selected: number | null = null;
  private lastRead = -Infinity;
  private signature = '';

  constructor(private readonly root: HTMLElement, private readonly refreshMs: number) {}

  invalidate(): void { this.lastRead = -Infinity; }

  update(now: number, source: ActionQueueSource): void {
    const selected = source.selectedIndex();
    if (selected === this.selected && now - this.lastRead < this.refreshMs) return;
    this.selected = selected;
    this.lastRead = now;
    this.root.hidden = selected === null;
    // Even the smallest card takes at least 40 pixels. Include an extra row
    // beyond the fade, keeping the stored queue independent of DOM capacity.
    const visibleLimit = Math.max(1, Math.ceil(this.root.clientHeight / 40) + 1);
    const structured = selected === null ? [] : source.actionQueueRowsOf?.(selected, visibleLimit + 1);
    const actions = selected === null || structured ? [] : source.actionQueueOf(selected, visibleLimit + 1);
    const cards = (structured ? structuredActionCards(structured.slice(0, visibleLimit + 1)) : actionCards(actions.slice(0, visibleLimit + 1))).slice(0, visibleLimit);
    this.root.hidden = cards.length === 0;
    const signature = JSON.stringify(cards);
    if (signature === this.signature) return;
    this.signature = signature;
    this.root.replaceChildren();
    for (const row of cards) {
      const { label, phase } = row;
      const card = this.root.ownerDocument.createElement('div');
      card.className = 'action-card';
      const caption = this.root.ownerDocument.createElement('small');
      caption.textContent = phase;
      card.append(caption, this.root.ownerDocument.createTextNode(label));
      if ('orderId' in row && row.orderId !== null) card.dataset.orderId = String(row.orderId);
      if ('reason' in row && row.reason) {
        const reason = this.root.ownerDocument.createElement('small');
        reason.textContent = String(row.reason);
        card.append(reason);
      }
      this.root.append(card);
    }
  }
}
