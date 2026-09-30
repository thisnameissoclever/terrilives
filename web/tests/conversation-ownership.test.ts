import { describe, expect, it } from 'vitest';
import { ActivityCueScheduler, type ActivityCueEvent } from '../src/audio/activity-cues.js';

const a = { owner: 31, endLow: 100, endHigh: 0, first: 1, second: 2 };
const b = { owner: 32, endLow: 100, endHigh: 0, first: 1, second: 2 };

function harness() {
  const events: ActivityCueEvent[] = [];
  const scheduler = new ActivityCueScheduler({ emit: (event) => events.push(event) });
  const frame = (...rows: Array<readonly [number, typeof a]>) => {
    scheduler.beginFrame();
    for (const [simId, voice] of rows) scheduler.observe(simId, 'conversation', voice);
    scheduler.endFrame();
  };
  return { events, frame, scheduler };
}

describe('conversation instance ownership', () => {
  it('distinguishes adjacent deadlines above the exact JavaScript integer range', () => {
    const { events, frame } = harness();
    const first = { ...a, endHigh: 0x20_0000, endLow: 0 };
    const second = { ...first, endLow: 1 };
    frame([31, first]);
    frame([31, second]);
    expect(events).toEqual([
      { type: 'sim.conversation-started', simId: 31, voice: first },
      { type: 'sim.conversation-ended', voice: first },
      { type: 'sim.conversation-started', simId: 31, voice: second },
    ]);
  });

  it('starts two simultaneous conversations once, independently of row order', () => {
    const { events, frame } = harness();
    frame([33, b], [34, a], [32, b], [31, a]);
    frame([31, a], [32, b], [34, a], [33, b]);
    expect(events).toEqual([
      { type: 'sim.conversation-started', simId: 31, voice: a },
      { type: 'sim.conversation-started', simId: 32, voice: b },
    ]);
  });

  it('does not restart a surviving pair when an unrelated pair starts or ends', () => {
    const { events, frame } = harness();
    frame([31, a], [34, a]);
    frame([31, a], [34, a], [32, b], [33, b]);
    frame([31, a], [34, a]);
    expect(events).toEqual([
      { type: 'sim.conversation-started', simId: 31, voice: a },
      { type: 'sim.conversation-started', simId: 32, voice: b },
      { type: 'sim.conversation-ended', voice: b },
    ]);
  });

  it.each([
    { ...a, endLow: 101 },
    { ...a, endHigh: 1 },
    { ...a, first: 2 },
    { ...a, second: 3 },
    b,
  ])('starts a replacement when any authoritative identity component changes: %j', (next) => {
    const { events, frame } = harness();
    frame([31, a], [34, a]);
    frame([31, next], [34, next]);
    expect(events).toEqual([
      { type: 'sim.conversation-started', simId: 31, voice: a },
      { type: 'sim.conversation-ended', voice: a },
      { type: 'sim.conversation-started', simId: next.owner, voice: next },
    ]);
  });
});
