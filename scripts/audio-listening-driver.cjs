const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');

const FORBIDDEN_BACKGROUND_FLAGS = [
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

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
    const value = read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error(`timed out waiting for ${description}`);
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
  await page.locator(`#speed-${multiplier}`).check();
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
    sim.flushCommands();
    sim.cancelIntents(agent);
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

async function runOwnerHiddenTabCheck(browserSession, page, monitor, input) {
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
    (states) => states.length > 0 && states.every((state) => state === 'suspended'),
    5_000,
    'the game Web Audio context to suspend',
  );
  await page.evaluate(() => {
    const button = document.querySelector('#queue-mode');
    if (!(button instanceof HTMLButtonElement)) throw new Error('missing #queue-mode');
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
  await page.locator('#queue-mode').click();
  await page.waitForTimeout(300);
  return {
    hiddenState,
    hiddenMechanism: 'owner-opened same-window tab in ordinary Chrome',
    gameWindowId: gameWindow.windowId,
    coverWindowId: coverWindow.windowId,
    hiddenContextStates,
    semanticEventsAttempted: 20,
    oscillatorNodesCreatedWhileHidden:
      after.createdOscillators - before.createdOscillators,
    pass:
      hiddenState === 'hidden' &&
      after.createdOscillators === before.createdOscillators,
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
        name: 'First trusted gesture and cue recovery',
        instructions:
          'Listen for one short confirmation cue after the controls are clicked. There must be no delayed burst from events that happened before the browser allowed sound.',
        run: async () => {
          const before = monitor.snapshot();
          await page.locator('#queue-mode').click();
          await page.waitForTimeout(250);
          await page.locator('#queue-mode').click();
          await page.waitForTimeout(350);
          return { before, after: monitor.snapshot() };
        },
      },
      {
        number: 2,
        id: 'accepted-rejected',
        name: 'Accepted and rejected command contrast',
        instructions:
          'You will hear an accepted selection cue, then a rejected Clear orders cue. They must be unmistakably different without being obnoxious.',
        run: async () => {
          const before = monitor.snapshot();
          await page.locator('#household-roster-members button').first().click();
          await page.waitForTimeout(400);
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
          'The slider moves to 25 percent. Input movement must not chatter. One audible confirmation should play when the value is committed.',
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
          const prepared = await prepareWalking(page);
          await setSpeed(page, speed);
          const before = monitor.snapshot();
          await page.waitForTimeout(5_000);
          return { prepared, before, after: monitor.snapshot() };
        },
      })),
      {
        number: 7,
        id: 'pause-resume',
        name: 'Pause and resume discontinuity',
        instructions:
          'A walking Sim pauses, waits, and resumes. The pause control may confirm once. Resuming must not replay distance travelled before or during the pause.',
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
        number: 8,
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
        number: 9,
        id: 'hidden-tab',
        name: 'Hidden-tab silence and foreground recovery',
        instructions:
          'A second ordinary Chrome tab covers the game while 20 real UI events fire. You should hear nothing while hidden and no catch-up burst when the game returns.',
        run: () => runOwnerHiddenTabCheck(browserSession, page, monitor, input),
      },
      {
        number: 10,
        id: 'rapid-input',
        name: 'Rapid input and voice-cap artifact check',
        instructions:
          'Twenty confirmation events fire quickly. Listen for clipping, clicks, pops, or a long queued tail. A brief dense cluster is expected; a small synthesizer riot is not.',
        run: async () => {
          const before = monitor.snapshot();
          for (let index = 0; index < 20; index += 1) {
            await page.locator('#queue-mode').click();
            await page.waitForTimeout(12);
          }
          await page.waitForTimeout(700);
          return { before, after: monitor.snapshot() };
        },
      },
      {
        number: 11,
        id: 'settings-persistence',
        name: 'Mute and level persistence',
        instructions:
          'The workflow stores Effects at 35 percent and Sound off, reloads, and verifies both controls. It then turns Sound on. The muted period must remain silent and the final confirmation must respect 35 percent.',
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

async function runMechanicalWorkflow(page) {
  await page.locator('#queue-mode').click();
  await page.waitForTimeout(350);
  const walkingSetup = await prepareWalking(page);
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
      mechanicalResult: walkingSetup.staged ? 'pass' : 'fail',
      evidence: walkingSetup,
    },
    {
      id: 'hidden-tab',
      mechanicalResult: 'owner-required',
      evidence: {
        pass: false,
        reason:
          'Chrome 151 did not produce a trustworthy visibility transition through CDP or exact-window UI Automation. The owner-listening run validates a manual same-window tab switch.',
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
      ? await runMechanicalWorkflow(page)
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

void main();
