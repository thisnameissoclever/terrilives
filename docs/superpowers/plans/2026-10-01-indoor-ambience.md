# Indoor Ambience Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development for the single integrated task below, with root-owned production verification and final review. The owner has delegated routine design and execution choices; do not request duplicate approval.

**Goal:** Add quiet household ambience with an independent saved control and complete audio lifecycle ownership.

**Architecture:** A dedicated room-loop player feeds an Ambience gain beneath Effects and master. The controller establishes demand from fixed-tick ready-world observations, owns bounded loading and preserves existing sound families. Source preparation is offline and deterministic.

**Tech Stack:** Existing TypeScript, native Web Audio, Vite/Vitest, Node and PowerShell. No new packages.

**Spec:** `docs/specs/2026-10-01-indoor-ambience.md`.

## Global Constraints

No dependency, purchase, download, host setting or saved-world change is required.
Routine controls remain silent. The source is synthetic and listening-provisional.
Effects controls all sound; Voices controls only conversations. Retain version-1
preferences and default Ambience to 25%. Do not weaken existing memory limits
or structural equality. Held PR 178 is not part of this change.
Use apply_patch, one test worker, no branding or co-author commit trailers.

## Review Focus

1. Startup has unlocked audio but no playable world: no request or source.
2. Context replacement or Load while decoding: no old-world source resurrection.
3. Repeated pause/slider toggles before native end callbacks: retained sources remain bounded.
4. Small viewport with doubled text: controls stay reachable without permanent HUD growth.
5. Failed ambient load alongside cooking/water/voice loads: independent recovery and no fixed-tick retry loop.

### Task 1: Complete the playable ambience slice

**Ownership:** One implementer owns all files for this task until handing off. Root does not edit concurrently. Other agents work elsewhere; do not revert their changes. No child agents. Root alone handles external push/PR/merge and final browser acceptance.

**Files:**

1. Create `web/src/audio/room-ambience.ts`, its player tests, `scripts/build-room-ambience.mjs`, a generated `web/public/audio/ambience/indoor-air.wav`, and generator tests.
2. Modify `web/src/audio/audio-controller.ts`, `web/src/audio/frame-audio.ts`, `web/src/ui/audio-controls.ts`, `web/src/main.ts`, `web/index.html`, and their current tests. Search all callers and test doubles before changing interfaces.
3. Add `web/proofs/room-ambience.js`; extend `scripts/audio-browser-proof.cjs`, its tests and stress diagnostics for active, retained and successful ambience starts.
4. Update `ASSETS.md`, `docs/ARCHITECTURE.md`, `docs/FEATURES.md`, `docs/GAME-SYSTEMS.md`, `docs/TIM-TODO.md`, audio foundation, player-visible string inventory, and this slice's spec with exact changed behavior. Preserve existing acceptance boundaries and unrelated copy.

**Interfaces:**

```ts
// New player module, consumes existing Web Audio ports.
class RoomAmbiencePlayer {
  constructor(context: VoiceAudioContext, output: unknown);
  play(buffer: AudioBufferPort): boolean;
  stop(immediate?: boolean): void;
  sweep(): void;
  activeCount(): number;
  retainedCount(): number;
}
// Controller/settings public additions.
ambienceLevel(): number;
previewAmbienceLevel(level: number): void;
setAmbienceLevel(level: number): void;
observeRunningWorld(): void;
loadAmbience(): Promise<void>;
activeAmbienceCount(): number;
retainedAmbienceCount(): number;
ambienceStartCount(): number;
```

`sampleSimAudioAfterTick` calls `observeRunningWorld` once after it acquires valid
world columns. Update its sink interface and all doubles explicitly. Standalone
frame methods still perform unavailable-player cleanup; they do not establish
room demand. The explicit world observation avoids accidental playback on a
gesture or in initialization-only controller tests.

- [ ] Establish clean baseline using existing lockfile dependencies and main-matching release WASM. Coordinate shared Cargo target use with root. Run focused audio tests before edits.
- [ ] Write one failing player test through the native-port fake, run it red, implement the smallest player behavior, and repeat for fade/bounds/failure cleanup. Example invariant:

```ts
expect(player.play({duration: 8})).toBe(true);
expect(player.play({duration: 8})).toBe(true);
expect(player.activeCount()).toBe(1);
player.stop(true);
expect(player.retainedCount()).toBe(0);
```

- [ ] Write a failing deterministic source test; implement filtered seeded noise and offline loop conditioning using the existing PCM encoder. Verify sample count, finite values, RMS/peak/DC/seam, repeatability and refusal to overwrite different existing bytes. Generate and hash the actual source; do not silently normalize existing audio.
- [ ] Add controller behavior vertically, red before green. First pin no startup request, then ready-world playback:

```ts
await controller.unlockFromGesture();
expect(fetcher).not.toHaveBeenCalled();
controller.observeRunningWorld();
await controller.loadAmbience();
expect(controller.activeAmbienceCount()).toBe(1);
```

Then parameterize mute, Effects zero, Pause, Load, hidden tab and automatic
suspension; after each boundary, resolving a pending decode creates no source.
Fresh observation after recovery starts exactly one. Pin cache/coalescing,
five-second cooldown, no repeated retry while unchanged demand persists,
independent recording failures, malformed duration and stale context completion.
- [ ] Add preference and UI tests. Preserve existing mute/Effects/Voices in a legacy record, persist Ambience once on commit and never on preview, clamp/fallback values and tolerate denied storage. Wire the Options range and literal Help update; no blanket click sound.
- [ ] Add native rendered-output proof for positive signal, independent Ambience/Voices/Effects/master gain, pause fade, suspended cleanup with zero resumed tail, and fast-toggle ownership. Include genuine positive enabled ambience counters in the retained-memory report; reject missing coverage, excess/undrained voices and any disabled-run start.
- [ ] Delete each load-bearing demand, cleanup, gain-route and report guard in turn, run its covering test, record the expected failure and restore exact bytes. Run focused checks while iterating, then the full web suite once, typecheck and production build. Run document IDs and diff checks.
- [ ] Self-review the complete diff, update the spec and full report with commands/results, then commit this coherent implementation locally. Do not push or merge. Return status, commits, one-line test summary, concerns and report path.

## Root verification and delivery

Root reads the report, dispatches task review against a packaged diff, resolves
findings through the implementer, then runs the production browser, native audio
and unchanged acceptance checks. Root actually inspects saved screenshots and
keeps subjective listening status open. Fresh whole-branch review precedes
authorized push/PR/merge and clean main synchronization. Close task-owned browser
and server resources in finally blocks. Report Pages separately.
