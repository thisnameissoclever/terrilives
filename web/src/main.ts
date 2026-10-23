import { setActionIntent } from './ui/action-intent.js';
import {sceneFramebufferSize} from './render/scene-sampling.js';
import { buildGrimeInstances } from './render/grime-decals.js';
import { WeatherScene } from './render/weather-scene.js';
import {ChoresBoard} from './ui/chores-board.js';
import { newGameSeed } from './new-game-seed.js';
import { DeathControls } from './ui/death-controls.js';
import { CareerAutonomyControls } from './ui/career-autonomy-controls.js';
import { CareerPanel, createCareerPanelSurface } from './ui/career-panel.js';
import { afterPaint, startupLoading } from './ui/startup-loading.js';
import { countAlongside } from './load-progress.js';
// The simulation runs in WASM at a fixed 10 Hz. The bridge exposes its state
// without copying, and the shared scene combines sprite batches with configured
// character meshes at display refresh rate. Movement interpolates between ticks.
//
// Focused modules own simulation, rendering, and input calculations. This entry
// point connects them to the graphics device, canvas, controls, and frame loop.

import init, { SimHandle } from './wasm/terri_wasm.js';
import { SimBridge } from './bridge.js';
import { spawnStressAgents } from './debug/stress-spawn.js';
import { FurnitureBuilder } from './ui/builder.js';
import { BuilderControls } from './ui/builder-controls.js';
import { BuildSession } from './ui/build-session.js';
import { BuildExit, buildCommandsIdle, confirmRefusal, hasUnconfirmedChanges, type BuildDraftSources } from './ui/build-exit.js';
import { WallTool, nearestLine, type WallLine } from './ui/wall-tool.js';
import { WallToolControls } from './ui/wall-tool-controls.js';
import { floorPoint, pickWallFace, wallFaces } from './ui/wall-pick.js';
import { WallView, WallViewControls } from './ui/wall-view.js';
import { withHoverLine } from './render/placement-preview.js';
import { WindowTool } from './ui/window-tool.js';
import { WindowToolControls } from './ui/window-tool-controls.js';
import { RoomTool } from './ui/room-tool.js';
import { RoomSelection, RoomSelectionControls, RoomsTool } from './ui/room-selection.js';
import { RoomReviewController, RoomReviewControls } from './ui/room-review.js';
import { screenX, screenY } from './render/iso.js';
import type { BuildReview } from './rooms/codec.js';
import { FloorTool } from './ui/floor-tool.js';
import { FloorToolControls } from './ui/floor-tool-controls.js';
import { LandTool } from './ui/land-tool.js';
import { LandToolControls } from './ui/land-tool-controls.js';
import { RoomToolControls } from './ui/room-tool-controls.js';
import { BuyTool } from './ui/buy-tool.js';
import { BuyToolControls } from './ui/buy-tool-controls.js';
import { drawCataloguePreviews } from './ui/catalogue-previews.js';
import { BookCommerce } from './ui/book-commerce.js';
import { BookResults, bookRefusal } from './books/results.js';
import { BuildToolSwitch, clearBuildSelection, routeBuildKey } from './ui/build-tools.js';
import { AMBIENT_NEUTRAL, ambientFor, sunStrength } from './render/daylight.js';
import { buildSkyExposure, type SkyExposure } from './render/sky.js';
import { edgesWithShell } from './render/house-shell.js';
import { initDevice } from './render/device.js';
import { SpriteRenderer } from './render/sprites.js';
import {CharacterWorld,type CharacterFrameProbe} from './render/character/world.js';
import {CharacterFrameMeasurement,type CharacterFrameReport} from './render/character/measurement.js';
import {DeviceLifetime} from './render/character/device-lifetime.js';
import {CharacterContactOwner,CharacterContactRoster,sharedCharacterPreparation} from './render/character/contact-admission.js';
import {loadPreparedCharacterState} from './render/character/prepared-character-load.js';
import {StressCharacterAdmission,guardedCharacterStressSource,type StressCharacterActions} from './render/character/stress-admission.js';
import { loadArchitectureAtlas, closeArchitectureAtlas } from './render/architecture-atlas.js';
import { activeFloorFinishKeys } from './render/floor-materials.js';
import { FloorFinishResources, canonicalFloorFinishKeys } from './render/floor-finish-resources.js';
import { FloorScenePresentation } from './render/floor-scene-presentation.js';
import { createFloorSceneStatus } from './ui/floor-scene-status.js';
import type { ActiveFinishes } from './render/architecture-finishes.js';
import { drawFloorSwatch } from './ui/floor-swatches.js';
import { decodeWindowPlacements } from './architecture/windows.js';
import {
  FixedStepDriver,
  frameElapsedMs,
  advanceSimulationFrame,
  buildInstanceBatch,
} from './frame.js';
import { FrameClock } from './frame-clock.js';
import { BackgroundTicker } from './background-ticker.js';
import { TILE_HALF_WIDTH, TILE_HALF_HEIGHT, cameraOrigin } from './render/iso.js';
import { landExtent, clampOrigin, clampZoom, lotExtent, openingExtent, zoomAnchoredOrigin } from './render/camera.js';
import { CreatorSession } from './ui/character-creator/session.js';
import { CreatorView } from './ui/character-creator/view.js';
import { CreatorPreview } from './ui/character-creator/preview.js';
import { CharacterDraft } from './character/draft.js';
import type { CharacterDraftV1 } from './character/schema.js';
import { previewAnimationTiming } from './ui/character-creator/animation-metadata.js';
import { householdMembers } from './ui/household-roster.js';
import { WallFade } from './render/wall-fade.js';
import { SPRITES } from './render/atlas.js';
import { spriteDrawOffsetX, spriteFramingHeight } from './render/sprite-anchors.js';
import { buildLightField } from './render/lighting.js';
import {
  BOUNDARY_SPRITE_NAMES,
  buildStaticInstances,
  setCutAwayWalls,
  setSeason,
  setSelectedLines,
} from './render/tiles.js';
import { FrameTimer } from './perf.js';
import { DebugPanel } from './ui/debug-panel.js';
import { NeedsPanel, buildNeedBars } from './ui/needs-panel.js';
import { MoodPanel, createMoodPanelSurface } from './ui/mood-panel.js';
import { PersonalDetailsPanel, createPersonalDetailsSurface } from './ui/personal-details.js';
import { SkillsPanel, createSkillsPanelSurface } from './ui/skills-panel.js';
import { AffinitiesPanel, createAffinitiesPanelSurface } from './ui/affinities-panel.js';
import { BedAssignmentPanel, createBedAssignmentSurface } from './ui/bed-assignment.js';
import { TraitsPanel, createTraitsPanelSurface } from './ui/traits-panel.js';
import {
  describeStartupFailure,
  renderStartupFailure,
} from './ui/startup-failure.js';
import { showDesktopSiteNotice } from './ui/desktop-site-notice.js';
import { buildTimeControls } from './ui/time-controls.js';
import { ObjectMenu, createMenuSurface } from './ui/object-menu.js';
import { attachPointerInput, dispatchMenuAction } from './input.js';
import { type KeepOut } from './ui/placement-actions.js';
import { BuildContextActions, createContextSurface, ghostAnchorTop, ghostAnchorX } from './ui/placement-actions.js';
import { canvasToClient } from './input.js';
import { createCompactBuildLayout } from './ui/build-layout.js';
import { installShortcuts } from './ui/shortcuts.js';
import { KIND_AGENT } from './render/instances.js';
import { createSaveStore } from './storage/save-store.js';
import { ActionQueue } from './ui/action-queue.js';
import { OrderDiagnostics } from './ui/player-orders.js';
import { OrderFailureBubbles } from './ui/order-failure-bubbles.js';
import { WorkOrderConfirmation, formatWorkConflict } from './ui/work-order-confirmation.js';
import { observeHudScrollbar } from './ui/hud-scrollbar.js';
import { GameHud } from './ui/game-hud.js';
import { OptionsMenu, attachOptionsMenu, type OptionsDocument } from './ui/options-menu.js';
import { showGameVersion } from './ui/game-version.js';
import { HelpPanel } from './ui/help-panel.js';
import {
  PersistenceController,
  applyPersistenceControlState,
  restorePersistenceFocus,
} from './ui/persistence-controller.js';
import { QueueMode } from './ui/queue-mode.js';
import { createSatisfactionSurface } from './ui/satisfaction-meter.js';
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
  createCompactHud,
  householdWarningText,
} from './ui/compact-hud.js';
import {
  AudioController,
  type AudioCuePlayCounts,
} from './audio/audio-controller.js';
import { sampleSimAudioAfterTick, samplePortalAudioAfterTick, withObjectSoundPause } from './audio/frame-audio.js';
import { drainCompletionAudioAfterTick } from './audio/completion-audio.js';
import { armAudioUnlock } from './audio/gesture-unlock.js';
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
 * How often the background timer checks for missing animation frames: once
 * per 10 Hz tick. Its steps are not drawn, so a faster beat would only cost
 * battery.
 */
const BACKGROUND_STEP_MS = 100;

/**
 * How long animation frames may be absent before the timer steps instead. A
 * hidden tab gets none; an unselected or covered one may get about one a
 * second. Several times a 60 Hz frame, so an ordinary slow frame is left alone.
 */
const FRAME_STALL_MS = 250;

/**
 * The tick budget of one background step: ten seconds of play at 3x. The
 * browser can deliver a background timer late, and its steps draw nothing, so
 * it catches up on gaps a frame would drop. A longer stall, such as a tab the
 * browser froze, still drops the rest rather than stalling the page to replay it.
 */
const BACKGROUND_MAX_TICKS = TICK_HZ * 3 * 10;

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
  readonly characters:StressCharacterActions&{
    snapshot():ReturnType<CharacterWorld['diagnostics']>;
    probeFrame(target:CharacterFrameProbe):void;
    pick(x:number,y:number):ReturnType<CharacterWorld['pick']>;
    readiness():unknown;
    createDraft(seed:number):CharacterDraftV1;
    createPreview(large:HTMLCanvasElement,small:HTMLCanvasElement,animation:string):{preview:CreatorPreview;samples:number};
  };
  readonly graphicsGeneration:number;
  loseGraphics():void;
  measureCharacters(durationMs:number):Promise<CharacterFrameReport>;
  readonly graphicsDevice:GPUDevice;
  readonly sceneDepthTexture:GPUTexture;
  readonly sceneColorTexture:GPUTexture;
  readonly sceneIdentityTexture:GPUTexture;
  readonly sceneSurfaceTexture:GPUTexture;
  readonly sceneAnnotationIdentityTexture:GPUTexture|null;
  readonly sceneSampleScale:number;
  readonly timer: FrameTimer;
  /** Sampler-only timings. A 540-sample ring discards 60 warm-up ticks. */
  readonly footstepSampler: FrameTimer;
  readonly footstepSampling: boolean;
  readonly entities: number;
  /** Current WASM linear-memory size, read live after any growth. */
  readonly wasmMemoryBytes: number;
  /** Bounded audio-owned state used by retained-memory acceptance. */
  readonly audio: {
    readonly activeVoices: number;
    /** Conversations currently playing recordings. */
    readonly conversationVoices: number;
    /** Conversations still holding audio nodes, sounding or fading out. */
    readonly retainedConversationVoices: number;
    readonly objectLoopVoices: number;
    readonly doorVoices: number;
    readonly toiletVoices: number;
    readonly doorTracks: number;
    readonly doorCapacity: number;
    readonly retainedObjectLoopVoices: number;
    readonly footstepTracks: number;
    readonly footstepCapacity: number;
    readonly activityTracks: number;
    readonly activityCapacity: number;
    readonly objectSoundTracks: number;
    readonly objectSoundCapacity: number;
    readonly cuePlayCounts: AudioCuePlayCounts;
  };
  /**
   * Exercises the real scheduler with stable identities without adding forty
   * fully autonomous Sims and measuring pathfinding instead of audio.
   */
  runFootstepSchedulerProbe(walkers?: number, ticks?: number): {
    readonly walkers: number;
    readonly ticks: number;
    readonly elapsedMs: number;
    readonly meanMsPerTick: number;
    readonly p95MsPerTick: number;
    readonly maxMsPerTick: number;
    readonly tracks: number;
    readonly capacity: number;
  };
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

// Found before main() so the failure handler at the bottom can clear it too.
const loading = startupLoading(document);

async function main(): Promise<void> {
  // First, so a phone in desktop mode is told before the long load, not after.
  showDesktopSiteNotice(window, document);
  // Audio is wired FIRST, ahead of every await below. Two reasons, both
  // learned the hard way. A phone takes seconds to fetch the WASM, bring up
  // WebGPU and decode the atlas, and a gesture made during that wait is the
  // one chance the browser gives to open the autoplay gate; arming later
  // throws it away. And if any of those awaits throws, the startup card is
  // the only thing on screen - but nothing about audio depends on the
  // simulation or the GPU, so there is no reason for it to fall with them.
  // On that failure path the listeners below stay armed and a tap will build
  // a context that can never be heard. That is deliberate and harmless: the
  // alternative is unarming audio on exactly the paths where it is cheapest
  // to keep, and the page is showing a failure card rather than a game.
  let preferences: Storage | null = null;
  try {
    preferences = window.localStorage;
  } catch {
    // Session preferences still work in memory when browser storage is denied.
  }
  const audio = new AudioController(undefined, preferences ?? undefined);
  // Read by handlers registered before their natural home further down, so
  // they are declared here: reading a later `let` from an early callback
  // throws instead of returning false.
  //
  // Graphics recovery pauses sound while retaining the household and draft.
  // New game prevents a save from writing the old household during reload.
  let graphicsRecovering = false;
  let startingNewGame = false;
  armAudioUnlock(document, audio);
  // A hidden tab keeps playing, sound included, so hiding changes nothing
  // here. Some browsers suspend the audio context themselves while the page
  // is hidden; showing it resumes that context without resetting the
  // schedulers, which are still describing the sound that kept playing.
  // Registered before the awaits, like the arming, so a tab shown during the
  // load is reconciled too. Graphics recovery owns silence itself.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !graphicsRecovering) void audio.resumeIfInterrupted();
  });

  // init() resolves to the instance exports, whose `memory` is the
  // WebAssembly.Memory backing every view the bridge hands out. It is
  // passed in rather than imported: `--target web` has no importable
  // `memory`, see bridge.ts and [L10].
  //
  // The module is fetched here rather than by init() so the loading screen
  // can count it arriving. init() still gets the original response, so
  // compiling overlaps the download and the browser can cache the compiled
  // code; a clone is counted alongside, and the step changes once it ends.
  loading.step('Downloading the simulation');
  const wasm = await init({ module_or_path: fetch(new URL('./wasm/terri_wasm_bg.wasm', import.meta.url))
    .then(response => countAlongside(response, count => loading.bytes(count),
      () => loading.step('Starting the simulation'))) });
  const characterContacts=sharedCharacterPreparation(),contactRoster=new CharacterContactRoster(characterContacts);
  let graphicsClosed=false,graphicsGeneration=0;

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
  const [seedLow, seedHigh] = newGameSeed();
  const handle = SimHandle.from_lot_with_seed(seedLow, seedHigh);
  const sim = new SimBridge(handle, wasm.memory);
  let replaceBuildLocalState = (_reason: 'load' | 'cancel' | 'end'): void => {};
  let hasRetainedReviewChoices = (): boolean => false;
  let requestRoomReview: (review: BuildReview) => Promise<boolean> = async () => false;
  const buildSession = new BuildSession(sim, {
    prepare: () => prepareBuildConfirmation(),
    settled: () => settleBuildControllers(),
    restored: () => restoreBuildPresentation(),
    replaced: reason => replaceBuildLocalState(reason),
    needsReview: () => hasRetainedReviewChoices(),
    review: review => requestRoomReview(review),
  });
  let contactAppearanceHash:bigint|null=null;
  const loadCharacters=async(bytes:Uint8Array):Promise<boolean>=>{
    const loaded=await loadPreparedCharacterState(bytes,buildSession,()=>{
      const candidate=SimHandle.from_lot(),source=new SimBridge(candidate,wasm.memory);
      return {loadBytes:(bytes:Uint8Array)=>source.loadBytes(bytes),characterAppearances:()=>source.characterAppearances(),
        flushCommands:()=>source.flushCommands(),free:()=>candidate.free()};
    },contactRoster);
    if(loaded)contactAppearanceHash=null;return loaded;
  };
  // The names of the conversation recordings come from the compiled content
  // pack, so this is the first moment they exist. The controller decides WHEN
  // to fetch them: decoding needs an audio context, and a context needs a
  // gesture that may not have happened yet.
  void audio.loadVoiceLibrary(sim.voiceClipIds());
  const saveStatusElement = document.querySelector<HTMLElement>('#save-status');
  if (!saveStatusElement) throw new Error('missing #save-status');
  const saveStatus: HTMLElement = saveStatusElement;
  const commandStatusElement = document.querySelector<HTMLElement>('#command-feedback');
  if (!commandStatusElement) throw new Error('missing #command-feedback');
  const commandStatus: HTMLElement = commandStatusElement;
  const persistence = new PersistenceController(
    createSaveStore(),
    buildSession,
    saveStatus,
    (error) => console.error('save storage failed:', error),
    loadCharacters,
  );
  loading.step('Loading the household');
  await persistence.restoreAtStartup();

  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (!canvas) {
    throw new Error('missing #stage canvas');
  }

  loading.step('Starting graphics');
  const gpu = await initDevice(canvas);
  // Awaited: the atlas is a PNG and decoding it is asynchronous, so the
  // renderer is only usable once its texture is on the GPU. Constructing
  // it synchronously and uploading later would let the first frames
  // sample an empty texture, which is a black room that fixes itself -
  // the hardest kind of glitch to reproduce.
  //
  // The saved floors' finishes load with it. Before, the first renderer
  // had none, so a save with boards, tiles or carpet laid kept the floor
  // scene hidden while a second renderer downloaded and decoded every sprite
  // page again to add them. A new game needs no finishes and never paid
  // that. If loading them fails here, the game loads without them and the
  // floor scene's own load and Retry path takes over, with the cover showing
  // that wait as "Loading floor materials".
  loading.step('Loading walls and floors');
  const startupProgress = {
    files: (done: number, total: number) => loading.files(done, total),
    bytes: (count: number) => loading.bytes(count),
  };
  const startupFinishKeys = canonicalFloorFinishKeys(activeFloorFinishKeys(sim.floorTiles(), null));
  let residentFinishKeys: readonly string[] = startupFinishKeys;
  let architectureAtlas: Awaited<ReturnType<typeof loadArchitectureAtlas>>;
  try {
    architectureAtlas = await loadArchitectureAtlas(gpu.device.limits,
      { finishKeys: startupFinishKeys, progress: startupProgress });
  } catch (error) {
    console.warn('Floor finishes could not load at startup', error);
    residentFinishKeys = [];
    architectureAtlas = await loadArchitectureAtlas(gpu.device.limits, { progress: startupProgress });
  }
  loading.step('Loading furniture and people');
  let renderer: SpriteRenderer;
  try {
    // The files are the sprite pages plus the click-area data, which loads
    // alongside them. The last file is followed by the renderer's own setup,
    // which can otherwise look like a finished download that has stalled.
    renderer = await SpriteRenderer.create(gpu, architectureAtlas, {
      files: (done, total) => {
        if (done < total) loading.files(done, total);
        else loading.step('Preparing graphics');
      },
      bytes: startupProgress.bytes,
    });
  } finally { closeArchitectureAtlas(architectureAtlas); }
  loading.note('Loading character models');
  await afterPaint();
  let characterWorld=await CharacterWorld.create(gpu.device,gpu.format,()=>renderer.sceneForPicking,contactRoster);
  let weatherScene = new WeatherScene(gpu.device);
  const weatherTuning = sim.weatherTuning();
  const drawWorldEffects = (encoder: GPUCommandEncoder, target: import('./render/scene-target.js').SceneTarget): void => {
    characterWorld.drawEffects(encoder, target);
    weatherScene.draw(encoder, target);
  };
  window.addEventListener('pagehide',event=>{if(!event.persisted){graphicsClosed=true;characterWorld.destroy();weatherScene.destroy();contactRoster.dispose();}});
  // Let the cover paint before assembling the controls and character resources.
  loading.step('Setting up the game');
  await afterPaint();

  const bookResults = new BookResults(sim);
  let lotWidth = handle.lot_width();
  let lotHeight = handle.lot_height();
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
  const selectedSomebody = sim.selectedIndex() !== null;
  if (!selectedSomebody) {
    const ids = sim.ids();
    const kinds = sim.kinds();
    for (let row = 0; row < sim.count; row++) {
      if (kinds[row] === KIND_AGENT) {
        sim.select(ids[row]);
        break;
      }
    }
  }
  // An empty household is valid after its last member dies. Keep the
  // selection prompt and New housemate available when that save loads.

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
  // Probe accepted floor cells, then stack filler there. Edge-mode spawning
  // refuses furniture cells; count actual additions rather than attempts.
  // Hunger 100 leaves selection autonomous without immediate hunger pressure.
  spawnStressAgents(sim, lotWidth, lotHeight, stress);
  loading.note('Preparing characters');
  await afterPaint();
  await contactRoster.prepareCurrent(sim.characterAppearances());characterWorld.prepareFixtures(sim);contactAppearanceHash=sim.appearanceHash();
  loading.step('Setting up the game');
  const syncCharacterContacts=()=>{
    const hash=sim.appearanceHash();if(hash===contactAppearanceHash&&!contactRoster.hasQueued)return;
    contactRoster.afterCommands(sim.characterAppearances());contactAppearanceHash=hash;
  };
  if (stress > 0) {
    // Startup, not steady state, and it is superlinear: `spawn_agent`
    // calls `sync_render_buffer`, which sorts and clones on every
    // count change, so seeding N entities from JavaScript is O(N^2 log N).
    // Printed separately so it can never be mistaken for frame cost.
    console.debug(
      `spawned ${sim.count} entities in ` +
        `${(performance.now() - spawnStartMs).toFixed(1)}ms`,
    );
  }

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
          drainCompletionAudioAfterTick(sim, audio, true);
          sampleSimAudioAfterTick(sim, audio);
          samplePortalAudioAfterTick(sim, audio);
        } else {
          const sampleStartedMs = performance.now();
          drainCompletionAudioAfterTick(sim, audio, true);
          sampleSimAudioAfterTick(sim, audio);
          samplePortalAudioAfterTick(sim, audio);
          footstepSamplerTimer.sample(performance.now() - sampleStartedMs);
        }
      } else {
        drainCompletionAudioAfterTick(sim, audio, false);
      }
    },
    flushCommands(): void {
      sim.flushCommands();
    },
  };
  const overlayPause = new OverlayPauseController(
    withObjectSoundPause(driver, audio),
    (ticksPerFrame) => sim.setSpeed(ticksPerFrame),
    START_SPEED,
  );
  const orderDiagnostics = new OrderDiagnostics(commandStatus);
  const failureBubbleRoot = document.querySelector<HTMLElement>('#order-failure-bubbles');
  const workDialog = document.querySelector<HTMLDialogElement>('#work-order-dialog');
  const workMessage = document.querySelector<HTMLElement>('#work-order-message');
  const workProceed = document.querySelector<HTMLButtonElement>('#work-order-proceed');
  if (!failureBubbleRoot || !workDialog || !workMessage || !workProceed) throw new Error('Missing player-order feedback markup');
  const feedbackBubbles = failureBubbleRoot;
  const failureBubbles = new OrderFailureBubbles(feedbackBubbles);
  let workReturnFocus: HTMLElement | null = null;
  const workConfirmation = new WorkOrderConfirmation(sim, overlayPause, {
    show(conflict) {
      workReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      workMessage.textContent = formatWorkConflict(conflict);
      workDialog.showModal();
      workDialog.querySelector<HTMLElement>('h2')?.focus();
    },
    close() { workDialog.close(); },
    rejected() {
      commandStatus.textContent = 'That order could not be added. Give the order again.';
      commandStatus.setAttribute('data-kind', 'error');
      audio.emit({type: 'command.rejected'});
    },
    returnFocus() {
      const target = workReturnFocus?.isConnected && !workReturnFocus.closest('[hidden]') && workReturnFocus.getClientRects().length > 0
        ? workReturnFocus : canvas;
      target.focus();
    },
  });
  sim.setOrderGate((participants, submit) => workConfirmation.request(participants, submit));
  workProceed.addEventListener('click', () => workConfirmation.proceed());
  workDialog.querySelector('#work-order-cancel')!.addEventListener('click', () => workConfirmation.cancel());
  workDialog.addEventListener('cancel', event => { event.preventDefault(); workConfirmation.cancel(); });

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
    !needsRoot ||
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
  // [TL-panel]. A missing element throws, for the [L17] reason above.
  const traitsBlock = document.querySelector<HTMLDetailsElement>('#traits-block');
  const traitsEmpty = document.querySelector<HTMLElement>('#traits-empty');
  const traitList = document.querySelector<HTMLElement>('#trait-list');
  if (!traitsBlock || !traitsEmpty || !traitList) {
    throw new Error('missing traits markup');
  }
  const traitsPanel = new TraitsPanel(
    sim,
    {
      labels: sim.traitLabels(),
      kinds: sim.traitKinds(),
      descriptions: sim.traitDescriptions(),
    },
    createTraitsPanelSurface(document, traitsBlock, traitsEmpty, traitList),
    // A level moves only when an activity completes, so the need bars'
    // interval is already faster than anything this panel can show.
    sim.needBarRefreshMs(),
  );
  const peopleRoot = document.querySelector('#people-panel');
  const personalDetails = document.querySelector<HTMLDetailsElement>('#personal-details');
  const personalDetailsEmpty = document.querySelector<HTMLElement>('#personal-details-empty');
  const personalDetailsContent = document.querySelector<HTMLElement>('#personal-details-content');
  const simOverview = document.querySelector<HTMLElement>('#sim-overview');
  const simSheet = document.querySelector<HTMLElement>('#sim-sheet');
  if (!personalDetails || !personalDetailsEmpty || !personalDetailsContent || !simOverview || !simSheet) {
    throw new Error('missing personal details markup');
  }
  const personalDetailsPanel = new PersonalDetailsPanel(sim, sim.needNames(),
    createPersonalDetailsSurface(document, personalDetailsEmpty, personalDetailsContent), sim.needBarRefreshMs(),
    () => personalDetails.open && !simOverview.hidden && !simSheet.hidden);
  const bedAssignmentSurface = createBedAssignmentSurface(document, personalDetails, {
    choose: place => bedAssignmentPanel.choose(place),
    assign: () => bedAssignmentPanel.assign(),
    clear: () => bedAssignmentPanel.clear(),
  });
  const bedAssignmentPanel = new BedAssignmentPanel(sim, bedAssignmentSurface, sim.needBarRefreshMs(),
    () => personalDetails.open && !simOverview.hidden && !simSheet.hidden);
  personalDetails.addEventListener('toggle', () => {
    if (personalDetails.open) {
      const nowMs = performance.now();
      personalDetailsPanel.update(nowMs, true);
      bedAssignmentPanel.update(nowMs, true);
    }
  });
  // [SK-hud]: the Skills disclosure beside the personal details. Closed, it
  // reads nothing; opening it reads at once.
  const skillsBlock = document.querySelector<HTMLDetailsElement>('#skills-block');
  const skillsEmpty = document.querySelector<HTMLElement>('#skills-empty');
  const skillList = document.querySelector<HTMLElement>('#skill-list');
  if (!skillsBlock || !skillsEmpty || !skillList) {
    throw new Error('missing skills markup');
  }
  const skillsPanel = new SkillsPanel(sim,
    { labels: sim.skillLabels(), descriptions: sim.skillDescriptions(), levels: sim.skillLevels() },
    createSkillsPanelSurface(document, skillsBlock, skillsEmpty, skillList), sim.needBarRefreshMs(),
    () => skillsBlock.open && !simOverview.hidden && !simSheet.hidden);
  skillsBlock.addEventListener('toggle', () => {
    if (skillsBlock.open) skillsPanel.update(performance.now(), true);
  });
  // The Career tab (rule 18 of docs/specs/2026-10-17-careers.md) and the
  // Overview row's trend and information control. Hidden, it does no
  // periodic reads; the forced updates below read whether or not it shows.
  const careerSection = document.querySelector<HTMLElement>('#sim-career');
  const careerEmpty = document.querySelector<HTMLElement>('#career-empty');
  const careerContent = document.querySelector<HTMLElement>('#career-content');
  const careerRowTitle = document.querySelector<HTMLElement>('#career-value');
  const careerRowInfo = document.querySelector<HTMLButtonElement>('#career-info');
  const careerRowGraph = document.querySelector<HTMLElement>('#career-row-graph');
  if (!careerSection || !careerEmpty || !careerContent || !careerRowTitle || !careerRowInfo || !careerRowGraph) {
    throw new Error('missing career markup');
  }
  const careerSurface = createCareerPanelSurface(document, {
    section: careerSection, empty: careerEmpty, content: careerContent,
    rowTitle: careerRowTitle, rowInfo: careerRowInfo, rowGraph: careerRowGraph,
  }, {
    choose: path => careerPanel.choose(path),
    assign: () => careerPanel.assign(),
    quit: () => careerPanel.quit(),
    setJobSearch: search => careerPanel.setJobSearch(search),
    chooseShift: shift => careerPanel.chooseShift(shift),
    chooseChange: shift => careerPanel.chooseChange(shift),
    changeShift: () => careerPanel.changeShift(),
  });
  const careerPanel = new CareerPanel(sim, careerSurface, sim.needBarRefreshMs(),
    () => (!careerSection.hidden || !simOverview.hidden) && !simSheet.hidden);
  // [OA-hud]: the Likes and dislikes disclosure after Skills. Closed, it does
  // no periodic reads; opening it reads at once, and the forced updates at
  // start, after Load and after an edit read whether or not it is open.
  const affinitiesBlock = document.querySelector<HTMLDetailsElement>('#affinities-block');
  const affinitiesEmpty = document.querySelector<HTMLElement>('#affinities-empty');
  const affinityList = document.querySelector<HTMLElement>('#affinity-list');
  if (!affinitiesBlock || !affinitiesEmpty || !affinityList) {
    throw new Error('missing likes and dislikes markup');
  }
  const affinitiesPanel = new AffinitiesPanel(sim, sim.affinityLabels(),
    createAffinitiesPanelSurface(document, affinitiesBlock, affinitiesEmpty, affinityList), sim.needBarRefreshMs(),
    () => affinitiesBlock.open && !simOverview.hidden && !simSheet.hidden);
  affinitiesBlock.addEventListener('toggle', () => {
    if (affinitiesBlock.open) affinitiesPanel.update(performance.now(), true);
  });
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
  const satisfactionSummary = document.querySelector<HTMLElement>('#satisfaction-summary');
  const satisfactionLabel = document.querySelector<HTMLElement>('#satisfaction-label');
  const satisfactionMeter = document.querySelector<HTMLMeterElement>('#satisfaction-meter');
  const careerRow = document.querySelector<HTMLElement>('#career-row');
  const careerValue = document.querySelector<HTMLElement>('#career-value');
  const activityValue = document.querySelector<HTMLElement>('#activity-value');
  const ordersRow = document.querySelector<HTMLElement>('#orders-row');
  const ordersValue = document.querySelector<HTMLElement>('#orders-value');
  const householdRosterRoot = document.querySelector<HTMLElement>(
    '#household-roster-members',
  );
  const hudRoot = document.querySelector<HTMLElement>('#hud');
  const actionQueueRoot = document.querySelector<HTMLElement>('#action-queue');
  if (
    !clockValue ||
    !fundsValue ||
    !satisfactionValue ||
    !satisfactionSummary ||
    !satisfactionLabel ||
    !satisfactionMeter ||
    !careerRow ||
    !careerValue ||
    !activityValue ||
    !ordersRow ||
    !ordersValue ||
    !householdRosterRoot ||
    !hudRoot ||
    !actionQueueRoot
  ) {
    throw new Error('missing player status markup');
  }
  const compactHudQuery = window.matchMedia(COMPACT_HUD_MEDIA_QUERY);
  const compactBuildQuery = window.matchMedia('(max-width: 700px), (max-height: 480px)');
  const actionQueue = new ActionQueue(actionQueueRoot, sim.needBarRefreshMs());
  const compactHud = createCompactHud(document, () => actionQueue.invalidate(), () => optionsMenu.close());
  compactHud.setCompact(compactHudQuery.matches);
  const dockActivity = document.getElementById('dock-activity');
  const dockTraitsEmpty = document.getElementById('dock-traits-empty');
  const queueEmpty = document.getElementById('queue-empty');
  const dockAlert = document.getElementById('dock-alert');
  const dockCritical = document.getElementById('dock-critical');
  if (!dockActivity || !dockCritical || !dockTraitsEmpty || !queueEmpty || !dockAlert) throw new Error('missing compact Sim summary');
  const needMeters = Array.from(needsContent.querySelectorAll<HTMLElement>('[role="meter"]'));
  const syncDockSummary = () => {
    const critical = needsContent.hidden ? [] : needMeters
      .filter(meter => meter.getAttribute('aria-valuetext')?.endsWith(', critical'))
      .map(meter => meter.getAttribute('aria-label'));
    // The current activity always shows; critical needs get their own line.
    const activity = activityValue.textContent ?? '';
    const urgent = critical.length ? `Critical: ${critical.join(', ')}` : '';
    dockActivity.dataset.urgent = String(critical.length > 0);
    if (dockActivity.textContent !== activity) dockActivity.textContent = activity;
    if (dockCritical.textContent !== urgent) dockCritical.textContent = urgent;
    dockTraitsEmpty.hidden = !traitsBlock.hidden;
    queueEmpty.hidden = !actionQueueRoot.hidden;
    const warning = householdWarningText(householdRosterRoot.querySelectorAll<HTMLElement>('.household-member'));
    if (dockAlert.textContent !== warning) dockAlert.textContent = warning;
    if (needsCaption.title !== needsCaption.textContent) needsCaption.title = needsCaption.textContent ?? '';
  };
  // [OF2] in docs/specs/2026-09-22-options-flyout.md. Its Escape is caught
  // in the capture phase, so an open panel takes it before the game view
  // and Build do.
  const optionsRoot = document.querySelector<HTMLElement>('#options');
  const optionsToggle = document.querySelector<HTMLButtonElement>('#options-toggle');
  const optionsPanel = document.querySelector<HTMLElement>('#options-panel');
  if (!optionsRoot || !optionsToggle || !optionsPanel) throw new Error('missing the Options flyout');
  const optionsMenu = new OptionsMenu(optionsToggle, optionsPanel);
  // The version line at the top of the panel; its markup is empty so the
  // number comes only from web/package.json (issue 276).
  const gameVersion = document.getElementById('game-version');
  if (!gameVersion) throw new Error('missing the game version line');
  showGameVersion(gameVersion);
  optionsToggle.addEventListener('click', () => compactHud.close());
  const optionsClose = document.getElementById('options-close');
  if (!optionsClose) throw new Error('missing Options close button');
  optionsClose.addEventListener('click', () => { optionsMenu.close(); optionsToggle.focus(); });
  const deathInput = document.querySelector<HTMLInputElement>('#death-enabled');
  if (!deathInput) throw new Error('missing death setting');
  const deathControls = new DeathControls(sim, deathInput);
  deathControls.update();
  deathInput.addEventListener('change', () => { if (!buildSession.active) deathControls.change(); });
  // Rule 15 of the careers spec: the household setting for changing path.
  // Job search is each person's setting, in the Career tab.
  const careerChangeInput = document.querySelector<HTMLInputElement>('#career-autonomous-change');
  if (!careerChangeInput) throw new Error('missing career setting');
  const careerAutonomy = new CareerAutonomyControls(sim, careerChangeInput);
  careerAutonomy.update();
  careerChangeInput.addEventListener('change', () => { if (!buildSession.active) careerAutonomy.change(); });

  attachOptionsMenu(
    document as unknown as OptionsDocument,
    { contains: (node) => node instanceof Node && optionsRoot.contains(node) },
    optionsToggle,
    optionsMenu,
    // Any open dialog owns Escape, even when focus has fallen to the page.
    (target) => document.querySelector('dialog[open]') !== null
      || (target instanceof Element && target.closest('dialog') !== null),
  );
  compactHudQuery.addEventListener('change', (event) => {
    compactHud.setCompact(event.matches);
  });
  compactBuildQuery.addEventListener('change', (event) => {
    builderControls.setCompact(event.matches);
    wallControls?.setCompact(event.matches);
    windowControls?.setCompact(event.matches);
    buyControls?.setCompact(event.matches);
    roomControls?.setCompact(event.matches);
    floorControls?.setCompact(event.matches);
    landControls?.setCompact(event.matches);
    placementActions?.invalidate();
    syncBuildOptionsHost();
  });
  observeHudScrollbar(hudRoot);
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
    createSatisfactionSurface(satisfactionSummary, satisfactionLabel, satisfactionMeter),
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
  traitsPanel.update(initialHudMs, true);
  personalDetailsPanel.update(initialHudMs, true);
  skillsPanel.update(initialHudMs, true);
  affinitiesPanel.update(initialHudMs, true);
  careerPanel.update(initialHudMs, true);
  bedAssignmentPanel.update(initialHudMs, true);
  // The developer overlay, installed only under `?debug=1` - the same
  // presence rule as `?stress`, so the shipping page carries no extra
  // surface and no extra key binding. Backquote toggles it; that key
  // collides with nothing (the only other keydown listener forwards to
  // the flyout, which consumes Escape and arrows).
  let debugPanel: DebugPanel | null = null;
  let updateOrderHistory: (() => void) | null = null;
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
    const filter = document.querySelector<HTMLSelectElement>('#order-history-person')!;
    const history = document.querySelector<HTMLElement>('#order-history')!;
    const copy = document.querySelector<HTMLButtonElement>('#order-history-copy')!;
    const copyStatus = document.querySelector<HTMLElement>('#order-history-copy-status')!;
    let roster = '', revision = -1, lastFilter = '';
    updateOrderHistory = () => {
      if (root.hidden) return;
      const ids = sim.ids(), kinds = sim.kinds();
      const people = Array.from(ids).filter((_, row) => kinds[row] === 0);
      const signature = people.map(entity => `${entity}:${sim.simName(entity)}`).join('|');
      if (signature !== roster) {
        roster = signature;
        const selected = filter.value;
        filter.replaceChildren(new Option('Selected person', 'selected'), new Option('Everyone', 'all'),
          ...people.map(entity => new Option(sim.simName(entity), String(entity))));
        if (Array.from(filter.options).some(option => option.value === selected)) filter.value = selected;
      }
      const entity = filter.value === 'all' ? null : filter.value === 'selected' ? sim.selectedIndex() : Number(filter.value);
      const selection = `${filter.value}:${entity}`;
      if (revision === orderDiagnostics.revision && selection === lastFilter) return;
      revision = orderDiagnostics.revision; lastFilter = selection;
      history.textContent = entity === null && filter.value === 'selected' ? 'Select a person to see their order history.' : orderDiagnostics.history(entity);
    };
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(history.textContent ?? '').then(() => { copyStatus.textContent = 'Copied'; }, () => { copyStatus.textContent = 'Copy failed. Select the history text and copy it.'; });
    });
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
    // Conversations follow the world's pace. Paused counts as normal speed:
    // nothing new starts while paused, and an already-playing conversation
    // should not change pitch because the player reached for the button.
    audio.setGameSpeed(ticksPerFrame > 0 ? ticksPerFrame : 1);
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
  const helpBody = document.querySelector<HTMLElement>('#help-body');
  const newGameDialog = document.querySelector<HTMLDialogElement>('#new-game-dialog');
  const loadGameDialog = document.querySelector<HTMLDialogElement>('#load-game-dialog');
  const confirmNewGame = document.querySelector<HTMLButtonElement>('#confirm-new-game');
  const confirmLoadGame = document.querySelector<HTMLButtonElement>('#confirm-load-game');
  const audioMuteButton = document.querySelector<HTMLButtonElement>('#audio-mute');
  const effectsVolume = document.querySelector<HTMLInputElement>('#effects-volume');
  const effectsVolumeValue = document.querySelector<HTMLOutputElement>(
    '#effects-volume-value',
  );
  const voicesVolume = document.querySelector<HTMLInputElement>('#voices-volume');
  const voicesVolumeValue = document.querySelector<HTMLOutputElement>(
    '#voices-volume-value',
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
    !helpBody ||
    !newGameDialog ||
    !loadGameDialog ||
    !confirmNewGame ||
    !confirmLoadGame ||
    !audioMuteButton ||
    !effectsVolume ||
    !effectsVolumeValue ||
    !voicesVolume ||
    !voicesVolumeValue
  ) {
    throw new Error('missing game action markup');
  }

  const queueMode = new QueueMode(queueButton);
  const audioControls = new AudioControls(
    audio,
    audioMuteButton,
    effectsVolume,
    effectsVolumeValue,
    voicesVolume,
    voicesVolumeValue,
  );
  // Every other fallback may sit in the closed Options panel ([OF2]).
  const persistenceFocusFallbacks = [
    optionsToggle,
    saveButton,
    stopOrdersButton,
    queueButton,
    newGameButton,
    helpButton,
  ] as const;
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
  voicesVolume.addEventListener('input', () => {
    audioControls.previewVoicesPercent(voicesVolume.value);
  });
  voicesVolume.addEventListener('change', () => {
    audioControls.setVoicesPercent(voicesVolume.value);
  });
  saveButton.addEventListener('click', () => {
    const saving = persistence.save();
    syncPersistenceButtons();
    void saving.then(() => syncPersistenceButtons());
  });
  // The housemate dialog and its two openers, found before Load so the load
  // path can close an open edit draft ([ES-form]); the form is set up below.
  const newHousemateButton = document.querySelector<HTMLButtonElement>('#new-housemate');
  const housemateDialog = document.querySelector<HTMLDialogElement>('#housemate-dialog');
  if (!newHousemateButton || !housemateDialog) throw new Error('missing the New housemate form');
  const editHousemateButton = document.querySelector<HTMLButtonElement>('#edit-housemate');
  if (!editHousemateButton) throw new Error('missing the Edit housemate button');
  let loadingGame = false;
  loadButton.addEventListener('click', () => {
    optionsMenu.close();
    menu.close(); overlayPause.suspend('load-game');
    loadGameDialog.showModal();
  });
  loadGameDialog.addEventListener('close', () => {
    if (loadingGame) return;
    restorePersistenceFocus(document, loadGameDialog, optionsToggle, persistenceFocusFallbacks);
    overlayPause.resume('load-game');
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
          wallFade.reset();
          adoptLotShape();
          lot.walls = sim.wallTiles();
          lot.edges = sim.wallEdges();
          lot.windows = sim.windowLines();
          lot.architecture.windows = decodeWindowPlacements(sim.windowPlacements());
          // [FL-draw]: the loaded house's own painted tiles. Without this the
          // previous game's floors stayed on screen, and on a lot of another
          // height they landed on unrelated tiles, because the renderer keys
          // the list by height.
          lot.floors = sim.floorTiles();
          lot.doors = sim.interiorDoorLines();
          lot.horizontalDoors = sim.interiorHorizontalDoorLines();
          lot.frontDoors = sim.frontDoorLines();
          // A world saved before the yard that never grew has no street.
          lot.street = sim.streetColumn();
          // A restored world may reuse entity indices for different live
          // entities. Discard every transient action that names the old world.
          lightingDirty = true;
          cameraDirty = true;
          menu.close();
          keyboardTargets.clear();
          bookResults.resetAfterLoad();
          orderDiagnostics.resetAfterLoad(sim.orderEventsSince('0').nextCursor);
          commandStatus.textContent = '';
          commandStatus.removeAttribute('data-kind');
          bookCommerce.resetAfterLoad();
          builder.resetAfterLoad();
          // [ES-form]: a draft names a person of the replaced world, so
          // close it before the form returns to create mode.
          if (housemateDialog.open) housemateDialog.close('cancel');
          housemateView?.destroy(); housemateView=undefined; creatorSession?.destroy();creatorSession=undefined;
          characterWorld.reset();characterWorld.prepareFixtures(sim);
          bedAssignmentPanel.resetAfterLoad();
          careerPanel.resetAfterLoad();
          syncNewHousemateButton();
          syncEditHousemateButton();
          wallTool.resetAfterLoad(lotWidth, lotHeight);
          windowTool.resetAfterLoad(lotWidth, lotHeight);
          buyTool.resetAfterLoad(lotWidth, lotHeight);
          roomTool.resetAfterLoad(lotWidth, lotHeight);
          floorTool.resetAfterLoad(lotWidth, lotHeight);
          landTool.resetAfterLoad(lotWidth, lotHeight);
          audio.reset('load');
          const nowMs = performance.now();
          householdRoster.update(nowMs, true);
          peoplePanel.update(nowMs, true);
          moodPanel.update(nowMs, true);
          traitsPanel.update(nowMs, true);
          personalDetailsPanel.update(nowMs, true);
          skillsPanel.update(nowMs, true);
          affinitiesPanel.update(nowMs, true);
          bedAssignmentPanel.update(nowMs, true);
          careerPanel.update(nowMs, true);
        }
      })
      .finally(() => {
        loadingGame = false;
        syncPersistenceButtons();
        restorePersistenceFocus(
          document,
          loadGameDialog,
          optionsToggle,
          persistenceFocusFallbacks,
        );
        overlayPause.resume('load-game');
      });
  });
  let housemateOpener: HTMLButtonElement = optionsToggle;
  let housemateView: CreatorView | undefined;
  let creatorSession: CreatorSession | undefined;
  const syncNewHousemateButton = (): void => {
    const [current, limit] = sim.householdSize();
    newHousemateButton.disabled = buildSession.active || graphicsRecovering || current >= limit;
  };
  const syncEditHousemateButton = (): void => {
    editHousemateButton.disabled = buildSession.active || graphicsRecovering || !!creatorSession?.pending || sim.selectedIndex() === null;
  };
  const openCreator = (person: number | null): void => {
    const members = householdMembers(sim).map(member => ({ sim_id: member.simId, name: member.name }));
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    creatorSession = new CreatorSession(sim, seed, members, person, entity => {
      sim.select(entity);
      housemateDialog.close('confirm');
      const nowMs = performance.now();
      householdRoster.update(nowMs, true);
      if (needsPanel.update(nowMs, sim)) syncDockSummary();
      peoplePanel.update(nowMs, true);
      traitsPanel.update(nowMs, true);
      personalDetailsPanel.update(nowMs, true);
      skillsPanel.update(nowMs, true);
      affinitiesPanel.update(nowMs, true);
      careerPanel.update(nowMs, true);
    },new CharacterContactOwner(characterContacts,contactRoster));
    housemateView?.destroy();
    housemateView = new CreatorView(housemateDialog.querySelector<HTMLElement>('#character-creator-root')!,
      creatorSession, gpu.device, gpu.format, () => housemateDialog.close('cancel'));
    menu.close();
    overlayPause.suspend('housemate');
    housemateDialog.showModal();
  };
  syncNewHousemateButton();
  syncEditHousemateButton();
  editHousemateButton.addEventListener('click', () => {
    if (buildSession.active) return;
    const selected = sim.selectedIndex();
    if (selected === null) return;
    const person = sim.simIdOf(selected);
    if (person === null) return;
    housemateOpener = editHousemateButton;
    openCreator(person);
  });
  newHousemateButton.addEventListener('click', () => {
    optionsMenu.close();
    if (buildSession.active) return;
    housemateOpener = optionsToggle;
    openCreator(null);
  });
  housemateDialog.addEventListener('cancel', event => {
    if (creatorSession?.pending) event.preventDefault();
  });
  housemateDialog.addEventListener('close', () => {
    housemateView?.destroy();
    housemateView = undefined;
    creatorSession?.destroy();
    creatorSession = undefined;
    overlayPause.resume('housemate');
    syncNewHousemateButton();
    syncEditHousemateButton();
    restorePersistenceFocus(document, housemateDialog, housemateOpener, persistenceFocusFallbacks);
    if (graphicsRecovering) {
      const status = document.getElementById('graphics-recovery');
      if (status) document.body.append(status);
    }
  });
  window.addEventListener('pagehide', event => { if (!event.persisted) {housemateView?.destroy();creatorSession?.destroy();} });
  let clearingForNewGame = false;
  newGameButton.addEventListener('click', () => {
    optionsMenu.close();
    menu.close(); overlayPause.suspend('new-game');
    newGameDialog.showModal();
  });
  newGameDialog.addEventListener('close', () => {
    if (clearingForNewGame) return;
    restorePersistenceFocus(document, newGameDialog, optionsToggle, persistenceFocusFallbacks);
    overlayPause.resume('new-game');
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
          optionsToggle,
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

  const helpPanel = new HelpPanel(helpRoot, helpBody, helpTitle, preferences);
  const lightingMode = new LightingMode(lightingModeButton, preferences);
  let helpReturnTarget: HTMLElement = canvas;
  const firstRunHelpOpened = helpPanel.showOnFirstRun();
  if (firstRunHelpOpened) overlayPause.suspend('help');
  helpButton.setAttribute('aria-expanded', String(helpRoot.open));
  helpButton.addEventListener('click', () => {
    optionsMenu.close();
    helpReturnTarget = optionsToggle;
    menu.close();
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

  // Audio's half of this event is handled at the top of main(); this half
  // needs `persistence`, which does not exist until the awaits have run.
  document.addEventListener('visibilitychange', () => {
    const hidden = document.visibilityState === 'hidden';
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
  let depthScale = Math.max(lotWidth, lotHeight);

  // **The camera.** One scale and two origins, all live state. `cameraOrigin`
  // seeds the centered initial view once. Pan and anchored zoom own the origins
  // afterward; `applyCamera` preserves the center across buffer resizes and
  // clamps the result rather than resetting the player's view.
  //
  // Both visible heights use atlas anchors and content bounds, so adding taller
  // furniture moves the camera extent rather than silently invalidating a
  // fixed magic number. `cameraOrigin` centres that DRAWN extent; if a lot
  // is ever big enough to exceed the viewport, the overflow is shared
  // equally between the two edges and pan reaches either.
  const tallestSprite = Math.max(...SPRITES.map((_, index) => spriteFramingHeight(index)));
  // Reserve wall height above the first boundary panels, and furniture
  // height above the first interior tile. Their anchors differ by 0.5
  // half-tile rows; furniture cannot stand outside the lot.
  const boundaryNames: readonly string[] = BOUNDARY_SPRITE_NAMES;
  const tallestBoundarySprite = Math.max(
    ...SPRITES.flatMap((sprite, index) => boundaryNames.includes(sprite.name) ? [spriteFramingHeight(index)] : []),
  );
  const lot = { width: lotWidth, height: lotHeight, walls: sim.wallTiles(), edges: sim.wallEdges(),
    windows: sim.windowLines(),
    windowPreview: null as import('./architecture/windows.js').WindowEditPreview | null,
    architecture: { windows: decodeWindowPlacements(sim.windowPlacements()), catalogue: sim.windowCatalogue(),
      finishes: architectureAtlas.finishes },
    floorPreview: null as readonly number[] | null,
    // [FL-draw]: what the player has laid, and each covering's shift.
    floors: sim.floorTiles(),
    coveringLooks: sim.coveringLooks(),
    doors: sim.interiorDoorLines(), horizontalDoors: sim.interiorHorizontalDoorLines(), house: sim.houseSize(),
    houseOrigin: sim.houseOrigin() as readonly [number, number], yardLook: sim.yardLook(),
    street: sim.streetColumn(), streetLook: sim.streetLook(), showCutAwayWalls: false,
    selectedLines: null as ReadonlyMap<string, boolean> | null,
    frontDoors: sim.frontDoorLines(),
    // [SEA-yard]: the yard's seasonal looks, content read once, and the
    // last season the frame loop saw.
    seasonYardLooks: sim.seasonYardLooks(), season: sim.seasonIndex() };
  const camera = { scale: 1, originX: 0, originY: 0 };
  let cameraDirty = true;
  let lightingDirty = false;
  // The house's implicit shell is a wall to the lamps and the sky once
  // bought land lies beyond it (land expansion, issue 254).
  const lightingEdges = (): Uint32Array | null =>
    edgesWithShell(lot.edges, lot.house, lot.houseOrigin, lot.width, lot.height, lot.windows ?? []);
  let lighting = buildLightField(sim, lotWidth, lotHeight, lot.walls, true, lightingEdges(), lot.windows);
  // [OS-daylight]: how much open sky each tile sees, rebuilt with the lamp
  // field whenever the lot's walls change.
  const [interiorDaylightShade, daylightReachPerTile] = sim.daylightTuning();
  const buildSky = (): SkyExposure =>
    buildSkyExposure(lot.width, lot.height, lightingEdges(), lot.house ?? null, daylightReachPerTile, lot.windows, lot.houseOrigin);
  let sky = buildSky();
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
  // How far the Land tool's strips reach beyond the lot; set once the tool exists.
  let landReach = (): number => 0;
  function clampCamera(): void {
    const bounded = clampOrigin(
      camera.originX,
      camera.originY,
      landExtent(
        lotWidth,
        lotHeight,
        landReach(),
        tallestSprite,
        tallestBoundarySprite,
        camera.scale,
      ),
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
   * world, a lot edit, and a flat-light toggle all enter through the
   * camera-dirty gate; restore and lot edits additionally refresh the light
   * map inside that gate. Ordinary frames do not upload this block ([V11]
   * is what an ungated rebuild costs; during a drag this runs once per
   * FRAME, not per event).
   *
   * The origin is FREE STATE since pan landed ([V8]): it starts at
   * `cameraOrigin`'s centred answer and belongs to the gestures from
   * then on, so this must never re-derive it - only keep the view's
   * centre steady across a buffer resize by shifting half the delta.
   */
  let cameraInitialised = false;
  const wallFade = new WallFade();
  function applyCamera(): void {
    const outside = sim.roomTiles(0);
    if (!outside.ok) throw new Error('Outdoor weather tiles are unavailable.');
    weatherScene.setOutside(outside.value, lotWidth, lotHeight, ...lot.houseOrigin);
    if (lightingDirty) {
      lighting = buildLightField(sim, lotWidth, lotHeight, lot.walls, true, lightingEdges(), lot.windows);
      sky = buildSky();
      lightingDirty = false;
    }
    const ratio = window.devicePixelRatio || 1;
    const [width,height]=sceneFramebufferSize(stage.clientWidth,stage.clientHeight,ratio,gpu.device.limits.maxTextureDimension2D);
    if (stage.width !== width || stage.height !== height) {
      const dx = (width - stage.width) / 2;
      const dy = (height - stage.height) / 2;
      stage.width = width;
      stage.height = height;
      camera.originX += dx;
      camera.originY += dy;
    }
    if (!cameraInitialised) {
      // [OS-camera]: the view opens framed on the house; pan reaches the yard.
      const [openWidth, openHeight] = openingExtent(lotWidth, lotHeight, lot.house);
      const origin = cameraOrigin(
        stage.width,
        stage.height,
        openWidth,
        openHeight,
        tallestSprite,
        tallestBoundarySprite,
        camera.scale,
      );
      camera.originX = origin.x;
      camera.originY = origin.y;
      // The house stands away from the grid's origin once land lies behind
      // or beside it; the view opens framed on it where it is.
      const [houseX, houseY] = lot.houseOrigin;
      camera.originX -= (houseX - houseY) * TILE_HALF_WIDTH * camera.scale;
      camera.originY -= (houseX + houseY) * TILE_HALF_HEIGHT * camera.scale;
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
      sky,
    );
    wallFade.configure(staticGeometry.lowInstances, staticGeometry.lowPanels, lot.width, lot.height);
    renderer.setArchitectureCamera(camera.originX, camera.originY);
    renderer.setStaticGeometry(staticGeometry.instances, staticGeometry.count, staticGeometry.lowInstances);

    cameraDirty = false;
  }
  // Flagged rather than applied: a drag-resize fires this continuously,
  // and the flag coalesces the burst into one rebuild on the next frame.
  let placementActions: BuildContextActions | undefined;
  window.addEventListener('resize', () => {
    cameraDirty = true;
    placementActions?.invalidate();
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
  // Queue mode or the modifier held on the row: either appends, the same
  // rule the canvas click follows.
  const menu: ObjectMenu = new ObjectMenu(createMenuSurface(document, menuRoot, {
    anchor(model) {
      if (model.object === undefined) return null;
      const row = Array.from(sim.ids()).indexOf(model.object);
      if (row < 0) return null;
      const positions = sim.positions(), x = positions[row * 2], y = positions[row * 2 + 1];
      const sprite = sim.sprites()[row];
      const object = sim.objectModel(model.object);
      if (!object) return null;
      const footprint = { x, y, width: object.width, depth: object.depth };
      const height = spriteFramingHeight(sprite);
      return canvasToClient(ghostAnchorX(footprint, camera, spriteDrawOffsetX(sprite)),
        ghostAnchorTop(footprint, camera, height) + height * camera.scale / 2,
        stage.getBoundingClientRect(), stage.width, stage.height);
    },
    revision: () => [camera.originX, camera.originY, camera.scale, stage.width, stage.height, sim.clockTick()].join(','),
    keepouts: () => ['hud', 'time-controls', 'build-toggle', 'options-toggle', 'build-camera', 'sim-dock', 'builder-controls']
      .map(id => document.getElementById(id)?.getBoundingClientRect())
      .filter((rect): rect is DOMRect => !!rect && rect.width > 0 && rect.height > 0),
    dismiss: () => menu.close(),
  }), (action, additive) => {
    if (action.kind === 'build') {
      if (overlayPause.suspendedExcept('builder') || builder.pending) return;
      for (const tool of buildTools) tool.exit();
      builder.selectForBuild(action.object); builderControls?.render(); toolSwitch?.render();
      bookCommerce.render(builder.selected); placementActions?.invalidate(); cameraDirty = true;
      return;
    }
    if (overlayPause.suspendedExcept('builder')) return;
    if (action.kind === 'buy-book') { if (action.quote) bookCommerce.purchaseBook(action.quote); return; }
    if (action.kind === 'sell-book') { if (action.quote) bookCommerce.sellBook(action.quote); return; }
    if (action.kind === 'recover-book') { bookCommerce.recoverBook(action.copy); return; }
    if (builder.active) return;
    const accepted = dispatchMenuAction(sim, action, queueMode.isActive() || additive ? 'back' : 'front',
      () => clearCommandFeedback(commandStatus));
    if (!accepted) { commandStatus.textContent = 'That order could not be added'; commandStatus.setAttribute('data-kind', 'error'); }
    audio.emit({ type: accepted ? 'command.staged' : 'command.rejected' });
  }, action => {
    if (overlayPause.suspendedExcept('builder') || roomReview.active) return false;
    if (action.kind === 'build') return !builder.pending && !buildTools.some(tool => Boolean(tool.pending));
    return ['buy-book', 'sell-book', 'recover-book'].includes(action.kind) || !builder.active;
  });
  optionsToggle.addEventListener('click', () => menu.close());
  const keyboardStatus = document.querySelector<HTMLElement>('#keyboard-target');
  if (!keyboardStatus) throw new Error('missing #keyboard-target');
  const keyboardTargets = new KeyboardTargetController(sim, keyboardStatus);
  const choresDialog=document.createElement('dialog');choresDialog.id='chores-dialog';
  const choresTitle=document.createElement('h2');choresTitle.id='chores-title';choresTitle.textContent='Chores';
  choresDialog.setAttribute('aria-labelledby','chores-title');
  const choresClose=document.createElement('button');choresClose.type='button';choresClose.className='hud-button';choresClose.textContent='Close';setActionIntent(choresClose,'negative');
  const choresBoard=new ChoresBoard(sim,document,()=>choresDialog.close());
  const choresHeader=document.createElement('header');choresHeader.className='chores-header';choresHeader.append(choresTitle,choresClose);
  choresDialog.append(choresHeader,choresBoard.element());document.body.append(choresDialog);
  choresClose.addEventListener('click',()=>choresDialog.close());
  document.querySelector('#chores-toggle')!.addEventListener('click',()=>{if(buildSession.active)return;optionsMenu.close();menu.close(); overlayPause.suspend('chores');choresBoard.update();choresDialog.showModal();});
  choresDialog.addEventListener('close',()=>overlayPause.resume('chores'));
  const buildToggle = document.querySelector<HTMLButtonElement>('#build-toggle');
  if (!buildToggle) throw new Error('Missing Build button');
  let builderControls: BuilderControls;
  // [WT-shell]. Build mode's second tool; it is only ever active while the
  // furniture builder is, because Build is what pauses the household.
  let wallControls: WallToolControls | undefined;
  // [BM-shell]. The third tool, beside Furniture and Walls.
  let buyControls: BuyToolControls | undefined;
  let toolSwitch: BuildToolSwitch | undefined;
  let windowControls: WindowToolControls | undefined;
  const windowTool = new WindowTool(sim, lotWidth, lotHeight, {
    changed: () => {
      placementActions?.invalidate();
      lot.windowPreview = windowTool.preview();
      cameraDirty = true;
      windowControls?.render();
      wallControls?.render();
    },
  });
  const wallTool = new WallTool(sim, lotWidth, lotHeight, {
    changed: () => {
      wallControls?.render();
      windowControls?.render();
      toolSwitch?.render();
      placementActions?.invalidate();
    },
  }, windowTool);
  // [WB-height]: the Walls and Room tools' wall height, Low unless the player asks for Full.
  let wallViewControls: WallViewControls | undefined;
  const wallView = new WallView(() => { wallViewControls?.render(); cameraDirty = true; });
  /** The line a click would choose, drawn as a fainter bar while the Walls tool is in use ([WB-pick]). */
  let hoverLine: WallLine | null = null;
  /** Every barrier line at the height the static walls draw it, for picking the one under the pointer. */
  const wallFacesNow = () => wallFaces({
    width: lot.width, height: lot.height, house: lot.house, houseOrigin: lot.houseOrigin,
    edges: lot.edges ?? [], windowLines: lot.windows ?? [],
    hinged: [...(lot.doors ?? []), ...(lot.frontDoors ?? [])], horizontalHinged: lot.horizontalDoors ?? [],
    low: lot.showCutAwayWalls !== true, raised: new Set(lot.selectedLines?.keys() ?? []),
  });
  /** The line under a canvas point, and the floor point that chose it when no drawn wall did. */
  const pickWallAt = (point: { x: number; y: number }): { line: WallLine | null; floor: [number, number] | null } => {
    const face = pickWallFace(point.x, point.y, camera, wallFacesNow());
    if (face) return { line: face, floor: null };
    const floor = floorPoint(point.x, point.y, camera, lot.width, lot.height);
    return { line: floor ? nearestLine(floor[0], floor[1], lot.width, lot.height) : null, floor };
  };
  const buyTool = new BuyTool(sim, lotWidth, lotHeight, {
    changed: () => {
      buyControls?.render();
      toolSwitch?.render();
      placementActions?.invalidate();
    },
  });

  const bookCommerce = new BookCommerce(sim, bookResults, document, (text, error) => {
    commandStatus.textContent = text;
    commandStatus.setAttribute('data-kind', error ? 'error' : 'info');
    actionQueue.invalidate(); placementActions?.invalidate();
  });
  // [RT-shell]. A whole room in one edit, beside the one-line Walls tool.
  let roomControls: RoomToolControls | undefined;
  const roomTool = new RoomTool(sim, lotWidth, lotHeight, {
    changed: () => {
      roomControls?.render();
      toolSwitch?.render();
      placementActions?.invalidate();
    },
  });
  let selectionControls: RoomSelectionControls | undefined;
  let reviewControls: RoomReviewControls | undefined;
  let finishReview: ((adopted: boolean) => void) | null = null;
  const roomSelection = new RoomSelection(sim, () => {
    selectionControls?.render(); cameraDirty = true;
    if (buildSession.active && (sim.buildDirty() || roomSelection.hasLocalChanges())) {
      setBuildStatus(roomSelection.error, roomSelection.error !== '');
    }
  });
  const roomsTool = new RoomsTool(roomSelection, roomTool, () => {
    selectionControls?.render(); toolSwitch?.render(); placementActions?.invalidate(); cameraDirty = true;
  });
  const roomReview = new RoomReviewController(sim, {
    changed: () => { reviewControls?.render(); placementActions?.invalidate(); cameraDirty = true; },
    completed: adopted => {
      if (!adopted) { buildSession.noteReviewCancellation(); buildExit.clearExitIntent(); }
      const finish = finishReview; finishReview = null; finish?.(adopted);
    },
    refused: () => buildExit.cancelDestination(),
  });
  hasRetainedReviewChoices = () => roomReview.hasChoices;
  requestRoomReview = review => new Promise<boolean>(resolve => {
    finishReview = resolve; optionsMenu.close(); menu.close(); roomReview.open(review);
  });
  // [FL-tool]. A covering laid on one tile, beside the tools that move
  // walls and furniture.
  let floorControls: FloorToolControls | undefined;
  let floorResourceError: string | null = null;
  let syncFloorResources = (): void => {};
  const floorTool = new FloorTool(sim, lotWidth, lotHeight, {
    changed: () => {
      syncFloorResources();
      lot.floorPreview = floorTool.preview();
      cameraDirty = true;
      floorControls?.render();
      toolSwitch?.render();
      placementActions?.invalidate();
    },
  });
  const presentFloorSceneStatus = createFloorSceneStatus(document, stage, () => floorResources.retry());
  const floorScene = new FloorScenePresentation({
    suspend: () => { menu.close(); overlayPause.suspend('floor-materials'); },
    resume: () => overlayPause.resume('floor-materials'),
    status: (blocked, error) => {
      // At startup the cover stays up while floors load, and gives way to
      // the floor status card when they fail, so Retry can be reached.
      if (error) loading.finish();
      else if (blocked) loading.note('Loading floor materials');
      presentFloorSceneStatus(blocked, error);
    },
  });
  const syncFloorScene = () => floorScene.update(activeFloorFinishKeys(sim.floorTiles(), null),
    lot.architecture.finishes?.keys ?? [], floorResourceError);
  const floorResources = new FloorFinishResources<{ renderer: SpriteRenderer; finishes: ActiveFinishes | undefined }>({
    // Reports to the startup cover, which ignores it once lifted: on the
    // startup fallback path this load is what the cover is waiting for.
    prepare: async finishKeys => {
      const atlas = await loadArchitectureAtlas(gpu.device.limits, { finishKeys, progress: startupProgress });
      try {
        return { renderer: await SpriteRenderer.create(gpu, atlas, startupProgress), finishes: atlas.finishes };
      }
      finally { closeArchitectureAtlas(atlas); }
    },
    publish: next => {
      const previous = renderer, previousFinishes = lot.architecture.finishes;
      renderer = next.renderer;
      lot.architecture.finishes = next.finishes;
      lot.floors = sim.floorTiles();
      try { applyCamera(); }
      catch (error) {
        renderer = previous;
        lot.architecture.finishes = previousFinishes;
        throw error;
      }
      previous.destroy();
    },
    dispose: next => next.renderer.destroy(),
    state: (ready, error) => {
      floorResourceError = error;
      if (error) console.warn('Floor material resource failed', error);
      floorTool.setResourceStatus(ready ? null : error ? 'Floor materials could not load. Try again.' : 'Loading floor materials.', error !== null);
      syncFloorScene();
      cameraDirty = true;
    },
  }, residentFinishKeys);
  syncFloorResources = () => {
    floorResources.request(activeFloorFinishKeys(sim.floorTiles(), floorTool.active ? floorTool.chosen : null));
    syncFloorScene();
  };
  syncFloorResources();
  // Rule 8 of the land expansion spec: a strip of land beside the lot,
  // quoted by the simulation and confirmed twice.
  let landControls: LandToolControls | undefined;
  const landTool = new LandTool(sim, lotWidth, lotHeight, {
    changed: () => {
      clampCamera();
      cameraDirty = true;
      landControls?.render();
      toolSwitch?.render();
      placementActions?.invalidate();
    },
  });
  landReach = () => landTool.reach();
  const buildTools = [wallTool, roomsTool, buyTool, floorTool, landTool] as const;
  // [PA-show]: Context actions surround the active selection. They sit
  // above the phone's Build dock when it is showing, else anywhere in the
  // window.
  const placementRoot = document.querySelector<HTMLElement>('#placement-actions');
  const builderDock = document.querySelector<HTMLElement>('#builder-dock');
  if (!placementRoot || !builderDock) {
    throw new Error('missing the placement buttons');
  }
  const syncBuildViewport = (): void => {
    const viewport = window.visualViewport;
    const style = document.documentElement.style;
    style.setProperty('--build-visible-height', `${viewport?.height ?? innerHeight}px`);
    style.setProperty('--build-visible-width', `${viewport?.width ?? innerWidth}px`);
    style.setProperty('--build-visible-left', `${viewport?.offsetLeft ?? 0}px`);
    style.setProperty('--build-visible-bottom', `${Math.max(0, innerHeight - (viewport?.height ?? innerHeight) - (viewport?.offsetTop ?? 0))}px`);
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.matches('#room-name, #room-review input, #room-review select')) {
      requestAnimationFrame(() => { if (document.activeElement === focused) focused.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
    }
  };
  window.visualViewport?.addEventListener('resize', syncBuildViewport);
  window.visualViewport?.addEventListener('scroll', syncBuildViewport);
  window.addEventListener('resize', syncBuildViewport);
  syncBuildViewport();
  const contextLayout = createCompactBuildLayout(document, placementRoot, () => compactBuildQuery.matches);
  // [PA-place]: clear of the desktop sidebar, which holds the Build panel,
  // and of the compact world controls. The Build dock bounds the bottom.
  const placementKeepOut = (): KeepOut => {
    const gear = hudRoot.getBoundingClientRect();
    const options = optionsPanel.hidden ? gear : optionsPanel.getBoundingClientRect();
    return {
      left: compactBuildQuery.matches ? 0 : hudRoot.getBoundingClientRect().right,
      gearLeft: gear.left,
      gearBottom: Math.max(gear.bottom, options.bottom),
      gearRight: Math.max(gear.right, options.right),
    };
  };
  const dockTop = (): number => {
    const panel = builderDock.querySelector<HTMLElement>('#builder-controls');
    return compactBuildQuery.matches && panel !== null && !panel.hidden
      ? builderDock.getBoundingClientRect().top
      : document.documentElement.clientHeight;
  };
  const builder = new FurnitureBuilder(sim, overlayPause, {
    beforeEnter: () => {
      if (buildSession.begin()) return true;
      commandStatus.textContent = buildSession.error || 'Build mode could not open.';
      commandStatus.setAttribute('data-kind', 'error');
      return false;
    },
    // Every way out asks first while changes are not confirmed; see build-exit.ts.
    beforeExit: () => buildExit.gate(),
    changed: () => {
      builderControls?.render();
      placementActions?.invalidate();
    },
    enter() {
      optionsMenu.close();
      syncBuildIsolation();
      setBuildStatus('');
      document.querySelectorAll<HTMLDetailsElement>('#builder-controls .shortcuts').forEach(section => { section.open = false; });
      canvas.focus();
      menu.close();
      keyboardTargets.clear();
      compactHud.beginEditing();
      syncBuildOptionsHost();
      cameraDirty = true;
    },
    exit() {
      syncBuildIsolation();
      contextLayout.setRows(false);
      wallTool.exit();
      roomsTool.exit();
      buyTool.exit();
      floorTool.exit();
      landTool.exit();
      compactHud.endEditing();
      syncBuildOptionsHost();
      optionsMenu.close();
      builderControls?.render();
      document.querySelector<HTMLButtonElement>('#build-toggle')?.focus();
      cameraDirty = true;
    },
  });
  const buildBatchStatus = document.querySelector<HTMLElement>('#build-batch-status')!;
  /** The footer's status; a refusal is marked so it reads as an error. */
  function setBuildStatus(text: string, error = false): void {
    buildBatchStatus.textContent = text;
    if (error) buildBatchStatus.setAttribute('data-kind', 'error'); else buildBatchStatus.removeAttribute('data-kind');
  }
  // What decides whether leaving Build mode would lose a change; see build-exit.ts.
  const buildDraft: BuildDraftSources = {
    session: buildSession, furniture: builder,
    tools: [wallTool, windowTool, roomTool, buyTool, floorTool, landTool],
    pendingBookCommands: () => sim.pendingBookCommands(),
  };
  function syncBuildIsolation(): void {
    syncNewHousemateButton(); syncEditHousemateButton();
    document.querySelector<HTMLButtonElement>('#chores-toggle')!.disabled = buildSession.active;
    document.querySelector<HTMLElement>('#sim-dock')!.inert = buildSession.active;
    deathInput!.disabled = buildSession.active;
    careerAutonomy.setDisabled(buildSession.active);
  }
  function settleBuildControllers(): boolean {
    wallTool.afterCommands(); windowTool.afterCommands(); roomTool.afterCommands();
    floorTool.afterCommands(); buyTool.afterCommands(); landTool.afterCommands();
    if (adoptLotShape()) refreshLotPresentation();
    housemateView?.afterCommands(); bedAssignmentPanel.afterCommands(); careerPanel.afterCommands(); bookResults.drain();
    if (builder.afterCommands()) refreshBuildArchitecture();
    return buildCommandsIdle(buildDraft);
  }
  function prepareBuildConfirmation(): boolean {
    if (!roomSelection.validate()) return false;
    // Tool actions apply to the draft. Include an outstanding furniture move
    // when the player uses the batch Confirm instead of its nearby Place button.
    if (!buildTools.some(tool => tool.active) && builder.hasPlacementChange) {
      if (!builder.confirm()) return false;
      sim.flushCommands();
      const accepted = sim.lastPlacementResult()?.reason === null;
      if (builder.afterCommands()) refreshBuildArchitecture();
      return accepted;
    }
    return true;
  }
  function refreshBuildArchitecture(): void {
    lot.walls = sim.wallTiles(); lot.edges = sim.wallEdges();
    lot.windows = sim.windowLines();
    lot.architecture.windows = decodeWindowPlacements(sim.windowPlacements());
    lot.floors = sim.floorTiles(); syncFloorResources();
    lot.doors = sim.interiorDoorLines(); lot.horizontalDoors = sim.interiorHorizontalDoorLines();
    lot.frontDoors = sim.frontDoorLines();
    lightingDirty = true; cameraDirty = true; keyboardTargets.clear();
    if (buildSession.active && hasUnconfirmedChanges(buildDraft)) setBuildStatus('');
  }
  /**
   * Reads the lot's size and the house's place from the simulation; true
   * when either changed, as a land purchase, its cancellation or a Load
   * changes them. The view keeps the house where it was on screen.
   */
  function adoptLotShape(): boolean {
    const width = handle.lot_width();
    const height = handle.lot_height();
    const [houseX, houseY] = sim.houseOrigin();
    const [oldX, oldY] = lot.houseOrigin;
    if (width === lotWidth && height === lotHeight && houseX === oldX && houseY === oldY) return false;
    lotWidth = width; lotHeight = height;
    depthScale = Math.max(lotWidth, lotHeight);
    lot.width = lotWidth; lot.height = lotHeight;
    lot.houseOrigin = [houseX, houseY];
    lot.street = sim.streetColumn();
    camera.originX -= ((houseX - oldX) - (houseY - oldY)) * TILE_HALF_WIDTH * camera.scale;
    camera.originY -= ((houseX - oldX) + (houseY - oldY)) * TILE_HALF_HEIGHT * camera.scale;
    lightingDirty = true; cameraDirty = true;
    return true;
  }
  /** After the lot changed shape under Build mode: every tool and the walls start afresh on the new lot. */
  function refreshLotPresentation(): void {
    wallFade.reset(); keyboardTargets.clear();
    builder.resetAfterLoad(); wallTool.resetAfterLoad(lotWidth, lotHeight);
    windowTool.resetAfterLoad(lotWidth, lotHeight); roomTool.resetAfterLoad(lotWidth, lotHeight);
    buyTool.resetAfterLoad(lotWidth, lotHeight); floorTool.resetAfterLoad(lotWidth, lotHeight);
    landTool.setLotSize(lotWidth, lotHeight);
    characterWorld.reset(); characterWorld.prepareFixtures(sim);
    refreshBuildArchitecture(); clampCamera();
    toolSwitch?.render(); placementActions?.invalidate();
  }
  function restoreBuildPresentation(): void {
    const reshaped = adoptLotShape();
    menu.close(); keyboardTargets.clear(); wallFade.reset();
    bookResults.resetAfterLoad(); bookCommerce.resetAfterLoad();
    builder.resetAfterLoad(); wallTool.resetAfterLoad(lotWidth, lotHeight);
    windowTool.resetAfterLoad(lotWidth, lotHeight); roomTool.resetAfterLoad(lotWidth, lotHeight);
    buyTool.resetAfterLoad(lotWidth, lotHeight); floorTool.resetAfterLoad(lotWidth, lotHeight);
    // As after a Load: a land purchase still on its way was dropped with the draft.
    landTool.resetAfterLoad(lotWidth, lotHeight);
    if (reshaped) { characterWorld.reset(); characterWorld.prepareFixtures(sim); }
    refreshBuildArchitecture(); audio.reset('load'); clampCamera();
    toolSwitch?.render(); placementActions?.invalidate();
  }
  async function confirmBuildBatch(): Promise<boolean> {
    const confirmed = await buildSession.confirm();
    const reason = confirmed || buildSession.confirmationCancelled ? ''
      : roomSelection.error || buildSession.error || confirmRefusal(builder.hasPlacementChange);
    setBuildStatus(reason, reason !== '');
    if (confirmed) {
      builder.cancel(); wallTool.clearSelection(); windowTool.handleKey('Escape');
      roomTool.cancel(); buyTool.cancel(); floorTool.clearSelection(); landTool.clearSelection();
      placementActions?.invalidate();
      roomSelection.reset(); choresBoard.update(); refreshBuildArchitecture();
      setBuildStatus('');
    }
    return confirmed;
  }
  // Both footer actions leave after success; Land starts a fresh paused batch.
  const buildExit: BuildExit = new BuildExit(document, {
    hasUnconfirmedChanges: () => hasUnconfirmedChanges(buildDraft) || roomSelection.hasLocalChanges() || roomReview.hasChoices,
    confirm: confirmBuildBatch,
    discard: () => {
      const cancelled = buildSession.end();
      if (!cancelled) setBuildStatus(buildSession.error || 'Changes could not be cancelled. Try Cancel again.', true);
      return cancelled;
    },
    refusal: () => buildBatchStatus.getAttribute('data-kind') === 'error' ? buildBatchStatus.textContent ?? '' : '',
    leave: () => { builder.exit(); return !builder.active; },
    focusView: () => canvas.focus(),
    // Escape clears the current tool's selection first; with none, it asks to leave.
    escapeBuild: () => { if (roomReview.active) roomReview.back(); else routeBuildKey('Escape', buildTools, builder); },
    escapeAllowed: () => builder.active && !menu.isShowing() && !overlayPause.suspendedExcept('builder'),
    beforeAsk: () => { optionsMenu.close(); menu.close(); },
  });
  replaceBuildLocalState = reason => {
    buildExit.dismiss(); roomReview.reset(); roomSelection.reset();
    if (reason === 'load' || reason === 'end') roomSelection.select(null);
  };
  function syncBuildOptionsHost(): void {
    if (!optionsRoot) return;
    const host = document.getElementById(builder.active && compactBuildQuery.matches ? 'build-camera' : 'world-actions')!;
    if (optionsRoot.parentElement === host) return;
    const focused = optionsRoot.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    host.append(optionsRoot);
    focused?.focus();
  }
  const placementButtons = new BuildContextActions(
    { furniture: builder, buy: buyTool, walls: wallTool, room: roomTool, floors: floorTool,
      clearSelection: () => clearBuildSelection(buildTools, builder),
      suspended: () => optionsMenu.isOpen() || roomReview.active,
      focusCatalogue: () => buyControls?.focusCatalogue() },
    createContextSurface(document, placementRoot, stage,
      () => {
        const zoom = document.querySelector<HTMLElement>('#build-camera')!.getBoundingClientRect();
        return { width: document.documentElement.clientWidth, bottom: dockTop(), keepOut: placementKeepOut(),
          topRight: { left: zoom.left, bottom: zoom.bottom } };
      },
      () => placementActions?.invalidate(), contextLayout, (dx, dy) => {
        const rect = stage.getBoundingClientRect();
        camera.originX += dx * stage.width / rect.width;
        camera.originY += dy * stage.height / rect.height;
        clampCamera(); applyCamera();
      }),
    // The visible art: its height from the content bounds, which cover
    // furniture, and the taller of the body and its foreground layer.
    (ghost) => ({
      height: Math.max(spriteFramingHeight(ghost.sprite),
        ghost.foreground === null ? 0 : spriteFramingHeight(ghost.foreground)),
      offsetX: spriteDrawOffsetX(ghost.sprite),
    }),
  );
  // The resize listener above was registered before the buttons existed.
  placementActions = placementButtons;
  installShortcuts(document, sim.coveringNames());
  builderControls = new BuilderControls(document, builder);
  builderControls.setCompact(compactBuildQuery.matches);
  wallControls = new WallToolControls(document, wallTool);
  wallControls.setCompact(compactBuildQuery.matches);
  windowControls = new WindowToolControls(document, windowTool, wallTool);
  windowControls.setCompact(compactBuildQuery.matches);
  wallViewControls = new WallViewControls(document, wallView, ['wall', 'room']);
  buyControls = new BuyToolControls(document, buyTool, sim.needNames(), cards => {
    drawCataloguePreviews(cards).catch(error => console.warn('The catalogue pictures were not drawn.', error));
  });
  buyControls.setCompact(compactBuildQuery.matches);
  roomControls = new RoomToolControls(document, roomTool);
  selectionControls = new RoomSelectionControls(document, roomsTool);
  reviewControls = new RoomReviewControls(document, roomReview, point => {
    camera.originX = stage.width / 2 - screenX(point[0], point[1], 0, camera.scale);
    camera.originY = stage.height * 0.35 - screenY(point[0], point[1], 0, camera.scale);
    clampCamera(); cameraDirty = true;
  }, id => {
    const row = Array.from(sim.simIds()).indexOf(id);
    return row < 0 ? 'Former housemate' : sim.simName(sim.ids()[row]);
  }, entity => sim.simName(entity), () => canvas.focus(), entity => sim.entityName(entity));
  roomControls.setCompact(compactBuildQuery.matches);
  floorControls = new FloorToolControls(document, floorTool, (canvas, covering) =>
    drawFloorSwatch(canvas, covering, lot.coveringLooks.subarray((covering - 1) * 3, covering * 3)), () => floorResources.retry());
  floorControls.setCompact(compactBuildQuery.matches);
  landControls = new LandToolControls(document, landTool);
  landControls.setCompact(compactBuildQuery.matches);
  document.querySelector<HTMLButtonElement>('#builder-exit')?.addEventListener('click', () => builder.exit());
  const zoomView = (direction: -1 | 1): void => {
    const rect = stage.getBoundingClientRect();
    const bounds = placementKeepOut();
    const free = contextLayout.freeArea();
    const anchorX = ((free ? free.left + free.width / 2 : (bounds.left + rect.right) / 2) - rect.left) * stage.width / rect.width;
    const centerY = free ? free.top + free.height / 2
      : compactBuildQuery.matches ? (bounds.gearBottom + dockTop()) / 2 : (rect.top + rect.bottom) / 2;
    const anchorY = (centerY - rect.top) * stage.height / rect.height;
    const scale = clampZoom(camera.scale * 1.12 ** direction);
    const origin = zoomAnchoredOrigin(camera.originX, camera.originY, anchorX, anchorY, camera.scale, scale);
    camera.scale = scale; camera.originX = origin.x; camera.originY = origin.y;
    clampCamera(); cameraDirty = true;
  };
  document.querySelector('#build-zoom-in')?.addEventListener('click', () => zoomView(1));
  document.querySelector('#build-zoom-out')?.addEventListener('click', () => zoomView(-1));
  toolSwitch = new BuildToolSwitch(document, [
    { tool: wallTool, button: 'build-tool-walls', panel: 'wall-tool' },
    { tool: roomsTool, button: 'build-tool-room', panel: 'room-tool' },
    { tool: buyTool, button: 'build-tool-buy', panel: 'buy-tool' },
    { tool: floorTool, button: 'build-tool-floors', panel: 'floor-tool' },
    { tool: landTool, button: 'build-tool-land', panel: 'land-tool' },
  ], {
    beforeSelect(button, activate) {
      if (roomReview.active || buildExit.resolving) return false;
      if (button === 'build-tool-land' && landTool.active) { canvas.focus(); return true; }
      if (landTool.pending) return false;
      if (button !== 'build-tool-land') {
        buildExit.clearExitIntent();
        return activate();
      }
      return buildExit.requestDestination(() => {
        if (!buildSession.begin()) {
          buildBatchStatus.textContent = buildSession.error || 'Land could not be opened. Try again.';
          return false;
        }
        return activate();
      }, 'Switch to Land?');
    },
    leaveFurniture() {
      builder.cancel();
      return builder.selected === null && !builder.pending;
    },
    focusView: () => canvas.focus(),
  });
  canvas.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (builder.active) {
      if (event.key === 'Escape' && !menu.isShowing() && !overlayPause.suspendedExcept('builder')) {
        // BuildExit also reads Escape from the rest of the page.
        buildExit.pressEscape(event.repeat); event.preventDefault(); return;
      }
      if (roomReview.active) { event.preventDefault(); return; }
      if (!menu.isShowing() && !event.ctrlKey && !event.metaKey && !event.altKey
        && event.key.toLowerCase() === 'n') {
        if (toolSwitch?.select('build-tool-walls')) wallTool.selectWindows();
        event.preventDefault();
        return;
      }
      if (!menu.isShowing() && !event.ctrlKey && !event.metaKey && !event.altKey
        && event.key.toLowerCase() === 't' && (wallTool.active || roomTool.active)) {
        wallView.toggle();
        event.preventDefault();
        return;
      }
      if (!menu.isShowing() && !event.ctrlKey && !event.metaKey && !event.altKey
        && routeBuildKey(event.key, buildTools, builder)) {
        event.preventDefault();
      }
      return;
    }
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
  // need the camera above. Left click selects a sim or sends the
  // selected one to an object ahead of its waiting orders, ctrl or cmd
  // click queues behind them instead, right click opens the flyout; the
  // wheel zooms at the cursor, a pinch
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
    {
      active: () => builder.active,
      mode: () => roomReview.active ? 'review' : roomsTool.selecting ? 'room-selection' : buildTools.findIndex(tool => tool.active),
      click(pick, tile, world, point) {
        if (roomReview.active) return;
        if (roomsTool.selecting) { if (tile) roomSelection.chooseTile(tile); return; }
        if (pick?.bookCopy !== undefined) { openBookCopy(pick.bookCopy); return; }
        if (wallTool.active) {
          // [WB-pick]: the wall drawn under the pointer, then the floor beside it.
          if (point) {
            const { line, floor } = pickWallAt(point);
            if (line) wallTool.chooseClicked(line, floor);
          } else if (world) wallTool.choosePoint(world[0], world[1]);
          return;
        }
        if (roomTool.active) {
          if (world) roomTool.choosePoint(world[0], world[1]);
          return;
        }
        if (buyTool.active) {
          if (tile) buyTool.moveTo(tile[0], tile[1]);
          return;
        }
        if (floorTool.active) {
          if (world) floorTool.choosePoint(world[0], world[1]);
          return;
        }
        if (landTool.active) {
          if (world) landTool.choosePoint(world[0], world[1]);
          return;
        }
        if (pick && !pick.isAgent && pick.entity !== builder.selected) builder.select(pick.entity);
        else if (tile) builder.moveTo(tile[0], tile[1]);
      },
      hover(point) {
        hoverLine = point && wallTool.active && !roomReview.active && wallTool.pending === null && !wallTool.blocked
          ? pickWallAt(point).line : null;
      },
    },
    openBookCopy,
    async point=>{
      if(graphicsRecovering)return undefined;
      const revision=sim.lotRevision(),generation=graphicsGeneration;
      const hit=await characterWorld.pick(Math.floor(point.x),Math.floor(point.y));
      if(hit===undefined||graphicsRecovering||graphicsGeneration!==generation||sim.lotRevision()!==revision)return undefined;
      if(hit?.kind==='person'&&sim.simIdOf(hit.entity)!==hit.sim)return undefined;
      return hit?{entity:hit.entity,isAgent:hit.kind==='person',cleanup:hit.cleanup,bookCopy:hit.bookCopy}:null;
    },
  );
  function openBookCopy(copy: number): void {
    const rect = stage.getBoundingClientRect();
    menu.open({ title: 'Book', entries: [{ label: 'Recover book', enabled: sim.canRecoverBook(copy) && sim.pendingBookCommands() === 0, action: { kind: 'recover-book', copy } }] },
      rect.left + rect.width / 2, rect.top + rect.height / 2);
  }
  const timer = new FrameTimer(FRAME_WINDOW);
  const characterMeasurement=stressParam===null?null:new CharacterFrameMeasurement(()=>gpu.device.queue);
  let previousFrameMs = performance.now();
  window.addEventListener('pageshow',event=>{if(event.persisted)previousFrameMs=performance.now();});
  const graphicsStatus=document.createElement('div');graphicsStatus.id='graphics-recovery';graphicsStatus.hidden=true;graphicsStatus.setAttribute('role','status');
  graphicsStatus.style.cssText='position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);padding:20px;background:#202630;color:white;z-index:5';
  const graphicsText=document.createElement('p'),graphicsRetry=document.createElement('button');graphicsRetry.textContent='Retry graphics';setActionIntent(graphicsRetry,'affirmative');
  graphicsStatus.append(graphicsText,graphicsRetry);document.body.append(graphicsStatus);
  let recoveryPending=false;
  const deviceLifetime=new DeviceLifetime();
  const recoverGraphics=async()=>{
    if(graphicsClosed||recoveryPending)return;recoveryPending=true;graphicsRecovering=true;
    void audio.setBackgrounded(true);
    overlayPause.suspend('graphics');menu.close();buildExit.dismiss();housemateView?.destroy();characterWorld.destroy();weatherScene.destroy();
    graphicsStatus.hidden=false;graphicsRetry.hidden=true;graphicsText.textContent='Restoring graphics. Your game and character draft are kept.';
    if(housemateDialog.open)housemateDialog.append(graphicsStatus);else document.body.append(graphicsStatus);
    try{
      Object.assign(gpu,await initDevice(stage));
      watchGraphics(gpu.device);
      weatherScene = new WeatherScene(gpu.device);
      const replacement=CharacterWorld.create(gpu.device,gpu.format,()=>renderer.sceneForPicking,contactRoster);
      try{await floorResources.invalidate();characterWorld=await replacement;characterWorld.prepareFixtures(sim);}
      catch(error){void replacement.then(world=>world.destroy(),()=>{});throw error;}
      if(graphicsClosed){characterWorld.destroy();weatherScene.destroy();return;}
      deviceLifetime.assertAvailable(gpu.device);
      if(creatorSession&&housemateDialog.open)housemateView=new CreatorView(housemateDialog.querySelector<HTMLElement>('#character-creator-root')!,creatorSession,gpu.device,gpu.format,()=>housemateDialog.close('cancel'));
      graphicsGeneration++;graphicsRecovering=false;graphicsStatus.hidden=true;document.body.append(graphicsStatus);
      previousFrameMs=performance.now();cameraDirty=true;overlayPause.resume('graphics');
      void audio.setBackgrounded(false);
    }catch(error){console.error('Graphics recovery failed',error);graphicsText.textContent='Graphics could not restart. Your game is still available to save. Try again.';graphicsRetry.hidden=false;}
    finally{recoveryPending=false;}
  };
  function watchGraphics(device:GPUDevice):void {deviceLifetime.watch(device,()=>{if(!graphicsClosed&&device===gpu.device)void recoverGraphics();});}
  graphicsRetry.addEventListener('click',()=>void recoverGraphics());watchGraphics(gpu.device);
  let lastReportMs = performance.now();

  /**
   * One frame's work. `nowMs` is the browser's animation timestamp;
   * `frameEntered` records when this callback actually starts. Measurements
   * retain callback delay separately from simulation, bridge reads, instance
   * packing, and draw submission.
   *
   * `presenting` is false for a background step, taken while the browser
   * sends no animation frames: the simulation, saves, sound and panels
   * advance, and the scene is not drawn.
   */
  let lastBookRefreshMs = -Infinity;
  let firstSceneDrawn = false;
  let firstSceneRecorded = false;
  function frame(nowMs: number, presenting = true): void {
    const frameEntered=performance.now();
    const deltaMs = frameElapsedMs(nowMs, previousFrameMs);
    previousFrameMs = nowMs;
    const tickBudget = presenting ? MAX_TICKS_PER_FRAME : BACKGROUND_MAX_TICKS;

    // Chromium's media-query event is not reliable under every embedding and
    // emulation path. The value is already read each frame for animation, so
    // this cached check makes a live accessibility change converge without
    // touching the DOM or static buffer on steady frames.
    syncSystemLighting();

    // The sim advances in whole ticks; alpha is how far this frame sits
    // between the last one that ran and the next one that has not. A paused
    // frame drains input without running a full tick.
    const alpha = advanceFrameWithCommandFeedback(
      () => advanceSimulationFrame(driver, deltaMs, frameSimulation, tickBudget),
      () => {
        if (!startingNewGame) persistence.updateAutosave();
      },
      sim,
      commandStatus,
      () => audio.emit({ type: 'command.rejected' }),
    );
    orderDiagnostics.update(nowMs, sim);
    feedbackBubbles.hidden = !floorScene.visible || graphicsRecovering;
    builder.setBlocked(overlayPause.suspendedExcept('builder') || roomReview.active);
    wallTool.setBlocked(overlayPause.suspendedExcept('builder') || roomReview.active);
    buyTool.setBlocked(overlayPause.suspendedExcept('builder') || roomReview.active);
    bookResults.drain();
    roomTool.setBlocked(overlayPause.suspendedExcept('builder') || roomReview.active);
    floorTool.setBlocked(overlayPause.suspendedExcept('builder') || roomReview.active);
    landTool.setBlocked(overlayPause.suspendedExcept('builder') || roomReview.active);
    if (roomsTool.active) selectionControls?.render();
    const roomMarker = document.querySelector<HTMLElement>('#room-map-marker')!;
    const selectedRoom = roomSelection.rooms.find(room => room.id === roomSelection.selected);
    const markerPoint = selectedRoom?.anchor ?? (roomsTool.selecting ? roomSelection.highlight()?.tiles[0] : null);
    roomMarker.hidden = !builder.active || !roomsTool.selecting || roomReview.active || !markerPoint;
    if (!roomMarker.hidden && markerPoint && selectedRoom) {
      const rect = stage.getBoundingClientRect();
      roomMarker.textContent = selectedRoom.name;
      roomMarker.style.left = `${rect.left + screenX(markerPoint[0], markerPoint[1], camera.originX, camera.scale) * rect.width / stage.width}px`;
      roomMarker.style.top = `${rect.top + screenY(markerPoint[0], markerPoint[1], camera.originY, camera.scale) * rect.height / stage.height}px`;
    }
    wallTool.afterCommands();
    windowTool.afterCommands();
    roomTool.afterCommands();
    floorTool.afterCommands();
    buyTool.afterCommands();
    landTool.afterCommands();
    if (adoptLotShape()) refreshLotPresentation();
    housemateView?.afterCommands();
    syncCharacterContacts();
    bedAssignmentPanel.afterCommands();
    careerPanel.afterCommands();
    if(choresDialog.open)choresBoard.update();
    if (builder.afterCommands()) {
      refreshBuildArchitecture();
    }
    // [WB-draw], [WB-height]: while a wall tool is in use the walls stand
    // low, the chosen ones full height, or every wall full height when the
    // player asks. The static block is rebuilt only when that changes, not
    // on every click.
    const wallsInUse = wallTool.active || roomTool.active;
    if (setCutAwayWalls(lot, wallsInUse && wallView.height === 'full')) cameraDirty = true;
    const chosenWalls = wallTool.active ? wallTool.selection() : null;
    if (setSelectedLines(lot, chosenWalls
      ? new Map(chosenWalls.lines.map((line, at) => [`${line.axis}/${line.x}/${line.y}`, chosenWalls.valid[at]]))
      : null)) cameraDirty = true;
    if (!wallTool.active) hoverLine = null;
    // [SEA-yard]: the yard's grass changes color when the season turns, or
    // when a Load lands in another season; the static block is rebuilt then
    // and not on every frame.
    if (setSeason(lot, sim.seasonIndex())) cameraDirty = true;
    // Placement can change collision and lighting while paused. Rebuild the
    // camera-derived statics after that drain, before any instances are drawn.
    if (presenting&&floorScene.visible&&!graphicsRecovering) {
      if (cameraDirty) applyCamera();
      renderer.setGrimeInstances(buildGrimeInstances(sim,lot.width,depthScale,camera.originX,camera.originY,camera.scale,renderer.grimeSpriteBase));

      // [PA-place]: after the camera settles, so the buttons follow this
      // frame's pan and zoom.
      placementButtons.frame(camera, stage.width, stage.height);
      // Editing marks the original furniture; play mode marks the selected Sim.
      const selected = builder.active ? builder.selected : sim.selectedIndex();
      const ambient=lightingMode.isFlat()?AMBIENT_NEUTRAL:ambientFor(sim.clockTick(),sim.dayTicks());
      const skyShade = lightingMode.isFlat() ? 0 : interiorDaylightShade * sunStrength(ambient);
      characterWorld.beginFrame(sim,{originX:camera.originX,originY:camera.originY,scale:camera.scale,width:stage.width,height:stage.height,
        gridSize:depthScale,ambient,skyShade,lighting:lightingMode.isFlat()?null:lighting,sky,fixtureDepthBase:renderer.fixtureDepthBase});
      failureBubbles.update(orderDiagnostics.failedActors(nowMs), sim, {...camera, width:stage.width, height:stage.height, rect:stage.getBoundingClientRect()},
        row => characterWorld.plan.actorAt(row)?.head ?? null);
      const batch = buildInstanceBatch(
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
        undefined,
        buyTool.ghost() ?? builder.preview,
        roomReview.highlight() ?? (roomsTool.selecting ? roomSelection.highlight() : null)
          ?? (wallTool.active ? withHoverLine(wallTool.highlight(), hoverLine, chosenWalls?.lines) : null)
          ?? roomTool.highlight() ?? floorTool.highlight() ?? landTool.highlight(),
        // A purchase in the Buy tool's colourway; a moved object in its own.
        buyTool.ghost() ? buyTool.ghostColourway() : builder.colourway ?? 0,
        sky,
        characterWorld.plan,
      );
      // The day/night cycle. `LightingMode` combines the player's saved flat
      // choice with reduced motion's temporary constraint, so one effective
      // state governs ambient light, pools, and the button without rewriting
      // the player's preference.
      wallFade.update(sim, alpha, deltaMs, reducedMotion.matches);
      weatherScene.prepare(sim.clockTick() + alpha, sim.dayTicks(), sim.seasonIndex(), weatherTuning,
        camera.originX, camera.originY, camera.scale, depthScale, ambient, reducedMotion.matches);
      renderer.draw(
        batch.instances,
        batch.count,
        camera.scale,
        ambient,
        // [OS-daylight]: the sky shades the house by day; flat light is even.
        skyShade,
        characterWorld.draw,
        batch.owners,
        batch.annotations,
        drawWorldEffects,
      );
      if (!firstSceneRecorded) {
        firstSceneRecorded = true;
        void gpu.device.queue.onSubmittedWorkDone().then(() => {
          window.dispatchEvent(new Event('terrilives:startup-ready'));
        }, error => {
          window.dispatchEvent(new CustomEvent('terrilives:startup-failure',{detail:error}));
        });
      }
    }

    // Inside the sample below rather than outside it, deliberately: the
    // panel is work the frame does, and a periodic cost measured outside
    // the budget is a budget that does not describe the frame ([L19]).
    // On five frames in six this is two comparisons and a return.
    const needsUpdated = needsPanel.update(nowMs, sim);
    gameHud.update(nowMs, sim);
    actionQueue.update(nowMs, sim);
    householdRoster.update(nowMs);
    deathControls.update();
    careerAutonomy.update();
    syncNewHousemateButton();
    syncEditHousemateButton();
    peoplePanel.update(nowMs);
    moodPanel.update(nowMs);
    traitsPanel.update(nowMs);
    personalDetailsPanel.update(nowMs);
    skillsPanel.update(nowMs);
    affinitiesPanel.update(nowMs);
    bedAssignmentPanel.update(nowMs);
    careerPanel.update(nowMs);
    if (needsUpdated) syncDockSummary();
    if (nowMs - lastBookRefreshMs >= sim.needBarRefreshMs()) {
      lastBookRefreshMs = nowMs; bookCommerce.render(builder.active ? builder.selected : null, overlayPause.suspendedExcept('builder'));
    }
    syncPersistenceButtons();
    debugPanel?.update(nowMs);
    updateOrderHistory?.();
    // The cover lifts once the GPU has finished the first full scene, not
    // when it was queued: a phone compiles shaders on that first draw, and
    // lifting early would show the blank canvas the cover exists to hide.
    if (presenting && floorScene.visible && !firstSceneDrawn) {
      firstSceneDrawn = true;
      void gpu.device.queue.onSubmittedWorkDone()
        .then(() => requestAnimationFrame(() => loading.finish()), () => loading.finish());
    }

    if (presenting) {
      timer.sample(performance.now() - nowMs);
      characterMeasurement?.frame(nowMs,frameEntered,performance.now());
    }
    if (nowMs - lastReportMs > REPORT_INTERVAL_MS) {
      lastReportMs = nowMs;
      console.debug(`entities ${sim.count}  ${timer.report()}`);
    }
  }

  if (stressParam !== null) {
    if (footstepSamplerTimer === null) {
      throw new Error('stress footstep timer was not created');
    }
    const admission=new StressCharacterAdmission(sim,characterContacts,contactRoster,async bytes=>{
      const loaded=await loadCharacters(bytes);if(loaded){characterWorld.reset();characterWorld.prepareFixtures(sim);}return loaded;
    });
    window.addEventListener('pagehide',event=>{if(!event.persisted)admission.dispose();});
    globalThis.__terriStress = {
      characters:{snapshot:()=>characterWorld.diagnostics(),probeFrame:target=>characterWorld.probeFrame(target),pick:(x,y)=>characterWorld.pick(x,y),
        loadBytes:bytes=>admission.loadBytes(bytes),create:(request,draft)=>admission.create(request,draft),edit:(request,person,patch)=>admission.edit(request,person,patch),
        prepareCurrent:()=>admission.prepareCurrent(),readiness:()=>({roster:contactRoster.diagnostics(),service:characterContacts.diagnostics()}),
        createDraft:seed=>CharacterDraft.create(seed,sim.characterCatalog(),sim.characterAppearances().map(person=>({sim_id:person.sim,name:sim.characterSnapshot(person.sim)!.name}))).resolve(),
        createPreview:(large,small,animation)=>{
          const {frames}=previewAnimationTiming(animation);
          return {preview:new CreatorPreview(gpu.device,gpu.format,large,small),samples:frames};
        }},
      get graphicsGeneration(){return graphicsGeneration;},loseGraphics:()=>gpu.device.destroy(),
      measureCharacters:durationMs=>characterMeasurement!.start(durationMs),
      get graphicsDevice(){return gpu.device;},
      get sceneDepthTexture(){return renderer.depthForPicking;},
      get sceneColorTexture(){return renderer.sceneForPicking.color;},
      get sceneIdentityTexture(){return renderer.sceneForPicking.identity;},
      get sceneSurfaceTexture(){return renderer.sceneForPicking.surface;},
      get sceneAnnotationIdentityTexture(){return renderer.sceneForPicking.annotationIdentity;},
      sceneSampleScale:2,
      timer,
      footstepSampler: footstepSamplerTimer,
      footstepSampling,
      entities: sim.count,
      get wasmMemoryBytes() {
        return wasm.memory.buffer.byteLength;
      },
      audio: {
        get activeVoices() {
          return audio.activeVoiceCount();
        },
        // Voices are a retained scheduler like the others, so the
        // bounded-state proof has to be able to see them. Adding a scheduler
        // without adding it here is the omission
        // [L-audio-boundaries-and-proofs-must-cover-every-scheduler] records.
        get conversationVoices() {
          return audio.activeConversationVoiceCount();
        },
        get retainedConversationVoices() {
          return audio.retainedConversationVoiceCount();
        },
        get objectLoopVoices() {
          return audio.activeObjectLoopCount();
        },
        get doorVoices() { return audio.activeDoorVoiceCount(); },
        get toiletVoices() { return audio.activeToiletVoiceCount(); },
        get doorTracks() { return audio.doorTrackCount(); },
        get doorCapacity() { return audio.doorTrackCapacity(); },
        get retainedObjectLoopVoices() {
          return audio.retainedObjectLoopCount();
        },
        get footstepTracks() {
          return audio.activeFootstepTrackCount();
        },
        get footstepCapacity() {
          return audio.footstepTrackCapacity();
        },
        get activityTracks() {
          return audio.activeActivityTrackCount();
        },
        get activityCapacity() {
          return audio.activityTrackCapacity();
        },
        get objectSoundTracks() {
          return audio.activeObjectSoundTrackCount();
        },
        get objectSoundCapacity() {
          return audio.objectSoundTrackCapacity();
        },
        get cuePlayCounts() {
          return audio.cuePlayCounts();
        },
      },
      runFootstepSchedulerProbe: (walkers = 40, ticks = 600) => {
        if (!Number.isSafeInteger(walkers) || walkers < 1 || walkers > 1_000) {
          throw new Error('footstep probe walkers must be an integer from 1 to 1000');
        }
        if (!Number.isSafeInteger(ticks) || ticks < 2 || ticks > 10_000) {
          throw new Error('footstep probe ticks must be an integer from 2 to 10000');
        }

        audio.reset('load');
        const probeTimer = new FrameTimer(ticks);
        const startedMs = performance.now();
        for (let tick = 0; tick < ticks; tick += 1) {
          const tickStartedMs = performance.now();
          audio.beginFootstepFrame();
          try {
            for (let walker = 0; walker < walkers; walker += 1) {
              audio.observeFootstep(
                1_000_000 + walker,
                tick * 0.1,
                walker * 0.01,
                true,
              );
            }
          } finally {
            audio.endFootstepFrame();
          }
          probeTimer.sample(performance.now() - tickStartedMs);
        }
        const result = {
          walkers,
          ticks,
          elapsedMs: performance.now() - startedMs,
          meanMsPerTick: probeTimer.mean,
          p95MsPerTick: probeTimer.p95,
          maxMsPerTick: probeTimer.max,
          tracks: audio.activeFootstepTrackCount(),
          capacity: audio.footstepTrackCapacity(),
        };
        audio.reset('load');
        return result;
      },
      step: (nowMs = performance.now()) => frame(nowMs),
      sim:guardedCharacterStressSource(sim),
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

  // A background tab keeps playing on a worker-paced timer. Under `?stress=N`
  // the harness steps the frame itself from a hidden tab ([L14]), so a second
  // clock there would advance the game between its fabricated timestamps.
  const backgroundTicker = new BackgroundTicker(BACKGROUND_STEP_MS);
  const clock = new FrameClock({
    now: () => performance.now(),
    requestFrame: callback => { requestAnimationFrame(callback); },
    startTimer: callback => backgroundTicker.start(callback),
  }, (nowMs, presenting) => {
    if (graphicsClosed) {
      clock.stop();
      return;
    }
    try {
      frame(nowMs, presenting);
    } catch (error) {
      // A throw here already ended the loop before the cover existed; the
      // cover must not then hide the frozen game for good.
      window.dispatchEvent(new CustomEvent('terrilives:startup-failure',{detail:error}));
      loading.finish();
      throw error;
    }
  }, stressParam === null ? FRAME_STALL_MS : null);

  // A startup that fell back to loading floor materials separately is still
  // waiting on them, and the cover already says so.
  if (floorScene.visible) loading.step('Drawing the house');
  clock.start();
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
  window.dispatchEvent(new CustomEvent('terrilives:startup-failure',{detail:error}));
  console.error('Natural Causes failed to start:', error);
  loading.finish();
  // A lost graphics device may already have put its own card up, which says
  // more about what happened than a generic startup failure would.
  if (document.querySelector('[data-role="startup-failure"]')) return;
  renderStartupFailure(
    describeStartupFailure(error, {
      webgpu: 'gpu' in navigator && navigator.gpu !== undefined,
      secure: window.isSecureContext,
    }),
    document.body,
  );
});
