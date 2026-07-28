# GPU and Browser Verification

Every claim in this repository about what the GPU, the render path or the
simulation loop actually does, with the measurement that supports it.

**Why this file exists.** The measurements were originally recorded in
per-task reports under `.superpowers/`, which is gitignored. Tracked
source cites them - `web/src/render/iso.ts` derives the depth sense from
[V3], `web/tests/iso.test.ts` says the browser evidence is what stands
behind `sprites.ts`, and `docs/lessons-learned.md` [L14] cites [V3]. On
merge those citations would have pointed at nothing. The labels [V1]
through [V5] are Task 10's originals and are kept exactly so the existing
citations resolve; later work continues the numbering.

**Read `testing-protocol.md` first if you intend to add to this file.**
The governing rule there applies with more force here than anywhere else:
a browser check that passes because the code under test never ran is the
single most common failure this project has recorded. [L14] is the entry;
`document.visibilityState` is the first thing to check.

## The machine

Every number below is from one machine. There is no second GPU, no second
browser, and no second display in any of it.

| | |
| --- | --- |
| OS | Windows 11 Pro, 10.0.26200 |
| GPU | NVIDIA, `architecture: 'lovelace'` (Ada), as reported by `GPUAdapter.info` |
| Browser | Google Chrome, real install (`channel: 'chrome'`), `Chrome/150.0.0.0` at the M0 close-out |
| Preferred canvas format | `bgra8unorm` |
| Display refresh | **120 Hz**, confirmed by 7,202 rAF callbacks in 60.02 s and 3,110 in 26.0 s |
| Page canvas | 1280 x 720 (`#stage`) |

**[U-all] This is the whole coverage.** No Firefox, no Safari, no
integrated GPU, no other canvas format, no 60 Hz display, no other
driver. Nothing below should be read as a cross-platform claim.

---

# Task 10: the WebGPU device and the instanced sprite pipeline

Chrome via the agent-driven Browser pane, Vite dev server on `:5173`.

**The stated check was "load the page and confirm no console errors",
and it was worthless.** It passed instantly while `SpriteRenderer.draw`
had never been called once: the agent-driven tab runs **hidden**, a
hidden tab is not composited, and `requestAnimationFrame` therefore never
fires. Measured `document.visibilityState === 'hidden'` and **0 rAF
callbacks in one second**; the canvas read back `0,0,0,0` across all
921,600 pixels. Recorded as [L14].

Everything in this section was therefore produced by dynamic-importing
the real modules from the dev server, calling `draw` directly, wrapping
the GPU work in explicit error scopes, and reading pixels back with
`drawImage` + `getImageData`. Nothing is mocked.

## [V1] The shader compiles and the pipeline builds

`createShaderModule` and `createRenderPipeline` both returned **`null`**
from a `validation` error scope and from an `internal` error scope. An
assertion with a value behind it, rather than the absence of a console
line.

This settles the two WGSL questions worth doubting in `sprites.wgsl`: a
module-scope `const CORNERS = array<vec2<f32>, 6>(...)` indexed by a
runtime `@builtin(vertex_index)` is legal, and the trailing `;` after a
`struct` declaration parses.

## [V2] Two entities, correct pixels, exactly the right geometry

Agent (kind 0) at screen (64, 128), object (kind 1) at (192, 128), on a
256 x 256 canvas. Read back **exactly three distinct colours**:

| colour | pixels | what |
| --- | --- | --- |
| `23,23,28` | 64,384 | background, from `clearValue` 0.09/0.09/0.11 |
| `242,140,89` | **576** | agent |
| `89,166,217` | **576** | object |

576 = 24 x 24, the uniform's `tileSize` (`QUAD_SIZE_PX` in `sprites.ts`).
**The pixel count is the load-bearing part**, not the colour: a
"some orange is present" check passes on a collapsed or degenerate
triangle, and an exact area does not. Totals to 65,536 = 256 x 256, so
every pixel is accounted for. Centre samples hit the right colours, so
the screen-pixel to clip-space mapping and the Y flip are both right. No
validation error.

## [V3] Depth comes from the instance, not from draw order

[D10]'s central claim, and the one `web/src/render/iso.ts` derives
`worldDepth`'s sense from.

Two quads at the same pixel. The agent is written to instance slot 0 and
the object to slot 1 **in both trials**, so draw order is held constant
and only the depth values swap.

| agent depth | object depth | winner |
| --- | --- | --- |
| 0.1 | 0.9 | AGENT (orange) |
| 0.9 | 0.1 | OBJECT (blue) |

The winner flips, so the depth buffer is deciding. Had it been inert,
instance 0 would have won both times. This is what establishes that
**the smaller depth wins the pixel** under `depthCompare: 'less'` with
`depthClearValue: 1.0`, which is why `worldDepth` returns `1 - nearness`
and not `nearness`.

The inverse mapping shipped once in the Task 11 brief, with a test that
pinned it ([L16]). `web/tests/iso.test.ts` now asserts the two pipeline
settings as text so the two files cannot drift apart silently; that test
is the CI-side counterpart of this measurement, and it is mutation-
verified.

## [V4] Capacity growth on real hardware

Drawing 5,000 instances took the capacity from 4,096 to **8,192** and the
buffer from 65,536 to **131,072 bytes** (= 8192 x 16). Doubling, not
fitting to 5,000, which is what `growCapacity` promises.

No `validation` error and no `out-of-memory` error, which also confirms
that destroying a `GPUBuffer` referenced by a prior submission is safe
here. 65,324 of 65,536 pixels covered.

## [V5] The whole WASM-to-pixels chain tracks live state

A real `SimBridge` over a 32 x 32 lot, an agent walking to a fridge, five
ticks between samples, at 8 screen px per tile:

| tick | sim agent tile x | orange centroid x |
| --- | --- | --- |
| 0 | 1 | 38 |
| 5 | 2.25 | 48 |
| 10 | 3.5 | 58 |
| 15 | 4.75 | 68 |
| 20 | 6 | 78 |
| 25 | 7.25 | 88 |

1.25 tiles per 5 ticks x 8 px = 10 px per sample, which is exactly what
the centroid does. Quad area stayed 576 px throughout, and there was no
validation error across 30 draws.

This is the whole chain checked arithmetically rather than by eye: WASM
linear memory, the zero-copy view, the packed instance array, one
instanced draw call, lit pixels.

---

# Task 12: interpolation and smooth motion

Same setup: Chrome via the Browser pane, dev server on `:5173`, adapter
nvidia / lovelace, `bgra8unorm`. [L14] was reconfirmed first -
`visibilityState` `hidden`, rAF fired **0 times in one second**, before
and after a reload - so again every frame below was driven by hand
against the real modules.

## [V6] Interpolation is visible on the GPU, sub-tick

One sim, one frozen state, five alphas. The agent's previous tick was
(4.25, 3) and its current tick (4.5, 3): a quarter tile apart.

| alpha | orange centroid | expected screen |
| --- | --- | --- |
| 0 | (179.5, 155.5) | (180, 156) |
| 0.25 | (181.5, 156.5) | (182, 157) |
| 0.5 | (183.5, 157.5) | (184, 158) |
| 0.75 | (185.5, 158.5) | (186, 159) |
| 1 | (187.5, 159.5) | (188, 160) |

**Exactly 2 px in x and 1 px in y per 0.25 of alpha**, which is
`0.25 tiles * 32 px / 4` and `0.25 * 16 / 4`. The quad stayed exactly
576 px and the frame held exactly three distinct colours at every alpha.
No validation error. The half-pixel offset throughout is the pixel-centre
convention, not an error: a quad centred on 180 covers columns 168..191.

## [V7] Motion is smooth, not stepped at the tick rate

Sixty frames of 16.667 ms fed through `FixedStepDriver(10, 5)`, drawing
every frame, making exactly the calls `main.ts` makes.

- Ticks per frame: `000001000001000001...` - **exactly 10 ticks in 60
  frames**, one every sixth frame. The sim ran at 10 Hz while the display
  ran at 60.
- The centroid moved on **59 of 59** frame transitions.
- **Maximum single-frame jump: 2 px**, alternating 2 and 1.414.
- 0 validation errors, and the quad was 576 px on all 60 frames.

**The degenerate alternative, stated so the result means something:**
without interpolation the centroid would have moved on **10 of 59**
transitions, in jumps of `hypot(8, 4) = 8.94` px. Observed 59 of 59 at no
more than 2 px. The two hypotheses differ by a factor of six in
frequency and four in amplitude, so this is not a close call.

## [V8] An entity lower on the screen draws in front of one higher up

[V3] proved the depth buffer decides; this proves the projection feeds it
the right way round. The smart object is spawned first in both trials, so
it holds the lower entity index and instance slot 0: **draw order is
constant** and only which entity is lower on screen changes. The two
quads overlap in a 24 x 8 px band.

| trial | slot 0 (object) | slot 1 (agent) | winner | pixel counts |
| --- | --- | --- | --- | --- |
| agent lower | screen y 72, depth 0.9333 | screen y 88, depth 0.9 | **AGENT** | agent 576, object 384 |
| object lower | screen y 88, depth 0.9 | screen y 72, depth 0.9333 | **OBJECT** | object 576, agent 384 |

384 = 576 - 192 is the loser's quad minus exactly the overlap band, so
the occlusion is the right size as well as the right way round.

## [V8b] The lot fits the canvas at `GRID = 16`

Computed through the shipped `worldToScreen` with the page's real
1280 x 720 `#stage`, `originX = 640`, `originY = 80`: corners at
(640, 80), (1120, 320), (160, 320), (640, 560); with the 24 px quad the
lot occupies x 148..1132 and y 68..572.

**Superseded by [V12] at M1b Task 3b.** `GRID` no longer exists: the lot
comes from `content/lot.toml` and is 24 x 18, so the origins are derived
from its dimensions rather than hand-tuned. The measurement above is kept
because it is what the numbers in `iso.ts` were checked against at the
time.

---

# Task 13: the M0 exit measurement

**This is the section the M0 exit criterion rests on, so its provenance
matters more than its numbers.**

## [V9] Sustained p95 frame time with 1,000 entities

| | |
| --- | --- |
| **p95 frame time** | **0.33 ms** against a 16.6 ms budget |
| mean | 0.261 ms |
| p50 / p90 / p99 | 0.25 / 0.31 / 0.405 ms |
| worst single frame | **0.805 ms** |
| frames over 16.6 ms | **0 of 7,202** |
| frames rendered | 7,202 in 60.02 s |
| achieved frame rate | **120 fps sustained**, no dropped frames |
| entities | **1,002** (1,000 filler + 1 agent + 1 fridge) |
| JS heap | 1.84 - 2.62 MB across twelve 5-second marks, no trend |
| build | **release**: `wasm-pack` release + `wasm-opt`, `vite build`, served by `vite preview` on `:4173` |

Reproduced: a separate 30-second run gave 3,609 frames, mean 0.263 ms,
p50 0.255, p90 0.315, **p95 0.34**, p99 0.465, max 0.935 ms, 0 frames
over budget.

`document.visibilityState === 'visible'` in a real 1400 x 900 Chrome
window. The 60-second run's twelve 5-second marks are below; `frames` is
cumulative and lands on an exact multiple of 600, which is 120 fps with
nothing dropped.

| s | frames | heap MB | rolling mean | rolling p95 |
| --- | --- | --- | --- | --- |
| 5 | 601 | 2.37 | 0.266 | 0.37 |
| 10 | 1201 | 2.27 | 0.261 | 0.33 |
| 15 | 1801 | 2.18 | 0.258 | 0.33 |
| 20 | 2401 | 2.11 | 0.254 | 0.32 |
| 25 | 3001 | 2.62 | 0.258 | 0.325 |
| 30 | 3602 | 1.88 | 0.256 | 0.32 |
| 35 | 4202 | 2.42 | 0.258 | 0.33 |
| 40 | 4802 | 2.02 | 0.261 | 0.335 |
| 45 | 5402 | 1.84 | 0.260 | 0.345 |
| 50 | 6002 | 2.33 | 0.266 | 0.33 |
| 55 | 6602 | 2.32 | 0.265 | 0.35 |
| 60 | 7202 | 2.31 | 0.258 | 0.32 |

## Which numbers came from the shipped instrument, and which did not

**`FrameTimer` produced none of the headline percentiles, and cannot
have.** It exposes `mean` and `p95` only, over a window that caps at
`FRAME_WINDOW = 240` frames. There is no `p99`, no `max`, and no
over-budget count anywhere in `web/src/perf.ts`, and a 240-frame window
cannot yield a statistic over 7,202 frames. Anyone reconciling the table
above against the shipped class needs this said plainly rather than
inferring it.

| number | source |
| --- | --- |
| every per-frame duration | **shipped**: `main.ts` computes `performance.now() - nowMs` and hands it to `FrameTimer.sample()` |
| frame **count** (7,202) | **shipped**: `FrameTimer.frames`, the lifetime counter [L14] exists for |
| rolling mean and p95 at each 5 s mark | **shipped**: `FrameTimer.mean` / `.p95` over its 240-frame window |
| mean, p50, p90, **p95**, **p99**, **max**, **0 of 7,202 over budget** | **external collector**, over the full run |

So the headline p95 of 0.33 ms is an external statistic over 7,202
samples; the shipped `FrameTimer`'s own rolling p95 agrees with it
independently, reading 0.32 to 0.37 ms at every one of the twelve marks.
Two instruments, one conclusion, and they are not the same instrument.

## The collector's procedure, so the table is reproducible

The collector is a Playwright script. It does not simulate frames and it
does not call the page's `step()` handle; it wraps the shipped
instrument's input and lets the browser produce every frame.

1. Launch **real Chrome** (`channel: 'chrome'`, `headless: false`), 1400 x
   900 window, and `bringToFront()`. Headless or a background window
   makes every number meaningless ([L14]).
2. Load `http://localhost:4173/?stress=1000`, the **release** build under
   `vite preview`.
3. Wait for `globalThis.__terriStress` to exist, then **wait for a
   readiness signal with a value in it**: `timer.frames` must advance by
   more than 120. A timeout here is a failure, not a slow start - it
   means rAF is not firing.
4. Wrap `timer.sample` so every sample is appended to an unbounded array
   as well as going into the shipped ring:
   `h.timer.sample = (ms) => { all.push(ms); origSample(ms); }`.
   This is why the per-frame durations are the shipped ones: the
   collector observes the shipped call, it does not re-time anything.
5. **Discard a 2-second warm-up** by slicing off the samples collected
   before it (`run = all.slice(warm)`). Not optional: the first console
   report of every run reads `mean 0.82ms  p95 6.21ms` and the second
   reads `mean 0.27ms  p95 0.36ms`. That is pipeline creation and JIT,
   and averaging it in misdescribes steady state.
6. Sample twelve 5-second marks, recording `timer.frames`,
   `performance.memory.usedJSHeapSize`, and the shipped rolling
   `mean`/`p95`.
7. Restore `timer.sample`, sort a `Float64Array` copy of the run, and
   read percentiles at `floor(n * p)` with `min(n - 1, ...)`, the same
   index rule `FrameTimer.p95` uses. Count `> 16.6` for the budget line.

**Re-read [L19] before quoting any percentile from a re-run.** The frame
rate silently chooses which costs the percentile can see: the sim ticks
at a fixed 10 Hz off wall-clock time, so the fraction of frames paying
for a tick is `10 / fps`. At 120 fps that is 1 frame in 12, so p95 sits
inside the tick-frame population and the 0.33 ms above **includes tick
frames**. Driven flat out at 7,088 fps it is 1 in 709, and p95 stops
seeing them entirely.

## What Task 13 did not establish

- **Memory stability is the JS heap only.** WASM linear memory is not
  observable from the bundled build, so its stability is argued rather
  than measured: nothing spawns after start-up, so the count-change path
  in `sync_render_buffer` never fires and the render `Vec`s never
  reallocate.
- **Start-up is superlinear and unmeasured beyond N = 1,000.**
  `spawn_agent` calls `sync_render_buffer`, which sorts and clones on the
  count-change path, so seeding N entities from JavaScript is
  O(N^2 log N). At 1,000 it measured 6.1 ms and 7.1 ms across two runs.
  It is printed on its own console line so it can never be confused with
  frame cost.
- **The heap trend said nothing about allocation.** See [V11].

---

# M0 close-out

Chrome 150.0.0.0, NVIDIA lovelace, `bgra8unorm`, 1280 x 720 canvas, 120 Hz
display, Vite **dev** server on `:5173`, visible 1400 x 900 window.

## [V10] A hungry sim paths to the fridge, eats, and recovers

The last unmet definition-of-done item. Smooth movement was [V7]; "paths,
eats and recovers" had **never been observed in a browser at any commit**,
because `?stress=N` spawns its filler agents at hunger 100 precisely so
they stay idle.

### The shipped page, under real `requestAnimationFrame`

`http://localhost:5173/` with **no** `?stress` parameter, in a visible
window, for 26 seconds. No frames were driven by hand.

| | |
| --- | --- |
| `document.visibilityState` | **`visible`**, `document.hidden === false` |
| rAF callbacks | **3,110** (119.6/s) |
| `GPURenderPassEncoder.draw` calls | **3,104** |
| `GPUQueue.submit` calls | **3,104** |
| `instanceCount` on the last draw | **2** |
| the page's own `FrameTimer` | `frames 2882  window 240  mean 0.25ms  p95 0.30ms` |
| sim ticks observed | **259** (10 Hz) |

The draw and submit counts come from wrapping
`GPURenderPassEncoder.prototype.draw` and `GPUQueue.prototype.submit`,
which are platform globals rather than module exports, so they cannot be
defeated by the module-identity trap in [L20]. One draw and one submit
per frame, `instanceCount` 2: instancing intact.

**This also closes [U1] from Tasks 10 and 12.** The
`requestAnimationFrame(loop)` line in `main.ts` had never once executed
at any prior commit. It has now executed 3,104 times.

### The agent's trace

`SimBridge.prototype.tick` was wrapped to read `positions()` after every
tick. Slot 0 is the fridge and slot 1 is the agent.

- Slot 0 held **(12, 10) on all 259 ticks**. A static control: if the
  fridge ever moved, the slot mapping would be wrong and the agent trace
  would mean nothing.
- The agent spawns at (2, 3) and its first post-tick sample is
  **(2.25, 3)**, so the observer was installed before tick 1 and no part
  of the walk is missing.
- **67 consecutive moves, every one of exactly 0.25 tiles** - the only
  step size in the whole trace - reaching **(12, 10) on tick 68**.
  Manhattan distance is 10 + 7 = 17 tiles and `TILES_PER_TICK` is 0.25,
  so 17 / 0.25 = 68. The prediction and the observation agree exactly,
  with no stalls.

**Pathing is closed.** This is also the direct disproof of the [L17]
failure mode, where an out-of-lot fridge leaves the agent motionless at
its spawn forever with nothing logged.

### The meal is not positionally observable, and the predicted signature does not exist

The expected signature was "the agent holds still for about 15 ticks,
and that pause is the meal". **It is not there, and it cannot be.** After
arriving, the agent stays at (12, 10) for all 191 remaining ticks:
eating is stationary, and so is idling afterwards, and there is only one
smart object to go back to. "Ate" and "arrived and did nothing" predict
the identical trace. Reading a meal out of that pause would be reading a
pause that is indistinguishable from its own absence - the exact shape of
[L5] through [L16].

`SimBridge` exposes no hunger accessor, and adding one was explicitly
deferred, so hunger cannot be read directly either.

### Reservation supplies the missing observable, causally

`select_action` queries objects `Without<Reserved>`, so a claimed fridge
is invisible to every other agent; `tick_interactions` removes `Reserved`
**only** when a meal's `remaining_ticks` reaches 0; and idle agents are
processed in entity-index order, so an agent already standing on the
fridge - distance 0, hence maximum score - wins any contest it enters.

So a second agent's freeze reports on the first agent's meal. Three runs
of 200 ticks, same lot, same fridge tile, `positions()` only:

| run | setup | A | B |
| --- | --- | --- | --- |
| **control** | B alone with the fridge | - | moves on **tick 1**, reaches (12, 10) on tick 64 |
| **walk then eat** | A from (2,3), B waits at (2,4) | arrives tick 68 | frozen ticks 1-98, **first moves tick 99** |
| **eat in place** | A spawns on (12,10), B waits at (2,4) | never moves | frozen ticks 1-30, **first moves tick 31** |

Reading the three together:

1. **The control is what makes the other two mean anything.** An
   identical agent, identical hunger, identical tile, with the competitor
   removed and nothing else changed, departs on tick 1. So B's freeze is
   caused by the reservation and not by anything about B - protocol rule
   4, hold everything else constant.
2. **B moving at all proves a meal completed.** Removing `Reserved` has
   exactly one code path, and it is gated on `remaining_ticks == 0`.
3. **The hold after arrival is 30 ticks in both geometries.** Walk-then-
   eat: released end of tick 98, arrived tick 68, so 30. Eat-in-place:
   released end of tick 30, arrived at spawn, so 30. `duration_ticks` is
   15, so that is **two consecutive meals**, and the two very different
   geometries agreeing on the same 30 is what makes it arithmetic rather
   than a single number.
4. **A yielding the fridge is the recovery observation.** A is sorted
   first and stands on the object at distance 0, so it re-claims for as
   long as its score exceeds `ACTION_THRESHOLD`. The only term that
   changes is its hunger. B departs, so A stopped wanting to eat - which
   is what "recovers" means. Had hunger not risen, A would have held the
   reservation forever and B would never have moved.

**What is still not observed in a browser:** the hunger *value*. That it
rose is established causally above and by `terri-sim`'s own tests, which
assert the level before and after a meal. No number was read.

## [V11] The render path's per-frame allocation, measured

[D11] says "zero copy, and **no per-entity JS objects, ever**". Task 13
measured the JS heap *trend*, which cannot distinguish "nothing
allocates" from "the scavenger keeps up with what does". This closes
that.

V8's sampling heap profiler over CDP, on
`http://localhost:5173/?stress=1000`, 20 seconds after a 6-second warm-up,
`samplingInterval: 32768`, with **`includeObjectsCollectedByMinorGC` and
`includeObjectsCollectedByMajorGC` both true**. Those two flags default
to false, which excludes exactly the short-lived temporaries in question;
see [L20]. Frame production was confirmed in the same run by wrapping
`GPURenderPassEncoder.prototype.draw`.

| | before | after |
| --- | --- | --- |
| frames in the window | 2,394 | 2,401 |
| entities (`instanceCount`) | 1,002 | 1,002 |
| **`buildInstances`** | **57.76 MB** | **0.38 MB** |
| `SpriteRenderer.draw` | 0.59 MB | 0.84 MB |
| `main.ts` frame body | 0.09 MB | 0.09 MB |
| **whole page, sampled** | **58.54 MB** | **1.38 MB** |

**The expectation was wrong.** `worldToScreen` returned a fresh
two-element array per entity per frame, and `iso.ts` excused it on the
grounds that V8's escape analysis would eliminate it once the function
inlined into `buildInstances`. 57.76 MB over 2,394 frames at 1,002
entities is **about 25 bytes per entity per frame, 2.9 MB/s**, which is
that array and nothing else in that function. V8 kept every one of them.

`buildInstances` now calls the scalar `screenX`/`screenY` helpers and
allocates nothing per entity: **57.76 MB to 0.38 MB, a factor of 150**,
and the whole page's sampled allocation falls by a factor of 42. The
0.38 MB that remains is about 164 bytes per frame, which is the three
typed-array views the bridge is **required** to rebuild every call and
must never cache ([L10]). Those are per-frame, not per-entity, and [D11]
permits them by name.

The `SpriteRenderer.draw` row is WebGPU wrapper objects -
`getCurrentTexture`, `createView`, `createCommandEncoder`,
`beginRenderPass`, `finish` - at roughly 250 to 370 bytes per frame. The
difference between the two columns there is sampling variance, not a
regression; both runs already contained the uniform fix.

**The uniform-buffer fix is not separately quantified, and is much
smaller than it looks.** `draw` used to build
`new Float32Array([canvas.width, canvas.height, 24, 24])` every frame and
hand it to `writeBuffer`, so unlike the tuple it escapes and no optimiser
can remove it - but it is **one** object per frame rather than one per
entity, roughly 40 bytes, about 4.8 KB/s at 120 fps. It is hoisted to a
field and mutated in place because it is free to fix and unambiguous, not
because it was the expensive one. Both columns above already include
that change; the before/after isolates the tuple alone.

## Reproducing any of this

The Playwright scripts live in the session scratchpad rather than the
repo, because they are one-off instruments and a stale committed harness
is worse than none. What matters is reproducible from the procedure
descriptions above; the load-bearing details are these.

- **Rebuild the wasm before measuring.** `npm test` and the browser both
  read a previously emitted `.wasm` and have no idea the Rust moved.
  This is [L8] wearing a different hat, and [L13] is the instance.
- **Check `document.visibilityState` and a frame count before believing
  any browser number.** Every measurement above that involved frames
  reports one.
- **Prefer platform-level hooks to module-level ones** when counting
  frames. `GPURenderPassEncoder.prototype.draw` cannot be defeated by
  [L20]'s module-identity trap; a patched class method can, and was.

---

# M1b Task 3b: the authored lot on screen

Real, **visible** Chrome driven by Playwright, so `requestAnimationFrame`
is paced by the compositor rather than by a harness ([L19] rule 3). Frames
counted at `GPUQueue.prototype.submit` and `GPURenderPassEncoder.prototype.draw`,
and the instance array captured at `GPUQueue.prototype.writeBuffer` - three
platform globals with one identity per page, so none of them can be
defeated by [L20]'s module-identity trap.

## [V12] The lot in `content/lot.toml` is what the page draws

`document.visibilityState` was **`visible`** and **1,345 rAF callbacks,
1,345 `draw` calls and 1,345 `submit` calls** landed in 12 s, an
`instanceCount` of **9** on every one. The page reports `entities 9`.

Pixel readback, taken **inside** a rAF callback, over the 921,600-pixel
canvas:

| colour | pixels | what |
| --- | --- | --- |
| `23,23,28` | 916,416 | the clear colour |
| `89,166,217` | **4,608** | 8 smart objects x 576 |
| `242,140,89` | **576** | 1 sim |

576 is exactly one 24 x 24 quad, so this is the [L14] rule 4 count rather
than a "some blue is present" check: 4,608 is 8 quads and not 7, and no
quad is degenerate.

The instance array the GPU received, converted back through the shipped
projection with `originX = 544`, `originY = 40`:

| screen | world tile | object |
| --- | --- | --- |
| 544, 104 | 2, 2 | fridge |
| 640, 152 | 5, 2 | sink |
| 1056, 360 | 18, 2 | shower |
| 1184, 424 | 22, 2 | toilet |
| 288, 232 | 2, 10 | bookshelf |
| 352, 360 | 7, 13 | sofa |
| 416, 456 | 11, 15 | television |
| 768, 568 | 20, 13 | bed |

Every one is exactly where `content/lot.toml` places it, and every screen
coordinate is inside 1280 x 720. The sim was at (687.8, 224.1) - world
(8.0, 3.5) - at t = 1.2 s, having started at (8, 6) and walked north
toward the fridge, and at (544, 104) at t = 12 s, which is the fridge's
tile.

**Two things you cannot see, and both matter to whoever reads the play
session.**

1. **Walls are not drawn.** Only entities are, and a wall is a `TileGrid`
   bit rather than an entity. The bathroom is enclosed in the simulation
   and invisible on screen, so a sim walking round to the doorway looks
   like a detour for no reason.
2. **A sim standing on an object disappears behind it.** Both quads take
   the same world position, so [D10]'s depth is identical, and
   `depthCompare: 'less'` rejects the second draw. This is why the orange
   576 pixels are present in the t = 1.2 s sample and absent from the
   t = 12 s one - the sim is *at* the fridge, not gone. Pre-existing
   behaviour rather than anything Task 3b changed, but the M1b lot makes
   it constant: a sim spends most of its time using something.

## [V13] `?stress=1000` on the M1b lot, with two controls

Frame time got worse, and the first plausible cause is wrong. Numbers are
the **median p95 across the 240-frame windows after the first**, which is
discarded as warm-up; all three runs are the same session, same machine,
same visible Chrome, roughly 100 fps.

| configuration | p95 | mean |
| --- | --- | --- |
| M1b lot, 8 objects, **A\* path length** (shipping) | **16.68 ms** | 4.39 ms |
| M1b lot, 8 objects, **Euclidean** (control, metric reverted) | 17.49 ms | 5.22 ms |
| M0 shape: 16 x 16, one fridge, shipping simulation | **7.82 ms** | 3.24 ms |

**The wall-aware metric is not the cause.** Reverting only the metric, on
the same lot and the same 1,009 entities, measures the same thing - very
slightly worse, which is noise. The reason it costs so little is
structural rather than lucky: `select_action` skips objects already
claimed this tick and objects the query has excluded as `Reserved`, so
once the eight objects are taken the ~1,000 idle agents iterate an empty
candidate list and path nowhere at all.

**The configuration is the cause**, roughly a 2x p95, from a 24 x 18 lot
with eight objects and 1,000 entities spread across 432 tiles instead of
256.

**Do not compare any of these with [V9]'s 0.33 ms.** The M0 shape reads
7.82 ms here against the 0.33 ms recorded at the M0 close-out, on the same
shape and the same machine, so this session's environment differs from
that one by more than the thing being measured. Only the three
same-session rows above are comparable with each other. Reproduced on both
the Vite dev server and a `vite preview` production build, which rules out
bundling as the difference.

The M1b page itself, with one sim and eight objects, runs at **p95 0.32 to
0.38 ms** in steady windows, so nothing here affects the milestone; it
affects the M0 stress harness, which is what [V9] rests on.

---

# M1b Task 3c: the room, textured

Real, **visible** Chrome (`channel: 'chrome'`, `headless: false`) driven by
Playwright, 1400 x 900 window, `bringToFront()`, Vite dev server on `:5173`.
Frames counted at `GPUQueue.prototype.submit` and
`GPURenderPassEncoder.prototype.draw`, and `requestAnimationFrame` wrapped -
three platform globals with one identity per page, so none of them can be
defeated by [L20]'s module-identity trap.

Two earlier measurements are superseded here rather than deleted.

- **[V2]'s 576 pixels no longer apply.** Every quad was 24 x 24 and flat
  coloured; sprites are now sized per entry of the atlas manifest and textured,
  so a sim is 38 x 78 and a floor tile is 64 x 32. The pixel-count discipline
  behind that measurement is what carries forward, not the number.
- **[V12]'s two "things you cannot see" are what this task fixed.** Both are
  re-measured below.

## [V14] The lot draws as a room, in one draw call, at 499 instances

`http://localhost:5173/` with no query parameters.

| | 12 s run | 45 s run |
| --- | --- | --- |
| `document.visibilityState` | **`visible`** | **`visible`** |
| rAF callbacks | 1,607 | 5,362 |
| `GPURenderPassEncoder.draw` calls | **1,481** | **5,235** |
| `GPUQueue.submit` calls | **1,481** | **5,235** |
| `draw` arguments on every call | `(6, 499)` | `(6, 499)` |

**One draw and one submit per frame, unchanged**, with `instanceCount` 499 on
every one of them. 6 is `VERTICES_PER_QUAD`. The instancing property [D10] rests
on survives the atlas, which is the whole reason there is one atlas.

**499 is arithmetic, not a number that looked plausible.** The shipped 24 x 18
lot is 432 floor tiles; `wall_tiles` reports 15 interior walls; `tiles.ts` adds
the lot boundary the simulation treats as solid but `lot.toml` never lists, at
18 panels down the west side and 25 along the north including the corner. That
is 490 static instances, uploaded **once at load**, plus 8 smart objects and 1
sim written per frame after them. 432 + 15 + 43 + 9 = 499.

Pixel readback taken **inside** a rAF callback ([L37]), over the 921,600-pixel
canvas, at the moment the sim was standing on the fridge tile:

| colour | pixels | what |
| --- | --- | --- |
| `23,23,28` | 383,913 | the clear colour, outside the lot |
| `186,155,118` | 279,149 | the generated floor diamond's fill |
| `255,251,241` | 48,932 | `wallNS` panels, the lit face |
| `137,134,132` | 58,400 | `wallEW` panels, the shaded face |

7,980 distinct colours in all, which is the point of the row above: the frame
is pre-rendered art with antialiased edges rather than the four flat fills
[V12] measured.

**Reproduced on the production build**, not only on the dev server. `vite build`
emits `dist/assets/atlas-*.png` at 55.75 kB and `vite preview` on `:4173` gives
893 draws with `instanceCount` 499 and the same 7,980 distinct colours in 8 s.
That matters because the atlas is imported from `assets/`, one directory above
the Vite root, and the dev server needs an explicit `server.fs.allow` to serve
it - a setting the production build does not use, so the two paths could have
diverged silently.

## [V14a] A sim standing on an object is drawn, not swallowed

[V12] recorded the failure directly: the sim's 576 orange pixels were present at
t = 1.2 s while it was walking and **absent** at t = 12 s once it had reached
the fridge. Same world position, same depth, and `depthCompare: 'less'` rejected
whichever quad was drawn second.

Observed at t = 12 s in the run above, with the sim on the fridge's tile
(2, 2): the sim is drawn in front of the fridge, and the fridge is still visible
around it. The mechanism is `layeredDepth` in `iso.ts`, and the CI-side
counterpart is
`gives a sim on an object tile a strictly smaller depth than the object` in
`web/tests/frame.test.ts`, which is mutation-verified - deleting the layer term
fails it and two others.

At t = 30 s the sim had walked through the doorway at (16, 5) and was standing
at the toilet inside the bathroom, drawn **in front of** the wall it had just
walked around, which is correct: the bathroom is on the near side of that wall.
The detour is now legible instead of looking like an AI fault.

## [V14b] 490 static instances cost nothing measurable, with an in-session control

The static geometry is uploaded once and drawn every frame, so the question is
whether 490 extra instances and their overdraw show up in the frame budget.
Measured with the shipped `FrameTimer`'s own rolling p95, 30 s per arm, first
two 2-second windows discarded as warm-up.

| arm | `instanceCount` | median p95 | median mean | best windows |
| --- | --- | --- | --- | --- |
| shipping | **499** | 3.31 ms | 0.59 ms | 0.33 ms |
| control, `setStaticGeometry` suppressed | **9** | 3.04 ms | 0.59 ms | 0.35 ms |

**The control is what makes this mean anything**, per [V13]: same session, same
machine, same visible window, one line changed and restored. The two arms are
indistinguishable, and the 0.33 ms clean windows match the "p95 0.32 to 0.38 ms"
[V13] recorded for this page before any of this work.

**The distribution is bimodal and the median is the wrong statistic for it.**
Individual windows read either ~0.35 ms or 3 to 7 ms, in both arms, with no
trend. That is the environment - a dev server, a Playwright-driven Chrome and a
build toolchain on one machine - not the renderer. [V13] already warned that
this session's environment differs from the M0 close-out's by more than the
thing being measured; the same caution applies here, and the control is why a
conclusion is available anyway.

## What Task 3c did not establish

- **No allocation profile was taken.** [V11]'s procedure was not re-run, so the
  claim that `buildInstances` still allocates nothing per entity rests on the
  code being unchanged in that respect plus the static block being built once,
  not on a measurement. The static path is the one that would show up, and it
  runs exactly once.
- **The atlas is not checked against the GPU.** `web/tests/atlas.test.ts`
  compares the two manifests to each other and to the declared texture size; it
  cannot check that `atlas.png`'s pixels are where the rects say. A sprite
  packed at the wrong offset would draw the wrong picture and pass everything.
  `sprites.ts` does compare the decoded bitmap's dimensions against `atlas.ts`
  at start-up, which catches a regenerated atlas paired with a stale manifest.
- **One display, one GPU, one browser.** [U-all] still holds.
