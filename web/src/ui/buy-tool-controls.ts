// The Buy tool's controls - [BM-shell]: the catalogue list, the price, Rotate,
// Buy and Cancel.

import { formatFunds } from './game-hud.js';
import { FACING_NAMES } from './builder.js';
import type { BuyTool } from './buy-tool.js';

/**
 * How the list names an item: its name and its price. The price goes in
 * brackets because some names already hold a comma.
 */
export function itemLabel(name: string, price: number): string {
  return `${name} (${formatFunds(price)})`;
}

export class BuyToolControls {
  private readonly selector: HTMLSelectElement;
  private readonly options: HTMLOptionElement[] = [];
  private readonly facing: HTMLElement;
  private readonly price: HTMLElement;
  private readonly status: HTMLElement;
  private readonly rotate: HTMLButtonElement;
  private readonly confirm: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private readonly keyboardHelp: HTMLElement;
  private readonly touchHelp: HTMLElement;

  constructor(document: Document, private readonly tool: BuyTool) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing buy controls: ${id}`);
      return element;
    };
    this.selector = required('buy-object');
    this.facing = required('buy-facing');
    this.price = required('buy-price');
    this.status = required('buy-status');
    this.rotate = required('buy-rotate');
    this.confirm = required('buy-confirm');
    this.cancel = required('buy-cancel');
    this.keyboardHelp = required('buy-keyboard-help');
    this.touchHelp = required('buy-touch-help');
    const choose = document.createElement('option');
    choose.value = '';
    choose.textContent = 'Choose something to buy';
    this.selector.replaceChildren(choose);
    for (const item of tool.items) {
      const option = document.createElement('option');
      option.value = String(item.definition);
      option.textContent = itemLabel(item.name, item.price);
      this.options.push(option);
      this.selector.append(option);
    }
    this.selector.addEventListener('change', () => {
      if (this.selector.value !== '') tool.choose(Number(this.selector.value));
    });
    this.rotate.addEventListener('click', () => tool.rotate());
    this.confirm.addEventListener('click', () => tool.buy());
    this.cancel.addEventListener('click', () => tool.cancel());
    this.render();
  }

  /** The phone layout reads the touch help, as the other tools' do. */
  setCompact(compact: boolean): void {
    this.keyboardHelp.hidden = compact;
    this.touchHelp.hidden = !compact;
  }

  render(): void {
    const tool = this.tool;
    tool.items.forEach((item, index) => { this.options[index].disabled = !tool.affordable(item); });
    this.selector.value = tool.chosen === null ? '' : String(tool.chosen.definition);
    this.selector.disabled = tool.pending || tool.blocked;
    this.facing.textContent = tool.preview ? `Facing: ${FACING_NAMES[tool.preview.facing]}` : '';
    this.price.textContent = tool.chosen ? `Price: ${formatFunds(tool.chosen.price)}` : '';
    this.rotate.disabled = !tool.canRotate || tool.pending || tool.blocked;
    this.confirm.disabled = !tool.canBuy;
    this.cancel.disabled = tool.chosen === null || tool.pending || tool.blocked;
    this.status.textContent = tool.status;
    this.status.setAttribute('data-valid', String(tool.preview?.valid ?? true));
  }
}
