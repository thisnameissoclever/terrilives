import type { CareerShift, SkillStanding } from '../bridge.js';
import { careerDurationWords } from '../ui/career-panel.js';
import { formatTimeOfDay, shiftName } from '../ui/game-hud.js';
import { describeSatisfaction } from '../ui/satisfaction-meter.js';
import { affinityRowLabel } from '../ui/affinities-panel.js';
import { COMPACT_HUD_MEDIA_QUERY } from '../ui/compact-hud.js';
import type { AdminEdit, AdminJobOption, AdminLimits, AdminMoodlet, AdminPerson, AdminRepetition, AdminTimer } from './codec.js';
import type { AdminTab, AdminTabContext, AdminTabFactory } from './admin-panel.js';
import { HOUSEMATE_WORDS as W, undoLabels } from './admin-words.js';
import {
  actionButton, checkRow, createSection, labelled, make, numberRow, rebuild, selectControl, sliderRow, textNode,
  type Section, type SelectOption,
} from './admin-controls.js';

// The admin panel's Housemate tab (issue 312, [AP-e-housemate] in
// docs/specs/2026-11-20-admin-panel.md): the chosen housemate's needs, life
// satisfaction, repetition, mood and timed moodlets, likes and dislikes,
// skills, traits and career, in three columns as Mockup A. Every control sends
// one change through `context.apply` and the shell re-reads every tab after it,
// so the tab never refreshes itself or keeps a value the world did not confirm.
//
// Mood is derived, so it is read only; the controls beside it change what it
// is made of. A capability is shown, and edited, as the skill it trains
// ([AP-c-capability]).

/** What the tab reads that is fixed for the life of the content; read once. */
export interface HousemateLibrary {
  readonly needNames: readonly string[];
  readonly needMax: number;
  readonly skillLabels: readonly string[];
  /** The top level of each skill. */
  readonly skillLevels: readonly number[];
  readonly traitLabels: readonly string[];
  /** "disposition", "capability" or "condition" per trait. */
  readonly traitKinds: readonly string[];
  /** The skill a capability trains, or null, per trait. */
  readonly traitSkills: readonly (number | null)[];
  readonly affinityLabels: readonly string[];
  readonly pathLabels: readonly string[];
  /** The level titles of each path, in level order. */
  readonly levelTitles: readonly (readonly string[])[];
  readonly jobOptions: readonly AdminJobOption[];
  readonly limits: AdminLimits;
}

/** One row of the repetition labels the game already words. */
export interface RepeatedLabel { readonly key: string; readonly object: string; readonly activity: string }

/** Everything the tab reads, keyed by SimId; `main.ts` adapts the bridge's entity-keyed reads to it. */
export interface HousemateSource {
  library(): HousemateLibrary;
  adminPerson(sim: number): AdminPerson | null;
  adminRepetition(sim: number): AdminRepetition[];
  adminMoodlets(sim: number): AdminMoodlet[];
  adminTimers(sim: number): AdminTimer[];
  adminAffinities(sim: number): number[];
  /** The overall mood score, then each moodlet's, aligned with `moodLabels`. */
  moodScores(sim: number): readonly number[];
  /** The overall mood word, then each moodlet's label. */
  moodLabels(sim: number): readonly string[];
  /** Object and activity labels of the person's repetition rows, keyed `object:row`. */
  repeatedLabels(sim: number): readonly RepeatedLabel[];
  /** The word for each affinity value, in pack order. */
  affinityWords(sim: number): readonly string[] | null;
  skills(sim: number): readonly SkillStanding[] | null;
  /** Interleaved `[pack trait index, state]` pairs; a capability's state is its skill's mastery. */
  traits(sim: number): ArrayLike<number>;
  /** The shifts the person's level offers. */
  careerShifts(sim: number): readonly CareerShift[];
  skillPracticeFor(skill: number, level: number, fraction: number): number | null;
  clockTick(): number;
  dayTicks(): number;
  deathEnabled(): boolean;
}

function signed(score: number): string {
  const rounded = Math.round(score * 10) / 10;
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

/** A skill's standing as `level.hundredths`: level 2, 40% of the way to 3 reads 2.40. */
function skillValue(standing: SkillStanding, levels: number): number {
  if (standing.level >= levels) return levels;
  return standing.level + Math.min(99, Math.floor(standing.progress * 100 + 1e-4)) / 100;
}

/** A capability's percentage: rounded down, 100 only at full mastery, as the Traits panel words it. */
function masteryPercent(mastery: number): number {
  if (mastery >= 1) return 100;
  return Math.min(99, Math.floor(Math.max(0, mastery) * 100 + 1e-4));
}

/**
 * The label of each Repetition row. A row is named by its action; when two or
 * more rows share an action (two bookshelves, both "Read a book") each of them
 * also shows its object's name, and rows whose object names are identical too
 * are numbered in the order they appear.
 */
function repetitionNames(labels: readonly (RepeatedLabel | undefined)[], entries: readonly AdminRepetition[]): string[] {
  const actions = labels.map((label, index) => label?.activity ?? `${entries[index].object}:${entries[index].row}`);
  const count = (matches: (index: number) => boolean): number => actions.filter((_, index) => matches(index)).length;
  const seen = new Map<string, number>();
  return actions.map((activity, index) => {
    const object = labels[index]?.object;
    if (object === undefined || object === '' || count(other => actions[other] === activity) < 2) return activity;
    if (count(other => actions[other] === activity && labels[other]?.object === object) < 2) return W.repetitionRow(activity, object);
    const key = `${activity}
${object}`;
    const number = (seen.get(key) ?? 0) + 1;
    seen.set(key, number);
    return W.repetitionRowNumbered(activity, object, number);
  });
}

class HousemateTab implements AdminTab {
  readonly body: HTMLElement;
  private library: HousemateLibrary | null = null;

  private readonly needs: Section;
  private readonly satisfaction: Section;
  private readonly repetition: Section;
  private readonly mood: Section;
  private readonly likes: Section;
  private readonly skills: Section;
  private readonly traits: Section;
  private readonly career: Section;

  constructor(private readonly context: AdminTabContext, private readonly source: HousemateSource) {
    const doc = context.doc;
    this.needs = createSection(doc, W.needs, W.needsRange);
    this.satisfaction = createSection(doc, W.satisfaction, W.needsRange);
    // Mood to Career fold on a phone ([AP-web-phone]); Needs and Life satisfaction stay open.
    const fold = { foldable: true };
    this.repetition = createSection(doc, W.repetition, undefined, fold);
    this.mood = createSection(doc, W.mood, undefined, fold);
    this.likes = createSection(doc, W.likes, W.likesRange, fold);
    this.skills = createSection(doc, W.skills, undefined, fold);
    this.traits = createSection(doc, W.traits, undefined, fold);
    this.career = createSection(doc, W.career, undefined, fold);
    this.body = make(doc, 'div', 'admin-housemate admin-columns');
    const column = (...sections: Section[]): HTMLElement => {
      const node = make(doc, 'div', 'admin-column');
      node.append(...sections.map(section => section.root));
      return node;
    };
    this.body.append(
      column(this.needs, this.satisfaction, this.repetition),
      column(this.mood, this.likes),
      column(this.skills, this.traits, this.career),
    );
    // The phone layout folds the six sections; crossing the breakpoint folds or unfolds them.
    const compact = doc.defaultView?.matchMedia(COMPACT_HUD_MEDIA_QUERY);
    if (compact === undefined) {
      for (const section of this.folding) section.setFolding(false);
    } else {
      const fit = (): void => { for (const section of this.folding) section.setFolding(compact.matches); };
      compact.addEventListener('change', fit);
      fit();
    }
  }

  private get folding(): Section[] {
    return [this.repetition, this.mood, this.likes, this.skills, this.traits, this.career];
  }

  private get sections(): Section[] {
    return [this.needs, this.satisfaction, this.repetition, this.mood, this.likes, this.skills, this.traits, this.career];
  }

  refresh(): void {
    // Every re-read ends the statuses before it: a refusal is about the change just sent, which the
    // shell reports after this returns, and Undo or a new choice leaves no stale one behind.
    for (const section of this.sections) section.report(null);
    const member = this.context.selected();
    const person = member === null ? null : this.source.adminPerson(member.simId);
    if (member === null || person === null) {
      for (const section of this.sections) { section.body.replaceChildren(); section.actions.replaceChildren(); }
      return;
    }
    this.library ??= this.source.library();
    const library = this.library;
    this.renderNeeds(member.simId, member.name, person, library);
    this.renderSatisfaction(member.simId, person);
    this.renderRepetition(member.simId, member.name, library);
    this.renderMood(member.simId, member.name);
    this.renderLikes(member.simId, library);
    this.renderSkills(member.simId, library);
    this.renderTraits(member.simId, library);
    this.renderCareer(member.simId, person, library);
  }

  /** Sends one change under `section`'s status line. */
  private send(section: Section, edits: AdminEdit[], label: string): void {
    this.context.apply({ edits }, { label, report: section.report });
  }

  // ---- Needs ---------------------------------------------------------------

  private renderNeeds(sim: number, name: string, person: AdminPerson, library: HousemateLibrary): void {
    const doc = this.context.doc;
    const section = this.needs;
    const max = library.needMax;
    rebuild(doc, section.actions, section.heading, () => [actionButton(doc, {
      text: W.fillNeeds(name), key: 'fill-needs', intent: 'affirmative',
      disabled: person.needs.every(value => Math.round(value) >= max),
      onClick: () => this.send(section, person.needs.map((_, need) => ({ edit: 'SetNeed', sim, need, value: max })), undoLabels.fillNeeds),
    })]);
    rebuild(doc, section.body, section.heading, () => {
      const rows = person.needs.map((value, need) => sliderRow({
        doc, label: library.needNames[need] ?? `Need ${need + 1}`, key: `need-${need}`, min: 0, max, step: 1, decimals: 0, value,
        onCommit: next => this.send(section, [{ edit: 'SetNeed', sim, need, value: next }], undoLabels.need(library.needNames[need])),
      }).root);
      if (this.source.deathEnabled()) rows.push(textNode(doc, 'p', 'admin-note', W.deathNote));
      return rows;
    });
  }

  // ---- Life satisfaction ---------------------------------------------------

  private renderSatisfaction(sim: number, person: AdminPerson): void {
    const doc = this.context.doc;
    const section = this.satisfaction;
    rebuild(doc, section.body, section.heading, () => [sliderRow({
      doc, label: W.satisfactionRow, key: 'satisfaction', min: 0, max: 100, step: 1, decimals: 0, value: person.satisfaction,
      onCommit: value => this.send(section, [{ edit: 'SetSatisfaction', sim, value }], undoLabels.satisfaction),
    }, [textNode(doc, 'span', 'admin-word', describeSatisfaction(person.satisfaction)?.label ?? '')]).root]);
  }

  // ---- Repetition ----------------------------------------------------------

  private renderRepetition(sim: number, name: string, library: HousemateLibrary): void {
    const doc = this.context.doc;
    const section = this.repetition;
    const limits = library.limits;
    const entries = this.source.adminRepetition(sim);
    const labels = new Map(this.source.repeatedLabels(sim).map(row => [row.key, row]));
    section.setRange(W.repetitionRange(String(limits.habituationMax)));
    const over = entries.filter(entry => entry.value > limits.overdoingThreshold).length;
    section.setSummary(over > 0 ? W.overdoingCount(over) : '');
    rebuild(doc, section.actions, section.heading, () => entries.length === 0 ? [] : [actionButton(doc, {
      text: W.clearRepetition(name), key: 'clear-repetition',
      onClick: () => this.send(section, entries.map(entry => ({ edit: 'SetRepetition', sim, object: entry.object, row: entry.row, value: 0 })), undoLabels.clearRepetition),
    })]);
    rebuild(doc, section.body, section.heading, () => {
      if (entries.length === 0) return [textNode(doc, 'p', 'admin-note', W.noRepetition)];
      const names = repetitionNames(entries.map(entry => labels.get(`${entry.object}:${entry.row}`)), entries);
      return entries.map((entry, index) => {
        const label = labels.get(`${entry.object}:${entry.row}`);
        const activity = names[index];
        const words: string[] = [];
        if (entry.value > limits.overdoingThreshold) words.push(W.overdoing);
        if (entry.food && entry.value >= limits.sickThreshold) words.push(W.feelingSick);
        const extras = [textNode(doc, 'span', 'admin-word', words.join(', '))];
        const row = sliderRow({
          doc, label: activity, key: `repetition-${entry.object}-${entry.row}`, min: 0, max: limits.habituationMax, step: 0.01, decimals: 2, value: entry.value,
          onCommit: value => this.send(section, [{ edit: 'SetRepetition', sim, object: entry.object, row: entry.row, value }], undoLabels.repetition(activity)),
        }, extras).root;
        if (label !== undefined) row.setAttribute('title', label.object);
        return row;
      });
    });
  }

  // ---- Mood and moodlets ---------------------------------------------------

  private renderMood(sim: number, name: string): void {
    const doc = this.context.doc;
    const section = this.mood;
    const scores = Array.from(this.source.moodScores(sim));
    const labels = Array.from(this.source.moodLabels(sim));
    const rows = this.source.adminMoodlets(sim);
    const timers = this.source.adminTimers(sim);
    const aligned = scores.length > 0 && scores.length === labels.length && rows.length === scores.length - 1;
    const now = this.source.clockTick();
    const dayTicks = this.source.dayTicks();
    const members = this.context.members();
    section.setSummary(aligned ? W.moodSummary(labels[0], signed(scores[0])) : '');
    rebuild(doc, section.actions, section.heading, () => timers.length === 0 ? [] : [actionButton(doc, {
      text: W.endTimed(name), key: 'end-timed',
      onClick: () => this.send(section, timers.map(timer => ({ edit: 'EndTimedMoodlet', sim, timer: timer.timer })), undoLabels.endTimedMoodlets),
    })]);
    rebuild(doc, section.body, section.heading, () => {
      const nodes: HTMLElement[] = [];
      if (!aligned) return nodes;
      const overall = make(doc, 'div', 'admin-overall');
      overall.append(textNode(doc, 'span', 'admin-overall-label', W.moodOverall(labels[0])), textNode(doc, 'span', 'admin-score', signed(scores[0])));
      nodes.push(overall);
      rows.forEach((row, index) => {
        const label = labels[index + 1];
        const item = make(doc, 'div', 'admin-moodlet');
        item.append(textNode(doc, 'span', 'admin-moodlet-label', label));
        const why = this.moodSource(row, name, members, now, dayTicks);
        if (why !== '') item.append(textNode(doc, 'span', 'admin-moodlet-source', why));
        item.append(textNode(doc, 'span', 'admin-score', signed(scores[index + 1])));
        if (row.source.kind === 'timer') {
          const timer = row.source.timer;
          item.append(actionButton(doc, {
            text: W.endNow, key: `end-${timer}`, name: undoLabels.endMoodlet(label),
            onClick: () => this.send(section, [{ edit: 'EndTimedMoodlet', sim, timer }], undoLabels.endMoodlet(label)),
          }));
        }
        nodes.push(item);
      });
      return nodes;
    });
  }

  /** The short explanation beside a moodlet, or empty when its source has none. */
  private moodSource(row: AdminMoodlet, name: string, members: readonly { simId: number; name: string }[], now: number, dayTicks: number): string {
    const source = row.source;
    switch (source.kind) {
      case 'job': return W.fromJob;
      case 'bills': return W.fromBills;
      case 'feeling': {
        const other = members.find(member => member.simId === source.sim);
        return other === undefined ? '' : W.fromFeeling(name, other.name);
      }
      case 'timer': return W.endsIn(careerDurationWords(Math.max(0, source.endsTick - now) * 1440 / dayTicks));
      case 'other': return '';
    }
  }

  // ---- Likes and dislikes --------------------------------------------------

  private renderLikes(sim: number, library: HousemateLibrary): void {
    const doc = this.context.doc;
    const section = this.likes;
    const values = this.source.adminAffinities(sim);
    const words = this.source.affinityWords(sim);
    rebuild(doc, section.body, section.heading, () => values.map((value, kind) => sliderRow({
      doc, label: affinityRowLabel(library.affinityLabels[kind] ?? `Kind ${kind + 1}`), key: `affinity-${kind}`,
      min: -1, max: 1, step: 0.01, decimals: 2, value,
      onCommit: next => this.send(section, [{ edit: 'SetAffinity', sim, kind, value: next }], undoLabels.affinity(library.affinityLabels[kind])),
    }, [textNode(doc, 'span', 'admin-word', words?.[kind] ?? '')]).root));
  }

  // ---- Skills --------------------------------------------------------------

  private renderSkills(sim: number, library: HousemateLibrary): void {
    const doc = this.context.doc;
    const section = this.skills;
    const standings = this.source.skills(sim) ?? [];
    const top = Math.max(0, ...library.skillLevels);
    section.setRange(W.skillsRange(top));
    rebuild(doc, section.body, section.heading, () => standings.map((standing, skill) => {
      const levels = library.skillLevels[skill];
      const label = library.skillLabels[skill] ?? `Skill ${skill + 1}`;
      return sliderRow({
        doc, label, key: `skill-${skill}`, min: 0, max: levels, step: 0.01, decimals: 2, value: skillValue(standing, levels),
        onCommit: value => this.sendSkill(sim, skill, value, undoLabels.skill(label)),
      }).root;
    }));
  }

  /** Sends the practice that reads back as `value`: whole levels, then hundredths of the next. */
  private sendSkill(sim: number, skill: number, value: number, label: string): void {
    const hundredths = Math.round(value * 100);
    const practice = this.source.skillPracticeFor(skill, Math.floor(hundredths / 100), (hundredths % 100) / 100);
    if (practice === null) return;
    this.send(this.skills, [{ edit: 'SetSkillPractice', sim, skill, practice }], label);
  }

  // ---- Traits --------------------------------------------------------------

  private renderTraits(sim: number, library: HousemateLibrary): void {
    const doc = this.context.doc;
    const section = this.traits;
    const pairs = this.source.traits(sim);
    const worn: { index: number; state: number }[] = [];
    for (let at = 0; at + 1 < pairs.length; at += 2) worn.push({ index: pairs[at], state: pairs[at + 1] });
    const wornIndices = new Set(worn.map(trait => trait.index));
    const full = worn.length >= library.limits.maxTraits;
    rebuild(doc, section.body, section.heading, () => {
      const nodes: HTMLElement[] = worn.map(trait => this.traitRow(sim, trait, library));
      const options: SelectOption[] = [{ value: '', label: W.chooseTrait }];
      library.traitLabels.forEach((label, index) => { if (!wornIndices.has(index)) options.push({ value: String(index), label }); });
      const choose = selectControl({ doc, label: W.chooseTrait, key: 'trait-choose', options, value: '', onCommit: () => {} });
      const add = actionButton(doc, {
        text: W.add, key: 'trait-add', intent: 'affirmative', disabled: full,
        onClick: () => {
          if (choose.value === '') return;
          const index = Number(choose.value);
          this.send(section, [{ edit: 'AddTrait', sim, trait_index: index }], undoLabels.addTrait(library.traitLabels[index]));
        },
      });
      const row = make(doc, 'div', 'admin-row admin-trait-add');
      row.append(choose, add);
      nodes.push(row);
      if (full) nodes.push(textNode(doc, 'p', 'admin-note', W.fourTraits));
      return nodes;
    });
  }

  private traitRow(sim: number, trait: { index: number; state: number }, library: HousemateLibrary): HTMLElement {
    const doc = this.context.doc;
    const section = this.traits;
    const label = library.traitLabels[trait.index] ?? `Trait ${trait.index + 1}`;
    const kind = library.traitKinds[trait.index];
    const remove = actionButton(doc, {
      text: W.remove, key: `trait-${trait.index}-remove`, name: undoLabels.removeTrait(label), intent: 'destructive',
      onClick: () => this.send(section, [{ edit: 'RemoveTrait', sim, trait_index: trait.index }], undoLabels.removeTrait(label)),
    });
    if (kind === 'disposition') {
      const row = labelled(doc, label, textNode(doc, 'span', 'admin-word', W.noValue), remove);
      row.setAttribute('class', 'admin-row admin-trait-row');
      return row;
    }
    const skill = kind === 'capability' ? library.traitSkills[trait.index] ?? null : null;
    const percent = kind === 'capability' ? masteryPercent(trait.state) : Math.round(Math.min(1, Math.max(0, trait.state)) * 100);
    const control = sliderRow({
      doc, label, key: `trait-${trait.index}`, min: 0, max: 100, step: 1, decimals: 0, value: percent,
      onCommit: value => {
        const undo = undoLabels.trait(label);
        if (skill === null) {
          this.send(section, [{ edit: 'SetTraitState', sim, trait_index: trait.index, state: value / 100 }], undo);
          return;
        }
        // A capability is its skill: whole levels of the skill's ladder, then hundredths of the next.
        const levels = library.skillLevels[skill];
        const scaled = value * levels;
        const practice = this.source.skillPracticeFor(skill, Math.floor(scaled / 100), (scaled % 100) / 100);
        if (practice === null) return;
        this.send(section, [{ edit: 'SetSkillPractice', sim, skill, practice }], undo);
      },
    }, [textNode(doc, 'span', 'admin-word', kind === 'capability' ? W.learned : W.severe), remove]);
    control.root.setAttribute('class', `${control.root.getAttribute('class')} admin-trait-row`);
    return control.root;
  }

  // ---- Career --------------------------------------------------------------

  private renderCareer(sim: number, person: AdminPerson, library: HousemateLibrary): void {
    const doc = this.context.doc;
    const section = this.career;
    const dayTicks = this.source.dayTicks();
    const current = library.jobOptions.find(option => option.row === person.careerRow);
    section.setSummary(person.careerRow === null ? W.noJob : current === undefined ? '' : library.levelTitles[current.path]?.[current.level] ?? '');
    rebuild(doc, section.body, section.heading, () => {
      const nodes: HTMLElement[] = [];
      const jobs: SelectOption[] = [{ value: '', label: W.noJob }];
      for (const option of library.jobOptions) {
        const titles = library.levelTitles[option.path] ?? [];
        // A level that offers no shift cannot be held, so it cannot be chosen.
        jobs.push({
          value: String(option.row),
          label: W.jobOption(library.pathLabels[option.path] ?? '', titles[option.level] ?? '', option.level + 1, titles.length),
          disabled: option.firstShift === null,
        });
      }
      nodes.push(labelled(doc, W.job, selectControl({
        doc, label: W.job, key: 'job', options: jobs, value: person.careerRow === null ? '' : String(person.careerRow),
        onCommit: value => {
          if (value === '') {
            this.send(section, [{ edit: 'SetJob', sim, job: null, shift: 0 }], undoLabels.job);
            return;
          }
          // A new job starts at the first shift its level offers, with no draw.
          const shift = library.jobOptions.find(option => String(option.row) === value)?.firstShift;
          if (shift === undefined || shift === null) return;
          this.send(section, [{ edit: 'SetJob', sim, job: Number(value), shift }], undoLabels.job);
        },
      })));
      // The card's status line sits under the Job and Shift controls, next to the change that
      // a refusal is about, and not at the foot of a card that ends below the fold.
      if (person.careerRow === null) nodes.push(section.status);
      if (person.careerRow !== null) {
        const shifts = this.source.careerShifts(sim);
        const options: SelectOption[] = shifts.map(shift => ({
          value: String(shift.index),
          label: W.shiftOption(shiftName(shift.kind) ?? W.shift, formatTimeOfDay(shift.shiftStart % dayTicks, dayTicks),
            formatTimeOfDay((shift.shiftStart + shift.shiftTicks) % dayTicks, dayTicks)),
        }));
        nodes.push(labelled(doc, W.shift, selectControl({
          doc, label: W.shift, key: 'shift', options, value: String(person.shift),
          onCommit: value => this.send(section, [{ edit: 'SetShift', sim, shift: Number(value) }], undoLabels.shift),
        })));
        nodes.push(textNode(doc, 'p', 'admin-note', W.shiftNote));
        nodes.push(section.status);
        nodes.push(sliderRow({
          doc, label: W.pay, key: 'pay', min: person.payMin, max: person.payMax, step: 1, decimals: 0, value: person.pay,
          onCommit: dollars => this.send(section, [{ edit: 'SetPay', sim, dollars }], undoLabels.pay),
        }, [textNode(doc, 'span', 'admin-hint', W.payRange(person.payMin, person.payMax))]).root);
        nodes.push(sliderRow({
          doc, label: W.jobSatisfaction, key: 'job-satisfaction', min: 0, max: 100, step: 1, decimals: 0, value: person.jobSatisfaction,
          onCommit: value => this.send(section, [{ edit: 'SetJobSatisfaction', sim, value }], undoLabels.jobSatisfaction),
        }, [textNode(doc, 'span', 'admin-hint', W.ofHundred)]).root);
        nodes.push(numberRow({
          doc, label: W.goodWeeks, key: 'good-weeks', min: 0, max: person.advanceWeeks, step: 1, decimals: 0, value: person.goodWeeks,
          onCommit: weeks => this.send(section, [{ edit: 'SetGoodWeeks', sim, weeks }], undoLabels.goodWeeks),
        }, [textNode(doc, 'span', 'admin-hint', W.promotionHint(person.advanceWeeks))]).root);
        nodes.push(numberRow({
          doc, label: W.poorWeeks, key: 'poor-weeks', min: 0, max: library.limits.maxPoorWeeks, step: 1, decimals: 0, value: person.poorWeeks,
          onCommit: weeks => this.send(section, [{ edit: 'SetPoorWeeks', sim, weeks }], undoLabels.poorWeeks),
        }, [textNode(doc, 'span', 'admin-hint', W.poorHint)]).root);
      }
      // The flag is the person's own with or without a job, so it shows either way.
      nodes.push(checkRow(doc, {
        label: W.search, words: W.searchWords, key: 'search', checked: person.searching,
        onCommit: on => this.send(section, [{ edit: 'SetJobSearch', sim, on }], on ? undoLabels.searchOn : undoLabels.searchOff),
      }));
      return nodes;
    });
  }
}

/** The Housemate tab, for the shell's `tabs` map. */
export function createHousemateTab(source: HousemateSource): AdminTabFactory {
  return context => new HousemateTab(context, source);
}
