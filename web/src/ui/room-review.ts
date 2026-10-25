import type { BuildReview, Point, RoomChoices, RoomFailure, RoomSummary } from '../rooms/codec.js';
import type { TileHighlight } from '../render/placement-preview.js';
import { confirmFailure, failureDetails } from '../rooms/failure.js';
import { logError } from '../diagnostics/log.js';
import { RoomFailureLog, roomNameError, type RoomBridge } from './room-selection.js';

const key = (anchor: Point) => `${anchor[0]},${anchor[1]}`;
const same = (a: Point | null, b: Point) => a !== null && a[0] === b[0] && a[1] === b[1];
export const ROOM_CHANGE_NAMES = ['Split', 'Merge', 'Repartition', 'Lost enclosure'] as const;
interface Choice { anchor: Point; name?: string; inheritance?: number | null }
export interface RoomReviewHooks {
  changed?(): void;
  completed?(adopted: boolean): void;
  refused?(): void;
}

/** Local choices are distinct from the native, token-bound candidate shown to the player. */
export class RoomReviewController {
  review: BuildReview | null = null;
  active = false;
  group = 0;
  error = '';
  busy = false;
  private edited = false;
  private readonly choices = new Map<string, Choice>();
  private eligible = new Map<string, readonly number[]>();
  private formerNames = new Map<number, string>();
  private formerRooms = new Map<number, RoomSummary>();
  private tiles: readonly Point[] = [];
  private readonly failures = new RoomFailureLog();
  constructor(private readonly source: RoomBridge, private readonly hooks: RoomReviewHooks = {}) {}
  private refuseConfirm(message: string, error: RoomFailure): void {
    const report = error.code === 10 ? this.source.buildFailureReport?.() : undefined;
    this.error = confirmFailure(error, report);
    logError('Rooms', message, failureDetails(error, report));
    this.hooks.refused?.();
  }
  open(review: BuildReview): void {
    const snapshot = this.source.roomSummaries();
    if (snapshot.ok) { this.formerNames = new Map(snapshot.value.rooms.map(room => [room.id, room.name])); this.formerRooms = new Map(snapshot.value.rooms.map(room => [room.id, room])); }
    this.active = true; this.edited = this.choices.size > 0; this.error = '';
    this.install(review); this.hooks.changed?.();
  }
  private install(review: BuildReview): void {
    const eligible = new Map<string, readonly number[]>();
    for (const room of review.rooms) if (room.anchor) {
      const result = this.source.buildComponentPredecessors(review.token, room.anchor);
      if (!result.ok) throw Error(this.failures.report("A room's former identities could not be read.", result.error));
      eligible.set(key(room.anchor), result.value);
    }
    this.review = review; this.eligible = eligible;
    this.group = Math.min(this.group, Math.max(0, review.groups.length - 1));
    this.refreshHighlight();
    if (this.unavailableChoices.length) this.error = 'Some retained choices no longer match this layout. Review or remove those choices before confirming.';
  }
  get unavailableChoices(): readonly Choice[] {
    return [...this.choices.values()].filter(choice => !this.eligible.has(key(choice.anchor))
      || (choice.inheritance !== undefined && choice.inheritance !== null && !this.predecessors(choice.anchor).includes(choice.inheritance)));
  }
  removeUnavailableChoices(): void {
    for (const choice of this.unavailableChoices) this.choices.delete(key(choice.anchor));
    this.error = ''; this.edited = true; this.hooks.changed?.();
  }
  predecessors(anchor: Point): readonly number[] { return this.eligible.get(key(anchor)) ?? []; }
  get hasChoices(): boolean { return this.choices.size > 0; }
  oldName(id: number): string { return this.formerNames.get(id) ?? this.review?.retiredNames.find(row => row.id === id)?.name ?? 'Former room'; }
  oldLabel(id: number): string {
    const room = this.formerRooms.get(id);
    return `${this.oldName(id)}${room ? ` · ${room.area} tiles${room.anchor ? ` · ${room.anchor[0]}, ${room.anchor[1]}` : ''}` : ''}`;
  }
  name(anchor: Point): string { return this.choices.get(key(anchor))?.name ?? this.review?.rooms.find(room => same(room.anchor, anchor))?.name ?? ''; }
  inheritance(anchor: Point): number | null {
    const choice = this.choices.get(key(anchor));
    if (choice?.inheritance !== undefined) return choice.inheritance;
    const id = this.review?.rooms.find(room => same(room.anchor, anchor))?.id;
    return id !== undefined && this.predecessors(anchor).includes(id) ? id : null;
  }
  private choice(anchor: Point): Choice {
    let choice = this.choices.get(key(anchor));
    if (!choice) { choice = { anchor }; this.choices.set(key(anchor), choice); }
    return choice;
  }
  setName(anchor: Point, text: string): void { this.choice(anchor).name = text; this.edited = true; this.error = roomNameError(text) ?? ''; this.hooks.changed?.(); }
  setInheritance(anchor: Point, id: number | null): void {
    if (id !== null && !this.predecessors(anchor).includes(id)) { this.error = 'That room cannot supply this identity.'; this.hooks.changed?.(); return; }
    this.choice(anchor).inheritance = id; this.edited = true; this.error = ''; this.hooks.changed?.();
  }
  selectGroup(index: number): void {
    if (!this.review || index < 0 || index >= this.review.groups.length) return;
    this.group = index; this.refreshHighlight(); this.hooks.changed?.();
  }
  private refreshHighlight(): void {
    const review = this.review, group = review?.groups[this.group];
    if (!review || !group) { this.tiles = []; return; }
    if (group.kind === 3) { this.tiles = group.formerTiles; return; }
    const tiles: Point[] = [];
    for (const anchor of group.finalAnchors) {
      const result = this.source.buildComponentTiles(review.token, anchor);
      if (!result.ok) { this.error = this.failures.report("A changed room's tiles could not be read.", result.error); this.tiles = []; return; }
      tiles.push(...result.value);
    }
    this.tiles = tiles;
  }
  highlight(): TileHighlight | null { return this.active ? { tiles: this.tiles, valid: true } : null; }
  opening(): Point | null {
    const opening = this.review?.groups[this.group]?.openings[0];
    return opening ? [opening.x - (opening.axis === 0 ? 0.5 : 0), opening.y - (opening.axis === 1 ? 0.5 : 0)] : null;
  }
  get needsUpdate(): boolean { return this.edited; }
  back(): void {
    if (!this.active || this.busy) return;
    const result = this.source.discardBuildReview();
    if (!result.ok) { this.error = this.failures.report('The room review could not be closed.', result.error); this.hooks.refused?.(); this.hooks.changed?.(); return; }
    this.active = false; this.hooks.completed?.(false); this.hooks.changed?.();
  }
  reset(): void { this.active = false; this.review = null; this.choices.clear(); this.eligible.clear(); this.error = ''; this.edited = false; this.hooks.completed?.(false); this.hooks.changed?.(); }
  async confirm(): Promise<boolean> {
    if (!this.active || this.busy || !this.review) return false;
    if (this.unavailableChoices.length) { this.error = 'Remove or correct the unavailable retained choices first.'; this.hooks.refused?.(); this.hooks.changed?.(); return false; }
    for (const choice of this.choices.values()) if (choice.name !== undefined) {
      const error = roomNameError(choice.name);
      if (error) { this.error = error; this.hooks.refused?.(); this.hooks.changed?.(); return false; }
    }
    this.busy = true; this.hooks.changed?.();
    try {
      if (this.edited) {
        const choices: RoomChoices = { inheritance: [], names: [], outsideName: null };
        const inheritance: { anchor: Point; id: number | null }[] = [], names: { anchor: Point; name: string }[] = [];
        for (const choice of this.choices.values()) {
          if (choice.inheritance !== undefined) inheritance.push({ anchor: choice.anchor, id: choice.inheritance });
          if (choice.name !== undefined) names.push({ anchor: choice.anchor, name: choice.name });
        }
        const result = this.source.prepareBuildCommit({ ...choices, inheritance, names }, this.review.token);
        if (!result.ok) { this.refuseConfirm('The room choices could not be prepared.', result.error); return false; }
        this.install(result.value); this.edited = false; this.error = 'Choices updated. Check the resulting names and duties, then Confirm changes.'; return false;
      }
      const result = this.source.commitBuild(this.review.token);
      if (!result.ok) { this.refuseConfirm('The reviewed changes could not be committed.', result.error); return false; }
      this.active = false; this.choices.clear(); this.error = ''; this.hooks.completed?.(true); return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'The room review could not be read. Return to Build and try again.';
      logError('Rooms', 'The room review failed unexpectedly.', { error });
      this.hooks.refused?.(); return false;
    } finally { this.busy = false; this.hooks.changed?.(); }
  }
}

export class RoomReviewControls {
  private signature = '';
  private shown = false;
  private opener: HTMLElement | null = null;
  constructor(private readonly document: Document, private readonly controller: RoomReviewController,
    private readonly showOpening: (point: Point) => void, private readonly ownerName: (id: number) => string,
    private readonly personName: (entity: number) => string, private readonly focusFallback: () => void,
    private readonly objectName: (entity: number) => string = () => 'Object') {
    document.querySelector('#room-review-back')!.addEventListener('click', () => controller.back());
    document.querySelector('#room-review-confirm')!.addEventListener('click', () => { void controller.confirm(); });
    document.querySelector<HTMLSelectElement>('#room-review-group')!.addEventListener('change', event => controller.selectGroup(Number((event.target as HTMLSelectElement).value)));
  }
  render(): void {
    const doc = this.document, controller = this.controller;
    const root = doc.querySelector<HTMLElement>('#builder-controls')!, panel = doc.querySelector<HTMLElement>('#room-review')!;
    const opening = controller.active && !this.shown, closing = !controller.active && this.shown;
    if (opening) this.opener = doc.activeElement as HTMLElement;
    this.shown = controller.active; root.dataset.reviewing = String(controller.active); panel.hidden = !controller.active;
    if (closing) {
      if (this.opener?.isConnected && !this.opener.closest('[hidden]') && !this.opener.matches(':disabled')) this.opener.focus({ preventScroll: true });
      else this.focusFallback();
    }
    if (!controller.active || !controller.review) return;
    const heading = doc.querySelector<HTMLElement>('#room-review-heading')!;
    if (opening) heading.focus();
    const submit = doc.querySelector<HTMLButtonElement>('#room-review-confirm')!;
    if (controller.busy && doc.activeElement === submit) heading.focus();
    submit.disabled = controller.busy; submit.textContent = controller.needsUpdate ? 'Update review' : 'Confirm changes';
    doc.querySelector<HTMLElement>('#room-review-status')!.textContent = controller.error;
    const review = controller.review, selector = doc.querySelector<HTMLSelectElement>('#room-review-group')!;
    const signature = `${review.token.session}/${review.token.revision}/${review.token.preparation}/${controller.group}`;
    if (signature === this.signature) return;
    this.signature = signature;
    selector.replaceChildren();
    review.groups.forEach((group, index) => { const option = doc.createElement('option'); option.value = String(index); option.textContent = `${index + 1}. ${ROOM_CHANGE_NAMES[group.kind]}: ${group.oldIds.map(id => controller.oldName(id)).join(', ')}`; selector.append(option); });
    if (!review.groups.length) { const option = doc.createElement('option'); option.value = '0'; option.textContent = 'Updated room layout'; selector.append(option); }
    selector.value = String(controller.group);
    const body = doc.querySelector<HTMLElement>('#room-review-body')!; body.replaceChildren();
    const paragraph = (text: string) => { const p = doc.createElement('p'); p.textContent = text; body.append(p); };
    const group = review.groups[controller.group] ?? { kind: -1, oldIds: [], finalAnchors: review.rooms.flatMap(room => room.anchor ? [room.anchor] : []) };
    paragraph(`Former rooms: ${group.oldIds.map(id => controller.oldName(id)).join(', ')}`);
    if (group.kind === 3) {
      paragraph('This room is open to Outside. Its enclosed identity and room duties will retire.');
      const outside = review.rooms.find(room => room.id === 0);
      if (outside) paragraph(`Outside destination: ${outside.name} · ${outside.previousArea} → ${outside.area} tiles`);
      if (!review.duties.duties.some(duty => duty.key.kind === 1 && duty.key.target === 0)) paragraph('No floor duty in this review.');
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'hud-button'; button.textContent = 'Show opening';
      button.disabled = controller.opening() === null; button.addEventListener('click', () => { const point = controller.opening(); if (point) this.showOpening(point); }); body.append(button);
    }
    for (const anchor of group.finalAnchors) {
      const room = review.rooms.find(row => same(row.anchor, anchor))!;
      const fieldset = doc.createElement('fieldset'), legend = doc.createElement('legend');
      legend.textContent = `${room.name} · ${anchor[0]}, ${anchor[1]} · ${room.previousArea} → ${room.area} tiles`; fieldset.append(legend);
      const label = doc.createElement('label'), select = doc.createElement('select'); label.textContent = 'Keep identity and floor owner'; label.append(select);
      const fresh = doc.createElement('option'); fresh.value = ''; fresh.textContent = 'New room'; select.append(fresh);
      for (const id of controller.predecessors(anchor)) { const option = doc.createElement('option'); option.value = String(id); option.textContent = controller.oldLabel(id); select.append(option); }
      select.value = controller.inheritance(anchor) === null ? '' : String(controller.inheritance(anchor));
      select.addEventListener('change', () => controller.setInheritance(anchor, select.value === '' ? null : Number(select.value)));
      const nameLabel = doc.createElement('label'), input = doc.createElement('input'); nameLabel.textContent = 'Resulting room name'; input.type = 'text'; input.value = controller.name(anchor); nameLabel.append(input);
      input.addEventListener('input', () => { controller.setName(anchor, input.value); input.setAttribute('aria-invalid', String(roomNameError(input.value) !== null)); });
      input.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Enter') event.preventDefault(); });
      fieldset.append(label, nameLabel);
      for (const retired of review.retiredNames.filter(row => group.oldIds.includes(row.id))) {
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'hud-button'; button.textContent = `Use name: ${retired.name}`;
        button.addEventListener('click', () => { input.value = retired.name; controller.setName(anchor, retired.name); }); fieldset.append(button);
      }
      body.append(fieldset);
    }
    for (const choice of controller.unavailableChoices) paragraph(`Retained choice at ${choice.anchor.join(', ')} needs attention${choice.name === undefined ? '.' : `: ${choice.name}`}`);
    if (controller.unavailableChoices.length) { const button = doc.createElement('button'); button.type = 'button'; button.className = 'hud-button'; button.textContent = 'Remove unavailable choices'; button.dataset.actionIntent = 'negative'; button.addEventListener('click', () => { this.signature = ''; controller.removeUnavailableChoices(); }); body.append(button); }
    const dutyNames = ['Dishes', 'Floors', 'Surfaces', 'Bins', 'Counter surfaces', 'Table surfaces'];
    const effects = ['Retained', 'Reassigned', 'Automatically assigned', 'Unassigned', 'Retired'];
    for (const duty of review.duties.duties) {
      const isRoom = [1, 4, 5].includes(duty.key.kind);
      const relevant = isRoom && ((group.kind === 3 && duty.key.target === 0) || group.oldIds.includes(duty.key.target)
        || review.rooms.some(room => room.id === duty.key.target && group.finalAnchors.some(anchor => same(room.anchor, anchor))));
      if (!relevant && duty.kind === 0) continue;
      const roomName = isRoom ? review.rooms.find(room => room.id === duty.key.target)?.name ?? controller.oldName(duty.key.target)
        : duty.key.kind === 0 ? 'Household' : this.objectName(duty.key.target);
      paragraph(`${dutyNames[duty.key.kind]} in ${roomName}: ${effects[duty.kind]} · ${duty.owner === null ? 'Unassigned' : this.ownerName(duty.owner)}`);
    }
    for (const retired of review.retiredNames.filter(row => group.oldIds.includes(row.id))) paragraph(`Retiring name: ${retired.name}`);
    if (review.duties.replannedPeople.length) paragraph(`Cleaning replanned: ${review.duties.replannedPeople.map(this.personName).join(', ')}`);
    if (review.duties.unavailablePeople.length) paragraph(`Cleaning no longer available: ${review.duties.unavailablePeople.map(this.personName).join(', ')}`);
  }
}
