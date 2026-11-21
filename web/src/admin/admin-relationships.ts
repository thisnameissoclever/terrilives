import { careerDurationWords } from '../ui/career-panel.js';
import { describeRelationship } from '../ui/people-panel.js';
import type { AdminEdit, AdminTimer } from './codec.js';
import type { AdminMember, AdminTab, AdminTabContext, AdminTabFactory } from './admin-panel.js';
import { HOUSEMATE_WORDS, RELATIONSHIP_WORDS as W, undoLabels } from './admin-words.js';
import { actionButton, make, rebuild, sliderRow, textNode } from './admin-controls.js';

// The admin panel's Relationships tab (issue 312, [AP-e-rel] in
// docs/specs/2026-11-20-admin-panel.md), with the owner's change from the
// mockup: the shared housemate picker chooses A, and the tab lists only A's
// relationships, one card per other living housemate. A card holds A's
// feeling about B and B's feeling about A. A feeling is one number per ordered
// pair; 0 drops the entry, so the pair reads as strangers.
//
// A fight is a queued order that runs when play resumes, so pressing "starts a
// fight" only says it will. A running "Had a fight" timer is the chosen
// housemate's own and is shown above the cards with End now.

/** The `admin_timers` code of "had a fight". */
const FIGHT_TIMER = 1;

/** What the tab reads, keyed by SimId; `main.ts` adapts the bridge's entity-keyed reads to it. */
export interface RelationshipsSource {
  /** Interleaved `[other SimId, feeling]` pairs for one housemate; a pair missing is a stranger. */
  relationships(sim: number): ArrayLike<number>;
  adminTimers(sim: number): AdminTimer[];
  clockTick(): number;
  dayTicks(): number;
}

class RelationshipsTab implements AdminTab {
  readonly body: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly cards: HTMLElement;
  /** What each status line says, by key; read when a card is drawn and written when a change is reported. */
  private readonly messages = new Map<string, string>();
  /** Status keys whose message reports a success, such as a queued fight, rather than a refusal. */
  private readonly notes = new Set<string>();
  /** The status nodes now on screen, by key. */
  private readonly nodes = new Map<string, HTMLElement>();

  constructor(private readonly context: AdminTabContext, private readonly source: RelationshipsSource) {
    const doc = context.doc;
    this.body = make(doc, 'div', 'admin-relationships');
    // Focus falls back here when the control that held it is gone.
    this.body.setAttribute('tabindex', '-1');
    this.bar = make(doc, 'div', 'admin-rel-bar');
    this.cards = make(doc, 'div', 'admin-rel-cards');
    this.body.append(this.bar, this.cards);
  }

  refresh(): void {
    // A status is about the change just sent, which the shell reports after this returns; any later
    // re-read (another change, Undo, a new choice) ends it.
    this.messages.clear();
    this.notes.clear();
    const doc = this.context.doc;
    const a = this.context.selected();
    if (a === null) {
      this.bar.replaceChildren();
      this.cards.replaceChildren();
      this.nodes.clear();
      return;
    }
    const others = this.context.members().filter(member => member.simId !== a.simId);
    const feelings = new Map<number, number>();
    const mine = this.source.relationships(a.simId);
    for (let at = 0; at + 1 < mine.length; at += 2) feelings.set(mine[at], mine[at + 1]);
    const timers = this.source.adminTimers(a.simId);
    const now = this.source.clockTick();
    const dayTicks = this.source.dayTicks();
    // Every card also needs the other direction, from B's own relationships.
    const back = new Map<number, number>(others.map(other => {
      const theirs = this.source.relationships(other.simId);
      for (let at = 0; at + 1 < theirs.length; at += 2) if (theirs[at] === a.simId) return [other.simId, theirs[at + 1]] as const;
      return [other.simId, 0] as const;
    }));

    this.nodes.clear();
    rebuild(doc, this.bar, this.body, () => this.barNodes(a, others, timers, now, dayTicks));
    rebuild(doc, this.cards, this.body, () => others.map(other => this.card(a, other, feelings.get(other.simId) ?? 0, back.get(other.simId) ?? 0)));
  }

  /** Shows `message` under the status line `key`, or clears it. A note reads as information, not a refusal. */
  private say(key: string, message: string | null, note = false): void {
    if (message === null) this.messages.delete(key); else this.messages.set(key, message);
    if (note && message !== null) this.notes.add(key); else this.notes.delete(key);
    const node = this.nodes.get(key);
    if (node !== undefined) {
      node.textContent = message ?? '';
      node.classList.toggle('admin-status-note', this.notes.has(key));
    }
  }

  private status(key: string): HTMLElement {
    const node = textNode(this.context.doc, 'p', 'admin-status', this.messages.get(key) ?? '');
    node.setAttribute('role', 'status');
    node.classList.toggle('admin-status-note', this.notes.has(key));
    this.nodes.set(key, node);
    return node;
  }

  private send(key: string, edits: AdminEdit[], label: string, done?: string): void {
    this.context.apply({ edits }, {
      label,
      report: message => this.say(key, message ?? done ?? null, message === null),
    });
  }

  // ---- the bar: the chosen housemate's fight, and Set all ------------------

  private barNodes(a: AdminMember, others: readonly AdminMember[], timers: readonly AdminTimer[], now: number, dayTicks: number): HTMLElement[] {
    const doc = this.context.doc;
    const nodes: HTMLElement[] = [];
    const fight = timers.find(timer => timer.timer === FIGHT_TIMER);
    if (fight !== undefined) {
      const row = make(doc, 'div', 'admin-fight');
      row.append(
        textNode(doc, 'span', 'admin-fight-text', W.fought(a.name, careerDurationWords(Math.max(0, fight.endsTick - now) * 1440 / dayTicks))),
        actionButton(doc, {
          text: HOUSEMATE_WORDS.endNow, key: 'fight-end', name: undoLabels.endMoodlet(W.fightMoodlet),
          onClick: () => this.send('fight', [{ edit: 'EndTimedMoodlet', sim: a.simId, timer: FIGHT_TIMER }], undoLabels.endMoodlet(W.fightMoodlet)),
        }),
        this.status('fight'),
      );
      nodes.push(row);
    }
    const all = make(doc, 'div', 'admin-rel-all');
    all.append(
      actionButton(doc, {
        text: W.all(a.name), key: 'all', disabled: others.length === 0,
        onClick: () => this.send('all', others.flatMap(other => this.zero(a, other)), undoLabels.allFeelings(a.name)),
      }),
      this.status('all'),
    );
    nodes.push(all);
    return nodes;
  }

  /** Both directions of a pair set to 0. */
  private zero(a: AdminMember, b: AdminMember): AdminEdit[] {
    return [{ edit: 'SetFeeling', from: a.simId, to: b.simId, value: 0 }, { edit: 'SetFeeling', from: b.simId, to: a.simId, value: 0 }];
  }

  // ---- one card per other housemate -----------------------------------------

  private card(a: AdminMember, b: AdminMember, aAbout: number, bAbout: number): HTMLElement {
    const doc = this.context.doc;
    const key = `card-${b.simId}`;
    const card = make(doc, 'section', 'admin-section admin-rel-card');
    const head = make(doc, 'div', 'admin-section-head');
    const title = textNode(doc, 'h3', 'admin-section-title admin-rel-title', W.pair(a.name, b.name));
    title.setAttribute('tabindex', '-1');
    const actions = make(doc, 'span', 'admin-section-actions');
    actions.append(
      actionButton(doc, {
        text: W.startFight(a.name), key: `${key}-fight`,
        onClick: () => this.send(key, [{ edit: 'StartFight', from: a.simId, to: b.simId }], undoLabels.startFight, W.fightQueued),
      }),
      actionButton(doc, {
        text: W.both, key: `${key}-both`,
        onClick: () => this.send(key, this.zero(a, b), undoLabels.bothFeelings),
      }),
    );
    head.append(title, actions);
    const body = make(doc, 'div', 'admin-section-body');
    body.append(
      this.feelingRow(a, b, aAbout, key, `${key}-ab`),
      this.feelingRow(b, a, bAbout, key, `${key}-ba`),
    );
    card.append(head, body, this.status(key));
    return card;
  }

  /** `from`'s feeling about `to`, with its relationship word. */
  private feelingRow(from: AdminMember, to: AdminMember, value: number, key: string, controlKey: string): HTMLElement {
    const doc = this.context.doc;
    const shown = describeRelationship(value);
    const word = textNode(doc, 'span', `admin-word admin-tone-${shown.tone}`, shown.label);
    return sliderRow({
      doc, label: W.feeling(from.name, to.name), key: controlKey, min: -1, max: 1, step: 0.01, decimals: 2, value,
      onCommit: next => this.send(key, [{ edit: 'SetFeeling', from: from.simId, to: to.simId, value: next }], undoLabels.feeling(from.name, to.name)),
    }, [word]).root;
  }
}

/** The Relationships tab, for the shell's `tabs` map. */
export function createRelationshipsTab(source: RelationshipsSource): AdminTabFactory {
  return context => new RelationshipsTab(context, source);
}
