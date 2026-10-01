import { expect, test } from 'vitest';
import { runInNewContext } from 'node:vm';
import proof from '../../scripts/audio-browser-proof.cjs';

test('memory endpoint observer pauses at the requested tick and releases its frame callback', () => {
  const callbacks = [];
  class Input {
    checked = false;
    changes = [];
    dispatchEvent(event) { this.changes.push(event.type); }
  }
  const pause = new Input();
  let tick = 59;
  runInNewContext(`(${proof.pauseAtMemoryEndpoint.toString()})(60)`, {
    __terriStress: { sim: { clockTick: () => tick } },
    requestAnimationFrame: callback => callbacks.push(callback),
    HTMLInputElement: Input,
    document: { querySelector: selector => selector === '#speed-0' ? pause : null },
    Event,
  });
  expect(callbacks).toHaveLength(1);
  callbacks.shift()();
  expect(pause.checked).toBe(false);
  expect(callbacks).toHaveLength(1);
  tick = 60;
  callbacks.shift()();
  expect(pause.checked).toBe(true);
  expect(pause.changes).toEqual(['change']);
  expect(callbacks).toHaveLength(0);
});

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
      measurementEndpoint:{tick:600,worldHash:'same-end-world'},
      bundleEvidence: [{url:'http://local/index-proof.js',sha256:'same-bundle'},
        {url:'http://local/terri-proof.wasm',sha256:'same-wasm'}],
      toiletWarmup: { drainedAfterPlayback:true, pausedVoices:0, playedFlushes:audioEnabled?2:0,
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
    run => { run.toiletWarmup.drainedAfterPlayback = false; },
    run => { run.toiletWarmup.second.voices = 0; },
    run => { run.toiletWarmup.pausedVoices = 1; },
    run => { run.toiletWarmup.second.event.tick = run.toiletWarmup.first.event.tick; },
    run => { run.fixtureSha256 = 'different-world'; },
    run => { run.bundleEvidence[0].sha256 = 'stale-build'; },
    run => { run.bundleEvidence.pop(); },
    run => { run.measurementBaseline.tick++; },
    run => { run.measurementBaseline.worldHash = 'different-baseline'; },
    run => { delete run.measurementEndpoint; },
    run => { run.measurementEndpoint.tick++; },
    run => { run.measurementEndpoint.worldHash = 'different-endpoint'; },
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

test.each([-1, 1])('equivalent endpoint HUD states reject node, document and listener changes of %s', change => {
  for (const field of ['domNodes', 'domDocuments', 'eventListeners']) {
    const leak = runsWithDoors(4);
    leak[0].samples[2][field] += change;
    expect(proof.analyseMemory(leak).structuralPass, field).toBe(false);
  }
});

function memoryHudFixture() {
  const nodes = new Map();
  const add = (selector, textContent = '', hidden = false) => {
    nodes.set(selector, { textContent, hidden, childNodes: textContent ? [{}] : [], title: '', dataset: {} });
  };
  add('#needs-caption', 'Select a person');
  nodes.get('#needs-caption').title = 'Select a person';
  add('#needs-empty', 'Select a person to see what they need.');
  add('#needs-content', '', true);
  add('#satisfaction-value', 'unavailable');
  add('#activity-value', 'Nothing selected');
  add('#career-row', '', true);
  add('#career-value');
  add('#orders-row', '', true);
  add('#orders-value', '0');
  add('#action-queue', '', true);
  add('#people-caption', 'People');
  add('#people-empty', 'Select a person to see how they feel about the household.');
  add('#people-list', '', true);
  add('#traits-block', '', true);
  add('#trait-list', '', true);
  add('#traits-empty', 'No traits.');
  add('#mood-content', '', true);
  add('#mood-empty', 'Select a person to see their mood.');
  add('#moodlet-list', '', true);
  add('#mood-label');
  add('#household-roster-members');
  add('#dock-activity', 'Nothing selected');
  nodes.get('#dock-activity').dataset.urgent = 'false';
  add('#dock-traits-empty', 'Select a person to see their traits.');
  add('#queue-empty', 'No actions queued.');
  add('#personal-details');
  nodes.get('#personal-details').open = false;
  const warnings = Array.from({ length: 7 }, () => ({ childNodes: [] }));
  const members = Array.from({ length: 3 }, () => ({ pressed: 'false', getAttribute() { return this.pressed; } }));
  const fixture = {
    nodes, warnings, members, selected: null,
    document: {
      querySelector: selector => nodes.get(selector) ?? null,
      querySelectorAll: selector => {
        if (selector === '#needs-content .need-state') return warnings;
        if (selector === '#household-roster-members .household-member') return members;
        throw new Error(`Unexpected selector: ${selector}`);
      },
    },
  };
  return fixture;
}

function normalized(fixture) {
  // A separate realm catches accidental closure dependencies before Playwright serialization.
  return runInNewContext(`(${proof.memoryHudIsDeselected.toString()})()`, {
    document: fixture.document,
    __terriStress: { sim: { selectedIndex: () => fixture.selected } },
  });
}

function oldSubsetReady(fixture) {
  return fixture.selected === null && fixture.nodes.get('#moodlet-list').childNodes.length === 0 &&
    fixture.nodes.get('#action-queue').childNodes.length === 0 && fixture.warnings.length === 7 &&
    fixture.warnings.every(span => span.childNodes.length === 0);
}

const staleProjectionCases = [
  ['needs-caption', node => { node.textContent = 'Tim'; }],
  ['needs-caption title', node => { node.title = 'Tim'; }],
  ['needs-empty', node => { node.hidden = true; }],
  ['needs-content', node => { node.hidden = false; }],
  ['satisfaction-value', node => { node.textContent = '12.3'; }],
  ['activity-value', node => { node.textContent = 'Sitting'; }],
  ['career-row', node => { node.hidden = false; }],
  ['career-value', node => { node.textContent = 'Office clerk'; node.childNodes = [{}]; }],
  ['orders-row', node => { node.hidden = false; }],
  ['orders-value', node => { node.textContent = '1'; }],
  ['action-queue', node => { node.hidden = false; }],
  ['people-caption', node => { node.textContent = 'How Tim feels'; }],
  ['people-empty', node => { node.hidden = true; }],
  ['people-empty text', node => { node.textContent = 'There is nobody else in the household.'; }],
  ['people-list visibility', node => { node.hidden = false; }],
  ['people-list children', node => { node.childNodes = [{}]; }],
  ['traits-block', node => { node.hidden = false; }],
  ['trait-list visibility', node => { node.hidden = false; }],
  ['trait-list children', node => { node.childNodes = [{}]; }],
  ['traits-empty', node => { node.hidden = true; }],
  ['traits-empty text', node => { node.textContent = 'Traits unavailable'; }],
  ['mood-content', node => { node.hidden = false; }],
  ['mood-empty visibility', node => { node.hidden = true; }],
  ['mood-empty text', node => { node.textContent = 'Mood unavailable'; }],
  ['moodlet-list', node => { node.hidden = false; }],
  ['mood-label', node => { node.textContent = 'Low'; node.childNodes = [{}]; }],
  ['dock-activity text', node => { node.textContent = 'Sitting / Low'; }],
  ['dock-activity urgent', node => { node.dataset.urgent = 'true'; }],
  ['dock-traits-empty', node => { node.hidden = true; }],
  ['queue-empty', node => { node.hidden = true; }],
  ['personal-details', node => { node.open = true; }],
];

test.each(staleProjectionCases)('memory normalization rejects stale %s even when the old subset is ready', (label, change) => {
  const fixture = memoryHudFixture();
  change(fixture.nodes.get(`#${label.split(' ')[0]}`));
  expect(oldSubsetReady(fixture)).toBe(true);
  expect(normalized(fixture)).toBe(false);
});

test('memory normalization accepts only a complete deselected projection without waiting on closed detail contents', () => {
  const fixture = memoryHudFixture();
  fixture.nodes.set('#personal-details-content', { textContent: 'Intentionally not refreshed while closed' });
  expect(normalized(fixture)).toBe(true);
  fixture.selected = 34;
  expect(normalized(fixture)).toBe(false);
});

test.each([...memoryHudFixture().nodes.keys()])('memory normalization rejects missing %s', selector => {
  const fixture = memoryHudFixture();
  fixture.nodes.delete(selector);
  expect(normalized(fixture)).toBe(false);
});

test('memory normalization rejects selected or missing roster buttons and uncleared warnings or rows', () => {
  const selected = memoryHudFixture();
  selected.members[0].pressed = 'true';
  expect(oldSubsetReady(selected)).toBe(true);
  expect(normalized(selected)).toBe(false);
  const emptyRoster = memoryHudFixture();
  emptyRoster.members.length = 0;
  expect(normalized(emptyRoster)).toBe(false);
  const missingWarning = memoryHudFixture();
  missingWarning.warnings.pop();
  expect(normalized(missingWarning)).toBe(false);
  const warning = memoryHudFixture();
  warning.warnings[0].childNodes.push({});
  expect(normalized(warning)).toBe(false);
  for (const selector of ['#action-queue', '#moodlet-list']) {
    const row = memoryHudFixture();
    row.nodes.get(selector).childNodes.push({});
    expect(normalized(row)).toBe(false);
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
