import { expect, test } from 'vitest';
import { drainCompletionAudioAfterTick } from '../src/audio/completion-audio.js';

test('completion drain consumes once, uses fresh views and clears even when disabled or throwing', () => {
  let packed = new Uint32Array([1, 42, 1, 77]);
  let count = 2;
  const source = {
    get completionSoundCount() { return count; },
    completionSounds: () => packed,
    clearCompletionSounds: () => { count = 0; packed = new Uint32Array(); },
  };
  const events: unknown[] = [];
  const sink = { emit: (event: unknown) => events.push(event) };
  drainCompletionAudioAfterTick(source, sink, true);
  expect(events).toEqual([{ type: 'object.completed', sourceId: 42, action: 1 },
    { type: 'object.completed', sourceId: 77, action: 1 }]);
  drainCompletionAudioAfterTick(source, sink, true);
  expect(events).toHaveLength(2);
  packed = new Uint32Array([1, 99]); count = 1;
  drainCompletionAudioAfterTick(source, sink, false);
  expect(count).toBe(0);
  expect(events).toHaveLength(2);
  packed = new Uint32Array([1, 100]); count = 1;
  expect(() => drainCompletionAudioAfterTick(source, { emit() { throw Error('sink'); } }, true)).toThrow('sink');
  expect(count).toBe(0);
});
