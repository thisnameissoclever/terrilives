// How tall the Walls and Room tools draw the house's walls - [WB-height] in
// docs/specs/2026-09-22-walls-in-build.md. Low by default, so the front walls
// stop hiding the floor being edited; the chosen line stands full height.
// Full shows every wall as it stands. The choice lasts for the session.

export type WallHeight = 'low' | 'full';

export class WallView {
  height: WallHeight = 'low';

  constructor(private readonly changed: () => void) {}

  set(height: WallHeight): void {
    if (this.height === height) return;
    this.height = height;
    this.changed();
  }

  toggle(): void { this.set(this.height === 'low' ? 'full' : 'low'); }
}

/** The Low and Full buttons in each panel that offers them, pressed for the current height. */
export class WallViewControls {
  private readonly buttons: { button: HTMLButtonElement; height: WallHeight }[] = [];

  constructor(document: Document, private readonly view: WallView, prefixes: readonly string[]) {
    for (const prefix of prefixes) {
      for (const height of ['low', 'full'] as const) {
        const button = document.querySelector<HTMLButtonElement>(`#${prefix}-height-${height}`);
        if (!button) throw new Error(`Missing wall height control: ${prefix}-height-${height}`);
        button.addEventListener('click', () => view.set(height));
        this.buttons.push({ button, height });
      }
    }
    this.render();
  }

  render(): void {
    for (const { button, height } of this.buttons) button.setAttribute('aria-pressed', String(this.view.height === height));
  }
}
