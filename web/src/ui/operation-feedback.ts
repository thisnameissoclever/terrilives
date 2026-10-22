/** An operation outcome, separate from selection instructions and translated status prose. */
export interface OperationFeedback {
  readonly operation: string;
  readonly state: 'pending' | 'success' | 'failure';
  readonly target: string;
  readonly message: string;
  readonly recovery?: 'retry' | 'move' | 'edit';
}

export function operationFeedback(operation: string, state: OperationFeedback['state'], target: string,
  message: string, recovery?: OperationFeedback['recovery']): OperationFeedback {
  return { operation, state, target, message, ...(recovery ? { recovery } : {}) };
}

/** A result appears once, even if its owning tool redraws on every frame. */
export class FeedbackLifetime {
  private previous: OperationFeedback | null = null;
  private since = 0;
  read(feedback: OperationFeedback | null, now = performance.now()): OperationFeedback | null {
    if (feedback !== this.previous) { this.previous = feedback; this.since = now; }
    return feedback?.state === 'success' && now - this.since >= 4000 ? null : feedback;
  }
}

export class PendingIndicator {
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly target: Pick<Element, 'setAttribute' | 'removeAttribute'>) {}
  start(expectedSlow = true): void {
    this.stop(); this.target.setAttribute('aria-busy', 'true');
    if (expectedSlow) this.target.setAttribute('data-pending', 'true');
    else this.timer = setTimeout(() => { this.timer = undefined; this.target.setAttribute('data-pending', 'true'); }, 1250);
  }
  stop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined; this.target.removeAttribute('data-pending'); this.target.removeAttribute('aria-busy');
  }
}

/** Scene messages share one readable surface; object-menu layout can supply its current anchor. */
export class SceneFeedback {
  private signature = '';
  private since = 0;
  constructor(private readonly element: HTMLElement) { element.dataset.surface = 'scene'; this.syncBox(); }
  /** Opacity removes the empty painted box without removing its live region. */
  private syncBox(): void { this.element.style.opacity = this.element.textContent?.trim() ? '' : '0'; }
  anchor(point: { x: number; y: number } | null): void {
    this.element.style.left = point ? `${point.x}px` : '';
    this.element.style.top = point ? `${point.y}px` : '';
    this.element.dataset.anchored = String(point !== null);
  }
  frame(now = performance.now()): void {
    const signature = `${this.element.getAttribute('data-kind')}/${this.element.textContent}`;
    if (signature !== this.signature) { this.signature = signature; this.since = now; }
    if (this.element.getAttribute('data-kind') !== 'error' && now - this.since >= 4000 && this.element.textContent) {
      this.element.textContent = ''; this.signature = '';
    }
    this.syncBox();
  }
}
