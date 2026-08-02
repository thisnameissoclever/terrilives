export interface QueueButton {
  setAttribute(name: string, value: string): void;
}

/**
 * Accessible, touch-friendly equivalent of holding Ctrl or Cmd while issuing
 * object orders. The mode stays active until the player turns it off, which
 * makes a run of several queued taps possible on a phone.
 */
export class QueueMode {
  private active = false;

  constructor(private readonly button: QueueButton) {
    this.reflect();
  }

  isActive(): boolean {
    return this.active;
  }

  toggle(): boolean {
    this.active = !this.active;
    this.reflect();
    return this.active;
  }

  private reflect(): void {
    this.button.setAttribute('aria-pressed', String(this.active));
  }
}
