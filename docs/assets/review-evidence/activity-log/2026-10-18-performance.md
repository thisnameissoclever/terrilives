# Activity log performance, measured 2026-10-18

This record holds the measurements Task 11 of the [activity log plan](../../../superpowers/plans/2026-10-18-activity-log.md) takes against [AL-perf] in the [specification](../../../specs/2026-10-18-activity-log.md). It compares the panel and simulation code before and after the fixes for five gaps the first measurement found, under the same conditions. The release frame-time gate could not run as the specification defines it on the machine available, so the browser measures were taken in substitute configurations. Every threshold is reported with the configuration it was measured in, and no threshold that was not measured as defined is marked as passed.

## Contents

- [What was run](#what-was-run)
- [Why the release gate could not run as defined](#why-the-release-gate-could-not-run-as-defined)
- [Verdicts](#verdicts)
- [Frame time and log work](#frame-time-and-log-work)
- [One-off work on a click](#one-off-work-on-a-click)
- [Allocation](#allocation)
- [Retained memory](#retained-memory)
- [Simulation cost](#simulation-cost)
- [Staging ring](#staging-ring)
- [What changed and why](#what-changed-and-why)
- [Findings outside the log](#findings-outside-the-log)
- [What remains for the played check](#what-remains-for-the-played-check)

## What was run

- **Revisions.** Before the fixes: the panel and log code of `039ac9985`, built into a production bundle beside the merges of main through `7b45ac301` (merge `7324bf665`). After the fixes: `b9fa490d8` (panel) and `cda1f9eab` (simulation and measurement tools). The before and after bundles ran alternately in one session, so they shared the machine's load. The native cost runs marked before used the branch at `c12171440`, before the two merges of main; the runs marked after used `cda1f9eab`. Main's changes moved the household's behavior between those revisions, so the before and after record counts differ.
- **Machine.** Windows 11 desktop, 60 Hz display, observed 2026-10-18: Windows 11 Pro, Intel Core i7-13700KF, 64 GB, NVIDIA GeForce RTX 4090, one display at 1920 by 1080 and 60 Hz; Chrome 155.0.8059.85 driven by Playwright Core 1.64 from Node 24.14.1. The machine was shared with other sessions' processes, with the processor at 88 percent load before the runs began.
- **Builds.** `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`, then `npm run build` in `web/` for the after bundle and `npx vite build --outDir <dir>` from the before sources for the before bundle, each served by `npx vite preview --port 4173 --strictPort --host 127.0.0.1 --outDir <dir>`. The allocation runs used the development server, `npx vite --mode lan --port 5174 --strictPort --host 127.0.0.1`, where module paths and function names survive.
- **Harness.** `scripts/activity-log-proof.cjs` with the helpers in `scripts/lib/browser-frame-gate.cjs`; `scripts/activity-log-wasm-memory.mjs`; the `activity_log_cost` example in `crates/terri-sim/examples/`. Every page ran with `audio=0` and Chrome's `--mute-audio`. Raw reports are in [2026-10-18-performance/](2026-10-18-performance/); files named `before-fix` and `after-fix` belong to this comparison, and the others are the first measurement of `23288060d`.
- **Commands.**
  - `node scripts/activity-log-proof.cjs performance --stress 0`, three alternating pairs per panel state, on each bundle.
  - `node scripts/activity-log-proof.cjs performance --stress 100 --repetitions 1 --everyone` on each bundle.
  - `node scripts/activity-log-proof.cjs rebuild --stress 100 --fill-ticks 2160 --everyone --repetitions 2`, twice on each bundle, alternating.
  - `node scripts/activity-log-proof.cjs allocation --url http://127.0.0.1:5174/` with `--stress 0` at the specified 32 KB interval and at `--sampling-interval 1024`, and with `--stress 100 --sampling-interval 1024`, with and without `--everyone`.
  - `node scripts/activity-log-proof.cjs memory --stress 100 --fill-ticks 2160 --after-ticks 720` and `memory --stress 0 --fill-ticks 46080 --after-ticks 2880` on the after bundle.
  - `node scripts/activity-log-wasm-memory.mjs --stress 100 --days 6 --pairs 3` on the before wasm and `--pairs 1` on the after wasm, and `--stress 0 --days 36 --pairs 1` on the after wasm, with `--wasm-dir` naming each build's copy.
  - `cargo build --release -p terri-sim --example activity_log_cost`, then `activity_log_cost --agents 0 --seed S` and `--agents 3 --seed S` for seeds 20260728, 7 and 42, and `--agents 100 --ticks 2880 --chunk 360`.

## Why the release gate could not run as defined

The gate in `docs/ARCHITECTURE.md` needs a display calibrated at 120 Hz and the `?stress=1000` page. Neither was available.

1. **The display runs at 60 Hz.** Every calibration achieved 58.4 to 59.4 Hz against 118 to 122 Hz. At 60 Hz the refresh interval itself sits at the 16.6 ms frame budget, so the gate's calibration check fails in every run and its frame-time verdicts are substitutes.
2. **`?stress=1000` never finishes starting** on current main (GitHub issue 305), so the browser measures ran at `?stress=0`, the household alone, and at `?stress=100`, which drives the log with roughly twenty times the household's records.

## Verdicts

Before and after are the same session's runs of the two bundles unless the row says otherwise.

| Threshold | Before the fixes | After the fixes | Verdict after |
| --- | --- | --- | --- |
| Calibrated 120 Hz display | 58.4 to 59.4 Hz | 58.4 to 59.4 Hz | Not met; the gate did not run as defined |
| Log work p95 at most 0.25 ms, stress 0 | Closed 0.010; open 0.035 in each pair | Closed 0.010; open 0.010 in each pair | Met at 60 Hz |
| Log work maximum at most 1 ms, stress 0 | Closed 0.035 to 0.115; open 1.275, 2.325 and 0.920 | Closed 0.055 to 0.105; open 0.350, 0.260 and 0.275 | Met at 60 Hz |
| Log work, stress 100, every person shown | Open p95 1.170, maximum 1.435; closed 0.010 and 0.040 | Open p95 0.300, maximum 1.345; closed 0.010 and 0.030 | Not met at stress 100 with the panel open; see [Frame time](#frame-time-and-log-work) |
| Application-work p95 regression at most 1 ms, stress 0 | Median pair: closed -0.605 ms, open -0.495 ms | Median pair: closed 0.390 ms, open -1.765 ms | Met at 60 Hz; not measured as defined |
| No application-work frame over 16.6 ms | Up to 10 per run, enabled and disabled alike | Up to 2 per run, enabled and disabled alike | Not met in either mode; the frames occur without the log |
| No steady `simIdOf` call | 0 in every run | 0 in every run | Met |
| Allocation, panel closed, 32 KB interval | 0 bytes | 0 bytes in two runs | Met |
| Allocation, panel open, 32 KB interval | 0 bytes over 2 lines | 0 bytes over 2 and 1 lines | Met, but see [Allocation](#allocation): this interval cannot resolve 2 KB a line with so few lines |
| Allocation per appended line, 1 KB interval | 1,176 bytes over 292 lines at stress 100 | 748 bytes over 416 lines at stress 100 | Met; the budget stays at 2 KB |
| Nothing for records whose lines stay hidden | 43,584 bytes for 342 hidden records, 37,348 of them in `visible` | 1,040 bytes besides the one view per drain, for 433 records and 2 lines; nothing in `visible` | Met |
| Nothing per frame without new lines, open, 1 KB interval | 9,472 bytes over 20 seconds and no line: `update`, `family`, `add`, `append`, `remember` | 3,096 and 2,072 bytes over 20 seconds with 3 and 2 lines: `remember`, which also runs with the panel closed, and one 1 KB sample in `groupKey`, a line's own merge key | Met for the panel; `remember` is open below |
| Retained JS difference at most 160 KiB, store full, stress 0 | Median 79,460 bytes (first measurement) | Median 20,256 bytes | Met |
| No wasm growth after the store is full | Page pairs at stress 100: 655 to 983 KB more with the log on (first measurement); Node runs at stress 100: 64 KB less with the log on | Page pairs: median 0 at stress 100, one 64 KB page at stress 0; Node runs at stress 100 and over 36 household days: identical | Met in the deterministic Node runs; the page pairs' small medians lie within their page-to-page spread |
| Simulation cost within 2 percent | Household median chunk ratios -1.29, +0.05 and +0.86 percent for seeds 20260728, 7 and 42 | +0.11, -0.06 and -0.71 percent for the same seeds, every 95 percent interval's upper end below +1.6 percent | Met |
| Staging ring holds every record a frame stages | Household of six: at most 63 records a frame | Household of six: at most 74 records a frame | Met for households; stress 100 still overflows at a day's end |
| The log never changes the simulation | Hashes equal after every game day in every lockstep run | Hashes equal after every game day in every lockstep run | Met |

## Frame time and log work

The log sampler times the store's drain and the panel's update in each frame. Each stress 0 run measured 540 ticks after 60 warm-up ticks at 3x speed. Work is the page's own frame timer; on and off are the enabled and `?activitylog=0` pages of a pair.

| Stress 0, panel open | Pair | Log p95 ms | Log max ms | Log max in frames without records | Work p95 ms, on and off | Work frames over 16.6 ms, on and off |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Before | 1 | 0.035 | 1.275 | 0.465 | 6.895 and 8.905 | 3 and 3 |
| Before | 2 | 0.035 | 2.325 | 2.325 | 10.250 and 6.575 | 9 and 4 |
| Before | 3 | 0.035 | 0.920 | 0.255 | 7.400 and 7.895 | 4 and 5 |
| After | 1 | 0.010 | 0.350 | 0.045 | 2.820 and 5.990 | 2 and 1 |
| After | 2 | 0.010 | 0.260 | 0.080 | 3.535 and 5.300 | 0 and 1 |
| After | 3 | 0.010 | 0.275 | 0.070 | 3.505 and 3.835 | 0 and 1 |

Before the fixes, the slowest log frames included frames that drained nothing, up to 2.325 ms. Those frames ran only the selection poll, whose `fitAboveDock` read the dock's position after the HUD's writes in the same frame and so forced a synchronous layout of the page. Frames that appended a line read the scroll metrics and set the scroll position the same way. After the fixes, no frame's log work reads layout, and the slowest open frame took 0.350 ms.

At stress 100 with every person shown, the page drained 573 records before and 802 after in its 540 ticks, appending lines on most frames, some of them with a hundred clauses (see [Staging ring](#staging-ring)). The open panel's p95 fell from 1.170 to 0.300 ms and its maximum from 1.435 to 1.345 ms, so stress 100 still exceeds both limits with the panel open. That load is far beyond a household's, whose lines arrive a few at a time; it would need a cap on lines composed per frame to meet the limits, which this change does not add. Application work at stress 100 was 127 to 503 ms per frame in both modes, so its frame-time comparison resolves nothing about the log.

## One-off work on a click

Opening the panel, changing a filter and Show earlier entries recompose the rendered window from the store in the click handler, outside the frame's log work. The `rebuild` mode filled the store to 2,000 records at stress 100, showed every person, and timed each click's script and the style and layout it left behind. Each bundle ran twice; the windows held 101 to 200 lines because the pages differed in what they had logged.

| Click | Before: script p50, max | Before: layout p50, max | After: script p50, max | After: layout p50, max |
| --- | --- | --- | --- | --- |
| Open | 2.06 to 2.18, up to 9.05 ms | 0.02 to 0.03, up to 0.20 ms | 0.59 to 2.14, up to 7.11 ms | 1.13 to 3.14, up to 5.31 ms |
| Filter change | 1.66 to 1.83, up to 2.39 ms | 0.02, up to 0.04 ms | 0.48 to 1.95, up to 5.06 ms | 0.92 to 2.45, up to 4.58 ms |

Before the fixes the click read the list's height inside its own script, so the layout ran there and the second reading found little left. After the fixes the scroll waits for the frame's own layout, which the mode's read-back measures as layout. The largest single click, script and layout together, took 12.4 ms after the fixes, on opening a 200-line window, and 9.2 ms before, on opening a 125-line window: one frame's work on a click, not a cost every frame pays. Show earlier entries never appeared, because no window reached 200 lines with more held.

## Allocation

The [V11] procedure ran on the development server: 6 seconds of warm-up, a 20-second window, both garbage-collection inclusion flags. Attribution counts a frame as the log's when its module is an `activity-log-*.ts` module or it is one of the bridge's activity log methods.

| Run | Before | After |
| --- | --- | --- |
| Stress 0, closed, 32 KB | 0 bytes; 13 drains with records | 0 bytes in two runs; 12 and 10 drains with records |
| Stress 0, open, 32 KB | 0 bytes; 2 lines | 0 bytes in two runs; 2 and 1 lines |
| Stress 0, closed, 1 KB | 4,116 bytes, all `remember` | 4,116 and 3,096 bytes, all `remember` |
| Stress 0, open, 1 KB | 9,472 bytes; 0 lines | 3,096 and 2,072 bytes; 3 and 2 lines; `remember` and one sample in `groupKey` |
| Stress 100, every person shown, open, 1 KB | 343,352 bytes for 292 lines, 1,176 a line | 311,328 bytes for 416 lines, 748 a line |
| Stress 100, one housemate selected, open, 1 KB | 43,584 bytes for 342 records and 0 lines; `visible` 37,348 | 6,320 bytes for 433 records and 2 lines; `takeActivityLog` 5,280, the one view per drain |
| Stress 100, closed, 1 KB | 8,340 bytes; about 97 a drain | 12,480 bytes; about 103 a drain, the one view |

The household adds at most a few lines in a 20-second window. At the specified 32 KB interval each sample stands for 32 KB, so a window with two lines reads 0 or 32 KB a line by chance: one run during this work charged a single 32 KB sample to `annoyed` over four lines. The first measurement's 4.6 KB a line came from four lines at the 1 KB interval. The figure per line here therefore comes from stress 100 with every person shown, where hundreds of lines arrive in the window. It includes the text, the list item's wrapper and the ResizeObserver callback, about 70 bytes a line. One stress 100 line can be much larger: a missed chore at a day's end carries a feeling from each of a hundred people and allocated about 40 KB when composed. A household's line carries at most five such clauses.

`ActivityLogNames.remember` runs at the roster's cadence whether or not the panel is open and is charged 2 to 4 KB in each 20-second window at the 1 KB interval, about 15 bytes a call. A Node loop of the same method showed no allocation, and the cause in the page is not identified. It is the only allocation left in frames without new records.

## Retained memory

The JS heap pairs ran on the after bundle with the panel closed, garbage collected twice before each sample. Retained is the enabled page's heap minus the disabled page's at the first sample, after the store has filled; growth is the second sample minus the first, enabled minus disabled.

| Run | Retained JS per pair, bytes | Median | JS growth, log minus baseline, median | Wasm growth, log minus baseline, per pair |
| --- | --- | ---: | ---: | --- |
| Stress 0, 46,080 + 2,880 ticks, before (first measurement) | 16,816,368; 79,460; 32,652 | 79,460 | -33,816 | 0 in every pair |
| Stress 0, 46,080 + 2,880 ticks, after | 54,700; 20,256; 16,852 | 20,256 | -128,976 | 65,536; -262,144; 65,536 |
| Stress 100, 2,160 + 720 ticks, before (first measurement) | 133,880; 590,120; -725,380 | 133,880 | -17,868,284 | 655,360; 786,432; 983,040 |
| Stress 100, 2,160 + 720 ticks, after | 207,512; -191,940; 15,656 | 15,656 | -1,664,876 | -524,288; 0; 0 |

At stress 100 the page holds about 1.43 GB after collection and grows by about 185 MB per 720 ticks in both modes, so its JS comparison cannot resolve 160 KiB. The page pairs also differ from each other: they start on different ticks and step differently, and their wasm memory grows by 0.5 to 1.4 MB with the log on and by similar amounts with it off.

`scripts/activity-log-wasm-memory.mjs` removes that noise. It runs the built wasm in Node with the page's 100 filler agents, takes the log every five ticks into a 2,000-record store as the page does, and records the wasm memory at the end of each game day. The runs are deterministic: the three before pairs gave identical numbers.

| Wasm, stress 100, 64 KB pages at the end of days 0 to 6 | Log on | Log off | Growth from day 2, on minus off |
| --- | --- | --- | ---: |
| Before | 27, 163, 179, 179, 188, 197, 199 | 27, 163, 179, 179, 186, 198, 200 | -65,536 bytes |
| After | 27, 164, 181, 181, 187, 198, 200 | 27, 163, 181, 181, 187, 197, 200 | 0 bytes |

The same runner with the household alone over 36 game days, `--stress 0 --days 36 --pairs 1`, ended both modes at 63 pages, with every day's size equal from day 4 on; the store filled on day 30. At stress 0 the page pairs' wasm growth with the log on was one page more than the disabled page's in two pairs and four pages less in the third, so their median of one page is noise from the pages, not log state. The simulation's own memory grows in both modes as the hundred agents meet. The log's state does not: the lockstep cost runs printed its scratch area after every game day, and over 20 days it held one Social total per person (3 for the household, 6 with three filler agents, 103 at stress 100), no open nuisance episode at a day's end, and a held-feeling buffer of capacity 4, unchanged from the first day. The staging ring and export buffer are fixed at 256 records.

## Simulation cost

`activity_log_cost` runs two worlds with the same seed in lockstep in one process, one with the log on and one off, over 28,800 ticks in 20 chunks of one game day, alternating which world runs each chunk first and taking the log every five ticks. It reports wall time and the thread's CPU cycles from `QueryThreadCycleTime`, which leave out time the thread spent descheduled. The cost below is the log-on world's time over the log-off world's, minus one, as the median of the 20 chunk ratios with its bootstrap 95 percent interval.

| Household | Seed | Median chunk, wall time | 95 percent interval | Median chunk, thread cycles | 95 percent interval | Records |
| --- | --- | ---: | --- | ---: | --- | ---: |
| Before | 20260728 | -1.29% | -2.15% to -0.15% | -1.30% | -1.61% to -0.24% | 911 |
| Before | 7 | +0.05% | -0.54% to +1.10% | -0.12% | -0.51% to +1.07% | 1,236 |
| Before | 42 | +0.86% | -0.04% to +1.57% | +0.82% | -0.21% to +1.53% | 1,289 |
| After | 20260728 | +0.11% | -2.05% to +1.55% | -0.08% | -2.01% to +1.33% | 1,339 |
| After | 7 | -0.06% | -1.01% to +0.78% | -0.24% | -1.10% to +0.74% | 1,378 |
| After | 42 | -0.71% | -2.54% to +0.91% | -1.14% | -2.40% to +1.13% | 1,394 |

Every median and every interval's upper end is below the 2 percent threshold, so the log's simulation cost cannot be told apart from zero at this resolution. With three filler agents added, a household of six, the after medians were +1.00, +1.11 and -0.55 percent for seeds 20260728, 7 and 42; seed 20260728's chunk ratios spread from -2 to +9 percent while another session loaded the machine, so its interval reached +8.07 percent. At stress 100 the after median was -0.69 percent over eight chunks of 360 ticks. The first measurement's separate processes varied by a factor of two, which is why the comparison now runs in lockstep. The worlds hashed the same after every chunk of every run, so the log changed nothing in the simulation; `activity_log_never_changes_the_world` and its twenty-day twin also pass.

## Staging ring

The busiest frame comes at the start of a chore week, when each owner's duties, the day's chore outcomes and each other housemate's feeling about them arrive together.

| People | Largest frame, before | Largest frame, after | Dropped |
| --- | --- | --- | ---: |
| Household of three, seeds 20260728, 7 and 42 | 36, 30 and 33 | 30, 28 and 38 | 0 |
| Household of six (three filler agents), same seeds | 63, 56 and 63 | 62, 62 and 74 | 0 |
| 103 people, `?stress=100`, two game days | 256 | 256 | 137 before, at `c12171440`; 53 after |

A household has at most six people, and its busiest frame used under a third of the 256-record ring, so the ring stays at 256 and is not sized for stress pages. At stress 100 the first day's end stages a chore outcome with about 250 feelings, one from each other person, and the ring overwrote 53 records at the merged revision, in Node, natively and in the page alike; later days dropped nothing in the after native run or in the six-day Node runs. The before native run, on the revision without main's two merges, dropped 69 at the first day's end and 68 more at the second. The page memory runs, which step five ticks at a time from different start ticks, dropped 0, 55 and 157 records. The specification now states this limit. The panel keeps every record that arrives: a child whose parent was overwritten stays hidden, and a parent whose children were overwritten shows without their clauses, which `shows what arrived when the staging ring dropped records` in `web/tests/activity-log-panel.test.ts` checks.

## What changed and why

1. **Hidden records allocated, and lines built many temporary arrays.** `visible` built an array of each record's children for every drained record, including records whose lines stayed hidden. It now refills one reusable family buffer and allocates nothing. Line text reuses one builder, joins clauses as it finds them instead of gathering them into arrays, and builds Details numbers only while Details is on. Rows are their list items, so an appended line no longer adds a handle object and a map entry.
2. **The frame update read layout.** The selection poll's `fitAboveDock`, the scroll check on each appended line and the scroll to the newest line each forced a synchronous layout behind the HUD's writes, which the log's timer charged to the log; the 2.325 ms frame drained nothing at all. The view now learns its scroll position from scroll events, and follows the dock and finishes a scroll to the newest line in a ResizeObserver callback, after the frame's layout. Opening the panel and filter changes still lay out the new window once, on the click.
3. **The frame update did clock arithmetic.** Comparing and storing the frame time boxed a number on frames between polls before the engine optimized `update`, which the 1 KB profile charged to `update`. The update now takes no clock: the selected housemate is a stored value the roster refreshes at its cadence.
4. **The wasm growth was the page's, not the log's.** The deterministic Node runs show the log on and off ending within one 64 KB page, and the log's state stops growing after the first day. The end-of-tick pass also no longer collects closed nuisance episodes into a vector every tick an episode is open.
5. **The simulation cost was unresolved.** The lockstep example replaced separate processes; see [Simulation cost](#simulation-cost).

## Findings outside the log

1. `?stress=1000` does not finish starting on current main, and the page allocated hundreds of megabytes to gigabytes in each 20-second sampling window, mostly in the character renderer. Both are GitHub issue 305.
2. At stress 100 the JS heap held about 1.43 GB after collection and grew about 185 MB per 720 ticks with the log on or off.
3. At stress 0, frames of application work over 16.6 ms occurred in enabled and disabled pages alike.

## What remains for the played check

The following needs a display that runs at 120 Hz and a stress page that starts. On a machine with both, check the refresh rate first: a calibration outside 118 to 122 Hz makes every frame-time verdict invalid.

1. Build the release wasm and the production bundle, then serve it on 127.0.0.1:4173 with `npm run preview` from `web/`.
2. Run `node scripts/activity-log-proof.cjs performance` with the default `--stress 1000`. If that page does not start within `--ready-timeout-ms` (600 seconds by default), issue 305 is still open; record it and use the largest stress count that starts.
3. Run `node scripts/activity-log-proof.cjs memory --stress 0 --fill-ticks 46080 --after-ticks 2880`, and at the stress count used in step 2 with enough fill ticks that `held` equals `capacity` at the first sample.
4. Start the development server on 127.0.0.1:5174 and run `node scripts/activity-log-proof.cjs allocation --url http://127.0.0.1:5174/` at the specified 32 KB interval, and at `--sampling-interval 1024 --stress 100 --everyone` for the allocation per line.
5. Run `activity_log_cost` for the shipped seed and two others, and compare the median chunk ratio and its interval with 2 percent.
