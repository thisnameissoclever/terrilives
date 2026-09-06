import { describe, expect, it } from 'vitest';

import {
  ActivityCueScheduler,
  CONVERSATION_REPEAT_TICKS,
  SLEEP_REPEAT_TICKS,
  type SimActivityAudioState,
} from '../src/audio/activity-cues.js';
import type {
  GameAudioEvent,
  GameAudioEventSink,
} from '../src/audio/audio-controller.js';

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
