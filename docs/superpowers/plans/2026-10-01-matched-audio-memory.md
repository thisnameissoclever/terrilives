# Matched Audio Memory Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development for one integrated harness task. The owner delegated routine design and execution choices; do not ask for duplicate approval. Root handles browser acceptance and external delivery.

**Goal:** Compare equivalent simulated worlds when measuring retained audio memory.

**Architecture:** A stress-only seed/target protocol supplies a finite tick budget
to the existing frame driver. The browser runner records exact normalized
endpoint hashes and rejects incomparable pairs before attributing heap growth.

**Tech Stack:** Existing TypeScript, Node, Vitest and Playwright helpers. No packages added.

**Spec:** `docs/specs/2026-10-01-matched-audio-memory.md`.

## Global Constraints

Preserve 60 warm-up ticks, 540 measured ticks, three alternating pairs, raw heap
accounting, the 65,536-byte allowance and exact document/node/listener equality.
Keep live rendering and native audio clocks. Normal gameplay remains unchanged.
Do not manually tick the simulation, suppress compilation or waive either held
audio feature. No dependencies, purchases, Rust or saved-world changes.

## Review Focus

1. A frame owing several ticks crosses a target unless the driver itself caps it.
2. A paused startup resumes accidentally when Help closes unless every initial
   speed owner agrees.
3. Invalid probe parameters or targets partially mutate runtime state.
4. Equal ticks but different command history or seed produces unequal hashes.
5. Legacy report fixtures accidentally bypass the new provenance requirement.

### Task 1: Exact matched memory runs

**Ownership:** One fresh implementer owns the following runtime/harness/tests/docs.
Other agents work elsewhere; preserve their changes. No children. Root alone owns
browser acceptance, evidence collection, push and merge. Keep root's untracked
web/output files out of the commit.

**Files:**

1. Modify `web/src/frame.ts` and `web/tests/frame.test.ts` for a backward-compatible
   optional tick budget. Search all advance/advanceSimulationFrame callers.
2. Create `web/src/stress-memory-probe.ts` and `web/tests/stress-memory-probe.test.ts`
   for pure query parsing and target state. Wire narrowly into `web/src/main.ts`;
   helper/frame tests cover logic and root browser verification checks integration.
3. Modify `scripts/audio-browser-proof.cjs` and `web/tests/audio-memory-report.test.js`
   for predeclared seeds, protocol use, recorded endpoint hashes and rejection.
4. Update this spec, the audio-foundation spec and relevant lessons with exact
   implemented behavior and outstanding acceptance limits. Do not rewrite
   previous failed reports or change their status.

**Interfaces:**

```ts
// Preserve existing positional arguments and default behavior.
FixedStepDriver.advance(deltaMs: number, onTick: () => void, tickBudget?: number): number;
advanceSimulationFrame(driver: FixedStepDriver, deltaMs: number, sim: FrameSimulation, tickBudget?: number): number;

type ProbeSeed = { readonly low: number; readonly high: number };
parseMemoryProbeSeed(search: string): ProbeSeed | null;
// Add these only to the existing stress handle, not the normal page API.
readonly memoryProbeSeed: ProbeSeed | null;
runUntilTick(targetTick: number): void;
```

Use a small target-state helper if needed, with a validated target, remaining
budget and completion query. Use the existing overlay/speed controller to start
and stop, including its audio pause wrapper. Do not duplicate a second speed
state in the probe.

- [ ] Write and run a failing driver test before implementation:

```ts
const driver = new FixedStepDriver(10, 5);
const tick = vi.fn();
expect(driver.advance(350, tick, 1)).toBe(0);
expect(tick).toHaveBeenCalledTimes(1);
driver.setSpeed(0);
driver.advance(1000, tick, 0);
expect(tick).toHaveBeenCalledTimes(1);
driver.setSpeed(1);
driver.advance(50, tick);
expect(tick).toHaveBeenCalledTimes(1);
```

- [ ] Implement finite budget validation and bound the while loop without
  changing unbudgeted behavior. Add zero/negative/fractional/NaN tests and
  existing frame/paused-command regression coverage.
- [ ] Add parser tests: no stress ignores probe seed; stress alone returns null;
  both decimal U32 values succeed; incomplete, empty, fractional, negative and
  overflowing values reject. Add safe target validation and remaining-budget tests.
- [ ] Wire probe seed before world creation and paused startup consistently across
  driver, overlay controller and time controls. Route every frame through the
  optional remaining budget; after reaching target, select Pause through the
  existing owner so room sources fade and queued speed settles normally.
- [ ] Update memory URLs and runner to call runUntilTick(60), normalize/drain and
  collect baseline, restore selection, call runUntilTick(600), sample while live,
  then normalize/drain and collect final. Keep interval sample cadence unchanged.
  Add seed and worldHash to snapshots and clear error on missing probe capability.
- [ ] Pin the three fixture seeds in code as exported test data. Add analyzer tests
  that mutate each seed, baseline/final tick and hash independently, and omit each
  metadata field. Require rejection before attribution. Existing source/DOM leak
  guards and disabled/positive playback fixtures must still fail their mutations.
- [ ] Delete the driver budget guard and each load-bearing comparability guard in
  turn; run its focused test, capture failure, restore exact bytes/hash. No full
  browser acceptance is run by the implementer.
- [ ] Run focused tests, then full `npx vitest run --maxWorkers=1` in web once,
  `npm run typecheck`, `npm run build`, `python check-doc-ids.py` from root and
  `git diff --check`. Do not rebuild Rust; current generated WASM matches source.
- [ ] Self-review, update docs and report, and commit locally. Return status,
  commit, test summary, concerns and report path. No push/PR/merge.

## Root verification

Review the packaged diff and report. Check one real matched pair's exact ticks
and equal hashes, then run the complete corrected acceptance once. Inspect the
game and preserve raw pass/fail separately from subjective sound quality.
Whole-branch review precedes any feature delivery. Close task browsers/servers.
