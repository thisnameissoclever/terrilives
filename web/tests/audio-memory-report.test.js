import { expect, test } from 'vitest';
import { runInNewContext } from 'node:vm';
import proof from '../../scripts/audio-browser-proof.cjs';

test('memory fixture seeds are predeclared in repetition order', () => {
  expect(proof.MEMORY_PROBE_SEEDS).toEqual([
    {low: 104729, high: 130363},
    {low: 155921, high: 196613},
    {low: 262147, high: 327673},
  ]);
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
      seed: {...proof.MEMORY_PROBE_SEEDS[repetition]}, worldHash: '100', tick: 60,
      entities: 1037, wasmMemoryBytes: 65536, jsUsedBytes: 1000, pageMemoryBytes: null,
      footstepTracks: 0, footstepCapacity: 8, activityTracks: 0, activityCapacity: 8,
      objectSoundTracks: 0, objectSoundCapacity: 8, activeVoices: 0,
      conversationVoices: 0, retainedConversationVoices: 0,
      objectLoopVoices: 0, retainedObjectLoopVoices: 0,
      doorVoices: 0, doorTracks: 0, doorCapacity: audioEnabled ? 4 : 0,
      ambienceVoices: 0, retainedAmbienceVoices: 0, ambienceStarts: 0,
      domDocuments: 1, domNodes: 100, eventListeners: 20,
    };
    return {repetition, audioEnabled, samples: [{...common},
      {...common, doorTracks: audioEnabled ? doorTracks : 0,
        ambienceVoices: audioEnabled ? 1 : 0, retainedAmbienceVoices: audioEnabled ? 1 : 0,
        ambienceStarts: audioEnabled ? 1 : 0}, {...common, tick: 600, worldHash: '200', ambienceStarts: audioEnabled ? 1 : 0}]};
  }));
}

test('memory attribution rejects independently changed seeds, ticks, hashes and missing metadata', () => {
  expect(proof.analyseMemory(runsWithDoors(4)).comparable).toBe(true);
  for (const repetition of [0, 1, 2]) {
    for (const endpoint of [0, 2]) {
      for (const field of ['seed', 'tick', 'worldHash', 'seedLow', 'seedHigh']) {
        for (const mutation of ['change', 'omit']) {
          const runs = runsWithDoors(4);
          const sample = runs[repetition * 2].samples[endpoint];
          if (field === 'seedLow' || field === 'seedHigh') {
            const half = field === 'seedLow' ? 'low' : 'high';
            if (mutation === 'omit') delete sample.seed[half];
            else sample.seed[half]++;
          } else if (mutation === 'omit') delete sample[field];
          else sample[field] = field === 'seed' ? {...sample.seed, low: sample.seed.low + 1} : field === 'tick' ? sample.tick + 1 : '999';
          const result = proof.analyseMemory(runs);
          expect(result.comparable, `${repetition}:${endpoint}:${field}:${mutation}`).toBe(false);
          expect(result.retainedAudioPass).toBe(false);
          expect(result.medianAudioSpecificJsGrowthBytes).toBeNull();
        }
      }
    }
  }
});

test('equal but unprescribed endpoints and seeds cannot pass a matched pair', () => {
  for (const field of ['tick', 'seed']) {
    const runs = runsWithDoors(4);
    for (const run of runs.slice(0, 2)) {
      run.samples[0][field] = field === 'tick' ? 61 : {low: 1, high: 2};
    }
    expect(proof.analyseMemory(runs).comparable).toBe(false);
  }
});

test.each([0, 1, 2].flatMap(repetition => [0, 2].flatMap(endpoint =>
  [0, 1].map(control => ({repetition, endpoint, control})))))(
  'missing low seed rejects repetition $repetition endpoint $endpoint control $control independently',
  ({repetition, endpoint, control}) => {
    const runs = runsWithDoors(4);
    const sample = runs[repetition * 2 + control].samples[endpoint];
    delete sample.seed.low;
    expect(sample.seed.high).toBe(proof.MEMORY_PROBE_SEEDS[repetition].high);
    const result = proof.analyseMemory(runs);
    expect(result.comparable).toBe(false);
    expect(result.retainedAudioPass).toBe(false);
    expect(result.medianAudioSpecificJsGrowthBytes).toBeNull();
  },
);

test('memory comparability rejects missing and duplicated pairs', () => {
  const missing = runsWithDoors(4); missing.pop();
  expect(proof.analyseMemory(missing).comparable).toBe(false);
  const duplicated = runsWithDoors(4); duplicated[1] = duplicated[0];
  expect(proof.analyseMemory(duplicated).comparable).toBe(false);
});

test('memory acceptance needs exercised doors and rejects retained door growth or excess voices', () => {
  expect(proof.analyseMemory(runsWithDoors(4)).structuralPass).toBe(true);
  expect(proof.analyseMemory(runsWithDoors(0)).structuralPass).toBe(false);
  for (const [field, value] of [['doorTracks', 5], ['doorCapacity', 5], ['doorVoices', 5]]) {
    const runs = runsWithDoors(4);
    runs[0].samples[1][field] = value;
    expect(proof.analyseMemory(runs).structuralPass, field).toBe(false);
  }
});
test('memory acceptance requires positive room playback and complete bounded drained ownership', () => {
  for (const [field, value] of [['ambienceVoices', 2], ['retainedAmbienceVoices', 3], ['ambienceStarts', undefined]]) {
    const runs = runsWithDoors(4); runs[0].samples[1][field] = value;
    expect(proof.analyseMemory(runs).structuralPass, field).toBe(false);
  }
  const silent = runsWithDoors(4); silent[0].samples[1].ambienceVoices = 0;
  expect(proof.analyseMemory(silent).structuralPass).toBe(false);
  const retained = runsWithDoors(4); retained[0].samples[2].retainedAmbienceVoices = 1;
  expect(proof.analyseMemory(retained).structuralPass).toBe(false);
  const disabled = runsWithDoors(4); disabled[1].samples[1].ambienceStarts = 1;
  expect(proof.analyseMemory(disabled).structuralPass).toBe(false);
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
