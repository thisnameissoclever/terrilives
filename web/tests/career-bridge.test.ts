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
      expect(bridge.careerPathLabels()).toEqual(['Office', 'Cafe', 'Night watch']);
      expect(bridge.careerLevelTitles(0)[0]).toBe('Office clerk');
      expect(bridge.careerLevelTitles(7)).toEqual([]);
      const report = bridge.careerReport(worker)!;
      expect(report).toMatchObject({ path: 0, level: 0, levels: 4, shifts: 0, mean: null, last: null, poor: 0, good: 0,
        warned: false, trend: 0, jobSatisfaction: 50, poorThreshold: 40, goodThreshold: 65 });
      expect(report.pay).toBe(report.payMin);
      expect(bridge.careerHistory(worker)).toEqual([]);
      const factors = bridge.careerFactors(worker)!;
      expect(Object.keys(factors)).toEqual(['fit', 'traitFit', 'socialCapacity', 'socialDemand', 'mastery', 'mood']);
      expect(bridge.careerReport(people.find(person => person !== worker)!)).toBeNull();
      expect(bridge.careerAutonomy()).toEqual({ change: true, search: true });
      expect(bridge.lastCareerResult()).toBeNull();

      expect(bridge.assignCareer(worker, 1)).toBe(true);
      handle.flush_commands();
      expect(bridge.lastCareerResult()).toEqual({ sequence: 1n, agent: worker, reason: null });
      expect(bridge.careerReport(worker)?.path).toBe(1);
      expect(bridge.careerOf(worker)).toBe('Lowly barista');
      expect(bridge.assignCareer(worker, 9)).toBe(true);
      handle.flush_commands();
      expect(bridge.lastCareerResult()).toEqual({ sequence: 2n, agent: worker, reason: 'That career path is not known.' });
      expect(bridge.quitCareer(worker)).toBe(true);
      handle.flush_commands();
      expect(bridge.lastCareerResult()).toEqual({ sequence: 3n, agent: worker, reason: null });
      expect(bridge.careerReport(worker)).toBeNull();
      expect(bridge.setCareerAutonomy(false, true)).toBe(true);
      handle.flush_commands();
      expect(bridge.careerAutonomy()).toEqual({ change: false, search: true });
      const saved = handle.save_bytes();
      expect(handle.load_bytes(saved)).toBe(true);
      expect(bridge.careerAutonomy()).toEqual({ change: false, search: true });
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
    career_level_titles: () => ['Office clerk'],
    assign_career: (...args: unknown[]) => { calls.push(['assign', ...args]); return true; },
    quit_career: (...args: unknown[]) => { calls.push(['quit', ...args]); return true; },
    career_result_sequence: () => 4n,
    last_career_result: () => new Float64Array([7, 2]),
    career_autonomy: () => new Uint8Array([1, 0]),
    set_career_autonomy: (...args: unknown[]) => { calls.push(['autonomy', ...args]); return true; },
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
    expect(bridge.careerAutonomy()).toEqual({ change: true, search: false });
  });

  it('refuses malformed runtime values and invalid indices before narrowing them', () => {
    const { bridge, calls } = fake();
    for (const bad of [-1, 0.5, NaN, Infinity, 4294967296]) {
      expect(bridge.careerReport(bad)).toBeNull();
      expect(bridge.careerHistory(bad)).toEqual([]);
      expect(bridge.careerFactors(bad)).toBeNull();
      expect(bridge.careerLevelTitles(bad)).toEqual([]);
      expect(bridge.assignCareer(bad, 0)).toBe(false);
      expect(bridge.assignCareer(0, bad)).toBe(false);
      expect(bridge.quitCareer(bad)).toBe(false);
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
    const badSettings = fake({ career_autonomy: () => new Uint8Array([2, 0]) });
    expect(badSettings.bridge.careerAutonomy()).toBeNull();
  });
});
