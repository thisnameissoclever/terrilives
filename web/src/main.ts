// Entry point. The simulation runs in WASM at a fixed 10 Hz, its state
// crosses into JavaScript through the zero-copy bridge, and the renderer
// draws every entity in one instanced call at display refresh rate,
// interpolating between the two most recent ticks.
//
// Everything with any arithmetic in it lives in `frame.ts`, `iso.ts` and
// `instances.ts`, where it can be tested in Node. This file is the wiring
// that cannot be: a device, a canvas, and a requestAnimationFrame loop.

import init, { SimHandle } from './wasm/terri_wasm.js';
import { SimBridge } from './bridge.js';
import { AMBIENT_NEUTRAL, ambientFor } from './render/daylight.js';
import { initDevice } from './render/device.js';
import { SpriteRenderer } from './render/sprites.js';
import {
  FixedStepDriver,
  advanceSimulationFrame,
  buildInstances,
  instanceCount,
} from './frame.js';
import { cameraOrigin } from './render/iso.js';
import { clampOrigin, lotExtent, zoomAnchoredOrigin } from './render/camera.js';
import { SPRITES } from './render/atlas.js';
import { buildLightField } from './render/lighting.js';
import { buildStaticInstances } from './render/tiles.js';
import { FrameTimer } from './perf.js';
import { DebugPanel } from './ui/debug-panel.js';
import { NeedsPanel, buildNeedBars } from './ui/needs-panel.js';
import { MoodPanel, createMoodPanelSurface } from './ui/mood-panel.js';
import {
  describeStartupFailure,
  renderStartupFailure,
} from './ui/startup-failure.js';
import { buildTimeControls } from './ui/time-controls.js';
import { ObjectMenu, createMenuSurface } from './ui/object-menu.js';
import { attachPointerInput, dispatchMenuAction } from './input.js';
import { KIND_AGENT } from './render/instances.js';
import { createSaveStore } from './storage/save-store.js';
import { GameHud } from './ui/game-hud.js';
import { HelpPanel } from './ui/help-panel.js';
import {
  PersistenceController,
  applyPersistenceControlState,
  restorePersistenceFocus,
} from './ui/persistence-controller.js';
import { QueueMode } from './ui/queue-mode.js';
import { LightingMode } from './ui/lighting-mode.js';
import {
  advanceFrameWithCommandFeedback,
  clearCommandFeedback,
} from './ui/command-feedback.js';
import {
  KeyboardTargetController,
  reportKeyboardSelection,
} from './ui/keyboard-target.js';
import {
  HouseholdRoster,
  createHouseholdRosterSurface,
} from './ui/household-roster.js';
import {
  PeoplePanel,
  createPeoplePanelSurface,
} from './ui/people-panel.js';
import { OverlayPauseController } from './ui/overlay-pause.js';
import {
  COMPACT_HUD_MEDIA_QUERY,
  MobileHud,
} from './ui/mobile-hud.js';
import { AudioController } from './audio/audio-controller.js';
import {
  FootstepIdentityLookup,
  sampleFootstepsAfterTick,
} from './audio/frame-audio.js';
import { AudioControls } from './ui/audio-controls.js';

/** [D2]: the simulation's one true rate. Speed controls change how many
 * ticks run per frame, never how long a tick is. */
const TICK_HZ = 10;

/**
 * The most ticks one frame may run before the driver gives up on the
 * backlog. Half a second of simulation, which is enough to ride out a
 * garbage-collection pause and short enough that catching up cannot cost
 * more than the frame that fell behind.
 */
const MAX_TICKS_PER_FRAME = 5;

/**
 * The speed the page opens at: real time. Not paused, because a game that
 * starts frozen looks broken rather than paused.
 */
const START_SPEED = 1;

/** Frames of history behind the rolling mean and p95. Four seconds at 60 Hz. */
const FRAME_WINDOW = 240;

/** How often the frame budget is printed, in milliseconds. */
const REPORT_INTERVAL_MS = 2000;

/**
 * What `?stress=N` hangs on `window` so the M0 exit gate can be measured.
 *
 * [L14]: an agent-driven browser tab runs hidden, a hidden tab is never
 * composited, and `requestAnimationFrame` therefore never fires. A harness
 * that loops on rAF in one reports a flawless p95 over zero frames. `step`
 * exists so the measurement can drive the real frame body itself rather than
 * trusting a callback that may not run, and `timer.frames` is what tells the
 * two situations apart. Present only under `?stress=N`, so the shipping page
 * carries no extra surface.
 */
export interface StressHandle {
  readonly timer: FrameTimer;
  /** Sampler-only timings. A 540-sample ring discards 60 warm-up ticks. */
  readonly footstepSampler: FrameTimer;
  readonly footstepSampling: boolean;
  readonly entities: number;
  /**
   * Runs one frame's real work, exactly as the rAF callback would.
   *
   * `nowMs` defaults to `performance.now()`, which is what a **timing**
   * harness wants: the M0 exit gate measures how long a real frame takes, so
   * it must not fabricate the clock.
   *
   * A **behaviour** harness has the opposite need and the default actively
   * defeats it. `frame` derives its elapsed time from the gap between
   * successive `nowMs` values, so stepping in a tight loop passes deltas of
   * roughly zero, the fixed-step accumulator never fills, and the simulation
   * advances almost no ticks - while `timer.frames` climbs and the harness
   * reports hundreds of frames of nothing. That is [L14]'s failure with the
   * numbers moving instead of frozen, which is the harder version to spot,
   * and it is what the first run of Task 8's play session did before this
   * parameter existed.
   *
   * So: pass a monotonically increasing `nowMs` when you need the simulation
   * to actually run, and omit it when you need to know what a frame costs.
   */
  step(nowMs?: number): void;
  /**
   * The live bridge, and the camera offsets the projection was built with.
   *
   * Exposed for the same reason `step` is. [L14] is not only about frame
   * timing: in an agent-driven browser the tab does not composite, so
   * nothing that waits on a rendered frame can be verified at all - and a
   * click is exactly such a thing, because the command it enqueues is only
   * applied by a tick, and ticks come from the frame loop. Without this,
   * verifying that a click selects a sim means asking a person to look at a
   * picture, which is what [L17] cost a session to.
   *
   * `origin` is here rather than recomputed by the harness because a second
   * copy of the camera arithmetic is a harness that can agree with itself
   * while disagreeing with the game - it would compute a click position from
   * one camera and the renderer would draw from another, and the test would
   * fail for a reason that is not in the code under test.
   *
   * Present only under `?stress=N`, so the shipping page carries no extra
   * surface. It is a read-only view plus the command methods the player
   * already has through the mouse; it is not a back door into the world,
   * because [D-2] means there is no such thing - everything still goes
   * through a serialised command.
   */
  readonly sim: SimBridge;
  readonly origin: { readonly x: number; readonly y: number };
}

declare global {
  var __terriStress: StressHandle | undefined;
}

async function main(): Promise<void> {
  // init() resolves to the instance exports, whose `memory` is the
  // WebAssembly.Memory backing every view the bridge hands out. It is
  // passed in rather than imported: `--target web` has no importable
  // `memory`, see bridge.ts and [L10].
  const wasm = await init();

  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (!canvas) {
    throw new Error('missing #stage canvas');
  }

  const gpu = await initDevice(canvas);
  // Awaited: the atlas is a PNG and decoding it is asynchronous, so the
  // renderer is only usable once its texture is on the GPU. Constructing
  // it synchronously and uploading later would let the first frames
  // sample an empty texture, which is a black room that fixes itself -
  // the hardest kind of glitch to reproduce.
  const renderer = await SpriteRenderer.create(gpu);

  // The lot, its walls and all eight authored objects come out of
  // content/lot.toml through the compiled pack. Nothing here names a
  // size, a coordinate or an object id, deliberately: a hardcoded room is
  // a second copy of content that nothing keeps in sync, and until this
  // task that copy was what the page actually ran - a 16 x 16 room with
  // one fridge, none of it authored anywhere.
  //
  // `handle` is kept alongside the bridge because the lot's dimensions
  // are simulation state rather than a memory view, and the bridge's job
  // is the zero-copy views.
  const handle = SimHandle.from_lot();
  const sim = new SimBridge(handle, wasm.memory);
  const saveStatusElement = document.querySelector<HTMLElement>('#save-status');
  if (!saveStatusElement) throw new Error('missing #save-status');
  const saveStatus: HTMLElement = saveStatusElement;
  const commandStatusElement = document.querySelector<HTMLElement>('#command-feedback');
  if (!commandStatusElement) throw new Error('missing #command-feedback');
  const commandStatus: HTMLElement = commandStatusElement;
  let preferences: Storage | null = null;
  try {
    preferences = window.localStorage;
  } catch {
    // Session preferences still work in memory when browser storage is denied.
  }
  const audio = new AudioController(undefined, preferences ?? undefined);
  void audio.setBackgrounded(document.visibilityState === 'hidden');
  const unlockAudio = (): void => {
    if (audio.isUnlocked()) return;
    void audio.unlockFromGesture();
  };
  // Browser autoplay policy requires the context to start from a trusted
  // gesture. Capture sees the gesture before the command it may accompany.
  document.addEventListener('pointerdown', unlockAudio, true);
  document.addEventListener('keydown', unlockAudio, true);
  const persistence = new PersistenceController(
    createSaveStore(),
    sim,
    saveStatus,
    (error) => console.error('save storage failed:', error),
  );
  await persistence.restoreAtStartup();
  const lotWidth = handle.lot_width();
  const lotHeight = handle.lot_height();
  // Checked rather than assumed. An empty lot is not a crash: it renders
  // a blank canvas with a lone sim wandering it, which reads as a broken
  // renderer rather than as missing content ([L17] is what that costs to
  // diagnose). main()'s catch below surfaces it instead.
  if (sim.count === 0) {
    throw new Error('the compiled lot placed no objects');
  }
  // NOBODY is spawned here any more. The household - Tim, Bill and
  // Casey - comes out of content/household.toml through the compiled
  // pack, spawned by the same `from_lot` call that placed the furniture.
  // The `spawnAgent(8, 6, 25)` that used to sit on this line was the
  // last hardcoded copy of content in the shell, and [H2] records why it
  // had to go: coordinates in TypeScript are a second copy of a fact
  // nothing keeps in sync.

  // **Select the first household sim immediately, because an unselected
  // sim makes the whole HUD invisible.**
  //
  // Selection lives in the simulation ([D-5]) and started out empty, which
  // meant the page opened with the need panel `hidden` and nothing on screen
  // to say why. The first report from someone opening it cold was "it does not
  // show the need bars or allow any control" - and every part of it worked.
  //
  // With three sims the choice of WHICH is no longer empty, and the lowest
  // entity index among the agents is the first household member in file
  // order - Tim, the first household member - which is as close to an authored
  // answer as exists. The other two are one click away, and the click is
  // taught by the ring appearing under Tim.
  //
  // It goes through a command like every other selection rather than reaching
  // into the world, so a replay of this session reproduces it ([D-2]). It
  // applies on the first tick, before the first frame the player can see.
  //
  // Read out of the render buffer rather than assumed: `ids()` is the
  // row-to-entity mapping and `kinds()` says which rows are agents. Rows
  // are entity-index order, so the first agent row IS the lowest index.
  // This runs BEFORE any stress filler is spawned below.
  let selectedSomebody = sim.selectedIndex() !== null;
  if (!selectedSomebody) {
    const ids = sim.ids();
    const kinds = sim.kinds();
    for (let row = 0; row < sim.count; row++) {
      if (kinds[row] === KIND_AGENT) {
        sim.select(ids[row]);
        selectedSomebody = true;
        break;
      }
    }
  }
  // Thrown for the same reason the zero-objects case above is: an empty
  // household is legal CONTENT - the schema says so - but a shipped page
  // with nobody home renders furniture, selects nothing, and leaves the
  // needs panel permanently hidden with no error anywhere, which is
  // verbatim the "it does not show the need bars" failure this selection
  // exists to prevent. main()'s catch surfaces it instead.
  if (!selectedSomebody) {
    throw new Error('the compiled household has nobody in it');
  }

  // ?stress=1000 spawns idle filler entities to exercise the M0 exit
  // criterion: p95 frame time at or under 16.6 ms with 1,000 entities.
  //
  // The parameter's PRESENCE is what installs the harness handle, and the
  // number only says how much filler to add - so `?stress=0` means "give me
  // the harness on the world the player actually gets". That distinction was
  // added during Task 8's play session, where filler sims turned out to
  // contend for object reservations with the real one; measuring input
  // latency needs a lot with exactly one sim in it, and before this the only
  // way to get the harness was to add a second sim to the world being
  // measured.
  const stressParam = new URLSearchParams(location.search).get('stress');
  const footstepSampling =
    stressParam === null ||
    new URLSearchParams(location.search).get('audio') !== '0';
  const footstepSamplerTimer = stressParam === null ? null : new FrameTimer(540);
  const stress = Number(stressParam ?? 0);
  const spawnStartMs = performance.now();
  for (let i = 0; i < stress; i++) {
    // Hunger 100 starts them satisfied, so they neither path nor eat at
    // first and the measurement is of render and bridge throughput. It
    // stops being true within seconds: every need decays from M1a
    // onwards, and selection now runs one A* per candidate object per
    // idle agent per tick, so a long stress run measures pathing too.
    // Say which you are reading.
    //
    // This walks every tile of the lot in turn, so entities stack
    // several deep on each. That is deliberate rather than incidental:
    // it raises overdraw, which makes the test harder on the GPU, not
    // easier.
    sim.spawnAgent(i % lotWidth, Math.floor(i / lotWidth) % lotHeight, 100);
  }
  if (stress > 0) {
    // Startup, not steady state, and it is superlinear: `spawn_agent`
    // calls `sync_render_buffer`, which sorts and clones on every
    // count change, so seeding N entities from JavaScript is O(N^2 log N).
    // Printed separately so it can never be mistaken for frame cost.
    console.log(
      `spawned ${sim.count} entities in ` +
        `${(performance.now() - spawnStartMs).toFixed(1)}ms`,
    );
  }

  // Stable Sim ids are resolved across the WASM boundary once per world,
  // outside the fixed-tick path. The lookup is rebuilt after Load below.
  const footstepIdentities = new FootstepIdentityLookup();
  footstepIdentities.rebuild(sim);

  const driver = new FixedStepDriver(TICK_HZ, MAX_TICKS_PER_FRAME);
  driver.setSpeed(START_SPEED);
  const frameSimulation = {
    tick(): void {
      sim.tick();
      // Sample once per fixed tick, not once per rendered frame. At 2x and 3x
      // one frame may run several ticks, and combining them loses corner and
      // stride distance that the simulation actually travelled.
      if (footstepSampling) {
        if (footstepSamplerTimer === null) {
          sampleFootstepsAfterTick(sim, audio, footstepIdentities);
        } else {
          const sampleStartedMs = performance.now();
          sampleFootstepsAfterTick(sim, audio, footstepIdentities);
          footstepSamplerTimer.sample(performance.now() - sampleStartedMs);
        }
      }
    },
    flushCommands(): void {
      sim.flushCommands();
    },
  };
  const overlayPause = new OverlayPauseController(
    driver,
    (ticksPerFrame) => sim.setSpeed(ticksPerFrame),
    START_SPEED,
  );

  // The player readouts render simulation state and own nothing ([D-5]):
  // needs, selection, household state and current activity all come from
  // the simulation, and the panels remember only their last read time.
  //
  // Absent elements are thrown on rather than skipped. A page whose
  // markup no longer matches this file would otherwise run with no bars
  // and no speed buttons, which reads as an unimplemented feature rather
  // than as a broken page - the same confusion [L17] cost a session to
  // diagnose from a rendered picture.
  const needsRoot = document.querySelector<HTMLElement>('#needs-panel');
  const needsEmpty = document.querySelector<HTMLElement>('#needs-empty');
  const needsContent = document.querySelector<HTMLElement>('#needs-content');
  const moodEmpty = document.querySelector<HTMLElement>('#mood-empty');
  const moodContent = document.querySelector<HTMLElement>('#mood-content');
  const moodLabel = document.querySelector<HTMLElement>('#mood-label');
  const moodMeter = document.querySelector<HTMLElement>('#mood-meter');
  const moodMarker = document.querySelector<HTMLElement>('#mood-marker');
  const moodletList = document.querySelector<HTMLElement>('#moodlet-list');
  const speedRoot = document.querySelector<HTMLElement>('#time-controls');
  const menuRoot = document.querySelector<HTMLElement>('#object-menu');
  if (
    !(needsRoot instanceof HTMLDetailsElement) ||
    !needsEmpty ||
    !needsContent ||
    !moodEmpty ||
    !moodContent ||
    !moodLabel ||
    !moodMeter ||
    !moodMarker ||
    !moodletList ||
    !speedRoot ||
    !menuRoot
  ) {
    throw new Error('missing needs, mood, time-control or object-menu markup');
  }
  // The caption is queried like the roots above and thrown on when
  // absent, for the same [L17] reason: a panel silently missing its
  // caption reads as an unbuilt feature, not a broken page.
  const needsCaption = document.querySelector<HTMLElement>('#needs-caption');
  if (!needsCaption) {
    throw new Error('missing #needs-caption');
  }
  const needsPanel = new NeedsPanel(
    needsRoot,
    needsCaption,
    buildNeedBars(document, needsContent, sim.needNames()),
    sim.needBarRefreshMs(),
    sim.needMax(),
    needsEmpty,
    needsContent,
  );
  const moodPanel = new MoodPanel(
    sim,
    createMoodPanelSurface(
      document,
      moodEmpty,
      moodContent,
      moodLabel,
      moodMeter,
      moodMarker,
      moodletList,
    ),
    sim.needBarRefreshMs(),
  );
  const peopleRoot = document.querySelector('#people-panel');
  const peopleCaption = document.querySelector<HTMLElement>('#people-caption');
  const peopleEmpty = document.querySelector<HTMLElement>('#people-empty');
  const peopleList = document.querySelector<HTMLElement>('#people-list');
  if (
    !(peopleRoot instanceof HTMLDetailsElement) ||
    !peopleCaption ||
    !peopleEmpty ||
    !peopleList
  ) {
    throw new Error('missing people-panel markup');
  }
  const peoplePanel = new PeoplePanel(
    sim,
    createPeoplePanelSurface(document, peopleCaption, peopleEmpty, peopleList),
    sim.needBarRefreshMs(),
  );
  const clockValue = document.querySelector<HTMLElement>('#clock-value');
  const fundsValue = document.querySelector<HTMLElement>('#funds-value');
  const satisfactionValue = document.querySelector<HTMLElement>('#satisfaction-value');
  const careerRow = document.querySelector<HTMLElement>('#career-row');
  const careerValue = document.querySelector<HTMLElement>('#career-value');
  const activityValue = document.querySelector<HTMLElement>('#activity-value');
  const ordersRow = document.querySelector<HTMLElement>('#orders-row');
  const ordersValue = document.querySelector<HTMLElement>('#orders-value');
  const householdRosterRoot = document.querySelector<HTMLElement>(
    '#household-roster-members',
  );
  const hudRoot = document.querySelector<HTMLElement>('#hud');
  const mobileHudButton = document.querySelector<HTMLButtonElement>(
    '#mobile-hud-toggle',
  );
  if (
    !clockValue ||
    !fundsValue ||
    !satisfactionValue ||
    !careerRow ||
    !careerValue ||
    !activityValue ||
    !ordersRow ||
    !ordersValue ||
    !householdRosterRoot ||
    !hudRoot ||
    !mobileHudButton
  ) {
    throw new Error('missing player status markup');
  }
  const compactHudQuery = window.matchMedia(COMPACT_HUD_MEDIA_QUERY);
  const mobileHud = new MobileHud(hudRoot, mobileHudButton, [
    needsRoot,
    peopleRoot,
  ]);
  mobileHud.setCompact(compactHudQuery.matches);
  mobileHudButton.addEventListener('click', () => mobileHud.toggle());
  compactHudQuery.addEventListener('change', (event) => {
    mobileHud.setCompact(event.matches);
  });
  const gameHud = new GameHud(
    {
      clock: clockValue,
      funds: fundsValue,
      satisfaction: satisfactionValue,
      careerRow,
      career: careerValue,
      activity: activityValue,
      ordersRow,
      orders: ordersValue,
    },
    sim.needBarRefreshMs(),
  );
  const householdRoster = new HouseholdRoster(
    sim,
    createHouseholdRosterSurface(document, householdRosterRoot),
    sim.needBarRefreshMs(),
    () => {
      commandStatus.textContent = 'That person could not be selected';
      commandStatus.setAttribute('data-kind', 'error');
      audio.emit({ type: 'command.rejected' });
    },
    () => {
      clearCommandFeedback(commandStatus);
      audio.emit({ type: 'command.staged' });
    },
  );
  const initialHudMs = performance.now();
  householdRoster.update(initialHudMs, true);
  peoplePanel.update(initialHudMs, true);
  moodPanel.update(initialHudMs, true);
  // The developer overlay, installed only under `?debug=1` - the same
  // presence rule as `?stress`, so the shipping page carries no extra
  // surface and no extra key binding. Backquote toggles it; that key
  // collides with nothing (the only other keydown listener forwards to
  // the flyout, which consumes Escape and arrows).
  let debugPanel: DebugPanel | null = null;
  if (new URLSearchParams(location.search).get('debug') === '1') {
    const debugSection = document.querySelector<HTMLElement>('#debug-panel');
    const debugDetails = document.querySelector<HTMLDetailsElement>('#debug-details');
    const debugReport = document.querySelector<HTMLElement>('#debug-report');
    if (!debugSection || !debugDetails || !debugReport) {
      throw new Error('missing #debug-panel markup under ?debug=1');
    }
    // Open where there is room, folded to the pill where there is not -
    // the owner's small-screen report. A live resize does not re-decide:
    // once the player has a preference, the browser's own <details>
    // state keeps it.
    debugDetails.open = window.innerWidth > 900;
    const root = {
      get hidden(): boolean {
        // Folded counts as hidden for the panel's throttle, so a
        // collapsed overlay costs no formatting per frame; the backtick
        // toggle still owns the section's own visibility.
        return debugSection.hidden || !debugDetails.open;
      },
      set hidden(value: boolean) {
        debugSection.hidden = value;
      },
      get textContent(): string | null {
        return debugReport.textContent;
      },
      set textContent(value: string | null) {
        debugReport.textContent = value;
      },
    };
    const panel = new DebugPanel(sim, root, sim.needBarRefreshMs());
    debugPanel = panel;
    document.addEventListener('keydown', (event) => {
      if (event.code === 'Backquote') panel.toggle();
    });
    // Open immediately: someone who typed ?debug=1 wants the numbers,
    // not a hidden panel and a keyboard shortcut to discover.
    panel.toggle();
  }

  buildTimeControls(document, speedRoot, START_SPEED, (ticksPerFrame) => {
    // Both halves, in one place so neither can be forgotten.
    //
    // The command is what a replay and Layer 2 multiplayer would carry
    // ([D-2]), even though the simulation applies nothing for it today;
    // the driver call is what actually changes the speed. [D2]: it
    // multiplies how many steps run per frame and never how long a step
    // is.
    overlayPause.selectSpeed(ticksPerFrame);
    audio.emit({ type: 'ui.confirmed' });
  });

  const saveButton = document.querySelector<HTMLButtonElement>('#save-game');
  const loadButton = document.querySelector<HTMLButtonElement>('#load-game');
  const stopOrdersButton = document.querySelector<HTMLButtonElement>('#stop-orders');
  const queueButton = document.querySelector<HTMLButtonElement>('#queue-mode');
  const lightingModeButton = document.querySelector<HTMLButtonElement>('#lighting-mode');
  const newGameButton = document.querySelector<HTMLButtonElement>('#new-game');
  const helpButton = document.querySelector<HTMLButtonElement>('#show-help');
  const closeHelpButton = document.querySelector<HTMLButtonElement>('#close-help');
  const helpRoot = document.querySelector<HTMLDialogElement>('#help-panel');
  const helpTitle = document.querySelector<HTMLElement>('#help-title');
  const newGameDialog = document.querySelector<HTMLDialogElement>('#new-game-dialog');
  const loadGameDialog = document.querySelector<HTMLDialogElement>('#load-game-dialog');
  const confirmNewGame = document.querySelector<HTMLButtonElement>('#confirm-new-game');
  const confirmLoadGame = document.querySelector<HTMLButtonElement>('#confirm-load-game');
  const audioMuteButton = document.querySelector<HTMLButtonElement>('#audio-mute');
  const effectsVolume = document.querySelector<HTMLInputElement>('#effects-volume');
  const effectsVolumeValue = document.querySelector<HTMLOutputElement>(
    '#effects-volume-value',
  );
  if (
    !saveButton ||
    !loadButton ||
    !stopOrdersButton ||
    !queueButton ||
    !lightingModeButton ||
    !newGameButton ||
    !helpButton ||
    !closeHelpButton ||
    !helpRoot ||
    !helpTitle ||
    !newGameDialog ||
    !loadGameDialog ||
    !confirmNewGame ||
    !confirmLoadGame ||
    !audioMuteButton ||
    !effectsVolume ||
    !effectsVolumeValue
  ) {
    throw new Error('missing game action markup');
  }

  const queueMode = new QueueMode(queueButton);
  const audioControls = new AudioControls(
    audio,
    audioMuteButton,
    effectsVolume,
    effectsVolumeValue,
  );
  const persistenceFocusFallbacks = [
    saveButton,
    stopOrdersButton,
    queueButton,
    newGameButton,
    helpButton,
  ] as const;
  let startingNewGame = false;
  let persistenceControlKey = '';
  const syncPersistenceButtons = (): void => {
    const state = persistence.controlState();
    const key = `${state.saveDisabled}:${state.loadDisabled}:${state.newGameDisabled}:${state.confirmationDisabled}`;
    if (key === persistenceControlKey) return;
    applyPersistenceControlState(state, {
      save: saveButton,
      load: loadButton,
      newGame: newGameButton,
      confirmLoad: confirmLoadGame,
      confirmNewGame,
    });
    persistenceControlKey = key;
  };
  syncPersistenceButtons();
  queueButton.addEventListener('click', () => {
    queueMode.toggle();
    audio.emit({ type: 'ui.confirmed' });
  });
  audioMuteButton.addEventListener('click', () => {
    const muted = audioControls.toggleMuted();
    if (!muted) audio.emit({ type: 'ui.confirmed' });
  });
  effectsVolume.addEventListener('input', () => {
    audioControls.previewEffectsPercent(effectsVolume.value);
  });
  effectsVolume.addEventListener('change', () => {
    audioControls.setEffectsPercent(effectsVolume.value);
    audio.emit({ type: 'ui.confirmed' });
  });
  saveButton.addEventListener('click', () => {
    const saving = persistence.save();
    syncPersistenceButtons();
    void saving.then(() => syncPersistenceButtons());
  });
  let loadingGame = false;
  loadButton.addEventListener('click', () => {
    overlayPause.suspend('load-game');
    loadGameDialog.showModal();
  });
  loadGameDialog.addEventListener('close', () => {
    if (!loadingGame) overlayPause.resume('load-game');
  });
  confirmLoadGame.addEventListener('click', (event) => {
    // The operation lock disables this submit button synchronously. Doing so
    // before the browser's method=dialog default action can cancel that action
    // and leave a successful Load hidden behind an open modal. Own the close
    // explicitly, before the button becomes disabled.
    event.preventDefault();
    loadingGame = true;
    loadGameDialog.close('confirm');
    const loading = persistence.load();
    syncPersistenceButtons();
    void loading
      .then((loaded) => {
        if (loaded) {
          // A restored world may reuse entity indices for different live
          // entities. Discard every transient action that names the old world.
          lightingDirty = true;
          cameraDirty = true;
          menu.close();
          keyboardTargets.clear();
          footstepIdentities.rebuild(sim);
          audio.reset('load');
          const nowMs = performance.now();
          householdRoster.update(nowMs, true);
          peoplePanel.update(nowMs, true);
          moodPanel.update(nowMs, true);
        }
      })
      .finally(() => {
        loadingGame = false;
        syncPersistenceButtons();
        restorePersistenceFocus(
          document,
          loadGameDialog,
          loadButton,
          persistenceFocusFallbacks,
        );
        overlayPause.resume('load-game');
      });
  });
  let clearingForNewGame = false;
  newGameButton.addEventListener('click', () => {
    overlayPause.suspend('new-game');
    newGameDialog.showModal();
  });
  newGameDialog.addEventListener('close', () => {
    if (!clearingForNewGame) overlayPause.resume('new-game');
  });
  confirmNewGame.addEventListener('click', (event) => {
    // Same ordering rule as Load: close first, then acquire and publish the
    // persistence lock. Clear may be deliberately slow and must not strand an
    // inert confirmation dialog over the running game.
    event.preventDefault();
    clearingForNewGame = true;
    newGameDialog.close('confirm');
    startingNewGame = true;
    const clearing = persistence.clear();
    syncPersistenceButtons();
    void clearing.then((cleared) => {
      if (cleared) window.location.reload();
      else {
        startingNewGame = false;
        clearingForNewGame = false;
        overlayPause.resume('new-game');
        syncPersistenceButtons();
        restorePersistenceFocus(
          document,
          newGameDialog,
          newGameButton,
          persistenceFocusFallbacks,
        );
      }
    });
  });
  stopOrdersButton.addEventListener('click', () => {
    const selected = sim.selectedIndex();
    if (selected === null) {
      commandStatus.textContent = 'Select a person first';
      commandStatus.setAttribute('data-kind', 'error');
      audio.emit({ type: 'command.rejected' });
      return;
    }
    if (sim.cancelIntents(selected)) {
      commandStatus.textContent = 'Orders cleared';
      commandStatus.removeAttribute('data-kind');
      audio.emit({ type: 'command.staged' });
    } else {
      commandStatus.textContent = 'Could not clear orders';
      commandStatus.setAttribute('data-kind', 'error');
      audio.emit({ type: 'command.rejected' });
    }
  });

  const helpPanel = new HelpPanel(helpRoot, helpTitle, preferences);
  const lightingMode = new LightingMode(lightingModeButton, preferences);
  let helpReturnTarget: HTMLElement = canvas;
  const firstRunHelpOpened = helpPanel.showOnFirstRun();
  if (firstRunHelpOpened) overlayPause.suspend('help');
  helpButton.setAttribute('aria-expanded', String(helpRoot.open));
  helpButton.addEventListener('click', () => {
    helpReturnTarget = helpButton;
    if (helpPanel.open()) overlayPause.suspend('help');
    helpButton.setAttribute('aria-expanded', String(helpRoot.open));
  });
  const closeHelp = (): void => {
    if (helpPanel.close()) overlayPause.resume('help');
    helpButton.setAttribute('aria-expanded', 'false');
    helpReturnTarget.focus();
  };
  closeHelpButton.addEventListener('click', closeHelp);
  helpRoot.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeHelp();
  });
  helpRoot.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeHelp();
  });

  document.addEventListener('visibilitychange', () => {
    const hidden = document.visibilityState === 'hidden';
    void audio.setBackgrounded(hidden);
    if (hidden && !startingNewGame) {
      const saving = persistence.save('Game saved');
      syncPersistenceButtons();
      void saving.then(() => syncPersistenceButtons());
    }
  });

  // `worldDepth` divides by (gridSize - 1) * 2, so this has to be at
  // least (w - 1) + (h - 1) for the far corner to keep a depth inside
  // [0, 1]; taking the larger side guarantees it for any lot, since
  // 2 * max(w, h) >= w + h. A depth outside the range does not sort
  // wrong, it clips the entity away entirely.
  const depthScale = Math.max(lotWidth, lotHeight);

  // **The camera.** One scale and two origins, all live state. `cameraOrigin`
  // seeds the centered initial view once. Pan and anchored zoom own the origins
  // afterward; `applyCamera` preserves the center across buffer resizes and
  // clamps the result rather than resetting the player's view.
  //
  // The tallest sprite is read off the atlas rather than named, so adding
  // taller furniture changes the conservative camera extent rather than
  // silently invalidating a fixed magic number. `cameraOrigin` centres that
  // DRAWN extent; if it exceeds the viewport at the current zoom, the
  // unavoidable overflow is shared equally and remains subject to the
  // reviewed cap in `iso.test.ts`.
  const tallestSprite = Math.max(...SPRITES.map((sprite) => sprite.h));
  const lot = { width: lotWidth, height: lotHeight, walls: sim.wallTiles() };
  const camera = { scale: 1, originX: 0, originY: 0 };
  let cameraDirty = true;
  let lightingDirty = false;
  let lighting = buildLightField(sim, lotWidth, lotHeight, lot.walls, true);
  lightingModeButton.addEventListener('click', () => {
    const wasFlat = lightingMode.isFlat();
    lightingMode.toggle();
    if (lightingMode.isFlat() !== wasFlat) cameraDirty = true;
    audio.emit({ type: 'ui.confirmed' });
  });
  // A narrowed alias: the null check on `canvas` above does not survive
  // into the closure below, and `applyCamera` runs long after it.
  const stage: HTMLCanvasElement = canvas;

  /**
   * Bounds the origin so at least a corner of the lot stays on screen,
   * whatever the gesture asked for. Every writer of the origin funnels
   * through here; a clamp applied by SOME writers is a lot that can
   * still be flung away by the one that forgot.
   */
  function clampCamera(): void {
    const bounded = clampOrigin(
      camera.originX,
      camera.originY,
      lotExtent(lotWidth, lotHeight, tallestSprite, camera.scale),
      stage.width,
      stage.height,
    );
    camera.originX = bounded.x;
    camera.originY = bounded.y;
  }

  /**
   * Everything that must agree when the camera or the window moves, in
   * one place so no half can be forgotten: the drawing buffer's size
   * (the window's CSS size times the device pixel ratio, so the canvas
   * is sharp on a phone instead of upscaled), the clamped origin, and
   * the static floor-and-walls block, which bakes screen positions and
   * local-light values and so must be rebuilt. Camera changes, a restored
   * world, and a flat-light toggle all enter through the camera-dirty gate;
   * restore additionally refreshes the light map inside that gate. Ordinary
   * frames do not upload this block ([V11] is what an ungated rebuild costs;
   * during a drag this runs once per FRAME, not per event).
   *
   * The origin is FREE STATE since pan landed ([V8]): it starts at
   * `cameraOrigin`'s centred answer and belongs to the gestures from
   * then on, so this must never re-derive it - only keep the view's
   * centre steady across a buffer resize by shifting half the delta.
   */
  let cameraInitialised = false;
  function applyCamera(): void {
    if (lightingDirty) {
      lighting = buildLightField(sim, lotWidth, lotHeight, lot.walls, true);
      lightingDirty = false;
    }
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(stage.clientWidth * ratio));
    const height = Math.max(1, Math.round(stage.clientHeight * ratio));
    if (stage.width !== width || stage.height !== height) {
      const dx = (width - stage.width) / 2;
      const dy = (height - stage.height) / 2;
      stage.width = width;
      stage.height = height;
      camera.originX += dx;
      camera.originY += dy;
    }
    if (!cameraInitialised) {
      const origin = cameraOrigin(
        stage.width,
        stage.height,
        lotWidth,
        lotHeight,
        tallestSprite,
        camera.scale,
      );
      camera.originX = origin.x;
      camera.originY = origin.y;
      cameraInitialised = true;
    }
    clampCamera();
    const staticGeometry = buildStaticInstances(
      lot,
      camera.originX,
      camera.originY,
      depthScale,
      camera.scale,
      lightingMode.isFlat() ? null : lighting,
    );
    renderer.setStaticGeometry(staticGeometry.instances, staticGeometry.count);
    cameraDirty = false;
  }
  // Flagged rather than applied: a drag-resize fires this continuously,
  // and the flag coalesces the burst into one rebuild on the next frame.
  window.addEventListener('resize', () => {
    cameraDirty = true;
  });

  // The right-click flyout. It renders simulation state and owns none of
  // it ([D-5]): the rows come from the object's own interaction list, read
  // across the boundary on every open, and the sim a row acts on is read
  // when the row is picked rather than when the menu appeared.
  //
  // The action goes back through `dispatchMenuAction`, which sends
  // commands like everything else - the menu is a nicer way to name a
  // command, not a second way to reach the world. A row carries its own
  // interaction index and `SimCommand::UseObject` carries one too, so
  // picking row `n` runs interaction `n`; the shipped lot cannot show that
  // off, because every object on it offers exactly one.
  const menu = new ObjectMenu(createMenuSurface(document, menuRoot), (action) => {
    const accepted = dispatchMenuAction(
      sim,
      action,
      !queueMode.isActive(),
      () => clearCommandFeedback(commandStatus),
    );
    if (!accepted) {
      commandStatus.textContent = 'That order could not be added';
      commandStatus.setAttribute('data-kind', 'error');
    }
    audio.emit({ type: accepted ? 'command.staged' : 'command.rejected' });
  });
  const keyboardStatus = document.querySelector<HTMLElement>('#keyboard-target');
  if (!keyboardStatus) throw new Error('missing #keyboard-target');
  const keyboardTargets = new KeyboardTargetController(sim, keyboardStatus);
  canvas.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      keyboardTargets.cycle(1);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      keyboardTargets.cycle(-1);
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      const target = keyboardTargets.current();
      if (target?.kind === 'person') {
        const accepted = sim.select(target.entity);
        reportKeyboardSelection(
          keyboardStatus,
          target.label,
          accepted,
        );
        audio.emit({ type: accepted ? 'command.staged' : 'command.rejected' });
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const action = keyboardTargets.activate();
      if (action.kind === 'select') {
        const accepted = sim.select(action.entity);
        reportKeyboardSelection(
          keyboardStatus,
          action.label,
          accepted,
        );
        audio.emit({ type: accepted ? 'command.staged' : 'command.rejected' });
      } else if (action.kind === 'menu') {
        const bounds = canvas.getBoundingClientRect();
        menu.open(action.menu, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      } else {
        keyboardStatus.hidden = false;
        keyboardStatus.textContent = action.message;
      }
      return;
    }
    if (event.key === 'Escape' && !menu.isShowing()) keyboardTargets.clear();
  });
  // An orientation change can move the viewport out from under an open
  // fixed-position menu. Closing it is clearer than leaving live controls at
  // coordinates the player can no longer reach.
  window.addEventListener('resize', () => menu.close());

  // Clicks and every camera gesture, last of the wiring because they
  // need the camera above. Left click selects a sim or redirects the
  // selected one at an object, ctrl or cmd click queues instead, right
  // click opens the flyout; the wheel zooms at the cursor, a pinch
  // zooms at its midpoint, and a drag pans. Every command among those
  // is serialised ([D-2]); the camera is not a command at all, because
  // it is presentation - two players watching one simulation at
  // different zooms is the ordinary multiplayer picture.
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reflectedReducedMotion: boolean | null = null;
  const syncSystemLighting = (): void => {
    const active = reducedMotion.matches;
    if (active === reflectedReducedMotion) return;
    reflectedReducedMotion = active;
    const wasFlat = lightingMode.isFlat();
    lightingMode.setSystemFlat(active);
    if (lightingMode.isFlat() !== wasFlat) cameraDirty = true;
  };
  syncSystemLighting();
  reducedMotion.addEventListener('change', syncSystemLighting);

  attachPointerInput(
    canvas,
    sim,
    menu,
    menuRoot,
    camera,
    {
      zoomAt(anchorX, anchorY, scale) {
        if (scale === camera.scale) return;
        const origin = zoomAnchoredOrigin(
          camera.originX,
          camera.originY,
          anchorX,
          anchorY,
          camera.scale,
          scale,
        );
        camera.scale = scale;
        camera.originX = origin.x;
        camera.originY = origin.y;
        clampCamera();
        cameraDirty = true;
      },
      panBy(dx, dy) {
        camera.originX += dx;
        camera.originY += dy;
        clampCamera();
        cameraDirty = true;
      },
    },
    () => queueMode.isActive(),
    (kind) => {
      commandStatus.textContent = kind === 'selection'
        ? 'Selection could not be changed'
        : 'That order could not be added';
      commandStatus.setAttribute('data-kind', 'error');
      audio.emit({ type: 'command.rejected' });
    },
    () => reducedMotion.matches,
    () => clearCommandFeedback(commandStatus),
    () => audio.emit({ type: 'command.staged' }),
  );

  const timer = new FrameTimer(FRAME_WINDOW);
  let previousFrameMs = performance.now();
  let lastReportMs = performance.now();

  /**
   * One frame's work. `nowMs` is when the frame began, so the sample below
   * covers simulation, bridge reads, instance packing and draw submission -
   * everything inside the 16.6 ms budget and nothing outside it.
   */
  function frame(nowMs: number): void {
    const deltaMs = nowMs - previousFrameMs;
    previousFrameMs = nowMs;

    // Chromium's media-query event is not reliable under every embedding and
    // emulation path. The value is already read each frame for animation, so
    // this cached check makes a live accessibility change converge without
    // touching the DOM or static buffer on steady frames.
    syncSystemLighting();

    // The camera settles before anything reads it, so the statics, the
    // entities and the picking all see one projection per frame. On
    // every frame without a zoom or a resize this is one boolean check.
    if (cameraDirty) applyCamera();

    // The sim advances in whole ticks; alpha is how far this frame sits
    // between the last one that ran and the next one that has not. A paused
    // frame drains input without running a full tick.
    const alpha = advanceFrameWithCommandFeedback(
      () => advanceSimulationFrame(driver, deltaMs, frameSimulation),
      () => {
        if (!startingNewGame) persistence.updateAutosave();
      },
      sim,
      commandStatus,
      () => audio.emit({ type: 'command.rejected' }),
    );
    // The selection comes from the simulation every frame rather than being
    // remembered here ([D-5]), so the ring cannot disagree with what the need
    // panel is showing.
    const selected = sim.selectedIndex();
    const instances = buildInstances(
      sim,
      alpha,
      camera.originX,
      camera.originY,
      depthScale,
      selected,
      camera.scale,
      reducedMotion.matches,
      sim.clockTick(),
      lightingMode.isFlat() ? null : lighting,
    );
    // The day/night cycle. `LightingMode` combines the player's saved flat
    // choice with reduced motion's temporary constraint, so one effective
    // state governs ambient light, pools, and the button without rewriting
    // the player's preference.
    renderer.draw(
      instances,
      instanceCount(sim, selected),
      camera.scale,
      lightingMode.isFlat()
        ? AMBIENT_NEUTRAL
        : ambientFor(sim.clockTick(), sim.dayTicks()),
    );

    // Inside the sample below rather than outside it, deliberately: the
    // panel is work the frame does, and a periodic cost measured outside
    // the budget is a budget that does not describe the frame ([L19]).
    // On five frames in six this is two comparisons and a return.
    needsPanel.update(nowMs, sim);
    gameHud.update(nowMs, sim);
    householdRoster.update(nowMs);
    peoplePanel.update(nowMs);
    moodPanel.update(nowMs);
    syncPersistenceButtons();
    debugPanel?.update(nowMs);

    timer.sample(performance.now() - nowMs);
    if (nowMs - lastReportMs > REPORT_INTERVAL_MS) {
      lastReportMs = nowMs;
      console.log(`entities ${sim.count}  ${timer.report()}`);
    }
  }

  if (stressParam !== null) {
    if (footstepSamplerTimer === null) {
      throw new Error('stress footstep timer was not created');
    }
    globalThis.__terriStress = {
      timer,
      footstepSampler: footstepSamplerTimer,
      footstepSampling,
      entities: sim.count,
      step: (nowMs = performance.now()) => frame(nowMs),
      sim,
      // Getters over the live camera rather than a copy: the origin now
      // changes with zoom and resize, and a harness computing a click
      // from a stale origin would fail for a reason that is not in the
      // code under test - the exact drift this field exists to prevent.
      origin: {
        get x() {
          return camera.originX;
        },
        get y() {
          return camera.originY;
        },
      },
    };
  }

  function loop(nowMs: number): void {
    frame(nowMs);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

// Surfaced rather than swallowed, ON SCREEN as well as in the console:
// initDevice throws a distinct message for each way WebGPU can be
// unavailable, and a blank canvas is otherwise indistinguishable between
// them. The console line alone turned out to be swallowing it for the
// audience that matters - a player on another device saw a dark void
// with one floating pause button, because http:// over the LAN is not a
// secure context and WebGPU never existed there. The card names that
// case in words a player can act on.
void main().catch((error: unknown) => {
  console.error('terrilives failed to start:', error);
  renderStartupFailure(
    describeStartupFailure(error, {
      webgpu: 'gpu' in navigator && navigator.gpu !== undefined,
      secure: window.isSecureContext,
    }),
    document.body,
  );
});
