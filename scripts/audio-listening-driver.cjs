const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');

const FORBIDDEN_BACKGROUND_FLAGS = [
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

const ACTIVITY_LISTENING_SCENARIOS = [
  ["conversation","Chat","talkTo",1,4,"conversation"],
  ["eating","Grab a snack","useObject",2,3,"eating"],
  ["reading","Read a book","useObject",4,8,"page-turn"],
  ["exercise","Use the exercise bike","useObject",6,9,"exercise"],
  ["sleep","Sleep","useObject",9,5,"sleep-breath"],
].map(
  ([id, label, command, expectedVisualAction, expectedActivity, cue]) => ({
    id,
    label,
    command,
    expectedVisualAction,
    expectedActivity,
    cue,
  }),
);

function parseArgs(argv) {
  const result = {
    cdp: null,
    gameUrl: null,
    launchProof: null,
    output: null,
    mechanicalOnly: false,
  };
  const readValue = (flag, index) => {
    const value = argv[index + 1];
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
      throw new Error(`missing value for ${flag}`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--cdp') result.cdp = readValue(value, index++);
    else if (value === '--game-url') result.gameUrl = readValue(value, index++);
    else if (value === '--launch-proof') result.launchProof = readValue(value, index++);
    else if (value === '--output') result.output = readValue(value, index++);
    else if (value === '--mechanical-only') result.mechanicalOnly = true;
    else throw new Error(`unknown argument: ${value}`);
  }
  for (const required of ['cdp', 'gameUrl', 'launchProof', 'output']) {
    if (typeof result[required] !== 'string' || result[required].length === 0) {
      throw new Error(`missing --${required.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
    }
  }
  return result;
}

function loadPlaywright() {
  const configured = process.env.TERRILIVES_PLAYWRIGHT_CORE;
  const globalRoot = path.join(process.env.APPDATA ?? '', 'npm', 'node_modules');
  const candidates = [
    configured,
    path.join(globalRoot, '@playwright', 'cli', 'node_modules', 'playwright-core'),
    path.join(globalRoot, 'playwright-core'),
  ].filter(Boolean);
  const found = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, 'package.json')),
  );
  if (found === undefined) {
    throw new Error(
      'Playwright Core was not found. Install the existing Codex Playwright CLI or set TERRILIVES_PLAYWRIGHT_CORE.',
    );
  }
  return require(found);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function launchProofResult(proof) {
  const commandLine = `${proof.executable ?? ''} ${(proof.arguments ?? []).join(' ')}`;
  const forbidden = FORBIDDEN_BACKGROUND_FLAGS.filter((flag) =>
    commandLine.includes(flag),
  );
  return {
    executable: proof.executable,
    processId: proof.processId,
    profilePath: proof.profilePath,
    arguments: proof.arguments,
    forbiddenBackgroundFlags: forbidden,
    ordinaryChromePass: forbidden.length === 0 && proof.launchedBy === 'audio-listening.ps1',
  };
}

class WebAudioMonitor {
  constructor(session) {
    this.session = session;
    this.created = [];
    this.destroyed = [];
    this.activeOscillators = new Set();
    this.maxActiveOscillators = 0;
    this.contextStates = new Map();
  }

  async start() {
    this.session.on('WebAudio.contextCreated', ({ context }) => {
      this.contextStates.set(context.contextId, context.contextState);
    });
    this.session.on('WebAudio.contextChanged', ({ context }) => {
      this.contextStates.set(context.contextId, context.contextState);
    });
    this.session.on('WebAudio.contextWillBeDestroyed', ({ contextId }) => {
      this.contextStates.delete(contextId);
    });
    this.session.on('WebAudio.audioNodeCreated', ({ node }) => {
      this.created.push({
        at: new Date().toISOString(),
        nodeId: node.nodeId,
        nodeType: node.nodeType,
      });
      if (node.nodeType.toLowerCase().includes('oscillator')) {
        this.activeOscillators.add(node.nodeId);
        this.maxActiveOscillators = Math.max(
          this.maxActiveOscillators,
          this.activeOscillators.size,
        );
      }
    });
    this.session.on('WebAudio.audioNodeWillBeDestroyed', ({ nodeId }) => {
      this.destroyed.push({ at: new Date().toISOString(), nodeId });
      this.activeOscillators.delete(nodeId);
    });
    await this.session.send('WebAudio.enable');
  }

  snapshot() {
    return {
      createdNodes: this.created.length,
      createdOscillators: this.created.filter((entry) =>
        entry.nodeType.toLowerCase().includes('oscillator'),
      ).length,
      activeOscillators: this.activeOscillators.size,
      maxActiveOscillators: this.maxActiveOscillators,
      contextStates: [...this.contextStates.values()],
    };
  }
}

async function waitForCondition(read, predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error(`timed out waiting for ${description}`);
}

function everyContextIs(states, expectedState) {
  return states.length > 0 && states.every((state) => state === expectedState);
}

function hasCompleteActivityEvidence(evidence) {
  return evidence.observedRenderState !== null &&
    evidence.expectedCueDelta > 0 &&
    evidence.oscillatorDelta > 0;
}

async function waitForGame(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#stage').waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(
    () => globalThis.__terriStress !== undefined,
    undefined,
    { timeout: 60_000 },
  );
}

async function closeHelp(page) {
  const close = page.locator('#close-help');
  if (await close.isVisible()) {
    await close.click();
    await page.waitForTimeout(200);
  }
}

async function setSpeed(page, multiplier) {
  await page.evaluate((multiplier) => {
    const speed = document.querySelector(`#speed-${multiplier}`);
    if (!(speed instanceof HTMLInputElement)) {
      throw new Error(`missing #speed-${multiplier} input`);
    }
    speed.checked = true;
    speed.dispatchEvent(new Event('change', { bubbles: true }));
  }, multiplier);
  await page.waitForTimeout(350);
}

async function prepareWalking(page) {
  return page.evaluate(() => {
    const stress = globalThis.__terriStress;
    if (stress === undefined) throw new Error('stress handle disappeared');
    const sim = stress.sim;
    const kinds = Uint32Array.from(sim.kinds());
    const ids = Uint32Array.from(sim.ids());
    const simIds = Uint32Array.from(sim.simIds());
    const positions = Float32Array.from(sim.positions());
    const agentRow = kinds.findIndex(
      (kind, row) => kind === 0 && simIds[row] !== 0xffff_ffff,
    );
    if (agentRow < 0) throw new Error('no stable household Sim row found');
    const agent = ids[agentRow];
    const ax = positions[agentRow * 2];
    const ay = positions[agentRow * 2 + 1];
    let objectRow = -1;
    let farthest = -1;
    for (let row = 0; row < kinds.length; row += 1) {
      if (kinds[row] !== 1) continue;
      if (sim.interactionLabels(ids[row]).length === 0) continue;
      const dx = positions[row * 2] - ax;
      const dy = positions[row * 2 + 1] - ay;
      const distance = dx * dx + dy * dy;
      if (distance > farthest) {
        farthest = distance;
        objectRow = row;
      }
    }
    if (objectRow < 0) throw new Error('no object row found');
    sim.select(agent);
    for (let row = 0; row < kinds.length; row += 1) {
      if (kinds[row] === 0 && simIds[row] !== 0xffff_ffff) {
        sim.cancelIntents(ids[row]);
      }
    }
    sim.flushCommands();
    const staged = sim.useObject(agent, ids[objectRow], 0);
    sim.flushCommands();
    if (!staged) throw new Error('the prepared household walk command was rejected');
    return {
      simId: simIds[agentRow],
      agent,
      object: ids[objectRow],
      staged,
      squaredDistance: farthest,
    };
  });
}

async function stageActivityScenario(page, scenario) {
  return page.evaluate((scenario) => {
    const stress = globalThis.__terriStress;
    if (stress === undefined) throw new Error('stress handle disappeared');
    const sim = stress.sim;
    const kinds = Uint32Array.from(sim.kinds());
    const ids = Uint32Array.from(sim.ids());
    const simIds = Uint32Array.from(sim.simIds());
    const stableSimRows = [];
    for (let row = 0; row < kinds.length; row += 1) {
      if (kinds[row] === 0 && simIds[row] !== 0xffff_ffff) stableSimRows.push(row);
    }
    if (stableSimRows.length < 2) {
      throw new Error('activity listening requires two stable household Sims');
    }

    const agentRow = stableSimRows[0];
    const agent = ids[agentRow];
    let target = null;
    let targetSimId = null;
    let interaction = -1;

    if (scenario.command === 'talkTo') {
      const matches = sim.socialLabels()
        .map((label, index) => ({ label, index }))
        .filter((entry) => entry.label === scenario.label);
      if (matches.length !== 1) {
        throw new Error(
          `expected one social label ${scenario.label}; found ${matches.length}`,
        );
      }
      const targetRow = stableSimRows[1];
      target = ids[targetRow];
      targetSimId = simIds[targetRow];
      interaction = matches[0].index;
    } else {
      const matches = [];
      for (let row = 0; row < kinds.length; row += 1) {
        if (kinds[row] !== 1) continue;
        const labels = sim.interactionLabels(ids[row]);
        for (let index = 0; index < labels.length; index += 1) {
          if (labels[index] === scenario.label) {
            matches.push({ entity: ids[row], interaction: index });
          }
        }
      }
      if (matches.length !== 1) {
        throw new Error(
          `expected one object interaction ${scenario.label}; found ${matches.length}`,
        );
      }
      target = matches[0].entity;
      interaction = matches[0].interaction;
    }

    sim.select(agent);
    sim.cancelIntents(agent);
    if (target !== null && targetSimId !== null) sim.cancelIntents(target);
    sim.flushCommands();
    const staged = scenario.command === 'talkTo'
      ? sim.talkTo(agent, target, interaction)
      : sim.useObject(agent, target, interaction);
    sim.flushCommands();
    if (!staged) throw new Error(`${scenario.id} command was rejected`);
    return {
      agent,
      simId: simIds[agentRow],
      target,
      targetSimId,
      interaction,
      staged,
    };
  }, scenario);
}

async function readActivityScenarioState(page, scenario, setup) {
  return page.evaluate(({ scenario, setup }) => {
    const stress = globalThis.__terriStress;
    if (stress === undefined) throw new Error('stress handle disappeared');
    const sim = stress.sim;
    const ids = Uint32Array.from(sim.ids());
    const visualActions = Uint32Array.from(sim.visualActions());
    const activities = Uint32Array.from(sim.activities());
    const stateFor = (entity) => {
      const row = ids.findIndex((id) => id === entity);
      if (row < 0) return null;
      return {
        entity,
        row,
        visualAction: visualActions[row],
        activity: activities[row],
      };
    };
    const agent = stateFor(setup.agent);
    const target = setup.targetSimId === null ? null : stateFor(setup.target);
    const agentMatches =
      agent?.visualAction === scenario.expectedVisualAction &&
      agent?.activity === scenario.expectedActivity;
    const targetMatches =
      scenario.command !== 'talkTo' ||
      (target?.visualAction === scenario.expectedVisualAction &&
        target?.activity === scenario.expectedActivity);
    return { agent, target, pass: agentMatches && targetMatches };
  }, { scenario, setup });
}

async function readCuePlayCounts(page) {
  return page.evaluate(() => {
    const stress = globalThis.__terriStress;
    if (stress === undefined) throw new Error('stress handle disappeared');
    return { ...stress.audio.cuePlayCounts };
  });
}

async function waitForActivityEvidence(page, monitor, scenario, setup, before, timeoutMs) {
  let observedRenderState = null;
  return waitForCondition(
    async () => {
      const renderState = await readActivityScenarioState(page, scenario, setup);
      if (renderState.pass && observedRenderState === null) {
        observedRenderState = renderState;
      }
      const cuePlayCounts = await readCuePlayCounts(page);
      const audio = monitor.snapshot();
      return {
        observedRenderState,
        cuePlayCounts,
        audio,
        expectedCueDelta:
          cuePlayCounts[scenario.cue] - before.cuePlayCounts[scenario.cue],
        oscillatorDelta:
          audio.createdOscillators - before.audio.createdOscillators,
      };
    },
    hasCompleteActivityEvidence,
    timeoutMs,
    `${scenario.id} action, ${scenario.cue} cue, and oscillator`,
  );
}

async function runActivityScenario(page, monitor, scenario, mechanicalOnly) {
  await setSpeed(page, mechanicalOnly ? 3 : 1);
  const before = {
    cuePlayCounts: await readCuePlayCounts(page),
    audio: monitor.snapshot(),
  };
  const setup = await stageActivityScenario(page, scenario);
  const evidence = await waitForActivityEvidence(
    page,
    monitor,
    scenario,
    setup,
    before,
    mechanicalOnly ? 12_000 : 30_000,
  );
  if (!mechanicalOnly) {
    await page.waitForTimeout(scenario.id === 'sleep' ? 6_500 : 4_000);
    await setSpeed(page, 0);
  }
  return { scenario, setup, before, ...evidence };
}

async function waitForWalkingEvidence(page, monitor, setup, before, timeoutMs) {
  let observedRenderState = null;
  return waitForCondition(
    async () => {
      const renderState = await page.evaluate((entity) => {
        const stress = globalThis.__terriStress;
        if (stress === undefined) throw new Error('stress handle disappeared');
        const sim = stress.sim;
        const ids = Uint32Array.from(sim.ids());
        const row = ids.findIndex((id) => id === entity);
        if (row < 0) return null;
        const visualActions = sim.visualActions();
        const activities = sim.activities();
        return {
          row,
          visualAction: visualActions[row],
          activity: activities[row],
          pass: visualActions[row] === 5 && activities[row] === 1,
        };
      }, setup.agent);
      if (renderState?.pass && observedRenderState === null) {
        observedRenderState = renderState;
      }
      const cuePlayCounts = await readCuePlayCounts(page);
      const audio = monitor.snapshot();
      return {
        observedRenderState,
        cuePlayCounts,
        audio,
        expectedCueDelta: cuePlayCounts.footstep - before.cuePlayCounts.footstep,
        oscillatorDelta:
          audio.createdOscillators - before.audio.createdOscillators,
      };
    },
    (evidence) =>
      evidence.observedRenderState !== null &&
      evidence.expectedCueDelta > 0 &&
      evidence.oscillatorDelta > 0,
    timeoutMs,
    'walking action, footstep cue, and oscillator',
  );
}

async function runOwnerHiddenTabCheck(browserSession, page, monitor, input) {
  await page.evaluate(() => {
    const stress = globalThis.__terriStress;
    if (stress === undefined) throw new Error('stress handle disappeared');
    stress.sim.select(null);
    stress.sim.flushCommands();
  });
  const context = page.context();
  const existingPages = new Set(context.pages());
  await input.question(
    'In the visible Chrome window, click the New tab button in the same window. Leave the game tab open, then return here and press Enter. ',
  );
  const newPages = context.pages().filter((candidate) => !existingPages.has(candidate));
  if (newPages.length !== 1) {
    throw new Error(`expected exactly one owner-opened control tab; found ${newPages.length}`);
  }
  const cover = newPages[0];
  await cover.waitForLoadState('domcontentloaded');
  const coverSession = await page.context().newCDPSession(cover);
  const [gameTarget, coverTarget] = await Promise.all([
    monitor.session.send('Target.getTargetInfo'),
    coverSession.send('Target.getTargetInfo'),
  ]);
  const [gameWindow, coverWindow] = await Promise.all([
    browserSession.send('Browser.getWindowForTarget', {
      targetId: gameTarget.targetInfo.targetId,
    }),
    browserSession.send('Browser.getWindowForTarget', {
      targetId: coverTarget.targetInfo.targetId,
    }),
  ]);
  if (gameWindow.windowId !== coverWindow.windowId) {
    await cover.close();
    throw new Error(
      `owner-opened control tab entered a separate window (${gameWindow.windowId} versus ${coverWindow.windowId})`,
    );
  }
  const before = monitor.snapshot();
  try {
    await page.waitForFunction(() => document.visibilityState === 'hidden', undefined, {
      timeout: 10_000,
    });
  } catch (error) {
    throw new Error(
      'cover target did not change the game document to hidden',
      { cause: error },
    );
  }
  const hiddenState = await page.evaluate(() => document.visibilityState);
  const hiddenContextStates = await waitForCondition(
    () => monitor.snapshot().contextStates,
    (states) => everyContextIs(states, 'suspended'),
    5_000,
    'the game Web Audio context to suspend',
  );
  await page.evaluate(() => {
    const button = document.querySelector('#stop-orders');
    if (!(button instanceof HTMLButtonElement)) throw new Error('missing #stop-orders');
    for (let index = 0; index < 20; index += 1) button.click();
  });
  await page.waitForTimeout(750);
  const after = monitor.snapshot();
  await input.question(
    'No game cue should have played while the control tab was selected. Press Enter to close that tab and return to the game. ',
  );
  await cover.close();
  await page.bringToFront();
  await page.waitForFunction(() => document.visibilityState === 'visible', undefined, {
    timeout: 10_000,
  });
  const foregroundContextStates = await waitForCondition(
    () => monitor.snapshot().contextStates,
    (states) => everyContextIs(states, 'running'),
    5_000,
    'the game Web Audio context to resume',
  );
  const beforeRecovery = monitor.snapshot();
  await page.locator('#stop-orders').click();
  await page.waitForTimeout(300);
  const afterRecovery = monitor.snapshot();
  return {
    hiddenState,
    hiddenMechanism: 'owner-opened same-window tab in ordinary Chrome',
    gameWindowId: gameWindow.windowId,
    coverWindowId: coverWindow.windowId,
    hiddenContextStates,
    foregroundContextStates,
    semanticEventsAttempted: 20,
    oscillatorNodesCreatedWhileHidden:
      after.createdOscillators - before.createdOscillators,
    foregroundRecoveryOscillators:
      afterRecovery.createdOscillators - beforeRecovery.createdOscillators,
    pass:
      hiddenState === 'hidden' &&
      after.createdOscillators === before.createdOscillators &&
      afterRecovery.createdOscillators > beforeRecovery.createdOscillators,
  };
}

async function askChoice(input, stage) {
  for (;;) {
    const answer = (await input.question(
      `${stage} result: [p]ass, [r]eplay, [f]ail, or [s]kip: `,
    )).trim().toLowerCase();
    if (answer === 'p' || answer === 'pass') return 'pass';
    if (answer === 'r' || answer === 'replay') return 'replay';
    if (answer === 'f' || answer === 'fail') return 'fail';
    if (answer === 's' || answer === 'skip') return 'skip';
    console.log('Please enter p, r, f, or s.');
  }
}

async function runHumanStage(input, definition) {
  for (;;) {
    console.log(`\n${definition.number}. ${definition.name}`);
    console.log(definition.instructions);
    await input.question('Press Enter when you are ready to hear this stage. ');
    const evidence = await definition.run();
    const choice = await askChoice(input, definition.name);
    if (choice === 'replay') continue;
    return {
      id: definition.id,
      name: definition.name,
      ownerResult: choice,
      evidence,
    };
  }
}

async function runHumanWorkflow(browserSession, page, monitor) {
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  const stages = [];
  try {
    const definitions = [
      {
        number: 1,
        id: 'gesture-recovery',
        name: 'First trusted gesture and rejected-action recovery',
        instructions:
          'A routine control first unlocks audio silently, then one invalid Clear orders action plays the rejection cue. There must be no delayed burst from events that happened before the browser allowed sound.',
        run: async () => {
          const before = monitor.snapshot();
          await page.locator('#queue-mode').click();
          await page.waitForTimeout(250);
          await page.evaluate(() => {
            const stress = globalThis.__terriStress;
            if (stress === undefined) throw new Error('stress handle disappeared');
            stress.sim.select(null);
            stress.sim.flushCommands();
          });
          await page.locator('#stop-orders').click();
          await page.waitForTimeout(350);
          return { before, after: monitor.snapshot() };
        },
      },
      {
        number: 2,
        id: 'routine-silence-rejection',
        name: 'Routine control silence and rejected action',
        instructions:
          'A routine Sim selection must be silent. The invalid Clear orders action that follows should play one quiet rejection cue.',
        run: async () => {
          const before = monitor.snapshot();
          await page.locator('#household-roster-members button').first().click();
          await page.waitForTimeout(400);
          const afterRoutine = monitor.snapshot();
          await page.evaluate(() => {
            const stress = globalThis.__terriStress;
            if (stress === undefined) throw new Error('stress handle disappeared');
            stress.sim.select(null);
            stress.sim.flushCommands();
          });
          await page.locator('#stop-orders').click();
          await page.waitForTimeout(450);
          return {
            before,
            afterRoutine,
            after: monitor.snapshot(),
            feedback: await page.locator('#command-feedback').textContent(),
          };
        },
      },
      {
        number: 3,
        id: 'effects-preview',
        name: 'Effects level preview and commit',
        instructions:
          'The slider moves to 25 percent. Both movement and release must remain silent.',
        run: async () => {
          const before = monitor.snapshot();
          await page.locator('#effects-volume').evaluate((element) => {
            element.value = '25';
            element.dispatchEvent(new Event('input', { bubbles: true }));
          });
          await page.waitForTimeout(500);
          const afterInput = monitor.snapshot();
          await page.locator('#effects-volume').evaluate((element) => {
            element.dispatchEvent(new Event('change', { bubbles: true }));
          });
          await page.waitForTimeout(400);
          return { before, afterInput, afterCommit: monitor.snapshot() };
        },
      },
      ...[1, 2, 3].map((speed, index) => ({
        number: 4 + index,
        id: `footsteps-${speed}x`,
        name: `Footsteps at ${speed}x`,
        instructions:
          `A Sim will walk for five seconds at ${speed}x. Footsteps should track movement without machine-gun bursts, double hits, or a sound caused by the initial position anchor.`,
        run: async () => {
          await setSpeed(page, speed);
          const before = {
            cuePlayCounts: await readCuePlayCounts(page),
            audio: monitor.snapshot(),
          };
          const prepared = await prepareWalking(page);
          const evidence = await waitForWalkingEvidence(
            page,
            monitor,
            prepared,
            before,
            30_000,
          );
          await page.waitForTimeout(5_000);
          return { prepared, before, ...evidence };
        },
      })),
      ...ACTIVITY_LISTENING_SCENARIOS.map((scenario, index) => ({
        number: 7 + index,
        id: `activity-${scenario.id}`,
        name: `${scenario.id[0].toUpperCase()}${scenario.id.slice(1)} cue`,
        instructions:
          scenario.id === 'sleep'
            ? 'One Sim will use the lower bunk. Listen for quiet, sparse breathing that reads as sleep without becoming a repeated thud or a continuous loop.'
            : `One exact ${scenario.id} action will run at 1x. The sound should identify the action without masking the rest of the game or becoming tiring at its normal cadence.`,
        run: () => runActivityScenario(page, monitor, scenario, false),
      })),
      {
        number: 12,
        id: 'pause-resume',
        name: 'Pause and resume discontinuity',
        instructions:
          'A walking Sim pauses, waits, and resumes. The speed controls remain silent. Resuming must not replay distance travelled before or during the pause.',
        run: async () => {
          const prepared = await prepareWalking(page);
          await setSpeed(page, 3);
          await page.waitForTimeout(1_500);
          await setSpeed(page, 0);
          await page.waitForTimeout(1_200);
          const beforeResume = monitor.snapshot();
          await setSpeed(page, 3);
          await page.waitForTimeout(2_500);
          await setSpeed(page, 1);
          return { prepared, beforeResume, after: monitor.snapshot() };
        },
      },
      {
        number: 13,
        id: 'load-reset',
        name: 'Successful Load discontinuity',
        instructions:
          'The workflow saves, starts movement, and loads the saved world. Loading must not produce a footstep burst, stale voice, or click/pop.',
        run: async () => {
          await page.locator('#save-game').click();
          await page.waitForFunction(
            () => document.querySelector('#save-status')?.textContent === 'Game saved',
            undefined,
            { timeout: 10_000 },
          );
          const prepared = await prepareWalking(page);
          await setSpeed(page, 3);
          await page.waitForTimeout(1_200);
          const beforeLoad = monitor.snapshot();
          await page.locator('#load-game').click();
          await page.locator('#confirm-load-game').click();
          await page.waitForFunction(
            () => document.querySelector('#save-status')?.textContent === 'Saved game loaded',
            undefined,
            { timeout: 10_000 },
          );
          await page.waitForTimeout(2_000);
          await setSpeed(page, 1);
          return { prepared, beforeLoad, after: monitor.snapshot() };
        },
      },
      {
        number: 14,
        id: 'hidden-tab',
        name: 'Hidden-tab silence and foreground recovery',
        instructions:
          'A second ordinary Chrome tab covers the game while 20 real UI events fire. You should hear nothing while hidden and no catch-up burst when the game returns.',
        run: () => runOwnerHiddenTabCheck(browserSession, page, monitor, input),
      },
      {
        number: 15,
        id: 'rapid-input',
        name: 'Rapid input and voice-cap artifact check',
        instructions:
          'Twenty rejected actions fire quickly. Listen for clipping, clicks, pops, or a long queued tail. A brief dense cluster is expected, followed by clean silence.',
        run: async () => {
          await page.evaluate(() => {
            const stress = globalThis.__terriStress;
            if (stress === undefined) throw new Error('stress handle disappeared');
            stress.sim.select(null);
            stress.sim.flushCommands();
          });
          const before = monitor.snapshot();
          for (let index = 0; index < 20; index += 1) {
            await page.locator('#stop-orders').click();
            await page.waitForTimeout(12);
          }
          await page.waitForTimeout(700);
          return { before, after: monitor.snapshot() };
        },
      },
      {
        number: 16,
        id: 'settings-persistence',
        name: 'Mute and level persistence',
        instructions:
          'The workflow stores Effects at 35 percent and Sound off, reloads, and verifies both controls. It then turns Sound on silently. The muted period and unmute control must remain silent.',
        run: async () => {
          await page.locator('#effects-volume').evaluate((element) => {
            element.value = '35';
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          });
          if ((await page.locator('#audio-mute').getAttribute('aria-pressed')) !== 'true') {
            await page.locator('#audio-mute').click();
          }
          await page.reload({ waitUntil: 'networkidle' });
          await waitForGame(page);
          await closeHelp(page);
          const restored = {
            muted: await page.locator('#audio-mute').getAttribute('aria-pressed'),
            level: await page.locator('#effects-volume').inputValue(),
          };
          await page.locator('#queue-mode').click();
          await page.waitForTimeout(250);
          await page.locator('#audio-mute').click();
          await page.waitForTimeout(350);
          return {
            restored,
            pass: restored.muted === 'true' && restored.level === '35',
            after: monitor.snapshot(),
          };
        },
      },
    ];

    for (const definition of definitions) {
      stages.push(await runHumanStage(input, definition));
    }
  } finally {
    input.close();
  }
  return stages;
}

async function runMechanicalWorkflow(page, monitor) {
  await page.locator('#queue-mode').click();
  await page.waitForTimeout(350);
  await setSpeed(page, 3);
  const walkingBefore = {
    cuePlayCounts: await readCuePlayCounts(page),
    audio: monitor.snapshot(),
  };
  const walkingSetup = await prepareWalking(page);
  const walkingEvidence = await waitForWalkingEvidence(
    page,
    monitor,
    walkingSetup,
    walkingBefore,
    12_000,
  );
  const activityStages = [];
  for (const scenario of ACTIVITY_LISTENING_SCENARIOS) {
    const evidence = await runActivityScenario(page, monitor, scenario, true);
    activityStages.push({
      id: `activity-${scenario.id}`,
      mechanicalResult: 'pass',
      evidence,
    });
  }
  await page.locator('#effects-volume').evaluate((element) => {
    element.value = '35';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  if ((await page.locator('#audio-mute').getAttribute('aria-pressed')) !== 'true') {
    await page.locator('#audio-mute').click();
  }
  await page.reload({ waitUntil: 'networkidle' });
  await waitForGame(page);
  await closeHelp(page);
  const restored = {
    muted: await page.locator('#audio-mute').getAttribute('aria-pressed'),
    level: await page.locator('#effects-volume').inputValue(),
  };
  return [
    {
      id: 'stable-walking-setup',
      mechanicalResult:
        walkingSetup.staged &&
        walkingEvidence.expectedCueDelta > 0 &&
        walkingEvidence.oscillatorDelta > 0
          ? 'pass'
          : 'fail',
      evidence: { setup: walkingSetup, before: walkingBefore, ...walkingEvidence },
    },
    ...activityStages,
    {
      id: 'hidden-tab',
      mechanicalResult: 'owner-required',
      evidence: {
        pass: false,
        reason:
          'Automated tab creation did not produce a trustworthy visibility transition in the current Chrome build. The owner-listening run validates a manual same-window tab switch.',
      },
    },
    {
      id: 'settings-persistence',
      mechanicalResult:
        restored.muted === 'true' && restored.level === '35' ? 'pass' : 'fail',
      evidence: restored,
    },
  ];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const launchProof = launchProofResult(
    JSON.parse(fs.readFileSync(args.launchProof, 'utf8')),
  );
  const report = {
    schema: 1,
    startedAt: new Date().toISOString(),
    completedAt: null,
    mode: args.mechanicalOnly ? 'mechanical-only' : 'owner-listening',
    gameUrl: args.gameUrl,
    launchProof,
    browserVersion: null,
    stages: [],
    audioTelemetry: null,
    pass: false,
    error: null,
  };
  let browser;
  try {
    if (!launchProof.ordinaryChromePass) {
      throw new Error('Chrome launch proof contains browser flags that invalidate hidden-tab acceptance');
    }
    const { chromium } = loadPlaywright();
    browser = await chromium.connectOverCDP(args.cdp);
    report.browserVersion = await browser.version();
    const context = browser.contexts()[0];
    if (context === undefined) throw new Error('ordinary Chrome exposed no browser context');
    const expected = new URL(args.gameUrl);
    const page = context.pages().find((candidate) => {
      try {
        const actual = new URL(candidate.url());
        return actual.origin === expected.origin;
      } catch {
        return false;
      }
    });
    if (page === undefined) throw new Error(`game page not found at ${expected.origin}`);
    const browserSession = await browser.newBrowserCDPSession();
    const session = await context.newCDPSession(page);
    const monitor = new WebAudioMonitor(session);
    await monitor.start();
    await page.bringToFront();
    await waitForGame(page);
    await closeHelp(page);
    report.stages = args.mechanicalOnly
      ? await runMechanicalWorkflow(page, monitor)
      : await runHumanWorkflow(browserSession, page, monitor);
    report.audioTelemetry = monitor.snapshot();
    report.pass = args.mechanicalOnly
      ? report.stages.every((stage) => stage.mechanicalResult === 'pass')
      : report.stages.every((stage) => stage.ownerResult === 'pass');
  } catch (error) {
    report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    report.completedAt = new Date().toISOString();
    writeJson(args.output, report);
    if (browser !== undefined) await browser.close();
  }
  console.log(`\nListening report: ${args.output}`);
  if (!report.pass) process.exitCode = 1;
}

module.exports = { everyContextIs, hasCompleteActivityEvidence };

if (require.main === module) void main();
