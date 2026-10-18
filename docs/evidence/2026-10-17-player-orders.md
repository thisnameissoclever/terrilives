# Player-order verification, October 17, 2026

This is a historical record of the isolated implementation. See the
[October 18 integration verification](2026-10-18-player-orders.md) for the
delivered V17 save format and current evidence.

Issue #273 is implemented locally on `twcx/issue-273-player-orders`, based on
`7c7cfa2274729716b35fda168653c2dfe687d079`. The original defect was reservation
cleanup deleting an accepted conversation order without an outcome. The
original play session's triggering condition remains unknown.

The implementation follows the [approved specification](../specs/2026-10-17-player-orders.md).
Each order keeps a stable identifier (ID); the new save format is version 15 (V15).
Source and retained artifact hashes are recorded beside the
[reproduction settings](2026-10-17-player-orders/final-runtime-settings.json).
See the [source manifest](2026-10-17-player-orders/source-manifest.json) and
[artifact manifest](2026-10-17-player-orders/artifact-manifest.json).
The release WebAssembly SHA-256 is
`61dc3fcd0d778b035f19ce176ab7bbe5684187c76c41e13f2c558da18a19577f`.

## Automated verification

| Check | Observed result |
| --- | --- |
| `cargo test --workspace -- --test-threads=4` | 2,356 passed; one existing private-save example test ignored because no private fixture path was supplied |
| Simulation library | 1,555 passed |
| WebAssembly wrapper library | 288 passed |
| `cargo clippy --workspace --all-targets -- -D warnings` | Passed after restoring mutation sources |
| `cargo fmt --all -- --check` | Passed |
| Full browser run, 265 files | 3,442 passed; one unrelated geometry case exceeded its unchanged 30-second limit |
| Geometry file rerun | All 14 passed; the previously timed-out crop-head case took 13.365 seconds |
| Final rebuilt WebAssembly and related browser files | 890 passed; one older builder fixture used an actionless lamp as a usable object |
| Corrected builder file | All 25 passed using a real exercise action; sale-refusal assertions remain intact |
| `npm run typecheck` | Passed with the new browser regression and corrected builder fixture |
| Release WebAssembly and `npm run build` | Passed; production build took 28.52 seconds |
| Changelog tests | All 12 passed |

The final related browser run covers 70 files and 891 cases, including the new
invalid-order regression. Its one fixture failure passed in the 25-case builder
rerun. The full run and these reruns cover the 3,444 current browser cases;
there was no second complete 265-file run after the native admission repair.
The remaining files do not load the simulation. Successful files are silent
under Vitest's automatic minimal reporter, so log silence did not mean a hang.

Rust ran with `CARGO_PROFILE_TEST_DEBUG=0`, `CARGO_BUILD_JOBS=2` and four test
threads. Browser tests used one worker and a 4 GiB Node heap limit. Dependency
manifests and lockfiles did not change. The production build retained its
existing large-chunk and ineffective dynamic-import notices.

## Regression boundaries

1. Critical needs on either conversation participant retain the exact accepted
   order. Busy recipients finish their current whole activity. Future incoming
   requests remain visible without reserving participants.
2. Reciprocal and competing requests use one participant decision. Recipe
   preparation, gathering, dining and physical conversation arrival share the
   distinction between current and suspended work. The targetless boundary
   after another activity ends survives exact V15 save/load and continuation.
3. Repeated identical actions retain distinct IDs. Reading, recipes, generic
   interactions, managed meals, chores and scoped cleanup record actual starts
   and one terminal outcome. Reservation release does not cancel their orders.
4. Supported named and unnamed agents retain their distinct owner kind in V15.
   Wrong-kind, missing and duplicate owners are rejected before adoption.
   Older readers retain their frozen wire layouts and migration tests.
5. Attendance tests cover delayed departure, outbound interruption, recall,
   resumption, repeated interruptions, overnight and week boundaries, fixed
   scheduled endings, integer-cent settlement and the two-hour grace period.
6. Invalid future object or social actions fail during admission. They cannot
   displace a valid front order, recall a worker or shelter behind a book return
   until their own save becomes unloadable. Capacity and exhausted-ID refusals
   remain distinct from accepted failures.

The new browser invalid-order case failed against the preceding native binary:
order #1 remained behind valid order #0. It passes against the final binary,
including exact accepted/failed events and a matching save/load hash.

## Deliberate defects

Each native mutation failed its intended behavioral assertion. Original source
bytes were restored in `finally` blocks and checked with SHA-256 before the
final clean workspace run.

| Mutation | Detection |
| --- | --- |
| Restore the blanket recipe veto on an explicit conversation front | New front conversation could not run before the retained recipe |
| Remove visited-node termination from front-request traversal | The independent participant bound panicked instead of hanging |
| Treat every retained recipe as busy at physical arrival | The targetless boundary conversation could not complete |
| Bypass object-action admission validation | Invalid future order remained in the valid queue |
| Suppress normal action-event capture | Real accepted/canceled history contained zero events instead of 2,048 |

The first event-capture mutation survived a test that exercised only the
separate rejected-submission producer. A new public-command test drives 1,025
accept/cancel pairs, checks retention and cursors, and compares exact V15
continuation with an empty-history restored peer. The mutation then failed.
The original rejection-path test remains. See the
[browser mutation receipts](2026-10-17-player-orders-browser.md) for the five
additional browser defects detected during implementation.

## Played behavior

Displayed Windows Chrome used an NVIDIA Lovelace adapter with
`isFallbackAdapter=false`. Desktop captures use 1440 by 1000 pixels. Phone
captures use a 390 by 844 touch viewport in desktop Chrome, not a physical phone.
The retained [V15 baseline](2026-10-17-player-orders/final-browser-baseline.bin)
and [browser staging helper](2026-10-17-player-orders/browser-staging.js) reproduce
the shipped household. The helper stages public simulation commands; actual
context-menu, dialog, queue, speed, Save and Load controls were also exercised.

1. The production preview showed Bill's running exercise above Casey's Incoming
   Chat. Exercise completed at tick 65; Chat started at 71 and completed once at
   134 with its original actor/order identity. The displayed preview advanced
   273 real browser frames and produced no page errors.
2. The two-worker warning named Tim and Bill and showed 8 of 8 remaining hours.
   Phone Cancel preserved hash `4928803057959406784`, restored canvas focus and
   produced no horizontal overflow. A 3x-speed warning held tick 362 for the
   observation interval; Cancel restored 3x and the clock reached 377 afterward.
3. Confirmed Chat #0 at tick 360 waited for the recipient, started at 539 and
   completed at 602. Both workers then resumed departure. At tick 880, Tim's
   completed original shift reported 157 of 480 minutes worked, 323 missed,
   base score 30.64, deduction 33.8333, clamped final score 0 and $39.25 earned.
4. During a real book return at tick 126, invalid front order #1 failed
   immediately while valid sleep order #0 and the return remained unchanged.
   Actual Save and Load preserved hash `13125485811153056145`. Load cleared
   visible history, failure text and the bubble.
5. Failure feedback remained visible near 2.8 real seconds and was absent near
   3.2 seconds both paused and at 3x. Paused simulation time stayed at tick 2;
   accelerated time advanced from 5 to 101. Console warnings occurred once per
   failed sequence. The timer module was unchanged by the final native
   admission repair and its browser expiry tests passed again.
6. Selected-person Copy matched the displayed history using a clipboard stub
   confined to the task's browser context. The user's clipboard was untouched.
   Exercise and sleep continued when a separate invalid action failed.

## Image inspection

The implementing reviewer inspected every original screenshot below. A fresh
independent reviewer accepted the final images and separately rejected the
known missing-feedback comparison. These judgments establish visible layout,
not the behavioral traces above.

| Files in the evidence folder | Visible finding |
| --- | --- |
| `final-facing-{1,2,3,4}-{normal,large}.png` | All eight keep the squiggle above red-shirt Casey, clear of the body; the close neighbor in direction 3 does not steal its attachment |
| `final-desktop-exercising-failure.png`, `final-desktop-sleeping-failure.png` | Bubble clears Bill's lowered exercise head and his head at the pillow |
| `final-desktop-incoming.png`, `final-phone-incoming.png`, `final-production-incoming.png` | Running action precedes the legible Incoming direction and counterpart |
| `final-desktop-work-warning.png`, `final-phone-work-warning.png` | Both names, hours, consequences and decision buttons fit without clipping |
| `final-desktop-attendance.png` | Worked/missed minutes, deduction, final score and earnings are readable |
| `final-phone-failure.png` | Complete squiggle and readable failure reason; no body obstruction |
| `final-phone-controls-layer.png` | Controls remain above the world bubble; this overlap frame does not show the entire bubble |
| `review-card-p.png`, `review-card-q.png` | Blind reviewer accepted p and rejected q because q has no visible failure bubble |
| `comparison-47.png`, `comparison-28.png` | Final-production blind review accepted 47 and rejected 28 for the same missing-feedback defect |

The blind pair used matching game settings before the final admission repair.
The final facing and interface captures were repeated with the final binary.
The final-production pair also restored the hidden bubble and compared its
element pixels before and after restoration. Both checksums were
`e3344afe105f4a85f41c8291cf97e0eae00aa2e04fcd886558b21a6655f2bf79`.
This comparison covers the effect's exact image region, not unrelated pixels
elsewhere in the game. The samples and settings are retained.
Normal game zoom is 1; enlarged captures use 1.3498588. Exact body settings,
positions, directions, clip samples and camera values for the facing and sleep
scenes are retained in machine-readable settings files.
No review videos were made or retained.

## Diagnostic cost

Native measurements use the unoptimized Windows test profile on a shared host.
Five trials with event capture and five without used the same admission commands.
Gameplay hashes matched for every size and mode.

| Orders | With event capture | Without event capture |
| --- | --- | --- |
| 32 | 1.487 ms | 1.108 ms |
| 256 | 4.644 ms | 4.091 ms |
| 1,024 | 16.430 ms | 10.766 ms |

The restored diagnostic example measured a full-history empty-tail read at
9.554 microseconds and copying all 2,048 records at 415.061 microseconds.
It compared 300 subsequent gameplay ticks with and without retained history.

Four alternating five-second displayed-browser trials verified Everyone,
2,048 rendered lines, actual open/closed panel state and an unchanged paused
world hash. For frame processor time (CPU work), closed-panel medians were
0.760 and 0.720 ms; open-panel
medians were 0.780 and 0.785 ms. CPU 95th percentiles ranged from 1.325 to
1.510 ms; frame-interval 95th percentiles stayed near 16.7 ms. These are steady
paused-scene measurements with concurrent shared-host work, not isolated graphics-processor
timings or a moving-population performance claim. Raw samples are retained.
Two earlier measurements with incorrect panel/filter settings were discarded.

Task-owned browser contexts were closed in `finally` blocks. Development and
production preview servers were stopped; ports 5197 and 5198 had no listeners.
No commit, push, merge or deployment was performed.
