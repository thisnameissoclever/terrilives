// The Buy tool's controls - [BM-shell]: the catalogue list, the price, Rotate,
// Buy and Cancel, with the Show filter and the Good for line ([CB-filter]).

import { formatFunds } from './game-hud.js';
import { FACING_NAMES } from './builder.js';
import type { BuyTool } from './buy-tool.js';
import { createObjectIdentity } from './object-identity.js';
import type { ModelFacts } from '../books/codec.js';

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

/** Station identities stay canonical in metadata; purchase text uses literal names. */
export function requirementLabel(requirement: string): string {
  const labels: Record<string, string> = { prep_surface: 'Preparation counter', cold_storage: 'Fridge', hob: 'Stove', meal_table: 'Dining table', dining_seat: 'Reachable dining chairs', dish_sink: 'Kitchen sink', eating_surface: 'Eating surface' };
  return labels[requirement] ?? needWord(requirement.replaceAll('_', ' '));
}

/** What an item is good for, from its needs mask and the need names in index order. */
export function servesLabel(needs: number, names: readonly string[]): string {
  const served = names.filter((_, index) => (needs & (1 << index)) !== 0).map(needWord);
  return served.length === 0 ? 'Good for: no need on its own' : `Good for: ${served.join(', ')}`;
}

/** Base purchase facts preserve small rewards and distinguish borrowing from shelf access. */
export function modelFactsLabel(model: ModelFacts, needNames: readonly string[]): string {
  const number = (value: number) => String(Number(value.toPrecision(4)));
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${number(value)}`;
  const lines = [`Footprint: ${model.width} x ${model.depth} tiles.`];
  const stationLabels: Record<string, string> = { cold_storage: 'Ingredient storage', hob: 'Cooking station', prep_surface: 'Food preparation surface', dish_sink: 'Dishwashing station', meal_table: 'Dining surface', eating_surface: 'Eating surface' };
  if (model.roles.length) lines.push(`Useful as: ${model.roles.map(role => stationLabels[role] ?? requirementLabel(role)).join(', ')}.`);
  if (model.roles.includes('meal_table')) lines.push('Add reachable dining chairs for seated meals.');
  if (model.shelfCapacity) {
    lines.push(`Shelf space: ${model.shelfCapacity} copies, including borrowed copies' reserved spaces.`);
    lines.push(`Collect or return: ${model.shelfAccessPoints} ${model.shelfAccessPoints === 1 ? 'person' : 'people'} at once.`);
  }
  for (const action of model.actions) {
    const capacity = action.capacity === null ? 'Readers use separate copies elsewhere' : `${action.capacity} ${action.capacity === 1 ? 'user' : 'users'} at once`;
    const seating = action.optionalRequirements.filter(requirement => requirement === 'meal_table' || requirement === 'dining_seat');
    const conditional = action.additionalDetails ?? [];
    const details = conditional.length ? ` Conditional details: ${conditional.join('; ')}.` : '';
    if (action.reading) {
      const [fun, comfort, satisfaction, rate] = action.readingBenefits;
      const gains = [
        ...(fun ? [`Fun ${signed(fun)} per reading hour`] : []),
        ...(comfort ? [`Comfort ${signed(comfort)} per hour`] : []),
        ...(satisfaction ? [`life satisfaction ${signed(satisfaction)} points per reading hour`] : []),
      ];
      lines.push(`${action.label}: ${capacity}. Up to ${model.sessionTicks} minutes per session. ${rate === 1 ? 'Standard reading speed' : `${number(rate)} times standard reading speed`}. ${gains.join('; ')}. Requires an available shelved copy.${details}`);
      continue;
    }
    const gains = action.benefits.filter(([, value]) => value !== 0)
      .map(([need, value]) => `${needWord(needNames[need])} ${signed(value)}`);
    if (action.satisfactionPoints) gains.push(`life satisfaction ${signed(action.satisfactionPoints)} points`);
    const requirements = action.requirements.length ? ` Requires: ${action.requirements.map(requirement => action.workKind === 'dish_cleanup' && requirement === 'prep_surface' ? 'Dirty dishes to collect' : requirementLabel(requirement)).join(', ')}.` : '';
    const extra = action.workKind === 'dish_cleanup' ? ' Extra dishes and collection stops take longer.' : '';
    const optional = seating.length ? ` Optional seating: ${seating.map(requirementLabel).join(', ')}. Without seating, eat beside a preparation counter.` : '';
    lines.push(`${action.label}: ${capacity}; about ${action.durationTicks} minutes.${gains.length ? ` ${gains.join('; ')}.` : ''}${requirements}${optional}${details}${extra}`);
  }
  if (model.shelfCapacity && model.actions.some(action => action.reading)) lines.push('The chosen seat affects reading comfort and enjoyment.');
  if (model.actions.length) lines.push('Times are game minutes. Travel, waiting and book returns add time. Personal factors and current needs affect gains and duration.');
  return lines.join('\n');
}

export class BuyToolControls {
  private readonly selector: HTMLSelectElement;
  private readonly filter: HTMLSelectElement;
  private readonly room: HTMLSelectElement;
  private readonly facts: HTMLElement;
  private readonly colour: HTMLSelectElement;
  private readonly placeholder: HTMLOptionElement;
  private readonly options: HTMLOptionElement[] = [];
  private readonly serves: HTMLElement;
  private readonly facing: HTMLElement;
  private readonly price: HTMLElement;
  private readonly status: HTMLElement;
  private readonly keyboardHelp: HTMLElement;
  private readonly touchHelp: HTMLElement;
  private readonly identity: HTMLElement;
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
    this.filter = required('buy-filter');
    this.room = required('buy-room-filter');
    this.facts = required('buy-facts');
    const allRooms = document.createElement('option'); allRooms.value = ''; allRooms.textContent = 'Every room';
    this.room.replaceChildren(allRooms);
    for (const room of [...new Set(tool.items.flatMap(item => item.model?.rooms ?? []))].sort()) {
      const option = document.createElement('option'); option.value = room;
      option.textContent = room.split('_').map(needWord).join(' '); this.room.append(option);
    }
    this.room.addEventListener('change', () => { tool.setRoomFilter(this.room.value || null); this.render(); });
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
    this.render();
  }

  /** CSS chooses the pointer hint; Shortcuts remains available in either layout. */
  setCompact(_compact: boolean): void {
    this.keyboardHelp.hidden = false;
    this.touchHelp.hidden = false;
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
        const identity = createObjectIdentity(this.identity.ownerDocument, tool.chosen.name, tool.chosen.details);
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
    this.room.value = tool.roomFilter ?? ''; this.room.disabled = tool.pending || tool.blocked;
    const model = tool.chosen?.model;
    this.facts.textContent = model ? modelFactsLabel(model, this.needNames) : '';
    this.serves.textContent = tool.chosen ? servesLabel(tool.chosen.needs, this.needNames) : '';
    this.facing.textContent = tool.preview ? `Facing: ${FACING_NAMES[tool.preview.facing]}` : '';
    this.price.textContent = tool.chosen ? `Price: ${formatFunds(tool.chosen.price)}` : '';
    this.status.textContent = tool.status;
    this.status.setAttribute('data-valid', String(tool.preview?.valid ?? true));
  }
}
