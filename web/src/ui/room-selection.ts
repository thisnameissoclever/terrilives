import type { SimBridge } from '../bridge.js';
import type { Point, RoomFailure, RoomSummary } from '../rooms/codec.js';
import { failureDetails, failureWhat } from '../rooms/failure.js';
import type { TileHighlight } from '../render/placement-preview.js';
import type { RoomTool } from './room-tool.js';
import { logError } from '../diagnostics/log.js';

export type RoomBridge = Pick<SimBridge, 'roomsRevision' | 'roomSummaries' | 'roomTiles' | 'stageRoomName'
  | 'prepareBuildCommit' | 'commitBuild' | 'discardBuildReview' | 'buildComponentTiles' | 'buildComponentPredecessors'>
  & Partial<Pick<SimBridge, 'buildFailureReport'>>;

export function roomNameError(raw: string): string | null {
  if (/[\uD800-\uDFFF]/u.test(raw)) return 'The name contains an incomplete character.';
  if (/\p{Cc}/u.test(raw)) return 'Room names cannot contain control characters.';
  const length = Array.from(normalizeRoomName(raw)).length;
  return length < 1 || length > 48 ? 'Use 1 to 48 characters for the room name.' : null;
}
export function normalizeRoomName(raw: string): string { return raw.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, ''); }
/** A room operation's failure for the status line, with what to do next. */
export function roomFailure(error: RoomFailure): string {
  const advice = error.code === 5 ? 'Choose another room.' : error.code === 6 ? 'Use 1 to 48 characters for the room name.'
    : 'Check the pending changes and try again.';
  return `${failureWhat(error)} ${advice}`;
}

/** Writes each distinct room failure to the console once, however often it is shown. */
export class RoomFailureLog {
  private readonly logged = new Set<string>();
  report(message: string, error: RoomFailure, details: Record<string, unknown> = {}): string {
    const text = roomFailure(error), key = `${message}|${text}`;
    if (!this.logged.has(key)) { this.logged.add(key); logError('Rooms', message, { ...failureDetails(error), ...details }); }
    return text;
  }
  clear(): void { this.logged.clear(); }
}

/** Confirmed native membership and raw field drafts. No provisional room identities. */
export class RoomSelection {
  selected: number | null = null;
  rooms: readonly RoomSummary[] = [];
  error = '';
  private revision: bigint | null = null;
  private readonly texts = new Map<number, string>();
  private readonly tiles = new Map<number, readonly Point[]>();
  private readonly failures = new RoomFailureLog();
  constructor(private readonly source: RoomBridge, private readonly changed: () => void = () => {}) {}
  refresh(): void {
    const revision = this.source.roomsRevision();
    if (revision === this.revision) return;
    const result = this.source.roomSummaries();
    if (!result.ok) { this.error = this.failures.report('The room list could not be read.', result.error); return; }
    this.failures.clear();
    this.rooms = result.value.rooms; this.revision = revision; this.tiles.clear();
    if (this.selected !== null && !this.rooms.some(room => room.id === this.selected)) this.selected = null;
  }
  select(id: number | null): boolean {
    this.refresh();
    if (id !== null && !this.rooms.some(room => room.id === id)) return false;
    this.selected = id; this.error = id === null ? '' : roomNameError(this.text) ?? ''; this.changed(); return true;
  }
  get text(): string { return this.selected === null ? '' : this.texts.get(this.selected) ?? this.rooms.find(room => room.id === this.selected)?.name ?? ''; }
  edit(raw: string): void {
    if (this.selected === null) return;
    this.texts.set(this.selected, raw); this.error = roomNameError(raw) ?? '';
    if (!this.error) {
      try {
        const result = this.source.stageRoomName(this.selected, raw);
        if (!result.ok) this.error = this.failures.report('The room name was refused.', result.error, { room: this.selected });
      } catch (error) {
        this.error = 'The room name could not be sent. Keep the text and try again.';
        logError('Rooms', 'The room name could not be sent.', { room: this.selected, error });
      }
    }
    this.changed();
  }
  validate(): boolean {
    this.refresh();
    for (const [id, text] of this.texts) {
      const error = roomNameError(text);
      if (error) { this.selected = id; this.error = error; this.changed(); return false; }
      const result = this.source.stageRoomName(id, text);
      if (!result.ok) { this.error = this.failures.report('A room name was refused at Confirm.', result.error, { room: id }); this.changed(); return false; }
    }
    this.error = ''; return true;
  }
  hasLocalChanges(): boolean {
    this.refresh();
    return [...this.texts].some(([id, text]) => roomNameError(text) !== null
      || normalizeRoomName(text) !== this.rooms.find(room => room.id === id)?.name);
  }
  reset(): void { this.texts.clear(); this.error = ''; this.revision = null; this.refresh(); this.changed(); }
  private membership(id: number): readonly Point[] {
    if (!this.tiles.has(id)) {
      const result = this.source.roomTiles(id);
      if (!result.ok) { this.error = this.failures.report("A room's tiles could not be read.", result.error, { room: id }); return []; }
      this.tiles.set(id, result.value);
    }
    return this.tiles.get(id)!;
  }
  chooseTile(tile: Point): boolean {
    this.refresh();
    const room = this.rooms.find(row => this.membership(row.id).some(point => point[0] === tile[0] && point[1] === tile[1]));
    return room ? this.select(room.id) : false;
  }
  highlight(): TileHighlight | null { this.refresh(); return this.selected === null ? null : { tiles: this.membership(this.selected), valid: true }; }
  label(room: RoomSummary): string {
    return `${room.name} · ${room.area} tiles${room.anchor ? ` · ${room.anchor[0]}, ${room.anchor[1]}` : ' · Outside'}`;
  }
}

/** The Rooms destination retains the rectangle tool as its construction mode. */
export class RoomsTool {
  active = false;
  mode: 'select' | 'build' = 'select';
  constructor(readonly selection: RoomSelection, private readonly construction: RoomTool, private readonly changed: () => void) {}
  get pending(): boolean | string | number | null { return this.construction.pending; }
  get selecting(): boolean { return this.active && this.mode === 'select'; }
  enter(): void { this.active = true; if (this.mode === 'build') this.construction.enter(); this.selection.refresh(); this.changed(); }
  exit(): void { this.active = false; this.construction.exit(); this.changed(); }
  setMode(mode: 'select' | 'build'): void {
    if (this.mode === mode) return;
    this.mode = mode; this.construction.exit(); if (this.active && mode === 'build') this.construction.enter(); this.changed();
  }
  handleKey(key: string): boolean {
    if (this.mode === 'build') return this.construction.handleKey(key);
    if (key === 'Escape' && this.selection.selected !== null) { this.selection.select(null); return true; }
    return key === 'Enter';
  }
}

export class RoomSelectionControls {
  private readonly select: HTMLSelectElement;
  private readonly name: HTMLInputElement;
  private readonly status: HTMLElement;
  private signature = '';
  constructor(private readonly document: Document, private readonly tool: RoomsTool) {
    this.select = document.querySelector<HTMLSelectElement>('#room-selection')!;
    this.name = document.querySelector<HTMLInputElement>('#room-name')!;
    this.status = document.querySelector<HTMLElement>('#room-name-status')!;
    this.select.addEventListener('change', () => tool.selection.select(this.select.value === '' ? null : Number(this.select.value)));
    this.name.addEventListener('input', () => { if (!this.composing) tool.selection.edit(this.name.value); });
    this.name.addEventListener('compositionstart', () => { this.composing = true; });
    this.name.addEventListener('compositionend', () => { this.composing = false; tool.selection.edit(this.name.value); });
    this.name.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Enter') event.preventDefault(); });
    for (const mode of ['select', 'build'] as const) document.querySelector(`#room-mode-${mode}`)!.addEventListener('click', () => { tool.setMode(mode); this.render(); });
    this.render();
  }
  private composing = false;
  render(): void {
    const { selection, mode } = this.tool; selection.refresh();
    for (const candidate of ['select', 'build']) this.document.querySelector(`#room-mode-${candidate}`)!.setAttribute('aria-pressed', String(mode === candidate));
    this.document.querySelector<HTMLElement>('#room-select-controls')!.hidden = mode !== 'select';
    this.document.querySelector<HTMLElement>('#room-build-controls')!.hidden = mode !== 'build';
    const signature = JSON.stringify(selection.rooms);
    if (signature !== this.signature) {
      this.signature = signature; this.select.replaceChildren();
      const placeholder = this.document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Select a room'; this.select.append(placeholder);
      for (const room of selection.rooms) { const option = this.document.createElement('option'); option.value = String(room.id); option.textContent = selection.label(room); this.select.append(option); }
    }
    this.select.value = selection.selected === null ? '' : String(selection.selected);
    this.name.disabled = selection.selected === null;
    if (!this.composing && this.name.value !== selection.text) this.name.value = selection.text;
    this.status.textContent = selection.error; this.name.setAttribute('aria-invalid', String(!!selection.error));
  }
}
