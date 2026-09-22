// The Buy tool's controls - [BM-shell]: the catalogue list, the price, Rotate,
// Buy and Cancel, with the Show filter and the Good for line ([CB-filter]).

import { formatFunds } from './game-hud.js';
import { FACING_NAMES } from './builder.js';
import type { BuyTool } from './buy-tool.js';
import { createObjectIdentity } from './object-identity.js';

/**
 * How the list names an item: its name and its price. The price goes in
 * brackets because some names already hold a comma.
 */
export function itemLabel(name: string, price: number): string {
  return `${name} (${formatFunds(price)})`;
}

/** A need name as a sentence shows it: "hunger" reads "Hunger". */
function needWord(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** What an item is good for, from its needs mask and the need names in index order. */
export function servesLabel(needs: number, names: readonly string[]): string {
  const served = names.filter((_, index) => (needs & (1 << index)) !== 0).map(needWord);
  return served.length === 0 ? 'Good for: no need on its own' : `Good for: ${served.join(', ')}`;
}

export class BuyToolControls {
  private readonly selector: HTMLSelectElement;
  private readonly filter: HTMLSelectElement;
  private readonly colour: HTMLSelectElement;
  private readonly placeholder: HTMLOptionElement;
  private readonly options: HTMLOptionElement[] = [];
  private readonly serves: HTMLElement;
  private readonly facing: HTMLElement;
  private readonly price: HTMLElement;
  private readonly status: HTMLElement;
  private readonly rotate: HTMLButtonElement;
  private readonly confirm: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private readonly keyboardHelp: HTMLElement;
  private readonly touchHelp: HTMLElement;
  private readonly identity: HTMLElement;
  private readonly identityBoundary: HTMLElement;
  private disposeIdentity: (() => void) | undefined;
  private shownDefinition: number | null = null;

  constructor(document: Document, private readonly tool: BuyTool,
    private readonly needNames: readonly string[]) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing buy controls: ${id}`);
      return element;
    };
    this.selector = required('buy-object');
    this.identity = required('buy-identity');
    this.identityBoundary = required('buy-tool');
    this.filter = required('buy-filter');
    this.colour = required('buy-colour');
    // [RC-slice-buy]: the colourways are content, so the list is built once.
    for (const [index, name] of tool.colourways.entries()) {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = name;
      this.colour.append(option);
    }
    this.colour.addEventListener('change', () => {
      tool.setColourway(Number(this.colour.value));
      this.render();
    });
    this.facing = required('buy-facing');
    this.price = required('buy-price');
    this.serves = required('buy-serves');
    this.status = required('buy-status');
    this.rotate = required('buy-rotate');
    this.confirm = required('buy-confirm');
    this.cancel = required('buy-cancel');
    this.keyboardHelp = required('buy-keyboard-help');
    this.touchHelp = required('buy-touch-help');
    this.placeholder = document.createElement('option');
    this.placeholder.value = '';
    this.placeholder.textContent = 'Choose something to buy';
    for (const item of tool.items) {
      const option = document.createElement('option');
      option.value = String(item.definition);
      option.textContent = itemLabel(item.details ? `${item.name}: ${item.details.modelName}` : item.name, item.price);
      this.options.push(option);
    }
    // Only the needs something in the catalogue serves, in need order.
    const everything = document.createElement('option');
    everything.value = '';
    everything.textContent = 'Everything';
    this.filter.replaceChildren(everything);
    const served = tool.items.reduce((mask, item) => mask | item.needs, 0);
    needNames.forEach((name, index) => {
      if ((served & (1 << index)) === 0) return;
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = needWord(name);
      this.filter.append(option);
    });
    this.filter.addEventListener('change', () => {
      tool.setFilter(this.filter.value === '' ? null : Number(this.filter.value));
      this.render();
    });
    // The placeholder drops the choice, so the list never shows nothing
    // chosen while a ghost stays buyable. The redraw puts the list back in
    // step when the tool could not act, such as with a purchase on its way.
    this.selector.addEventListener('change', () => {
      if (this.selector.value === '') tool.cancel();
      else tool.choose(Number(this.selector.value));
      this.render();
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
    const definition = tool.chosen?.definition ?? null;
    if (definition !== this.shownDefinition) {
      this.shownDefinition = definition;
      this.disposeIdentity?.();
      this.disposeIdentity = undefined;
      this.identity.replaceChildren();
      if (tool.chosen?.details) {
        const identity = createObjectIdentity(this.identity.ownerDocument, tool.chosen.name, tool.chosen.details, this.identityBoundary);
        this.disposeIdentity = identity.dispose;
        this.identity.append(identity.element);
      }
    }
    this.identity.hidden = !tool.chosen?.details;
    // Rebuilt rather than hidden: some phone browsers still list a hidden option.
    this.selector.replaceChildren(this.placeholder,
      ...this.options.filter((_, index) => tool.shows(tool.items[index])));
    tool.items.forEach((item, index) => { this.options[index].disabled = !tool.affordable(item); });
    this.selector.value = tool.chosen === null ? '' : String(tool.chosen.definition);
    this.selector.disabled = tool.pending || tool.blocked;
    this.colour.value = String(tool.colourway);
    this.colour.disabled = tool.pending || tool.blocked || tool.colourways.length < 2;
    this.filter.value = tool.filter === null ? '' : String(tool.filter);
    this.filter.disabled = tool.pending || tool.blocked;
    this.serves.textContent = tool.chosen ? servesLabel(tool.chosen.needs, this.needNames) : '';
    this.facing.textContent = tool.preview ? `Facing: ${FACING_NAMES[tool.preview.facing]}` : '';
    this.price.textContent = tool.chosen ? `Price: ${formatFunds(tool.chosen.price)}` : '';
    this.rotate.disabled = !tool.canRotate || tool.pending || tool.blocked;
    this.confirm.disabled = !tool.canBuy;
    this.cancel.disabled = tool.chosen === null || tool.pending || tool.blocked;
    this.status.textContent = tool.status;
    this.status.setAttribute('data-valid', String(tool.preview?.valid ?? true));
  }
}
