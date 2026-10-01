import { expect, test } from 'vitest';
import proof from '../../scripts/audio-browser-proof.cjs';

test.each([true, false])('memory setup unlocks through visible controls with first-run Help %s', async helpVisible => {
  const calls = [];
  const page = {
    locator: selector => ({
      isVisible: async () => helpVisible,
      click: async () => calls.push(selector),
    }),
    evaluate: async (_callback, speed) => calls.push(`speed:${speed}`),
    waitForTimeout: async delay => calls.push(`wait:${delay}`),
  };
  await proof.closeHelpAndSetThreeTimes(page);
  expect(calls).toEqual([
    ...(helpVisible ? ['#close-help'] : []),
    '#options-toggle', '#options-close', 'speed:3', 'wait:250',
  ]);
});

function runsWithDoors(doorTracks) {
  return [0, 1, 2].flatMap(repetition => [true, false].map(audioEnabled => {
    const common = {
      entities: 1037, wasmMemoryBytes: 65536, jsUsedBytes: 1000, pageMemoryBytes: null,
      footstepTracks: 0, footstepCapacity: 8, activityTracks: 0, activityCapacity: 8,
      objectSoundTracks: 0, objectSoundCapacity: 8, activeVoices: 0,
      conversationVoices: 0, retainedConversationVoices: 0,
      objectLoopVoices: 0, retainedObjectLoopVoices: 0,
      doorVoices: 0, doorTracks: 0, doorCapacity: audioEnabled ? 4 : 0,
      domDocuments: 1, domNodes: 100, eventListeners: 20,
    };
    return {repetition, audioEnabled, samples: [{...common},
      {...common, doorTracks: audioEnabled ? doorTracks : 0}, {...common}]};
  }));
}

test('memory acceptance needs exercised doors and rejects retained door growth or excess voices', () => {
  expect(proof.analyseMemory(runsWithDoors(4)).structuralPass).toBe(true);
  expect(proof.analyseMemory(runsWithDoors(0)).structuralPass).toBe(false);
  for (const [field, value] of [['doorTracks', 5], ['doorCapacity', 5], ['doorVoices', 5]]) {
    const runs = runsWithDoors(4);
    runs[0].samples[1][field] = value;
    expect(proof.analyseMemory(runs).structuralPass, field).toBe(false);
  }
});

test('equivalent endpoint HUD states still reject node, document and listener leaks', () => {
  for (const field of ['domNodes', 'domDocuments', 'eventListeners']) {
    const leak = runsWithDoors(4);
    leak[0].samples[2][field]++;
    expect(proof.analyseMemory(leak).structuralPass, field).toBe(false);
  }
});

test('memory acceptance allows three simultaneous object users but rejects a fourth track', () => {
  const runs = runsWithDoors(4);
  runs[0].samples[1].objectSoundTracks = 3;
  expect(proof.analyseMemory(runs).structuralPass).toBe(true);
  runs[0].samples[1].objectSoundTracks = 4;
  expect(proof.analyseMemory(runs).structuralPass).toBe(false);
});

test('both memory endpoints require fully drained players even with equal listener counts', () => {
  for (const field of ['activeVoices', 'objectLoopVoices', 'doorVoices', 'conversationVoices',
    'retainedConversationVoices', 'retainedObjectLoopVoices']) {
    for (const endpoint of [0, 2]) {
      const runs = runsWithDoors(4);
      runs[0].samples[endpoint][field] = 1;
      expect(proof.analyseMemory(runs).structuralPass, `${endpoint}:${field}`).toBe(false);
    }
  }
});
