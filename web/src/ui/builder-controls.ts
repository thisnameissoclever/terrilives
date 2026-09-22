import { FACING_NAMES, type FurnitureBuilder } from './builder.js';
import { formatFunds } from './game-hud.js';

/** One set of controls moves between the desktop HUD and the mobile dock. */
export class BuilderControls {
  private readonly panel: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly selector: HTMLSelectElement;
  private readonly name: HTMLElement;
  private readonly facing: HTMLElement;
  private readonly status: HTMLElement;
  private readonly rotate: HTMLButtonElement;
  private readonly confirm: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private readonly sell: HTMLButtonElement;
  private readonly saleNote: HTMLElement;
  private readonly colour: HTMLSelectElement;
  private readonly keyboardHelp: HTMLElement;
  private readonly touchHelp: HTMLElement;
  private listed: FurnitureBuilder['objects'] | null = null;

  constructor(private readonly document: Document, private readonly builder: FurnitureBuilder) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing furniture controls: ${id}`);
      return element;
    };
    this.panel = required('builder-controls');
    this.toggle = required('build-toggle');
    this.selector = required('builder-object');
    this.name = required('builder-name');
    this.facing = required('builder-facing');
    this.status = required('builder-status');
    this.rotate = required('builder-rotate');
    this.confirm = required('builder-confirm');
    this.cancel = required('builder-cancel');
    this.sell = required('builder-sell');
    this.saleNote = required('builder-sale-note');
    this.colour = required('builder-colour');
    // [RC-ui]: the colourways are content, so the list is built once.
    for (const [index, name] of builder.colourways.entries()) {
      const option = document.createElement('option');
      option.value = String(index); option.textContent = name;
      this.colour.append(option);
    }
    this.colour.addEventListener('change', () => {
      if (this.colour.value !== '') builder.recolour(Number(this.colour.value));
    });
    this.keyboardHelp = required('builder-keyboard-help');
    this.touchHelp = required('builder-touch-help');
    this.toggle.addEventListener('click', () => builder.active ? builder.exit() : builder.enter());
    this.selector.addEventListener('change', () => {
      if (this.selector.value !== '') builder.select(Number(this.selector.value));
    });
    this.rotate.addEventListener('click', () => builder.rotate());
    this.confirm.addEventListener('click', () => builder.confirm());
    this.cancel.addEventListener('click', () => builder.cancel());
    this.sell.addEventListener('click', () => builder.sell());
    this.render();
  }

  setCompact(compact: boolean): void {
    const host = this.document.querySelector(compact ? '#builder-dock' : '#builder-desktop');
    if (!host) throw new Error('Missing furniture panel host');
    host.append(this.panel);
    this.keyboardHelp.hidden = compact;
    this.touchHelp.hidden = !compact;
  }

  render(): void {
    const builder = this.builder;
    this.document.body.setAttribute('data-building', String(builder.active));
    this.panel.hidden = !builder.active;
    this.toggle.textContent = builder.active ? 'Exit build' : 'Build';
    this.toggle.setAttribute('aria-pressed', String(builder.active));
    this.toggle.disabled = builder.pending;
    if (this.listed !== builder.objects) {
      this.listed = builder.objects;
      this.selector.replaceChildren();
      const choose = this.document.createElement('option');
      choose.value = ''; choose.textContent = 'Choose furniture';
      this.selector.append(choose);
      for (const object of builder.objects) {
        const option = this.document.createElement('option');
        option.value = String(object.id); option.textContent = object.name;
        this.selector.append(option);
      }
    }
    this.selector.value = builder.selected === null ? '' : String(builder.selected);
    this.selector.disabled = builder.pending || builder.blocked;
    this.name.textContent = builder.name || 'Build mode';
    this.facing.textContent = builder.preview ? `Facing: ${FACING_NAMES[builder.preview.facing]}` : '';
    this.rotate.disabled = !builder.canRotate || builder.pending || builder.blocked;
    this.rotate.title = builder.canRotate ? 'Rotate to the next supported direction' : 'Only one direction is available for this furniture.';
    this.confirm.disabled = !builder.canConfirm;
    this.cancel.disabled = builder.selected === null || builder.pending || builder.blocked;
    // [SL-shell]: the button names what the sale pays back.
    this.sell.disabled = !builder.canSell;
    this.sell.textContent = builder.saleValue === null ? 'Sell' : `Sell for ${formatFunds(builder.saleValue)}`;
    this.colour.value = builder.colourway === null ? '0' : String(builder.colourway);
    // Not disabled while a change is on its way: disabling the focused list
    // would drop keyboard focus out of the panel. The builder queues it.
    this.colour.disabled = builder.colourway === null || builder.blocked
      || builder.colourways.length < 2;
    // A chosen object that would not sell says why, as the rotation note does.
    this.saleNote.hidden = builder.saleRefusal === null;
    this.saleNote.textContent = builder.saleRefusal === null ? '' : `Cannot sell: ${builder.saleRefusal}`;
    this.status.textContent = builder.status;
    this.status.setAttribute('data-valid', String(builder.preview?.valid ?? true));
    const explanation = this.document.querySelector<HTMLElement>('#builder-rotation-note');
    if (explanation) {
      explanation.hidden = builder.selected === null || builder.canRotate;
      explanation.textContent = 'This furniture has artwork for one direction.';
    }
  }
}
