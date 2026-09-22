import type { PlacementPreview, SimBridge } from '../bridge.js';
import type { OverlayPauseController } from './overlay-pause.js';

type BuilderSource = Pick<SimBridge, 'ids' | 'kinds' | 'positions' | 'count' |
  'objectName' | 'objectFacing' | 'objectFacingMask' | 'footprintWidths' |
  'footprintDepths' | 'placementPreview' | 'placeObject' | 'lotRevision' |
  'lastPlacementResult' | 'salePreview' | 'sellObject' | 'lastSaleResult'>;

export interface BuilderObject { readonly id: number; readonly name: string }
export interface BuilderHooks { changed(): void; enter(): void; exit(): void }
export const FACING_NAMES = ['South-east', 'South-west', 'North-west', 'North-east'] as const;
const EDIT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  '[', ']', 'r', 'R', 'Enter', 'Escape', 'Delete', 'Backspace']);

/** Paused edit state. Rust owns every placement decision and world write. */
export class FurnitureBuilder {
  active = false;
  selected: number | null = null;
  preview: PlacementPreview | null = null;
  objects: readonly BuilderObject[] = [];
  name = '';
  status = 'Choose furniture to move or rotate.';
  pending = false;
  blocked = false;
  /** What selling the chosen object would pay back, or null when it would not sell. */
  saleValue: number | null = null;
  /** Why the chosen object would not sell, or null when it would or nothing is chosen. */
  saleRefusal: string | null = null;
  /** The object a sale on its way names, until the drain reports it ([SL-shell]). */
  private selling: number | null = null;
  private mask = 0;
  private revision: number;
  private original: { x: number; y: number; facing: number } | null = null;
  private nextSelection: number | null = null;

  constructor(private readonly source: BuilderSource,
    private readonly pause: OverlayPauseController, private readonly hooks: BuilderHooks) {
    this.revision = source.lotRevision();
  }

  get canRotate(): boolean { return (this.mask & (this.mask - 1)) !== 0; }
  get canConfirm(): boolean {
    return this.active && !this.blocked && !this.pending && this.preview?.valid === true;
  }
  get canSell(): boolean {
    return this.active && !this.blocked && !this.pending && this.selected !== null
      && this.saleValue !== null;
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    this.pause.suspend('builder');
    this.refreshObjects();
    this.hooks.enter();
    this.hooks.changed();
  }

  exit(): void {
    if (!this.active || this.pending) return;
    this.clearSelection();
    this.active = false;
    this.pause.resume('builder');
    this.hooks.exit();
    this.hooks.changed();
  }

  setBlocked(blocked: boolean): void {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    this.hooks.changed();
  }

  select(object: number): void {
    if (!this.active || this.pending || this.blocked) return;
    if (object === this.selected) return;
    const ids = Array.from(this.source.ids());
    const row = ids.indexOf(object);
    if (row < 0 || this.source.kinds()[row] !== 1) return;
    if (this.preview?.valid && this.original &&
      (this.preview.x !== this.original.x || this.preview.y !== this.original.y ||
        this.preview.facing !== this.original.facing)) {
      if (this.confirm()) this.nextSelection = object;
      return;
    }
    this.selectNow(object);
  }

  private selectNow(object: number): void {
    // Copy scalar geometry before any allocating label or placement export.
    const row = Array.from(this.source.ids()).indexOf(object);
    if (row < 0 || this.source.kinds()[row] !== 1) return;
    const x = this.source.positions()[row * 2];
    const y = this.source.positions()[row * 2 + 1];
    const width = this.source.footprintWidths()[row];
    const depth = this.source.footprintDepths()[row];
    const facing = this.source.objectFacing(object);
    if (facing === null) return;
    this.selected = object;
    this.name = this.source.objectName(object);
    this.mask = this.source.objectFacingMask(object);
    this.original = { x: Math.floor(x - (width - 1) / 2),
      y: Math.floor(y - (depth - 1) / 2), facing };
    this.query(this.original.x, this.original.y, facing);
  }

  cycle(direction: -1 | 1): void {
    if (!this.active || this.objects.length === 0) return;
    const current = this.objects.findIndex(object => object.id === this.selected);
    const index = current < 0 ? (direction > 0 ? 0 : this.objects.length - 1) :
      (current + direction + this.objects.length) % this.objects.length;
    this.select(this.objects[index].id);
  }

  moveTo(x: number, y: number): void {
    if (!this.active || this.pending || this.blocked || !this.preview) return;
    this.query(x, y, this.preview.facing);
  }

  nudge(x: number, y: number): void {
    if (this.preview) this.moveTo(this.preview.x + x, this.preview.y + y);
    else this.cycle(1);
  }

  rotate(): void {
    if (!this.active || this.pending || this.blocked || !this.preview || !this.canRotate) return;
    for (let turn = 1; turn <= 4; turn += 1) {
      const facing = (this.preview.facing + turn) % 4;
      if ((this.mask & (1 << facing)) !== 0) {
        this.query(this.preview.x, this.preview.y, facing);
        return;
      }
    }
  }

  confirm(): boolean {
    if (!this.canConfirm || this.selected === null || this.preview === null) return false;
    const { x, y, facing } = this.preview;
    this.pending = this.source.placeObject(this.selected, x, y, facing);
    this.status = this.pending ? 'Placing furniture…' : 'The placement could not be queued.';
    this.hooks.changed();
    return this.pending;
  }

  cancel(): void {
    if (this.pending || this.blocked) return;
    this.clearSelection();
    this.hooks.changed();
  }

  /** Sells the chosen object; the drain applies it and `afterCommands` reports it. */
  sell(): boolean {
    if (!this.canSell || this.selected === null) return false;
    this.pending = this.source.sellObject(this.selected);
    if (this.pending) this.selling = this.selected;
    this.status = this.pending ? 'Selling…' : 'The sale could not be sent.';
    this.hooks.changed();
    return this.pending;
  }

  handleKey(key: string): boolean {
    if (!this.active || !EDIT_KEYS.has(key)) return false;
    if (this.pending || this.blocked) return true;
    switch (key) {
      case 'ArrowLeft': this.nudge(-1, 0); break;
      case 'ArrowRight': this.nudge(1, 0); break;
      case 'ArrowUp': this.nudge(0, -1); break;
      case 'ArrowDown': this.nudge(0, 1); break;
      case '[': this.cycle(-1); break;
      case ']': this.cycle(1); break;
      case 'r': case 'R': this.rotate(); break;
      case 'Enter': this.confirm(); break;
      // A Mac laptop's delete key sends Backspace, as the Walls tool allows.
      case 'Delete': case 'Backspace': this.sell(); break;
      case 'Escape': if (this.selected === null) this.exit(); else this.cancel(); break;
      default: return false;
    }
    return true;
  }

  /** Call after the frame drains commands, before rebuilding geometry or drawing. */
  afterCommands(): boolean {
    const revision = this.source.lotRevision();
    const changed = revision !== this.revision;
    this.revision = revision;
    // A sale first: once it lands there is no chosen object to requery.
    if (this.selling !== null) {
      const result = this.source.lastSaleResult();
      if (result?.object === this.selling) {
        this.selling = null;
        this.pending = false;
        const name = this.name;
        // A refused sale keeps the choice; ask again what it would sell for,
        // since whatever refused it may still stand.
        if (result.reason === null) this.clearSelection();
        else if (this.preview) this.query(this.preview.x, this.preview.y, this.preview.facing);
        this.status = result.reason ?? `${name || 'Furniture'} sold.`;
        this.hooks.changed();
      }
    }
    if (changed && this.active) {
      this.refreshObjects();
      // The list changed even when nothing is selected, as after a purchase,
      // so the controls redraw either way; a query redraws them itself.
      if (this.preview && this.selected !== null) {
        this.query(this.preview.x, this.preview.y, this.preview.facing);
      } else {
        this.hooks.changed();
      }
    }
    if (this.pending) {
      const result = this.source.lastPlacementResult();
      if (result?.object === this.selected) {
        this.pending = false;
        const next = this.nextSelection;
        this.nextSelection = null;
        if (result.reason === null && this.preview) {
          const { x, y, facing } = this.preview;
          this.original = { x, y, facing };
        }
        if (this.preview) this.query(this.preview.x, this.preview.y, this.preview.facing);
        this.status = result.reason ?? 'Furniture placed.';
        if (next !== null) {
          this.selectNow(next);
          if (result.reason !== null) this.status = `Previous move cancelled: ${result.reason}`;
        }
        this.hooks.changed();
      }
    }
    return changed;
  }

  resetAfterLoad(): void {
    this.pending = false;
    this.selling = null;
    this.clearSelection();
    this.revision = this.source.lotRevision();
    if (this.active) this.refreshObjects();
    this.hooks.changed();
  }

  private refreshObjects(): void {
    const ids = Array.from(this.source.ids());
    const kinds = Array.from(this.source.kinds());
    this.objects = ids.filter((_, row) => kinds[row] === 1)
      .map(id => ({ id, name: this.source.objectName(id) }));
  }

  private query(x: number, y: number, facing: number): void {
    if (this.selected === null) return;
    const preview = this.source.placementPreview(this.selected, x, y, facing);
    // Invalid unsigned coordinates still need the resolved art for the red
    // preview. The valid-coordinate query supplies geometry only, not approval.
    const geometry = preview.width > 0 ? preview :
      this.source.placementPreview(this.selected, 0, 0, facing);
    this.preview = { ...geometry, ...preview, width: geometry.width, depth: geometry.depth,
      sprite: geometry.sprite, foreground: geometry.foreground };
    this.status = preview.valid ? 'Ready to place.' : preview.reason ?? 'This placement is unavailable.';
    const sale = this.source.salePreview(this.selected);
    this.saleValue = sale.reason === null ? sale.payout : null;
    this.saleRefusal = sale.reason;
    this.hooks.changed();
  }

  private clearSelection(): void {
    this.saleValue = null;
    this.saleRefusal = null;
    this.nextSelection = null;
    this.original = null;
    this.selected = null;
    this.preview = null;
    this.mask = 0;
    this.name = '';
    this.status = 'Choose furniture to move or rotate.';
  }
}
