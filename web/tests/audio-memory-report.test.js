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
      doorVoices: 0, doorTracks: 0, doorCapacity: audioEnabled ? 4 : 0, toiletVoices: 0,
      domDocuments: 1, domNodes: 100, eventListeners: 20,
    };
    return {repetition, audioEnabled, fixtureSha256: 'same-fixture', diagnosticOnly:false,
      measurementBaseline:{tick:60,worldHash:'same-world'},
      bundleEvidence: [{url:'http://local/index-proof.js',sha256:'same-bundle'},
        {url:'http://local/terri-proof.wasm',sha256:'same-wasm'}],
      toiletWarmup: { naturallyDrained:true, pausedVoices:0, playedFlushes:audioEnabled?2:0,
        first:{event:{tick:50,source:29}, voices:audioEnabled?1:0},
        second:{event:{tick:240,source:29}, voices:audioEnabled?1:0}},
      samples: [{...common},
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

test('memory acceptance requires exercised toilet lifecycle, paired fixtures and same bundles', () => {
  for (const mutate of [
    run => { delete run.toiletWarmup; },
    run => { run.toiletWarmup.playedFlushes = 0; },
    run => { run.toiletWarmup.naturallyDrained = false; },
    run => { run.toiletWarmup.second.voices = 0; },
    run => { run.toiletWarmup.pausedVoices = 1; },
    run => { run.toiletWarmup.second.event.tick = run.toiletWarmup.first.event.tick; },
    run => { run.fixtureSha256 = 'different-world'; },
    run => { run.bundleEvidence[0].sha256 = 'stale-build'; },
    run => { run.bundleEvidence.pop(); },
    run => { run.measurementBaseline.tick++; },
    run => { run.measurementBaseline.worldHash = 'different-baseline'; },
    run => { run.diagnosticOnly = true; },
  ]) {
    const runs = runsWithDoors(4);
    mutate(runs[0]);
    expect(proof.analyseMemory(runs).coveragePass).toBe(false);
  }
  expect(proof.analyseMemory(runsWithDoors(4)).coveragePass).toBe(true);
  const missingWasm = runsWithDoors(4);
  for (const run of missingWasm) run.bundleEvidence.pop();
  expect(proof.analyseMemory(missingWasm).coveragePass).toBe(false);
});

test('second diagnostic window cannot replace a failing first540tick memory gate', () => {
  const runs = runsWithDoors(4);
  for (const run of runs) {
    run.samples.at(-1).jsUsedBytes += run.audioEnabled ? 70000 : 0;
    run.diagnosticSamples = [{jsUsedBytes:1000},{jsUsedBytes:1000}];
  }
  expect(proof.analyseMemory(runs).retainedAudioPass).toBe(false);
  expect(proof.analyseMemory(runs).allowanceBytes).toBe(65536);
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

test('memory acceptance rejects excess toilet voices', () => {
  const runs = runsWithDoors(4);
  runs[0].samples[1].toiletVoices = 4;
  expect(proof.analyseMemory(runs).structuralPass).toBe(true);
  runs[0].samples[1].toiletVoices = 5;
  expect(proof.analyseMemory(runs).structuralPass).toBe(false);
});

test('both memory endpoints require fully drained players even with equal listener counts', () => {
  for (const field of ['activeVoices', 'objectLoopVoices', 'doorVoices', 'toiletVoices', 'conversationVoices',
    'retainedConversationVoices', 'retainedObjectLoopVoices']) {
    for (const endpoint of [0, 2]) {
      const runs = runsWithDoors(4);
      runs[0].samples[endpoint][field] = 1;
      expect(proof.analyseMemory(runs).structuralPass, `${endpoint}:${field}`).toBe(false);
    }
  }
});
