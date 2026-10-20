// The Land tool in Build mode - rule 8 of
// docs/specs/2026-10-17-land-expansion.md.
//
// The player picks one of three strips beside the lot, reads what it would
// cost and what would be left, and confirms twice. Rust owns the price and
// the decision: this controller asks for a quote, stages the purchase the
// player confirmed, and reads back what the drain did with it.

import { landReason, type LandQuote, type SimBridge } from '../bridge.js';
import type { TileHighlight } from '../render/placement-preview.js';

type LandSource = Pick<SimBridge, 'landQuote' | 'buyLand' | 'lastLandResult' | 'lotRevision'>;

/** The three sides land can be bought on, as the simulation numbers them. */
export const SIDES = [0, 1, 2] as const;
export type Side = (typeof SIDES)[number];
/** Where each strip lies, standing on the street and facing the house. */
export const SIDE_NAMES: Readonly<Record<Side, string>> = {
  0: 'Behind the house', 1: 'Left side', 2: 'Right side',
};
/** The same places as a sentence reads them. */
const SIDE_PLACES: Readonly<Record<Side, string>> = {
  0: 'behind the house', 1: 'on the left side', 2: 'on the right side',
};

export const CHOOSE_STRIP = '';
const BUYING = 'Buying land…';
const NOT_SENT = 'The purchase could not be sent.';

/** Whole dollars from cents, as the interface shows them: prices round up. */
export function dollarsUp(cents: number): number {
  return Math.ceil(cents / 100);
}

/** Whole dollars from cents, as the interface shows them: funds round down. */
export function dollarsDown(cents: number): number {
  return Math.floor(cents / 100);
}

/** `$12,345` from whole dollars. */
export function dollars(amount: number): string {
  return `$${Math.trunc(amount).toLocaleString('en-US')}`;
}

/** The strip's tiles beside a `width` by `height` lot: its outline only. */
export function stripOutline(side: Side, width: number, height: number, depth: number): [number, number][] {
  const [x0, y0, x1, y1] = side === 0 ? [-depth, 0, -1, height - 1]
    : side === 1 ? [0, height, width - 1, height + depth - 1]
      : [0, -depth, width - 1, -1];
  const tiles: [number, number][] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x === x0 || x === x1 || y === y0 || y === y1) tiles.push([x, y]);
    }
  }
  return tiles;
}

/** The strip's tiles, every one. */
export function stripTiles(side: Side, width: number, height: number, depth: number): [number, number][] {
  const [x0, y0, x1, y1] = side === 0 ? [-depth, 0, -1, height - 1]
    : side === 1 ? [0, height, width - 1, height + depth - 1]
      : [0, -depth, width - 1, -1];
  const tiles: [number, number][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push([x, y]);
  return tiles;
}

/** What a quote says, in the interface's whole dollars. */
export function describeQuote(quote: LandQuote): string {
  const price = dollars(dollarsUp(quote.priceCents));
  const size = `${quote.length} by ${quote.depth} tiles, ${quote.area} squares, for ${price}.`;
  if (quote.affordable) return `${SIDE_NAMES[quote.side]}: ${size} ${dollars(dollarsDown(quote.remainingCents))} would remain.`;
  return `${SIDE_NAMES[quote.side]}: ${size} You have ${dollars(dollarsDown(quote.priceCents + quote.remainingCents))}.`;
}

/** What the confirmation asks, in the interface's whole dollars. */
export function describeConfirmation(quote: LandQuote): string {
  const price = dollars(dollarsUp(quote.priceCents));
  const what = `${quote.area} squares ${SIDE_PLACES[quote.side]} for ${price}.`;
  if (quote.affordable) return `${what} ${dollars(dollarsDown(quote.remainingCents))} would remain.`;
  return `${what} You have ${dollars(dollarsDown(quote.priceCents + quote.remainingCents))}, so this land cannot be bought yet.`;
}

export class LandTool {
  active = false;
  side: Side | null = null;
  status = CHOOSE_STRIP;
  /** Another pause holds, such as a Load in progress: nothing may be staged. */
  blocked = false;
  /** The confirmation is open: the second step before anything is sent. */
  confirming = false;
  private sent: { side: Side; quote: LandQuote } | null = null;
  private revision: number;

  constructor(private readonly source: LandSource, private width: number,
    private height: number, private readonly hooks: { changed(): void }) {
    this.revision = source.lotRevision();
  }

  get pending(): boolean {
    return this.sent !== null;
  }

  /** The quote for `side`, from the simulation's own numbers. */
  quote(side: Side): LandQuote | null {
    return this.source.landQuote(side);
  }

  /** The chosen strip's quote, when a strip is chosen and the simulation knows it. */
  chosenQuote(): LandQuote | null {
    return this.side === null ? null : this.quote(this.side);
  }

  /** How deep the strips reach beyond the lot, for the view's pan; 0 when not in use. */
  reach(): number {
    if (!this.active) return 0;
    return this.quote(0)?.depth ?? 0;
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    if (!this.pending) this.status = this.side === null ? CHOOSE_STRIP : this.describe();
    this.hooks.changed();
  }

  /**
   * Leaves the tool. A purchase already on its way is applied whatever
   * happens here, so it is kept until its result arrives.
   */
  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.confirming = false;
    if (this.pending) this.hooks.changed();
    else this.clear();
  }

  setBlocked(blocked: boolean): void {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    if (blocked) this.confirming = false;
    this.hooks.changed();
  }

  /** Picks a strip and reads its quote. Nothing is sent. */
  choose(side: number): void {
    if (!this.active || this.pending || this.blocked || this.confirming) return;
    if (!SIDES.includes(side as Side)) return;
    this.side = side as Side;
    this.status = this.describe();
    this.hooks.changed();
  }

  /** A click or tap on a strip picks it; a point anywhere else changes nothing. */
  choosePoint(wx: number, wy: number): void {
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
    const depth = this.reach();
    if (depth <= 0) return;
    const x = Math.round(wx);
    const y = Math.round(wy);
    for (const side of SIDES) {
      if (stripTiles(side, this.width, this.height, depth).some(([tx, ty]) => tx === x && ty === y)) {
        this.choose(side);
        return;
      }
    }
  }

  /** Whether the chosen strip can be bought now. */
  canBuy(): boolean {
    return this.active && !this.blocked && !this.pending && this.chosenQuote()?.affordable === true;
  }

  /** Opens the confirmation for the chosen strip; it opens even for a strip the household cannot afford. */
  requestBuy(): void {
    if (!this.active || this.pending || this.blocked || this.side === null || this.confirming) return;
    if (this.chosenQuote() === null) return;
    this.confirming = true;
    this.hooks.changed();
  }

  cancelConfirmation(): void {
    if (!this.confirming) return;
    this.confirming = false;
    this.hooks.changed();
  }

  /** Sends the purchase the confirmation asked about. */
  confirmBuy(): void {
    if (!this.confirming) return;
    this.confirming = false;
    const side = this.side;
    const quote = this.chosenQuote();
    if (side === null || quote === null || !this.canBuy()) {
      this.hooks.changed();
      return;
    }
    if (this.source.buyLand(side)) {
      this.sent = { side, quote };
      this.status = BUYING;
    } else {
      this.status = NOT_SENT;
    }
    this.hooks.changed();
  }

  clearSelection(): void {
    if (!this.active || this.pending || this.blocked) return;
    this.clear();
  }

  handleKey(key: string): boolean {
    if (!this.active) return false;
    if (key === 'Escape') {
      if (this.confirming) {
        this.cancelConfirmation();
        return true;
      }
      if (this.side === null) return false;
      this.clearSelection();
      return true;
    }
    if (this.confirming) return key === 'Enter' && (this.confirmBuy(), true);
    if (/^[1-3]$/.test(key)) {
      this.choose(Number(key) - 1);
      return true;
    }
    if (key === 'Enter') {
      this.requestBuy();
      return true;
    }
    return false;
  }

  /** Call after the frame drains commands, before drawing. */
  afterCommands(): void {
    const revision = this.source.lotRevision();
    const lotChanged = revision !== this.revision;
    this.revision = revision;
    const sent = this.sent;
    if (sent !== null) {
      const result = this.source.lastLandResult();
      if (result && result.side === sent.side) {
        this.sent = null;
        if (!this.active) {
          this.clear();
          return;
        }
        this.status = result.reason === 0
          ? `Bought ${sent.quote.area} squares ${SIDE_PLACES[sent.side]} for ${dollars(dollarsUp(result.chargedCents))}.`
          : landReason(result.reason);
        this.hooks.changed();
        return;
      }
    }
    if (lotChanged && this.active && this.side !== null && !this.pending) {
      this.status = this.describe();
      this.hooks.changed();
    }
  }

  /** The lot grew or shrank under the tool, as a purchase or a cancelled draft does. */
  setLotSize(width: number, height: number): void {
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    this.hooks.changed();
  }

  /** After Load: nothing chosen, nothing pending, and the loaded lot's size. */
  resetAfterLoad(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.revision = this.source.lotRevision();
    this.sent = null;
    this.confirming = false;
    this.clear();
  }

  /**
   * The three strips as outlines, the chosen one filled; red when the
   * chosen one cannot be afforded.
   */
  highlight(): TileHighlight | null {
    if (!this.active) return null;
    const depth = this.reach();
    if (depth <= 0) return null;
    const tiles: [number, number][] = [];
    for (const side of SIDES) {
      tiles.push(...(side === this.side ? stripTiles(side, this.width, this.height, depth)
        : stripOutline(side, this.width, this.height, depth)));
    }
    const chosen = this.chosenQuote();
    return { tiles, valid: chosen === null || chosen.affordable };
  }

  private describe(): string {
    const quote = this.chosenQuote();
    return quote === null ? CHOOSE_STRIP : describeQuote(quote);
  }

  private clear(): void {
    this.side = null;
    this.confirming = false;
    this.status = CHOOSE_STRIP;
    this.hooks.changed();
  }
}
