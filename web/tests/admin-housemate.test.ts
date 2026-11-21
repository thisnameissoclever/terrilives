import { describe, expect, it } from 'vitest';
import type { CareerShift, SkillStanding } from '../src/bridge.js';
import type {
  AdminJobOption, AdminMoodlet, AdminPerson, AdminRepetition, AdminTimer,
} from '../src/admin/codec.js';
import { createHousemateTab, type HousemateLibrary, type HousemateSource } from '../src/admin/admin-housemate.js';
import type { AdminMember } from '../src/admin/admin-panel.js';
import { COMPACT_HUD_MEDIA_QUERY } from '../src/ui/compact-hud.js';
import { enter, finders, release, tabHarness } from './helpers/admin-tab.js';

// The Housemate tab ([AP-e-housemate], [T10] in docs/specs/2026-11-20-admin-panel.md):
// every control sends the change the plan lists, inside the range it shows,
// shows a refusal in the section that sent it, and reads the world again after
// every change.

const NEED_NAMES = ['Hunger', 'Energy', 'Hygiene', 'Bladder', 'Social', 'Fun', 'Comfort'];

const LIBRARY: HousemateLibrary = {
  needNames: NEED_NAMES,
  needMax: 100,
  skillLabels: ['Cooking', 'Fitness', 'Reading'],
  skillLevels: [10, 10, 10],
  traitLabels: ["Can't cook", 'Low spirits', 'Bookworm', 'Night owl', 'Clumsy', 'Tidy'],
  traitKinds: ['capability', 'condition', 'disposition', 'disposition', 'capability', 'condition'],
  traitSkills: [0, null, null, null, null, null],
  affinityLabels: ['plants', 'aquarium', 'television', 'radio'],
  pathLabels: ['Office', 'Kitchen'],
  levelTitles: [['Junior clerk', 'Senior clerk', 'Manager'], ['Dishwasher', 'Cook']],
  jobOptions: [
    { path: 0, level: 0, row: 0, firstShift: 0 }, { path: 0, level: 1, row: 1, firstShift: 0 }, { path: 0, level: 2, row: 2, firstShift: null },
    { path: 1, level: 0, row: 7, firstShift: 0 }, { path: 1, level: 1, row: 8, firstShift: 2 },
  ] satisfies AdminJobOption[],
  limits: {
    habituationMax: 3, overdoingThreshold: 1, sickThreshold: 2.5, maxTraits: 4, maxPoorWeeks: 15,
    skipMaxHours: 168, skipDefaultHours: 8, skipTicksPerFrame: 300,
  },
};

const SHIFTS: CareerShift[] = [
  { index: 0, kind: 0, workingDays: 31, shiftStart: 360, shiftTicks: 480, weight: 1 },
  { index: 1, kind: 2, workingDays: 31, shiftStart: 720, shiftTicks: 480, weight: 1 },
];

const MEMBERS: AdminMember[] = [{ simId: 3, name: 'Tim' }, { simId: 5, name: 'Bill' }];

interface World {
  person: AdminPerson;
  repetition: AdminRepetition[];
  moodlets: AdminMoodlet[];
  timers: AdminTimer[];
  moodScores: number[];
  moodLabels: string[];
  affinities: number[];
  words: string[];
  skills: SkillStanding[];
  traits: number[];
  now: number;
  death: boolean;
  labels: { key: string; object: string; activity: string }[];
}

function timLike(): World {
  return {
    person: {
      needs: [62, 28, 70, 55, 48, 66, 80], satisfaction: 54, careerRow: 1, shift: 0, pay: 252, jobSatisfaction: 68,
      goodWeeks: 1, poorWeeks: 0, searching: true, advanceWeeks: 3, payMin: 240, payMax: 300,
    },
    repetition: [
      { object: 4, row: 1, value: 1.2, food: true },
      { object: 9, row: 0, value: 0.4, food: false },
    ],
    moodlets: [
      { source: { kind: 'timer', timer: 2, endsTick: 1000 + 840 }, score: 12 },
      { source: { kind: 'job' }, score: 6 },
      { source: { kind: 'feeling', sim: 5 }, score: 3.4 },
      { source: { kind: 'need', need: 1, critical: false, level: 40 }, score: -12 },
      { source: { kind: 'bills' }, score: -8 },
      { source: { kind: 'other' }, score: 1 },
    ],
    timers: [{ timer: 2, endsTick: 1840 }],
    moodScores: [-8.6, 12, 6, 3.4, -12, -8, 1],
    moodLabels: ['Okay', 'Promoted', 'Enjoys the job', 'Comforted by Bill', 'Tired', 'Behind on bills', 'Pleasant'],
    affinities: [0.35, -0.1, 0.72, -0.45],
    words: ['Likes', 'Indifferent', 'Loves', 'Dislikes'],
    skills: [
      { level: 2, progress: 0.4, mastery: 0.24 },
      { level: 0, progress: 0.6, mastery: 0.06 },
      { level: 10, progress: 0, mastery: 1 },
    ],
    // Pairs: [trait index, state]. A capability's state is its skill's mastery.
    traits: [0, 0.24, 1, 0.6, 2, 0],
    now: 1000,
    death: false,
    labels: [
      { key: '4:1', object: 'Fridge', activity: 'Grab a snack' },
      { key: '9:0', object: 'Shelf', activity: 'Read a book' },
    ],
  };
}

interface Built {
  h: ReturnType<typeof tabHarness>;
  f: ReturnType<typeof finders>;
  worlds: Map<number, World>;
  /** The practice the fake `skillPracticeFor` was asked about. */
  asked: [number, number, number][];
}

function build(worlds: Map<number, World> = new Map([[3, timLike()], [5, timLike()]]), compact = false): Built {
  const h = tabHarness(MEMBERS);
  if (compact) h.fake.media.add(COMPACT_HUD_MEDIA_QUERY);
  const asked: [number, number, number][] = [];
  const get = (sim: number): World => worlds.get(sim)!;
  const source: HousemateSource = {
    library: () => LIBRARY,
    adminPerson: sim => (worlds.has(sim) ? { ...get(sim).person } : null),
    adminRepetition: sim => get(sim).repetition.map(row => ({ ...row })),
    adminMoodlets: sim => get(sim).moodlets.slice(),
    adminTimers: sim => get(sim).timers.slice(),
    adminAffinities: sim => get(sim).affinities.slice(),
    moodScores: sim => get(sim).moodScores.slice(),
    moodLabels: sim => get(sim).moodLabels.slice(),
    repeatedLabels: sim => get(sim).labels.slice(),
    affinityWords: sim => get(sim).words.slice(),
    skills: sim => get(sim).skills.map(row => ({ ...row })),
    traits: sim => Float32Array.from(get(sim).traits),
    careerShifts: () => SHIFTS,
    // A readable stand-in: level hundreds plus the fraction in tens, so a test sees what was asked.
    skillPracticeFor: (skill, level, fraction) => { asked.push([skill, level, fraction]); return skill * 1000 + level * 10 + fraction; },
    clockTick: () => get(3).now,
    dayTicks: () => 1440,
    deathEnabled: () => get(3).death,
  };
  const tab = h.attach(createHousemateTab(source)(h.context));
  expect(tab.body).toBeDefined();
  return { h, f: finders(tab.body), worlds, asked };
}

const edits = (built: Built, at = -1) => built.h.sent.at(at)!.change.edits;
const labelOf = (built: Built, at = -1) => built.h.sent.at(at)!.label;

describe('Needs and life satisfaction', () => {
  it('shows the seven needs by name at the world values, 0 to 100', () => {
    const b = build();
    NEED_NAMES.forEach((name, need) => {
      expect(b.f.box(name).value).toBe(String([62, 28, 70, 55, 48, 66, 80][need]));
      expect(b.f.control(name).getAttribute('type') ?? (b.f.control(name) as { type: string }).type).toBe('range');
    });
    expect(b.f.section('Needs').querySelector('.admin-range')!.textContent).toBe('0 to 100');
    const hunger = b.f.control('Hunger') as unknown as { min: string; max: string; step: string };
    expect([hunger.min, hunger.max, hunger.step]).toEqual(['0', '100', '1']);
  });

  it('sends one SetNeed when a slider is released, never while it moves', () => {
    const b = build();
    const slider = b.f.control('Energy');
    slider.value = '45';
    slider.dispatch('input');
    expect(b.h.sent, 'dragging sends nothing').toEqual([]);
    expect(b.f.box('Energy').value, 'the box follows the drag').toBe('45');
    slider.dispatch('change');
    expect(edits(b)).toEqual([{ edit: 'SetNeed', sim: 3, need: 1, value: 45 }]);
    expect(labelOf(b)).toBe('Change Energy');
    expect(b.h.sent).toHaveLength(1);
  });

  it('clamps a typed number to the range and shows the clamped value', () => {
    const b = build();
    enter(b.f.box('Hunger'), '250');
    expect(edits(b)).toEqual([{ edit: 'SetNeed', sim: 3, need: 0, value: 100 }]);
    enter(b.f.box('Hunger'), '-5');
    expect(edits(b, 1)).toEqual([{ edit: 'SetNeed', sim: 3, need: 0, value: 0 }]);
    expect(b.f.box('Hunger').value).toBe('62');
  });

  it('rounds a typed need to a whole number and sends nothing for text, an empty box or no change', () => {
    const b = build();
    enter(b.f.box('Fun'), '70.6');
    expect(edits(b)).toEqual([{ edit: 'SetNeed', sim: 3, need: 5, value: 71 }]);
    const before = b.h.sent.length;
    enter(b.f.box('Fun'), 'lots');
    enter(b.f.box('Fun'), '');
    expect(b.f.box('Fun').value).toBe('66');
    enter(b.f.box('Fun'), '66');
    expect(b.h.sent).toHaveLength(before);
  });

  it('fills every need to the maximum as one change', () => {
    const b = build();
    b.f.button("Fill Tim's needs").click();
    expect(edits(b)).toEqual(NEED_NAMES.map((_, need) => ({ edit: 'SetNeed', sim: 3, need, value: 100 })));
    expect(labelOf(b)).toBe('Fill needs');
    expect(b.h.sent).toHaveLength(1);
  });

  it('disables Fill while every need is already full', () => {
    const world = timLike();
    world.person = { ...world.person, needs: Array(7).fill(100) };
    const b = build(new Map([[3, world], [5, timLike()]]));
    expect((b.f.button("Fill Tim's needs") as unknown as { disabled: boolean }).disabled).toBe(true);
  });

  it('warns about death only while death is on', () => {
    const off = build();
    expect(off.f.text()).not.toContain('count toward death');
    const world = timLike();
    world.death = true;
    const on = build(new Map([[3, world], [5, timLike()]]));
    expect(on.f.text()).toContain('At 0, Hunger and Energy count toward death.');
  });

  it('sends life satisfaction with its band word', () => {
    const b = build();
    expect(b.f.section('Life satisfaction').textContent).toContain('Content');
    release(b.f.control('Satisfaction'), '81');
    expect(edits(b)).toEqual([{ edit: 'SetSatisfaction', sim: 3, value: 81 }]);
    expect(labelOf(b)).toBe('Change life satisfaction');
  });
});

describe('Repetition', () => {
  it('lists each entry by its activity with the range from tuning and the Overdoing word above the threshold', () => {
    const b = build();
    expect(b.f.section('Repetition').querySelector('.admin-range')!.textContent).toBe('0 to 3');
    expect(b.f.box('Grab a snack').value).toBe('1.20');
    expect(b.f.box('Read a book').value).toBe('0.40');
    const rows = b.f.section('Repetition').querySelectorAll('.admin-slider-row');
    expect(rows[0].textContent).toContain('Overdoing');
    expect(rows[1].textContent).not.toContain('Overdoing');
    const max = (b.f.control('Grab a snack') as unknown as { max: string }).max;
    expect(max).toBe('3');
  });

  it('adds Feeling sick only for a food row at the sick threshold', () => {
    const world = timLike();
    world.repetition = [
      { object: 4, row: 1, value: 2.6, food: true },
      { object: 9, row: 0, value: 2.9, food: false },
      { object: 5, row: 2, value: 2.4, food: true },
    ];
    world.labels = [
      { key: '4:1', object: 'Fridge', activity: 'Grab a snack' },
      { key: '9:0', object: 'Shelf', activity: 'Read a book' },
      { key: '5:2', object: 'Stove', activity: 'Cook dinner' },
    ];
    const b = build(new Map([[3, world], [5, timLike()]]));
    const rows = b.f.section('Repetition').querySelectorAll('.admin-slider-row');
    expect(rows[0].textContent).toContain('Feeling sick');
    expect(rows[1].textContent).not.toContain('Feeling sick');
    expect(rows[2].textContent).not.toContain('Feeling sick');
    expect(rows[1].textContent).toContain('Overdoing');
  });

  it('names the object on rows that share an action label, and leaves unique rows alone', () => {
    const world = timLike();
    world.repetition = [
      { object: 9, row: 0, value: 1.1, food: false },
      { object: 12, row: 0, value: 0.7, food: false },
      { object: 4, row: 1, value: 0.4, food: true },
    ];
    world.labels = [
      { key: '9:0', object: 'Bookshelf', activity: 'Read a book' },
      { key: '12:0', object: 'Tall bookcase', activity: 'Read a book' },
      { key: '4:1', object: 'Fridge', activity: 'Grab a snack' },
    ];
    const b = build(new Map([[3, world], [5, timLike()]]));
    expect(b.f.has('Read a book (Bookshelf)')).toBe(true);
    expect(b.f.has('Read a book (Tall bookcase)')).toBe(true);
    expect(b.f.has('Read a book')).toBe(false);
    expect(b.f.has('Grab a snack')).toBe(true);
    enter(b.f.box('Read a book (Tall bookcase)'), '0.5');
    expect(edits(b)).toEqual([{ edit: 'SetRepetition', sim: 3, object: 12, row: 0, value: 0.5 }]);
    expect(labelOf(b)).toBe('Change repetition: Read a book (Tall bookcase)');
  });

  it('numbers rows in the order they appear when the object names are also identical', () => {
    const world = timLike();
    world.repetition = [
      { object: 9, row: 0, value: 1.1, food: false },
      { object: 4, row: 1, value: 0.4, food: true },
      { object: 12, row: 0, value: 0.7, food: false },
    ];
    world.labels = [
      { key: '9:0', object: 'Bookshelf', activity: 'Read a book' },
      { key: '4:1', object: 'Fridge', activity: 'Grab a snack' },
      { key: '12:0', object: 'Bookshelf', activity: 'Read a book' },
    ];
    const b = build(new Map([[3, world], [5, timLike()]]));
    expect(b.f.has('Read a book (Bookshelf 1)')).toBe(true);
    expect(b.f.has('Read a book (Bookshelf 2)')).toBe(true);
    expect(b.f.has('Grab a snack')).toBe(true);
    enter(b.f.box('Read a book (Bookshelf 2)'), '0.5');
    expect(edits(b)).toEqual([{ edit: 'SetRepetition', sim: 3, object: 12, row: 0, value: 0.5 }]);
  });

  it('sends SetRepetition for the entry, and 0 to remove it', () => {
    const b = build();
    enter(b.f.box('Grab a snack'), '0.5');
    expect(edits(b)).toEqual([{ edit: 'SetRepetition', sim: 3, object: 4, row: 1, value: 0.5 }]);
    expect(labelOf(b)).toBe('Change repetition: Grab a snack');
    enter(b.f.box('Read a book'), '0');
    expect(edits(b)).toEqual([{ edit: 'SetRepetition', sim: 3, object: 9, row: 0, value: 0 }]);
  });

  it('clamps a typed repetition to the tuning maximum', () => {
    const b = build();
    enter(b.f.box('Grab a snack'), '9');
    expect(edits(b)).toEqual([{ edit: 'SetRepetition', sim: 3, object: 4, row: 1, value: 3 }]);
  });

  it('clears every entry as one change, and with none shows a note and no Clear button', () => {
    const b = build();
    b.f.button("Clear Tim's repetition").click();
    expect(edits(b)).toEqual([
      { edit: 'SetRepetition', sim: 3, object: 4, row: 1, value: 0 },
      { edit: 'SetRepetition', sim: 3, object: 9, row: 0, value: 0 },
    ]);
    expect(labelOf(b)).toBe('Clear repetition');
    const world = timLike();
    world.repetition = [];
    const none = build(new Map([[3, world], [5, timLike()]]));
    expect(none.f.section('Repetition').textContent).toContain('No repetition.');
    expect(none.f.hasButton("Clear Tim's repetition")).toBe(false);
  });
});

describe('Mood and timed moodlets', () => {
  it('shows the overall mood and every moodlet with its source and score', () => {
    const b = build();
    const text = b.f.section('Mood and moodlets').textContent;
    expect(text).toContain('Mood Okay');
    expect(text).toContain('-8.6');
    expect(text).toContain('Promoted');
    expect(text).toContain('+12');
    expect(text).toContain('From job satisfaction');
    expect(text).toContain("From Tim's feeling about Bill");
    expect(text).toContain('From Energy below 40');
    expect(text).toContain('While a bill is overdue');
    expect(text).toContain('Pleasant');
  });

  it('words the time left on a timed moodlet and ends it with End now', () => {
    const b = build();
    expect(b.f.section('Mood and moodlets').textContent).toContain('Ends in 14 hours');
    b.f.button('End now').click();
    expect(edits(b)).toEqual([{ edit: 'EndTimedMoodlet', sim: 3, timer: 2 }]);
    expect(labelOf(b)).toBe('End Promoted');
  });

  it('ends every running timer as one change, and hides the button when none runs', () => {
    const world = timLike();
    world.timers = [{ timer: 1, endsTick: 2000 }, { timer: 2, endsTick: 1840 }];
    const b = build(new Map([[3, world], [5, timLike()]]));
    b.f.button("End Tim's timed moodlets").click();
    expect(edits(b)).toEqual([{ edit: 'EndTimedMoodlet', sim: 3, timer: 1 }, { edit: 'EndTimedMoodlet', sim: 3, timer: 2 }]);
    expect(labelOf(b)).toBe('End timed moodlets');
    const quiet = timLike();
    quiet.timers = [];
    quiet.moodlets = [{ source: { kind: 'job' }, score: 6 }];
    quiet.moodScores = [6, 6];
    quiet.moodLabels = ['Good', 'Enjoys the job'];
    const none = build(new Map([[3, quiet], [5, timLike()]]));
    expect(none.f.hasButton("End Tim's timed moodlets")).toBe(false);
    expect(none.f.hasButton('End now')).toBe(false);
  });

  it('draws no moodlet rows when the labels and the sources do not line up', () => {
    const world = timLike();
    world.moodLabels = ['Okay', 'Promoted'];
    const b = build(new Map([[3, world], [5, timLike()]]));
    expect(b.f.section('Mood and moodlets').textContent).not.toContain('Promoted');
  });
});

describe('Likes and dislikes', () => {
  it('shows one slider from -1 to 1 per affinity kind with its word', () => {
    const b = build();
    expect(b.f.section('Likes and dislikes').querySelector('.admin-range')!.textContent).toBe('-1 to 1');
    const plants = b.f.control('Plants') as unknown as { min: string; max: string; step: string };
    expect([plants.min, plants.max, plants.step]).toEqual(['-1', '1', '0.01']);
    expect(b.f.box('Plants').value).toBe('0.35');
    const rows = b.f.section('Likes and dislikes').querySelectorAll('.admin-slider-row');
    expect(rows.map(row => row.querySelector('.admin-word')!.textContent)).toEqual(['Likes', 'Indifferent', 'Loves', 'Dislikes']);
  });

  it('sends SetAffinity for the kind in pack order, clamped to the range', () => {
    const b = build();
    release(b.f.control('Television'), '0.1');
    expect(edits(b)).toEqual([{ edit: 'SetAffinity', sim: 3, kind: 2, value: 0.1 }]);
    expect(labelOf(b)).toBe('Change liking for television');
    enter(b.f.box('Radio'), '-4');
    expect(edits(b)).toEqual([{ edit: 'SetAffinity', sim: 3, kind: 3, value: -1 }]);
  });
});

describe('Skills', () => {
  it('shows each skill as level and hundredths, from 0 to its top level', () => {
    const b = build();
    expect(b.f.section('Skills').querySelector('.admin-range')!.textContent).toBe('Level 0 to 10');
    expect(b.f.box('Cooking').value).toBe('2.40');
    expect(b.f.box('Fitness').value).toBe('0.60');
    expect(b.f.box('Reading').value).toBe('10.00');
  });

  it('sends the practice that reads back as the typed level and fraction', () => {
    const b = build();
    enter(b.f.box('Fitness'), '3.25');
    expect(b.asked.at(-1)).toEqual([1, 3, 0.25]);
    expect(edits(b)).toEqual([{ edit: 'SetSkillPractice', sim: 3, skill: 1, practice: 1000 + 30 + 0.25 }]);
    expect(labelOf(b)).toBe('Change Fitness');
    enter(b.f.box('Cooking'), '99');
    expect(b.asked.at(-1), 'clamped to the top level with no fraction').toEqual([0, 10, 0]);
  });
});

describe('Traits', () => {
  it('shows a capability and a condition with a value, a disposition without one', () => {
    const b = build();
    expect(b.f.box("Can't cook").value).toBe('24');
    expect(b.f.box('Low spirits').value).toBe('60');
    expect(b.f.has('Bookworm value')).toBe(false);
    const text = b.f.section('Traits').textContent;
    expect(text).toContain('how far learned');
    expect(text).toContain('how severe');
    expect(text).toContain('No value to set');
  });

  it("edits a capability through the skill it trains, as the skill's level and fraction", () => {
    const b = build();
    enter(b.f.box("Can't cook"), '35');
    // 35 percent of a ten level ladder is level 3 and half of the next.
    expect(b.asked.at(-1)).toEqual([0, 3, 0.5]);
    expect(edits(b)).toEqual([{ edit: 'SetSkillPractice', sim: 3, skill: 0, practice: 0 + 30 + 0.5 }]);
    expect(labelOf(b)).toBe("Change Can't cook");
    enter(b.f.box("Can't cook"), '100');
    expect(b.asked.at(-1)).toEqual([0, 10, 0]);
  });

  it('falls back to the trait state for a capability whose tag names no skill', () => {
    const world = timLike();
    world.traits = [4, 0.5];
    const b = build(new Map([[3, world], [5, timLike()]]));
    enter(b.f.box('Clumsy'), '80');
    expect(edits(b)).toEqual([{ edit: 'SetTraitState', sim: 3, trait_index: 4, state: 0.8 }]);
  });

  it('sends a condition as a state from 0 to 1', () => {
    const b = build();
    release(b.f.control('Low spirits'), '25');
    expect(edits(b)).toEqual([{ edit: 'SetTraitState', sim: 3, trait_index: 1, state: 0.25 }]);
    expect(labelOf(b)).toBe('Change Low spirits');
  });

  it('removes a worn trait', () => {
    const b = build();
    b.f.control('Remove Bookworm').click();
    expect(edits(b)).toEqual([{ edit: 'RemoveTrait', sim: 3, trait_index: 2 }]);
    expect(labelOf(b)).toBe('Remove Bookworm');
  });

  it('offers only the traits not yet worn and adds the chosen one', () => {
    const b = build();
    const choose = b.f.control('Choose a trait to add');
    const offered = (choose as unknown as { options: { value: string; textContent: string }[] }).options;
    expect(offered.map(option => option.textContent)).toEqual(['Choose a trait to add', 'Night owl', 'Clumsy', 'Tidy']);
    b.f.button('Add').click();
    expect(b.h.sent, 'nothing chosen, nothing sent').toEqual([]);
    choose.value = '5';
    b.f.button('Add').click();
    expect(edits(b)).toEqual([{ edit: 'AddTrait', sim: 3, trait_index: 5 }]);
    expect(labelOf(b)).toBe('Add Tidy');
  });

  it('disables Add at four traits and says why', () => {
    const world = timLike();
    world.traits = [0, 0.2, 1, 0.5, 2, 0, 3, 0];
    const b = build(new Map([[3, world], [5, timLike()]]));
    expect((b.f.button('Add') as unknown as { disabled: boolean }).disabled).toBe(true);
    expect(b.f.section('Traits').textContent).toContain('Four traits at most.');
    const three = build();
    expect((three.f.button('Add') as unknown as { disabled: boolean }).disabled).toBe(false);
    expect(three.f.section('Traits').textContent).not.toContain('Four traits at most.');
  });

  it('shows a refusal in the traits section only, and a later success clears it', () => {
    const b = build();
    b.h.state.refuse = 7;
    (b.f.control('Choose a trait to add') as unknown as { value: string }).value = '5';
    b.f.button('Add').click();
    expect(b.f.status('Traits')).toBe('Four traits at most. Remove one first.');
    expect(b.f.status('Needs')).toBe('');
    expect(b.f.status('Career')).toBe('');
    b.h.state.refuse = null;
    b.f.control('Remove Bookworm').click();
    expect(b.f.status('Traits')).toBe('');
  });
});

describe('Career', () => {
  it('shows every field with its bounds and hints while the person has a job', () => {
    const b = build();
    expect(b.f.box('Pay per shift').value).toBe('252');
    const pay = b.f.control('Pay per shift') as unknown as { min: string; max: string };
    expect([pay.min, pay.max]).toEqual(['240', '300']);
    const good = b.f.box('Good weeks in a row') as unknown as { max: string; value: string };
    expect([good.max, good.value]).toEqual(['3', '1']);
    const poor = b.f.box('Poor weeks in a row') as unknown as { max: string };
    expect(poor.max).toBe('15');
    const text = b.f.section('Career').textContent;
    for (const words of ['$240 to $300', 'of 100', '3 earns a promotion', '2 brings a warning. 3 or more risk being fired.',
      'Takes effect tomorrow.', 'Looks for work on their own']) expect(text).toContain(words);
  });

  it('words the jobs by path, title and level, and the shifts by name and hours', () => {
    const b = build();
    const jobs = (b.f.control('Job') as unknown as { options: { value: string; textContent: string }[] }).options;
    expect(jobs.map(option => option.textContent)).toEqual([
      'No job', 'Office: Junior clerk (level 1 of 3)', 'Office: Senior clerk (level 2 of 3)', 'Office: Manager (level 3 of 3)',
      'Kitchen: Dishwasher (level 1 of 2)', 'Kitchen: Cook (level 2 of 2)',
    ]);
    expect(b.f.control('Job').value).toBe('1');
    const shifts = (b.f.control('Shift') as unknown as { options: { textContent: string }[] }).options;
    expect(shifts.map(option => option.textContent)).toEqual(['Day shift, 06:00 to 14:00', 'Late shift, 12:00 to 20:00']);
  });

  it('sets a job by its career row with the first shift the level offers, and No job as null with shift 0', () => {
    const b = build();
    enter(b.f.control('Job'), '7');
    expect(edits(b)).toEqual([{ edit: 'SetJob', sim: 3, job: 7, shift: 0 }]);
    expect(labelOf(b)).toBe('Change job');
    enter(b.f.control('Job'), '8');
    expect(edits(b)).toEqual([{ edit: 'SetJob', sim: 3, job: 8, shift: 2 }]);
    enter(b.f.control('Job'), '');
    expect(edits(b)).toEqual([{ edit: 'SetJob', sim: 3, job: null, shift: 0 }]);
  });

  it('cannot pick a level that offers no shift', () => {
    const b = build();
    const jobs = (b.f.control('Job') as unknown as { options: { value: string; disabled: boolean }[] }).options;
    expect(jobs.filter(option => option.disabled).map(option => option.value)).toEqual(['2']);
  });

  it('shows only the job, and the search box, while the person has no job', () => {
    const world = timLike();
    world.person = { ...world.person, careerRow: null, shift: 0, pay: 0, jobSatisfaction: 0, goodWeeks: 0, poorWeeks: 0, advanceWeeks: 0, payMin: 0, payMax: 0 };
    const b = build(new Map([[3, world], [5, timLike()]]));
    expect(b.f.control('Job').value).toBe('');
    for (const name of ['Shift', 'Pay per shift', 'Job satisfaction', 'Good weeks in a row', 'Poor weeks in a row']) {
      expect(b.f.has(name), name).toBe(false);
    }
    expect(b.f.section('Career').textContent).not.toContain('Takes effect tomorrow.');
    expect(b.f.has('Job search')).toBe(true);
  });

  it('sends each job field as its own change', () => {
    const b = build();
    enter(b.f.control('Shift'), '1');
    expect(edits(b)).toEqual([{ edit: 'SetShift', sim: 3, shift: 1 }]);
    expect(labelOf(b)).toBe('Change shift');
    enter(b.f.box('Pay per shift'), '999');
    expect(edits(b)).toEqual([{ edit: 'SetPay', sim: 3, dollars: 300 }]);
    release(b.f.control('Job satisfaction'), '30');
    expect(edits(b)).toEqual([{ edit: 'SetJobSatisfaction', sim: 3, value: 30 }]);
    enter(b.f.box('Good weeks in a row'), '9');
    expect(edits(b)).toEqual([{ edit: 'SetGoodWeeks', sim: 3, weeks: 3 }]);
    expect(labelOf(b)).toBe('Change good weeks');
    enter(b.f.box('Poor weeks in a row'), '40');
    expect(edits(b)).toEqual([{ edit: 'SetPoorWeeks', sim: 3, weeks: 15 }]);
    expect(labelOf(b)).toBe('Change poor weeks');
  });

  it('turns the job search on and off', () => {
    const b = build();
    const box = b.f.control('Job search') as unknown as { checked: boolean };
    box.checked = false;
    (box as never as { dispatch(type: string): void }).dispatch('change');
    expect(edits(b)).toEqual([{ edit: 'SetJobSearch', sim: 3, on: false }]);
    expect(labelOf(b)).toBe('Turn job search off');
    box.checked = true;
    (box as never as { dispatch(type: string): void }).dispatch('change');
    expect(labelOf(b)).toBe('Turn job search on');
  });

  it('shows the at work refusal in place', () => {
    const b = build();
    b.h.state.refuse = 6;
    enter(b.f.control('Shift'), '1');
    expect(b.f.status('Career')).toBe('They are at work or on the way. Change the job when they are home.');
    expect(b.f.status('Traits')).toBe('');
  });

  it('puts the status line directly under the Job and Shift controls, not at the end of the card', () => {
    const b = build();
    b.h.state.refuse = 6;
    enter(b.f.control('Job'), '0');
    expect(b.f.status('Career')).toBe('They are at work or on the way. Change the job when they are home.');
    const body = b.f.section('Career').querySelector('.admin-section-body')!;
    const holds = (label: string) => body.nodes.findIndex(node => node.all().some(inner => inner.getAttribute('aria-label') === label));
    const status = body.nodes.findIndex(node => node.className.includes('admin-status'));
    expect(status, 'the status line is inside the career body').toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(holds('Job'));
    expect(status).toBeGreaterThan(holds('Shift'));
    expect(status, 'before the pay row').toBeLessThan(holds('Pay per shift'));
    expect(status, 'before the job search row').toBeLessThan(holds('Job search'));
    expect(b.f.section('Career').nodes.at(-1)!.className, 'not left at the foot of the card').not.toContain('admin-status');
  });

  it('keeps the status line under the Job control for a person without a job', () => {
    const b = build(new Map([[3, { ...timLike(), person: { ...timLike().person, careerRow: null } }]]));
    b.h.state.refuse = 6;
    enter(b.f.control('Job'), '0');
    const body = b.f.section('Career').querySelector('.admin-section-body')!;
    const holds = (label: string) => body.nodes.findIndex(node => node.all().some(inner => inner.getAttribute('aria-label') === label));
    const status = body.nodes.findIndex(node => node.className.includes('admin-status'));
    expect(status).toBe(holds('Job') + 1);
    expect(status).toBeLessThan(holds('Job search'));
  });
});

describe('Reading the world again', () => {
  it('shows the new value after a change applies and the old one after a refusal', () => {
    const worlds = new Map([[3, timLike()], [5, timLike()]]);
    const b = build(worlds);
    b.h.state.onApply = change => {
      const edit = change.edits[0];
      if (edit.edit === 'SetNeed') {
        const world = worlds.get(3)!;
        world.person = { ...world.person, needs: world.person.needs.map((value, need) => (need === edit.need ? edit.value : value)) };
      }
    };
    enter(b.f.box('Hunger'), '20');
    expect(b.f.box('Hunger').value).toBe('20');
    b.h.state.refuse = 3;
    enter(b.f.box('Hunger'), '90');
    expect(b.f.box('Hunger').value, 'the refused change is not kept').toBe('20');
    expect(b.f.status('Needs')).toBe('That value is outside the allowed range.');
  });

  it("shows the chosen person's values and clears refusals when the choice changes", () => {
    const worlds = new Map([[3, timLike()], [5, timLike()]]);
    worlds.get(5)!.person = { ...worlds.get(5)!.person, needs: [1, 2, 3, 4, 5, 6, 7] };
    const b = build(worlds);
    b.h.state.refuse = 3;
    enter(b.f.box('Hunger'), '90');
    expect(b.f.status('Needs')).not.toBe('');
    b.h.state.selected = MEMBERS[1];
    b.h.state.tab!.refresh();
    expect(b.f.box('Hunger').value).toBe('1');
    expect(b.f.status('Needs')).toBe('');
    expect(b.f.hasButton("Fill Bill's needs")).toBe(true);
    b.h.state.refuse = null;
    enter(b.f.box('Hunger'), '50');
    expect(edits(b)).toEqual([{ edit: 'SetNeed', sim: 5, need: 0, value: 50 }]);
  });

  it('shows nothing when no housemate is chosen', () => {
    const b = build();
    b.h.state.selected = null;
    b.h.state.tab!.refresh();
    expect(b.f.has('Hunger')).toBe(false);
  });
});

describe('Focus', () => {
  it('keeps focus on the control that sent the change', () => {
    const b = build();
    const box = b.f.box('Hunger');
    box.focus();
    enter(box, '30');
    expect(b.h.fake.activeElement).toBe(b.f.box('Hunger'));
  });

  it("moves focus to the section's heading when the focused control goes away", () => {
    const b = build();
    b.f.control('Remove Bookworm').focus();
    b.h.state.onApply = () => {};
    // The world drops the trait, so its Remove button is gone after the re-read.
    b.h.state.onApply = () => { (b.worlds.get(3)!).traits = [0, 0.24, 1, 0.6]; };
    b.f.control('Remove Bookworm').click();
    const heading = b.f.section('Traits').querySelector('.admin-section-title')!;
    expect(b.h.fake.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });
});

describe('Folding sections on a phone', () => {
  const FOLDED = ['Mood and moodlets', 'Repetition', 'Likes and dislikes', 'Skills', 'Traits', 'Career'];
  const OPEN = ['Needs', 'Life satisfaction'];
  const folded = (b: Built, title: string) => b.f.section(title);

  it('starts the six sections closed on a phone, with Needs and Life satisfaction open', () => {
    const b = build(undefined, true);
    for (const title of FOLDED) {
      expect(folded(b, title).tagName, title).toBe('details');
      expect(folded(b, title).open, title).toBe(false);
    }
    for (const title of OPEN) expect(b.f.section(title).tagName, title).toBe('section');
  });

  it('keeps every section open, and unfoldable, on a desktop', () => {
    const b = build();
    for (const title of FOLDED) expect(folded(b, title).open, title).toBe(true);
    // The summary does nothing there: a click is cancelled before it can close the section.
    const summary = folded(b, 'Skills').querySelector('summary')!;
    expect(summary.dispatch('click').defaultPrevented).toBe(true);
  });

  it('lets a phone player open a section by its summary', () => {
    const b = build(undefined, true);
    const summary = folded(b, 'Skills').querySelector('summary')!;
    expect(summary.dispatch('click').defaultPrevented).toBe(false);
  });

  it('says what is inside Mood, Repetition and Career in one line each', () => {
    const b = build(undefined, true);
    const line = (title: string) => folded(b, title).querySelector('.admin-section-summary')!.textContent;
    expect(line('Mood and moodlets')).toBe('Okay, -8.6');
    expect(line('Repetition')).toBe('1 overdoing');
    expect(line('Career')).toBe('Senior clerk');
    for (const title of ['Likes and dislikes', 'Skills', 'Traits']) expect(line(title), title).toBe('');
  });

  it('words the summaries from what the world holds now', () => {
    const worlds = new Map([[3, timLike()], [5, timLike()]]);
    const b = build(worlds, true);
    const line = (title: string) => folded(b, title).querySelector('.admin-section-summary')!.textContent;
    const tim = worlds.get(3)!;
    tim.repetition = [{ object: 4, row: 1, value: 0.2, food: false }, { object: 9, row: 0, value: 1.6, food: false }, { object: 9, row: 1, value: 1.7, food: false }];
    tim.person = { ...tim.person, careerRow: null };
    b.h.state.tab!.refresh();
    expect(line('Repetition')).toBe('2 overdoing');
    expect(line('Career')).toBe('No job');
    tim.repetition = [];
    b.h.state.tab!.refresh();
    expect(line('Repetition')).toBe('');
  });

  it('keeps each section open or closed across a re-read, an edit and Undo', () => {
    const b = build(undefined, true);
    folded(b, 'Skills').open = true;
    folded(b, 'Career').open = true;
    release(b.f.control('Hunger'), '90');
    expect(folded(b, 'Skills').open).toBe(true);
    expect(folded(b, 'Career').open).toBe(true);
    expect(folded(b, 'Traits').open).toBe(false);
    expect(folded(b, 'Mood and moodlets').open).toBe(false);
  });

  it('folds and unfolds when the window crosses the compact breakpoint', () => {
    const b = build();
    b.h.fake.setMedia(COMPACT_HUD_MEDIA_QUERY, true);
    for (const title of FOLDED) expect(folded(b, title).open, title).toBe(false);
    b.h.fake.setMedia(COMPACT_HUD_MEDIA_QUERY, false);
    for (const title of FOLDED) expect(folded(b, title).open, title).toBe(true);
  });
});
