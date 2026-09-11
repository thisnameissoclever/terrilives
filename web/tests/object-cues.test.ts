import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  OBJECT_SOUND_ACTION_SHOWER_WATER,
  OBJECT_SOUND_ACTION_STOVE_COOKING,
  ObjectSoundCueScheduler,
  type ObjectSoundCueEvent,
} from '../src/audio/object-cues.js';

function scheduler(events: ObjectSoundCueEvent[]): ObjectSoundCueScheduler {
  return new ObjectSoundCueScheduler({ emit: (event) => events.push(event) });
}

function frame(
  cues: ObjectSoundCueScheduler,
  observations: ReadonlyArray<readonly [number, number]>,
): void {
  cues.beginFrame();
  for (const [sourceId, action] of observations) cues.observe(sourceId, action);
  cues.endFrame();
}

describe('ObjectSoundCueScheduler', () => {
  it('emits one start edge, no unchanged replay, and one stop edge', () => {
    const events: ObjectSoundCueEvent[] = [];
    const cues = scheduler(events);

    frame(cues, [[44, OBJECT_SOUND_ACTION_SHOWER_WATER]]);
    frame(cues, [[44, OBJECT_SOUND_ACTION_SHOWER_WATER]]);
    frame(cues, []);

    expect(events).toEqual([
      {
        type: 'object.sound-started',
        sourceId: 44,
        action: OBJECT_SOUND_ACTION_SHOWER_WATER,
      },
      {
        type: 'object.sound-stopped',
        sourceId: 44,
        action: OBJECT_SOUND_ACTION_SHOWER_WATER,
      },
    ]);
  });

  it('collapses multiple Sims observing the same source and action', () => {
    const events: ObjectSoundCueEvent[] = [];
    const cues = scheduler(events);

    frame(cues, [
      [73, OBJECT_SOUND_ACTION_STOVE_COOKING],
      [73, OBJECT_SOUND_ACTION_STOVE_COOKING],
    ]);

    expect(events).toEqual([
      {
        type: 'object.sound-started',
        sourceId: 73,
        action: OBJECT_SOUND_ACTION_STOVE_COOKING,
      },
    ]);
    expect(cues.activeTrackCount()).toBe(1);
  });

  it('stops the old action before starting a changed action', () => {
    const events: ObjectSoundCueEvent[] = [];
    const cues = scheduler(events);
    frame(cues, [[18, OBJECT_SOUND_ACTION_SHOWER_WATER]]);

    frame(cues, [[18, OBJECT_SOUND_ACTION_STOVE_COOKING]]);

    expect(events.slice(1)).toEqual([
      {
        type: 'object.sound-stopped',
        sourceId: 18,
        action: OBJECT_SOUND_ACTION_SHOWER_WATER,
      },
      {
        type: 'object.sound-started',
        sourceId: 18,
        action: OBJECT_SOUND_ACTION_STOVE_COOKING,
      },
    ]);
  });

  it('fails a conflicting source closed without depending on row order', () => {
    const events: ObjectSoundCueEvent[] = [];
    const cues = scheduler(events);
    frame(cues, [[31, OBJECT_SOUND_ACTION_SHOWER_WATER]]);

    frame(cues, [
      [31, OBJECT_SOUND_ACTION_SHOWER_WATER],
      [31, OBJECT_SOUND_ACTION_STOVE_COOKING],
    ]);

    expect(events).toEqual([
      {
        type: 'object.sound-started',
        sourceId: 31,
        action: OBJECT_SOUND_ACTION_SHOWER_WATER,
      },
      {
        type: 'object.sound-stopped',
        sourceId: 31,
        action: OBJECT_SOUND_ACTION_SHOWER_WATER,
      },
    ]);

    frame(cues, [[31, OBJECT_SOUND_ACTION_STOVE_COOKING]]);
    expect(events.at(-1)).toEqual({
      type: 'object.sound-started',
      sourceId: 31,
      action: OBJECT_SOUND_ACTION_STOVE_COOKING,
    });

    const reverseEvents: ObjectSoundCueEvent[] = [];
    const reverse = scheduler(reverseEvents);
    frame(reverse, [
      [31, OBJECT_SOUND_ACTION_STOVE_COOKING],
      [31, OBJECT_SOUND_ACTION_SHOWER_WATER],
    ]);
    expect(reverseEvents).toEqual([]);
  });

  it('resets silently and treats the next observation as a fresh start', () => {
    const events: ObjectSoundCueEvent[] = [];
    const cues = scheduler(events);
    frame(cues, [[9, OBJECT_SOUND_ACTION_SHOWER_WATER]]);

    cues.reset();
    frame(cues, [[9, OBJECT_SOUND_ACTION_SHOWER_WATER]]);

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.type === 'object.sound-started')).toBe(
      true,
    );
  });

  it('ignores sentinels, invalid ids, and unknown actions', () => {
    const events: ObjectSoundCueEvent[] = [];
    const cues = scheduler(events);

    frame(cues, [
      [0xffff_ffff, OBJECT_SOUND_ACTION_SHOWER_WATER],
      [-1, OBJECT_SOUND_ACTION_SHOWER_WATER],
      [2.5, OBJECT_SOUND_ACTION_SHOWER_WATER],
      [4, 0],
      [5, 99],
    ]);

    expect(events).toEqual([]);
    expect(cues.activeTrackCount()).toBe(0);
  });

  it('enforces one complete frame at a time', () => {
    const cues = scheduler([]);

    expect(() => cues.observe(1, OBJECT_SOUND_ACTION_SHOWER_WATER)).toThrow(
      'object sound frame is not open',
    );
    cues.beginFrame();
    expect(() => cues.beginFrame()).toThrow('object sound frame is already open');
    cues.endFrame();
    expect(() => cues.endFrame()).toThrow('object sound frame is not open');
  });

  it('retains one source map and no per-source JavaScript track object', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/audio/object-cues.ts', import.meta.url)),
      'utf8',
    );

    expect(source.match(/new Map<number, number>/g)).toHaveLength(1);
    expect(source).not.toMatch(/interface ObjectSoundTrack/);
  });

  it('keeps forty object sources in fixed retained storage after warm-up', () => {
    const cues = scheduler([]);
    const observations: Array<readonly [number, number]> = Array.from(
      { length: 40 },
      (_, sourceId) => [sourceId, OBJECT_SOUND_ACTION_SHOWER_WATER],
    );

    frame(cues, observations);
    const capacity = cues.trackCapacity();
    expect(cues.activeTrackCount()).toBe(40);
    expect(capacity).toBeGreaterThanOrEqual(40);

    for (let tick = 1; tick < 600; tick += 1) frame(cues, observations);

    expect(cues.activeTrackCount()).toBe(40);
    expect(cues.trackCapacity()).toBe(capacity);
    cues.reset();
    expect(cues.activeTrackCount()).toBe(0);
    expect(cues.trackCapacity()).toBe(capacity);
  });
});
