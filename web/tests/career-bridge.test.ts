import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';

let memory: WebAssembly.Memory;
beforeAll(async () => { memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory; });

describe('career release bridge', () => {
  it('reads the shipped worker, assigns, refuses, quits and reads the settings', () => {
    const handle = SimHandle.from_lot();
    try {
      const bridge = new SimBridge(handle, memory);
      const people = Array.from(bridge.ids()).filter((_, index) => bridge.kinds()[index] === 0);
      const worker = people.find(person => bridge.careerOf(person) !== null)!;
      expect(worker).toBeDefined();
      expect(bridge.careerPathLabels()).toEqual(['Office', 'Cafe', 'Night watch', 'Hospital', 'Warehouse', 'Library', 'Restaurant kitchen', 'Buses']);
      const report = bridge.careerReport(worker)!;
      expect(report).toMatchObject({ path: 0, level: 0, levels: 4, shifts: 0, mean: null, last: null, poor: 0, good: 0,
        warned: false, trend: 0, jobSatisfaction: 50, poorThreshold: 40, goodThreshold: 65 });
      expect(report.pay).toBe(report.payMin);
      expect(bridge.careerHistory(worker)).toEqual([]);
      const factors = bridge.careerFactors(worker)!;
      expect(Object.keys(factors)).toEqual(['fit', 'traitFit', 'socialCapacity', 'socialDemand', 'mastery', 'mood']);
      expect(bridge.careerReport(people.find(person => person !== worker)!)).toBeNull();
      expect(bridge.careerChangeAutonomy()).toBe(true);
      for (const person of people) expect(bridge.jobSearchOf(person)).toBe(true);
      expect(bridge.lastCareerResult()).toBeNull();

      expect(bridge.assignCareer(worker, 1)).toBe(true);
      handle.flush_commands();
      expect(bridge.lastCareerResult()).toEqual({ sequence: 1n, agent: worker, reason: null });
      expect(bridge.careerReport(worker)?.path).toBe(1);
      expect(bridge.careerOf(worker)).toBe('Lowly barista');
      expect(bridge.assignCareer(worker, 9)).toBe(true);
      handle.flush_commands();
      expect(bridge.lastCareerResult()).toEqual({ sequence: 2n, agent: worker, reason: 'That career path is not known.' });
      const furniture = Array.from(bridge.ids()).find((_, index) => bridge.kinds()[index] !== 0)!;
      expect(bridge.quitCareer(furniture)).toBe(true);
      handle.flush_commands();
      expect(bridge.lastCareerResult()).toEqual({ sequence: 3n, agent: furniture, reason: 'That person is no longer here.' });
      expect(bridge.quitCareer(worker)).toBe(true);
      handle.flush_commands();
      expect(bridge.lastCareerResult()).toEqual({ sequence: 4n, agent: worker, reason: null });
      expect(bridge.careerReport(worker)).toBeNull();
      expect(bridge.setCareerChangeAutonomy(false)).toBe(true);
      expect(bridge.setJobSearch(people[1], false)).toBe(true);
      handle.flush_commands();
      expect(bridge.careerChangeAutonomy()).toBe(false);
      expect(people.map(person => bridge.jobSearchOf(person))).toEqual(people.map((_, row) => row !== 1));
      expect(bridge.jobSearchOf(furniture)).toBeNull();
      const saved = handle.save_bytes();
      expect(handle.load_bytes(saved)).toBe(true);
      expect(bridge.careerChangeAutonomy()).toBe(false);
      expect(people.map(person => bridge.jobSearchOf(person))).toEqual(people.map((_, row) => row !== 1));
    } finally { handle.free(); }
  });
});

function fake(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: unknown[][] = [];
  const handle = {
    career_report: () => new Float64Array([0, 1, 4, 170, 160, 200, 2, 71.5, 80.25, 0, 2, 3, 58, 0, 1, 40, 65]),
    career_history: () => new Float64Array([0, 70, 0, 1, 82, 2]),
    career_factors: () => new Float64Array([0.4, 0.4, 0.7, 0.3, 0.25, -0.1]),
    career_path_labels: () => ['Office'],
    assign_career: (...args: unknown[]) => { calls.push(['assign', ...args]); return true; },
    quit_career: (...args: unknown[]) => { calls.push(['quit', ...args]); return true; },
    career_result_sequence: () => 4n,
    last_career_result: () => new Float64Array([7, 2]),
    career_change_autonomy: () => true,
    set_career_change_autonomy: (...args: unknown[]) => { calls.push(['change', ...args]); return true; },
    job_search_of: () => new Uint8Array([0]),
    set_job_search: (...args: unknown[]) => { calls.push(['search', ...args]); return true; },
    ...overrides,
  } as unknown as SimHandle;
  return { bridge: new SimBridge(handle, memory), calls };
}

describe('career bridge validation', () => {
  it('shapes a report, a history, the factors and a result', () => {
    const { bridge } = fake();
    expect(bridge.careerReport(3)).toEqual({ path: 0, level: 1, levels: 4, pay: 170, payMin: 160, payMax: 200, shifts: 2,
      mean: 71.5, last: 80.25, poor: 0, good: 2, advanceWeeks: 3, jobSatisfaction: 58, warned: false, trend: 1,
      poorThreshold: 40, goodThreshold: 65 });
    expect(bridge.careerHistory(3)).toEqual([{ week: 0, performance: 70, event: 0 }, { week: 1, performance: 82, event: 2 }]);
    expect(bridge.careerFactors(3)).toEqual({ fit: 0.4, traitFit: 0.4, socialCapacity: 0.7, socialDemand: 0.3, mastery: 0.25, mood: -0.1 });
    expect(bridge.lastCareerResult()).toEqual({ sequence: 4n, agent: 7, reason: 'Not while they are at work or on the way.' });
    expect(bridge.careerChangeAutonomy()).toBe(true);
    expect(bridge.jobSearchOf(3)).toBe(false);
  });

  it('preserves full u32 identities and bigint sequences without aliasing', () => {
    const wide = fake({
      career_report: () => new Float64Array([4000000001, 0, 1, 170, 160, 200, 2, 71.5, 80.25, 0, 2, 3, 100, 0, 1, 0, 100]),
      career_result_sequence: () => 9007199254740993n,
      last_career_result: () => new Float64Array([4000000002, 1]),
    });
    expect(wide.bridge.careerReport(4000000002)).toMatchObject({ path: 4000000001, levels: 1, jobSatisfaction: 100, poorThreshold: 0, goodThreshold: 100 });
    expect(wide.bridge.lastCareerResult()).toEqual({ sequence: 9007199254740993n, agent: 4000000002, reason: 'That person is no longer here.' });
    const { calls } = wide;
    expect(wide.bridge.assignCareer(4000000002, 4000000001)).toBe(true);
    expect(wide.bridge.setJobSearch(4000000002, true)).toBe(true);
    expect(wide.bridge.setCareerChangeAutonomy(false)).toBe(true);
    expect(calls).toEqual([['assign', 4000000002, 4000000001], ['search', 4000000002, true], ['change', false]]);
  });

  it('refuses malformed runtime values and invalid indices before narrowing them', () => {
    const { bridge, calls } = fake();
    for (const bad of [-1, 0.5, NaN, Infinity, 4294967296]) {
      expect(bridge.careerReport(bad)).toBeNull();
      expect(bridge.careerHistory(bad)).toEqual([]);
      expect(bridge.careerFactors(bad)).toBeNull();
      expect(bridge.assignCareer(bad, 0)).toBe(false);
      expect(bridge.assignCareer(0, bad)).toBe(false);
      expect(bridge.quitCareer(bad)).toBe(false);
      expect(bridge.jobSearchOf(bad)).toBeNull();
      expect(bridge.setJobSearch(bad, false)).toBe(false);
    }
    expect(calls).toEqual([]);
    const short = fake({ career_report: () => new Float64Array([1, 2]) });
    expect(short.bridge.careerReport(3)).toBeNull();
    const levelPastTop = fake({ career_report: () => new Float64Array([0, 4, 4, 170, 160, 200, 2, 71.5, 80.25, 0, 2, 3, 58, 0, 1, 40, 65]) });
    expect(levelPastTop.bridge.careerReport(3)).toBeNull();
    const payOutside = fake({ career_report: () => new Float64Array([0, 1, 4, 250, 160, 200, 2, 71.5, 80.25, 0, 2, 3, 58, 0, 1, 40, 65]) });
    expect(payOutside.bridge.careerReport(3)).toBeNull();
    const badTrend = fake({ career_report: () => new Float64Array([0, 1, 4, 170, 160, 200, 2, 71.5, 80.25, 0, 2, 3, 58, 0, 2, 40, 65]) });
    expect(badTrend.bridge.careerReport(3)).toBeNull();
    const fresh = fake({ career_report: () => new Float64Array([0, 0, 4, 120, 120, 150, 0, -1, -1, 0, 0, 2, 50, 1, -1, 40, 65]) });
    expect(fresh.bridge.careerReport(3)).toMatchObject({ mean: null, last: null, warned: true, trend: -1 });
    const halfSentinel = fake({ career_report: () => new Float64Array([0, 0, 4, 120, 120, 150, 0, -0.5, -1, 0, 0, 2, 50, 1, -1, 40, 65]) });
    expect(halfSentinel.bridge.careerReport(3)).toBeNull();
    const crossedThresholds = fake({ career_report: () => new Float64Array([0, 0, 4, 120, 120, 150, 0, -1, -1, 0, 0, 2, 50, 1, -1, 65, 40]) });
    expect(crossedThresholds.bridge.careerReport(3)).toBeNull();
    const pastScale = fake({ career_history: () => new Float64Array([0, 250, 0]) });
    expect(pastScale.bridge.careerHistory(3)).toEqual([]);
    const edges = fake({ career_history: () => new Float64Array([0, 0, 0, 1, 100, 2]) });
    expect(edges.bridge.careerHistory(3)).toEqual([{ week: 0, performance: 0, event: 0 }, { week: 1, performance: 100, event: 2 }]);
    const unordered = fake({ career_history: () => new Float64Array([1, 70, 0, 1, 82, 2]) });
    expect(unordered.bridge.careerHistory(3)).toEqual([]);
    const badEvent = fake({ career_history: () => new Float64Array([0, 70, 6]) });
    expect(badEvent.bridge.careerHistory(3)).toEqual([]);
    const ragged = fake({ career_history: () => new Float64Array([0, 70]) });
    expect(ragged.bridge.careerHistory(3)).toEqual([]);
    const noResult = fake({ career_result_sequence: () => 0n });
    expect(noResult.bridge.lastCareerResult()).toBeNull();
    const unknownReason = fake({ last_career_result: () => new Float64Array([7, 9]) });
    expect(unknownReason.bridge.lastCareerResult()).toBeNull();
    const badChange = fake({ career_change_autonomy: () => 1 });
    expect(badChange.bridge.careerChangeAutonomy()).toBeNull();
    for (const values of [[], [2], [1, 1]]) {
      const badSearch = fake({ job_search_of: () => new Uint8Array(values) });
      expect(badSearch.bridge.jobSearchOf(3)).toBeNull();
    }
  });
});

describe('shift bridge (issue 296, [WS-shell] item 6)', () => {
  it('validates the shift exports and commands', () => {
    const handle = SimHandle.from_lot();
    try {
      const bridge = new SimBridge(handle, memory);
      const people = Array.from(bridge.ids()).filter((_, index) => bridge.kinds()[index] === 0);
      const worker = people.find(person => bridge.careerOf(person) !== null)!;
      const idle = people.find(person => bridge.careerOf(person) === null)!;
      expect(bridge.careerScheduleOf(worker)).toEqual({ workingDays: 31, shiftStart: 360, shiftTicks: 480, kind: 0, index: 0 });
      expect(bridge.careerPathShifts(0)).toEqual([
        { index: 0, kind: 0, workingDays: 31, shiftStart: 360, shiftTicks: 480, weight: 19 },
        { index: 1, kind: 2, workingDays: 31, shiftStart: 720, shiftTicks: 480, weight: 1 },
      ]);
      expect(bridge.careerShiftsOf(worker)).toEqual(bridge.careerPathShifts(0));
      expect(bridge.careerShiftsOf(idle)).toEqual([]);
      expect(bridge.careerPathShifts(99)).toEqual([]);
      expect(bridge.changeShift(worker, 1)).toBe(true);
      handle.flush_commands();
      expect(bridge.lastCareerResult()).toMatchObject({ agent: worker, reason: null });
      expect(bridge.careerScheduleOf(worker)).toMatchObject({ shiftStart: 720, kind: 2, index: 1 });
      expect(bridge.changeShift(worker, 1)).toBe(true);
      handle.flush_commands();
      expect(bridge.lastCareerResult()?.reason).toBe('They already work that shift.');
      expect(bridge.changeShift(idle, 0)).toBe(true);
      handle.flush_commands();
      expect(bridge.lastCareerResult()?.reason).toBe('This person has no job.');
      expect(bridge.assignCareerShift(worker, 0, 9)).toBe(true);
      handle.flush_commands();
      expect(bridge.lastCareerResult()?.reason).toBe('That shift is not offered at this level.');
      expect(bridge.assignCareerShift(idle, 2, 1)).toBe(true);
      handle.flush_commands();
      expect(bridge.lastCareerResult()).toMatchObject({ agent: idle, reason: null });
      expect(bridge.careerScheduleOf(idle)).toMatchObject({ kind: 3, index: 1 });
      for (const bad of [-1, 0.5, NaN, Infinity, 4294967296]) {
        expect(bridge.careerPathShifts(bad)).toEqual([]);
        expect(bridge.careerShiftsOf(bad)).toEqual([]);
        expect(bridge.changeShift(bad, 0)).toBe(false);
        expect(bridge.changeShift(worker, bad)).toBe(false);
        expect(bridge.assignCareerShift(bad, 0, 0)).toBe(false);
        expect(bridge.assignCareerShift(worker, bad, 0)).toBe(false);
        expect(bridge.assignCareerShift(worker, 0, bad)).toBe(false);
      }
    } finally { handle.free(); }
  });

  it('drops an unnameable kind and refuses malformed shift lists', () => {
    const named = fake({ career_schedule_of: () => new Uint32Array([31, 360, 480, 7, 0]) });
    expect(named.bridge.careerScheduleOf(3)).toEqual({ workingDays: 31, shiftStart: 360, shiftTicks: 480, kind: null, index: 0 });
    expect(fake({ career_schedule_of: () => new Uint32Array([31, 360, 480]) }).bridge.careerScheduleOf(3)).toBeNull();
    const odd = fake({ career_path_shifts: () => new Uint32Array([0, 0, 360, 480, 31]) });
    expect(odd.bridge.careerPathShifts(0)).toEqual([]);
    const unweighted = fake({ career_path_shifts: () => new Uint32Array([0, 0, 360, 480, 31, 0]) });
    expect(unweighted.bridge.careerPathShifts(0)).toEqual([]);
    const repeated = fake({ career_path_shifts: () => new Uint32Array([0, 0, 360, 480, 31, 1, 0, 2, 720, 480, 31, 1]) });
    expect(repeated.bridge.careerPathShifts(0)).toEqual([]);
    const unnamed = fake({ career_shifts_of: () => new Uint32Array([1, 9, 720, 480, 31, 3]) });
    expect(unnamed.bridge.careerShiftsOf(3)).toEqual([
      { index: 1, kind: null, workingDays: 31, shiftStart: 720, shiftTicks: 480, weight: 3 },
    ]);
    const reasons = [[4, 'That shift is not offered at this level.'], [5, 'This person has no job.'],
      [6, 'They already work that shift.']] as const;
    for (const [code, text] of reasons) {
      expect(fake({ last_career_result: () => new Float64Array([7, code]) }).bridge.lastCareerResult()?.reason).toBe(text);
    }
    expect(fake({ last_career_result: () => new Float64Array([7, 9]) }).bridge.lastCareerResult()).toBeNull();
  });
});

describe('career tab bridge (issues 311 and 317, [CT-web])', () => {
  it('reads the Go to work status of each state', () => {
    const status = (values: number[]) => fake({ go_to_work_status: () => new Float64Array(values) }).bridge.goToWorkStatus(3);
    expect(status([0, 0, 0, 0])).toEqual({ state: 'none', startTick: null, endTick: null, opensTick: null });
    expect(status([1, 360, 840, 240])).toEqual({ state: 'due', startTick: 360, endTick: 840, opensTick: 240 });
    expect(status([2, 360, 840, 240])).toEqual({ state: 'late', startTick: 360, endTick: 840, opensTick: 240 });
    expect(status([3, 1800, 2280, 1680])).toEqual({ state: 'early', startTick: 1800, endTick: 2280, opensTick: 1680 });
    expect(status([3, 0, 0, 0])).toEqual({ state: 'early', startTick: null, endTick: null, opensTick: null });
    expect(status([4, 0, 840, 0])).toEqual({ state: 'atWork', startTick: null, endTick: 840, opensTick: null });
    expect(status([5, 0, 0, 0])).toEqual({ state: 'outbound', startTick: null, endTick: null, opensTick: null });
    expect(status([6, 0, 0, 0])).toEqual({ state: 'inbound', startTick: null, endTick: null, opensTick: null });
    // A shift whose window opened before tick 0 reads an opening of 0.
    expect(status([1, 60, 540, 0])).toEqual({ state: 'due', startTick: 60, endTick: 540, opensTick: 0 });
    // Large ticks keep exact whole numbers.
    expect(status([1, 4294967300, 4294967780, 4294967180]))
      .toEqual({ state: 'due', startTick: 4294967300, endTick: 4294967780, opensTick: 4294967180 });
  });

  it('refuses an unusable status and an invalid person', () => {
    const bad = [[], [1, 360, 840], [7, 0, 0, 0], [1.5, 360, 840, 240], [1, 360, 360, 240], [1, 360, 840, 400],
      [1, NaN, 840, 240], [1, -1, 840, 240], [1, 360, Infinity, 240], [0, 1, 0, 0], [3, 0, 0, 1], [4, 5, 840, 0],
      [5, 0, 1, 0], [4, 0, 0, 0], [3, 360, 0, 240], [2, 360, 840, 0.5]];
    for (const values of bad) {
      expect(fake({ go_to_work_status: () => new Float64Array(values) }).bridge.goToWorkStatus(3), String(values)).toBeNull();
    }
    const calls: string[] = [];
    const { bridge } = fake({
      go_to_work_status: () => { calls.push('status'); return new Float64Array([1, 360, 840, 240]); },
      go_to_work: () => { calls.push('work'); return true; },
    });
    for (const entity of [-1, 0.5, NaN, Infinity, 4294967296]) {
      expect(bridge.goToWorkStatus(entity)).toBeNull();
      expect(bridge.goToWork(entity)).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it('stages Go to work for a valid person', () => {
    const staged: unknown[][] = [];
    const recorded = fake({ go_to_work: (...args: unknown[]) => { staged.push(args); return true; } });
    expect(recorded.bridge.goToWork(4000000002)).toBe(true);
    expect(staged).toEqual([[4000000002]]);
    expect(fake({ go_to_work: () => false }).bridge.goToWork(3)).toBe(false);
  });

  const row = [3, 0, 0, 0, 5, 4, 0.5, 0.25, 0.75, 0.3, 0.125, -0.5, 30, 160];

  it('shapes the weekly input history, oldest week first', () => {
    const history = fake({ career_input_history: () => new Float64Array([...row, 4, 1, 0, 1, 5, 5, 0, 0, 1, 0.3, 0.5, 0.5, 0, 170]) });
    expect(history.bridge.careerInputHistory(3)).toEqual([
      { week: 3, career: 0, path: 0, level: 0, shifts: 5, attended: 4, fit: 0.5, traitFit: 0.25, socialCapacity: 0.75,
        socialDemand: 0.3, mastery: 0.125, mood: -0.5, missedMinutes: 30, pay: 160 },
      { week: 4, career: 1, path: 0, level: 1, shifts: 5, attended: 5, fit: 0, traitFit: 0, socialCapacity: 1,
        socialDemand: 0.3, mastery: 0.5, mood: 0.5, missedMinutes: 0, pay: 170 },
    ]);
    expect(fake({ career_input_history: () => new Float64Array() }).bridge.careerInputHistory(3)).toEqual([]);
  });

  it('refuses a malformed input history whole', () => {
    const edit = (at: number, value: number) => row.map((number, index) => (index === at ? value : number));
    const bad = [row.slice(0, 13), [...row, 1], edit(0, -1), edit(0, 1.5), edit(1, -1), edit(2, 0.5), edit(4, 0), edit(4, 15),
      edit(5, 6), edit(6, 1.5), edit(6, NaN), edit(7, Infinity), edit(8, -0.1), edit(8, 1.1), edit(9, NaN), edit(10, 2),
      edit(11, -1.5), edit(12, -1), edit(12, Infinity), edit(13, 1.5), edit(13, -1)];
    for (const values of bad) {
      expect(fake({ career_input_history: () => new Float64Array(values) }).bridge.careerInputHistory(3), String(values)).toEqual([]);
    }
    const repeated = [...row, ...row];
    expect(fake({ career_input_history: () => new Float64Array(repeated) }).bridge.careerInputHistory(3)).toEqual([]);
    const descending = [...edit(0, 4), ...row];
    expect(fake({ career_input_history: () => new Float64Array(descending) }).bridge.careerInputHistory(3)).toEqual([]);
    for (const entity of [-1, 0.5, NaN, Infinity, 4294967296]) {
      expect(fake().bridge.careerInputHistory(entity)).toEqual([]);
      expect(fake().bridge.careerLastShift(entity)).toBeNull();
    }
  });

  it('shapes the last shift and refuses an unusable one', () => {
    const last = (values: number[]) => fake({ career_last_shift: () => new Float64Array(values) }).bridge.careerLastShift(3);
    expect(last([-0.25, 0.5, 0.75, 0.125, 0.5, 45, 1]))
      .toEqual({ fit: -0.25, traitFit: 0.5, socialCapacity: 0.75, mastery: 0.125, mood: 0.5, missedMinutes: 45, attended: true });
    expect(last([0, 0, 0, 0, 0, 0, 0])).toMatchObject({ attended: false });
    expect(last([])).toBeNull();
    for (const values of [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 2], [1.5, 0, 0, 0, 0, 0, 1], [0, 0, 1.5, 0, 0, 0, 1],
      [0, 0, 0, -0.5, 0, 0, 1], [0, 0, 0, 0, 1.5, 0, 1], [0, 0, 0, 0, 0, -1, 1], [NaN, 0, 0, 0, 0, 0, 1], [0, Infinity, 0, 0, 0, 0, 1]]) {
      expect(last(values), String(values)).toBeNull();
    }
  });

  it('words the two new refusals, with the window from the knob', () => {
    const refusal = (code: number, window = 120) => fake({
      last_career_result: () => new Float64Array([7, code]),
      go_to_work_window_ticks: () => window,
    }).bridge.lastCareerResult()?.reason;
    expect(refusal(7)).toBe('Their next shift is more than two hours away.');
    expect(refusal(7, 60)).toBe('Their next shift is more than 1 hour away.');
    expect(refusal(7, 180)).toBe('Their next shift is more than 3 hours away.');
    expect(refusal(7, 45)).toBe('Their next shift is more than 45 minutes away.');
    expect(refusal(7, 90)).toBe('Their next shift is more than 90 minutes away.');
    expect(refusal(8)).toBe('They cannot find a way out to work.');
    expect(refusal(9)).toBeUndefined();
    for (const window of [0, -1, 1.5, NaN, Infinity]) {
      expect(fake({ last_career_result: () => new Float64Array([7, 7]), go_to_work_window_ticks: () => window })
        .bridge.lastCareerResult()).toBeNull();
    }
  });

  it('runs Go to work through the release wasm for the shipped worker', () => {
    const handle = SimHandle.from_lot();
    try {
      const bridge = new SimBridge(handle, memory);
      const people = Array.from(bridge.ids()).filter((_, index) => bridge.kinds()[index] === 0);
      const worker = people.find(person => bridge.careerOf(person) !== null)!;
      const idle = people.find(person => bridge.careerOf(person) === null)!;
      expect(bridge.goToWorkStatus(idle)).toEqual({ state: 'none', startTick: null, endTick: null, opensTick: null });
      expect(bridge.careerInputHistory(worker)).toEqual([]);
      expect(bridge.careerLastShift(worker)).toBeNull();
      const furniture = Array.from(bridge.ids()).find((_, index) => bridge.kinds()[index] !== 0)!;
      expect(bridge.goToWorkStatus(furniture)).toBeNull();
      // Early, or due if the game opens inside the window: follow events, not guessed ticks.
      let status = bridge.goToWorkStatus(worker)!;
      expect(['early', 'due']).toContain(status.state);
      expect(status.startTick! - status.opensTick!).toBe(120);
      if (status.state === 'early') {
        expect(bridge.goToWork(worker)).toBe(true);
        handle.flush_commands();
        expect(bridge.lastCareerResult()).toEqual({ sequence: 1n, agent: worker, reason: 'Their next shift is more than two hours away.' });
        for (let tick = 0; status.state === 'early'; tick += 1) {
          expect(tick).toBeLessThan(4000);
          handle.tick();
          status = bridge.goToWorkStatus(worker)!;
        }
      }
      expect(status.state).toBe('due');
      const funds = handle.funds();
      expect(bridge.goToWork(worker)).toBe(true);
      handle.flush_commands();
      expect(bridge.lastCareerResult()?.reason).toBeNull();
      expect(bridge.goToWorkStatus(worker)!.state).toBe('outbound');
      for (let tick = 0; bridge.goToWorkStatus(worker)!.state !== 'atWork'; tick += 1) {
        expect(tick).toBeLessThan(400);
        handle.tick();
      }
      expect(bridge.goToWorkStatus(worker)).toMatchObject({ state: 'atWork', endTick: status.endTick });
      for (let tick = 0; !['inbound', 'early'].includes(bridge.goToWorkStatus(worker)!.state); tick += 1) {
        expect(tick).toBeLessThan(1500);
        handle.tick();
      }
      expect(handle.funds()).toBeGreaterThan(funds);
    } finally { handle.free(); }
  });
});
