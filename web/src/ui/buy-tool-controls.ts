// The Buy tool's controls - [BM-shell] and docs/specs/2026-10-17-store-catalogue.md:
// the catalogue grid of cards with pictures, the Room and Show filter rows
// with Clear filters, the chosen item's price, facing, Good for line and
// buying facts ([CB-filter]). Buy, the rotations and Cancel sit beside the
// ghost.

import { formatFunds } from './game-hud.js';
import { FACING_NAMES } from './builder.js';
import type { BuyTool } from './buy-tool.js';
import type { CatalogueItem } from '../bridge.js';
import { createObjectIdentity } from './object-identity.js';
import type { ModelFacts } from '../books/codec.js';

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
    const capacity = action.capacity === null ? 'Readers use separate copies elsewhere'
      : action.seatsAddViewers ? `${action.capacity} standing at once, plus one for each free seat in view`
      : `${action.capacity} ${action.capacity === 1 ? 'user' : 'users'} at once`;
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

/** One card of the catalogue grid - rule 1 of the store catalogue spec. */
export interface CatalogueCard {
  readonly item: CatalogueItem;
  readonly button: HTMLButtonElement;
  readonly canvas: HTMLCanvasElement;
}

/**
 * How a card names its item to assistive technology: type, model and price.
 * The price goes in brackets because some model names hold a comma.
 */
export function cardName(item: CatalogueItem): string {
  const type = item.details ? `${item.name}: ${item.details.modelName}` : item.name;
  return `${type} (${formatFunds(item.price)})`;
}

/** A room id as its row shows it: `living_room` reads "Living Room". */
export function roomWord(room: string): string {
  return room.split('_').map(needWord).join(' ');
}

const CARD_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

export class BuyToolControls {
  private readonly grid: HTMLElement;
  private readonly roomRow: HTMLElement;
  private readonly showRow: HTMLElement;
  private readonly clearFilters: HTMLButtonElement;
  private readonly cards: CatalogueCard[] = [];
  private readonly roomButtons: { value: string | null; button: HTMLButtonElement }[] = [];
  private readonly showButtons: { value: number | null; button: HTMLButtonElement }[] = [];
  private readonly facts: HTMLElement;
  private readonly colour: HTMLSelectElement;
  private readonly colourLabel: HTMLElement;
  private readonly serves: HTMLElement;
  private readonly facing: HTMLElement;
  private readonly price: HTMLElement;
  private readonly status: HTMLElement;
  private readonly keyboardHelp: HTMLElement;
  private readonly touchHelp: HTMLElement;
  private readonly identity: HTMLElement;
  private disposeIdentity: (() => void) | undefined;
  private shownDefinition: number | null = null;
  /** The card that last had focus, by key, click, Tab or Choose item. */
  private lastFocused: CatalogueCard | null = null;
  /** Draws the pictures the first time the tool is shown, then is dropped. */
  private drawPictures: (() => void) | null = null;

  /**
   * `previews` receives every card the first time the tool is shown, to
   * draw the pictures; the page gives it `drawCataloguePreviews`, a test
   * gives a recorder or nothing.
   */
  constructor(document: Document, private readonly tool: BuyTool,
    private readonly needNames: readonly string[],
    previews?: (cards: readonly { canvas: HTMLCanvasElement; sprite: number; foreground: number | null }[]) => void) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing buy controls: ${id}`);
      return element;
    };
    this.grid = required('buy-object');
    this.identity = required('buy-identity');
    this.showRow = required('buy-filter');
    this.roomRow = required('buy-room-filter');
    this.clearFilters = required('buy-clear-filters');
    this.facts = required('buy-facts');
    const filterButton = (row: HTMLElement, label: string, press: () => void): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hud-button catalogue-filter';
      button.textContent = label;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => { press(); this.render(); });
      row.append(button);
      return button;
    };
    // Every room is first, then the rooms any item belongs to, in order.
    this.roomRow.replaceChildren();
    this.roomButtons.push({ value: null, button: filterButton(this.roomRow, 'Every room', () => tool.setRoomFilter(null)) });
    for (const room of [...new Set(tool.items.flatMap(item => item.model?.rooms ?? []))].sort()) {
      this.roomButtons.push({ value: room, button: filterButton(this.roomRow, roomWord(room), () => tool.setRoomFilter(room)) });
    }
    // Only the needs something in the catalogue serves, in need order.
    this.showRow.replaceChildren();
    this.showButtons.push({ value: null, button: filterButton(this.showRow, 'Everything', () => tool.setFilter(null)) });
    const served = tool.items.reduce((mask, item) => mask | item.needs, 0);
    needNames.forEach((name, index) => {
      if ((served & (1 << index)) === 0) return;
      this.showButtons.push({ value: index, button: filterButton(this.showRow, needWord(name), () => tool.setFilter(index)) });
    });
    this.clearFilters.addEventListener('click', () => {
      const focused = this.clearFilters.ownerDocument.activeElement === this.clearFilters;
      tool.setRoomFilter(null);
      tool.setFilter(null);
      this.render();
      // The button disables itself once nothing is filtered, so its focus
      // moves to Every room rather than falling to the page.
      if (focused) this.roomButtons[0]?.button.focus();
    });
    this.colour = required('buy-colour');
    this.colourLabel = required('buy-colour-label');
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
    // One card per item, in the list's order; the grid is built once and
    // the cards are shown, pressed and grayed on each redraw.
    this.grid.replaceChildren();
    for (const item of tool.items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'catalogue-card';
      button.setAttribute('aria-label', cardName(item));
      button.setAttribute('aria-pressed', 'false');
      button.tabIndex = -1;
      // Twice the displayed size, so the double-density art stays sharp on
      // high-density screens.
      const canvas = document.createElement('canvas');
      canvas.width = 144;
      canvas.height = 144;
      canvas.className = 'catalogue-picture';
      canvas.setAttribute('aria-hidden', 'true');
      const type = document.createElement('span');
      type.className = 'catalogue-type';
      type.textContent = item.name;
      const price = document.createElement('span');
      price.className = 'catalogue-price';
      price.textContent = formatFunds(item.price);
      button.append(canvas, type);
      if (item.details) {
        const model = document.createElement('span');
        model.className = 'catalogue-model';
        model.textContent = item.details.modelName;
        button.append(model);
      }
      button.append(price);
      const card = { item, button, canvas };
      // A grayed card stays focusable so the player can find what to save
      // for, and a press on it does nothing; pressing the chosen card again
      // keeps its ghost and facing.
      button.addEventListener('click', () => {
        if (!tool.affordable(item) || tool.chosen === item) return;
        tool.choose(item.definition);
        this.render();
      });
      // Whatever focuses a card, a key, a click or Tab, makes it the one Tab stop.
      button.addEventListener('focus', () => this.makeTabStop(card));
      this.grid.append(button);
      this.cards.push(card);
    }
    this.grid.addEventListener('keydown', event => this.handleGridKey(event));
    if (previews) {
      this.drawPictures = () => previews(this.cards.map(card => ({ canvas: card.canvas, ...tool.art(card.item) })));
    }
    this.render();
  }

  /** CSS chooses the pointer hint; Shortcuts remains available in either layout. */
  setCompact(_compact: boolean): void {
    this.keyboardHelp.hidden = false;
    this.touchHelp.hidden = false;
  }

  /** The cards a key or Choose item can reach: every shown card, grayed or not. */
  private reachable(): CatalogueCard[] {
    return this.cards.filter(card => !card.button.hidden && !card.button.disabled);
  }

  /**
   * The one card in the Tab order: the card focus is on, else the chosen
   * card, else the card last focused, else the first shown.
   */
  private tabStop(): CatalogueCard | undefined {
    const cards = this.reachable();
    const active = this.grid.ownerDocument.activeElement;
    return cards.find(card => card.button === active)
      ?? cards.find(card => card.item === this.tool.chosen)
      ?? cards.find(card => card === this.lastFocused) ?? cards[0];
  }

  private makeTabStop(card: CatalogueCard): void {
    this.lastFocused = card;
    for (const other of this.cards) other.button.tabIndex = other === card ? 0 : -1;
  }

  /** Choose item: the chosen card, grayed or not, else the first card the grid shows. */
  focusCatalogue(): void {
    const cards = this.reachable();
    (cards.find(card => card.item === this.tool.chosen) ?? cards[0])?.button.focus();
  }

  /**
   * The arrow keys move between the shown cards, Home and End to the ends;
   * the card moved to becomes the one Tab stop, so Tab leaves the grid.
   */
  private handleGridKey(event: KeyboardEvent): void {
    if (!CARD_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const cards = this.reachable();
    if (cards.length === 0) return;
    const active = this.grid.ownerDocument.activeElement;
    const at = cards.findIndex(card => card.button === active);
    let next: number;
    switch (event.key) {
      case 'Home': next = 0; break;
      case 'End': next = cards.length - 1; break;
      case 'ArrowLeft': case 'ArrowUp': next = at <= 0 ? cards.length - 1 : at - 1; break;
      default: next = at < 0 || at >= cards.length - 1 ? 0 : at + 1;
    }
    event.preventDefault();
    this.makeTabStop(cards[next]);
    cards[next].button.focus();
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
    if (tool.active && this.drawPictures) {
      // The pictures cost a few atlas pages; they are drawn when first needed.
      const draw = this.drawPictures;
      this.drawPictures = null;
      draw();
    }
    const held = tool.pending || tool.blocked;
    for (const card of this.cards) {
      card.button.hidden = !tool.shows(card.item);
      card.button.disabled = held;
      card.button.setAttribute('aria-disabled', String(!tool.affordable(card.item)));
      card.button.setAttribute('aria-pressed', String(tool.chosen === card.item));
    }
    const tabbable = this.tabStop();
    for (const card of this.cards) card.button.tabIndex = card === tabbable ? 0 : -1;
    for (const { value, button } of this.roomButtons) {
      button.setAttribute('aria-pressed', String(tool.roomFilter === value));
      button.disabled = held;
    }
    for (const { value, button } of this.showButtons) {
      button.setAttribute('aria-pressed', String(tool.filter === value));
      button.disabled = held;
    }
    this.clearFilters.disabled = held || (tool.filter === null && tool.roomFilter === null);
    this.colour.value = String(tool.colourway);
    this.colour.disabled = held || tool.colourways.length < 2;
    // Rule 4: nothing about an item shows beneath the grid until one is chosen.
    this.colour.hidden = tool.chosen === null;
    this.colourLabel.hidden = tool.chosen === null;
    const model = tool.chosen?.model;
    this.facts.textContent = model ? modelFactsLabel(model, this.needNames) : '';
    this.serves.textContent = tool.chosen ? servesLabel(tool.chosen.needs, this.needNames) : '';
    this.facing.textContent = tool.preview ? `Facing: ${FACING_NAMES[tool.preview.facing]}` : '';
    this.price.textContent = tool.chosen ? `Price: ${formatFunds(tool.chosen.price)}` : '';
    this.status.textContent = tool.status;
    this.status.setAttribute('data-valid', String(tool.preview?.valid ?? true));
  }
}
