export interface ActionQueueSource {
  selectedIndex(): number | null;
  actionQueueOf(entity: number, maxRows?: number): string[];
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
    const actions = selected === null ? [] : source.actionQueueOf(selected, visibleLimit + 1);
    this.root.hidden = actions.length === 0 || (actions.length === 1 && !actions[0]);
    const cards = actionCards(actions.slice(0, visibleLimit + 1)).slice(0, visibleLimit);
    const signature = JSON.stringify(cards);
    if (signature === this.signature) return;
    this.signature = signature;
    this.root.replaceChildren();
    for (const { label, phase } of cards) {
      const card = this.root.ownerDocument.createElement('div');
      card.className = 'action-card';
      const caption = this.root.ownerDocument.createElement('small');
      caption.textContent = phase;
      card.append(caption, this.root.ownerDocument.createTextNode(label));
      this.root.append(card);
    }
  }
}
