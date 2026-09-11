import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ActivityCueScheduler,
  CONVERSATION_REPEAT_TICKS,
  SLEEP_REPEAT_TICKS,
  type SimActivityAudioState,
} from '../src/audio/activity-cues.js';
import { EXERCISE_FRAME_TICKS } from '../src/frame.js';
import type {
  GameAudioEvent,
  GameAudioEventSink,
} from '../src/audio/audio-controller.js';

const SOURCE = readFileSync(
  new URL('../src/audio/activity-cues.ts', import.meta.url),
  'utf8',
);

function recordingSink(): GameAudioEventSink & {
  readonly events: GameAudioEvent[];
} {
  const events: GameAudioEvent[] = [];
  return {
    events,
    emit: (event) => events.push(event),
  };
}

function frame(
  scheduler: ActivityCueScheduler,
  observations: ReadonlyArray<readonly [number, SimActivityAudioState]>,
): void {
  scheduler.beginFrame();
  for (const [simId, activity] of observations) {
    scheduler.observe(simId, activity);
  }
  scheduler.endFrame();
}

describe('ActivityCueScheduler', () => {
  it('represents one conversation once instead of sounding once per participant', () => {
    const sink = recordingSink();
    const scheduler = new ActivityCueScheduler(sink);

    frame(scheduler, [
      [12, 'conversation'],
      [4, 'conversation'],
      [9, 'other'],
    ]);

    expect(sink.events).toEqual([
      { type: 'sim.conversation', simId: 4, phraseIndex: 0 },
    ]);
  });

  it('keeps conversation audible without repeating on every fixed tick', () => {
    const sink = recordingSink();
    const scheduler = new ActivityCueScheduler(sink);
    frame(scheduler, [[7, 'conversation']]);

    for (let tick = 1; tick < CONVERSATION_REPEAT_TICKS; tick += 1) {
      frame(scheduler, [[7, 'conversation']]);
    }
    expect(sink.events).toHaveLength(1);

    frame(scheduler, [[7, 'conversation']]);
    expect(sink.events).toEqual([
      { type: 'sim.conversation', simId: 7, phraseIndex: 0 },
      { type: 'sim.conversation', simId: 7, phraseIndex: 1 },
    ]);
  });

  it('uses a slower breathing cadence while any Sim remains asleep', () => {
    const sink = recordingSink();
    const scheduler = new ActivityCueScheduler(sink);
    frame(scheduler, [
      [8, 'sleep'],
      [3, 'sleep'],
    ]);

    for (let tick = 1; tick < SLEEP_REPEAT_TICKS; tick += 1) {
      frame(scheduler, [
        [8, 'sleep'],
        [3, 'sleep'],
      ]);
    }
    expect(sink.events).toEqual([
      { type: 'sim.sleep-breath', simId: 3, breathIndex: 0 },
    ]);

    frame(scheduler, [
      [8, 'sleep'],
      [3, 'sleep'],
    ]);
    expect(sink.events.at(-1)).toEqual({
      type: 'sim.sleep-breath',
      simId: 3,
      breathIndex: 1,
    });
  });

  it('starts a new phrase after silence and drops old cadence on reset', () => {
    const sink = recordingSink();
    const scheduler = new ActivityCueScheduler(sink);
    frame(scheduler, [[2, 'conversation']]);
    frame(scheduler, [[2, 'other']]);
    frame(scheduler, [[2, 'conversation']]);

    scheduler.reset();
    frame(scheduler, [[2, 'sleep']]);

    expect(sink.events).toEqual([
      { type: 'sim.conversation', simId: 2, phraseIndex: 0 },
      { type: 'sim.conversation', simId: 2, phraseIndex: 0 },
      { type: 'sim.sleep-breath', simId: 2, breathIndex: 0 },
    ]);
  });

  it('keeps eating, reading, and exercise cues independent per Sim', () => {
    const sink = recordingSink();
    const scheduler = new ActivityCueScheduler(sink);

    frame(scheduler, [
      [12, 'eating'],
      [4, 'reading'],
      [9, 'exercise'],
    ]);

    expect(sink.events).toEqual([
      { type: 'sim.eating', simId: 12, biteIndex: 0 },
      { type: 'sim.page-turn', simId: 4, pageIndex: 0 },
      { type: 'sim.exercise', simId: 9, repetitionIndex: 0 },
    ]);
  });

  it('keeps staggered eaters on independent cadence', () => {
    const sink = recordingSink();
    const scheduler = new ActivityCueScheduler(sink);

    frame(scheduler, [[1, 'eating']]);
    for (let tick = 1; tick <= 4; tick += 1) {
      frame(scheduler, [[1, 'eating']]);
    }
    frame(scheduler, [
      [1, 'eating'],
      [2, 'eating'],
    ]);
    for (let tick = 6; tick < 12; tick += 1) {
      frame(scheduler, [
        [1, 'eating'],
        [2, 'eating'],
      ]);
    }
    frame(scheduler, [
      [1, 'eating'],
      [2, 'eating'],
    ]);

    expect(sink.events).toEqual([
      { type: 'sim.eating', simId: 1, biteIndex: 0 },
      { type: 'sim.eating', simId: 2, biteIndex: 0 },
      { type: 'sim.eating', simId: 1, biteIndex: 1 },
    ]);

    for (let tick = 13; tick < 17; tick += 1) {
      frame(scheduler, [
        [1, 'eating'],
        [2, 'eating'],
      ]);
    }
    frame(scheduler, [
      [1, 'eating'],
      [2, 'eating'],
    ]);
    expect(sink.events.at(-1)).toEqual({
      type: 'sim.eating',
      simId: 2,
      biteIndex: 1,
    });
  });

  it.each([
    {
      activity: 'eating' as const,
      repeatTicks: 12,
      first: { type: 'sim.eating', simId: 6, biteIndex: 0 },
      second: { type: 'sim.eating', simId: 6, biteIndex: 1 },
    },
    {
      activity: 'reading' as const,
      repeatTicks: 28,
      first: { type: 'sim.page-turn', simId: 6, pageIndex: 0 },
      second: { type: 'sim.page-turn', simId: 6, pageIndex: 1 },
    },
    {
      activity: 'exercise' as const,
      repeatTicks: EXERCISE_FRAME_TICKS,
      first: { type: 'sim.exercise', simId: 6, repetitionIndex: 0 },
      second: { type: 'sim.exercise', simId: 6, repetitionIndex: 1 },
    },
  ])(
    'paces $activity without repeating it on every fixed tick',
    ({ activity, repeatTicks, first, second }) => {
      const sink = recordingSink();
      const scheduler = new ActivityCueScheduler(sink);

      frame(scheduler, [[6, activity]]);
      for (let tick = 1; tick < repeatTicks; tick += 1) {
        frame(scheduler, [[6, activity]]);
      }
      expect(sink.events).toEqual([first]);

      frame(scheduler, [[6, activity]]);
      expect(sink.events).toEqual([first, second]);
    },
  );

  it('starts a new personal cue when the action changes or resumes', () => {
    const sink = recordingSink();
    const scheduler = new ActivityCueScheduler(sink);

    frame(scheduler, [[3, 'eating']]);
    frame(scheduler, [[3, 'reading']]);
    frame(scheduler, []);
    frame(scheduler, [[3, 'eating']]);

    expect(sink.events).toEqual([
      { type: 'sim.eating', simId: 3, biteIndex: 0 },
      { type: 'sim.page-turn', simId: 3, pageIndex: 0 },
      { type: 'sim.eating', simId: 3, biteIndex: 0 },
    ]);
  });

  it('drops a retained personal cadence on lifecycle reset', () => {
    const sink = recordingSink();
    const scheduler = new ActivityCueScheduler(sink);

    frame(scheduler, [[3, 'eating']]);
    frame(scheduler, [[3, 'eating']]);
    scheduler.reset();
    frame(scheduler, [[3, 'eating']]);

    expect(sink.events).toEqual([
      { type: 'sim.eating', simId: 3, biteIndex: 0 },
      { type: 'sim.eating', simId: 3, biteIndex: 0 },
    ]);
  });

  it('retains typed-array personal tracks without per-Sim track objects', () => {
    const scheduler = new ActivityCueScheduler(recordingSink());
    frame(
      scheduler,
      Array.from({ length: 9 }, (_, simId) => [simId, 'eating'] as const),
    );

    expect(scheduler.activePersonalTrackCount()).toBe(9);
    expect(scheduler.personalTrackCapacity()).toBe(16);

    frame(scheduler, []);
    expect(scheduler.activePersonalTrackCount()).toBe(0);
    expect(scheduler.personalTrackCapacity()).toBe(16);
    expect(SOURCE).toMatch(/new Map<number, number>\(\)/);
    expect(SOURCE).not.toMatch(/Map<number, PersonalActivityTrack>/);
  });

  it('preserves the moved track cadence when dense removal fills a middle slot', () => {
    const sink = recordingSink();
    const scheduler = new ActivityCueScheduler(sink);
    frame(scheduler, [
      [1, 'eating'],
      [2, 'eating'],
      [3, 'eating'],
    ]);
    frame(scheduler, [
      [1, 'eating'],
      [2, 'eating'],
      [3, 'eating'],
    ]);
    frame(scheduler, [
      [2, 'other'],
      [1, 'eating'],
      [3, 'eating'],
    ]);

    for (let tick = 0; tick < 10; tick += 1) {
      frame(scheduler, [
        [1, 'eating'],
        [3, 'eating'],
      ]);
    }

    expect(scheduler.activePersonalTrackCount()).toBe(2);
    expect(sink.events).toEqual([
      { type: 'sim.eating', simId: 1, biteIndex: 0 },
      { type: 'sim.eating', simId: 2, biteIndex: 0 },
      { type: 'sim.eating', simId: 3, biteIndex: 0 },
      { type: 'sim.eating', simId: 1, biteIndex: 1 },
      { type: 'sim.eating', simId: 3, biteIndex: 1 },
    ]);
  });

  it('rejects observations outside a frame and duplicate Sim rows', () => {
    const scheduler = new ActivityCueScheduler(recordingSink());
    expect(() => scheduler.observe(1, 'sleep')).toThrow(
      'activity audio frame is not open',
    );
    expect(() => scheduler.endFrame()).toThrow(
      'activity audio frame is not open',
    );

    scheduler.beginFrame();
    scheduler.observe(1, 'sleep');
    expect(() => scheduler.observe(1, 'sleep')).toThrow(
      'duplicate activity sample for Sim 1',
    );
  });
});
