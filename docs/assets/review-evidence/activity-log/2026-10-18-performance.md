# Activity log performance, measured 2026-10-18

This record holds the measurements Task 11 of the [activity log plan](../../../superpowers/plans/2026-10-18-activity-log.md) takes against [AL-perf] in the [specification](../../../specs/2026-10-18-activity-log.md). It compares the panel and simulation code before and after the fixes for five gaps the first measurement found, under the same conditions. The release frame-time gate could not run as the specification defines it on the machine available, so the browser measures were taken in substitute configurations. Every threshold is reported with the configuration it was measured in, and no threshold that was not measured as defined is marked as passed. A second comparison on 2026-10-23 measured the change to Show earlier entries and reran the allocation measure; its runs are described with the first ones below.

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

- **Revisions.** Before the fixes: the panel and log code of `039ac9985`, built into a production bundle beside the merges of main through `7b45ac301` (merge `7324bf665`). After the fixes: `b9fa490d8` (panel) and `cda1f9eab` (simulation and measurement tools). By the reports' start times, only the rebuild runs alternated between the two bundles, from 00:50 to 00:56 UTC on 2026-10-19. The frame-time runs went in sequential blocks: the after bundle's stress 0 and stress 100 runs started at 00:59 and 01:06 UTC, and the before bundle's at 01:11 and 01:18 UTC. The allocation runs were blocks too: before from 23:35 to 23:41 UTC on 2026-10-18, after from 00:25 to 01:28 UTC. Blocks run at different times meet whatever load other sessions put on the shared machine then, so the frame-time and allocation comparisons do not control for load; within each performance run, the enabled and disabled pages of a pair did alternate. The native cost runs marked before used the branch at `c12171440`, before the two merges of main; the runs marked after used `cda1f9eab`. Main's changes moved the household's behavior between those revisions, so the before and after record counts differ.
- **Second comparison, 2026-10-23.** Before: the production bundle of `71f210201`, the revision this record first described (`index-CtDM-l2-.js`). After: the bundle of `1380c51f7` (`index-WdXf8KYR.js`), whose activity log panel, store and composer equal those of the pushed head `8a8861e82`. Each mode ran two rounds at each stress level, the two bundles alternating within each round, between 18:17 and 18:44 UTC. The stress level is at most 50 because higher counts overload the shared desktop the measurements run on. The allocation reruns used the development server on the branch at `5257cd838`, between 18:45 and 18:54 UTC. Runs from earlier that day whose selection never cleared (see [One-off work on a click](#one-off-work-on-a-click)) are not used.
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
  - On 2026-10-23: `node scripts/activity-log-proof.cjs rebuild` and `clicks`, each with `--everyone --repetitions 2`, at `--stress 0 --fill-ticks 46080` and at `--stress 50 --fill-ticks 2880`, with `--url` naming each bundle's preview server; `allocation --url http://127.0.0.1:5174/` four times at `--stress 0 --sampling-interval 1024`, twice at `--stress 0`, and once each at `--stress 50 --sampling-interval 1024` with and without `--everyone`.
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
| Allocation, panel closed, 32 KB interval | 0 bytes | 0 bytes in two runs, and in two reruns | Met |
| Allocation, panel open, 32 KB interval | 0 bytes over 2 lines | 0 bytes over 2 and 1 lines, and over 2 and 3 in two reruns | Met, but see [Allocation](#allocation): this interval cannot resolve 2 KB a line with so few lines |
| Allocation per appended line, 1 KB interval | 1,176 bytes over 292 lines at stress 100 | 748 bytes over 416 lines at stress 100; 930 bytes over 225 lines at stress 50 in the rerun | Met; the budget stays at 2 KB |
| Nothing for records whose lines stay hidden | 43,584 bytes for 342 hidden records, 37,348 of them in `visible` | 1,040 bytes besides the one view per drain, all in `groupKey`, for 433 records and 2 lines; nothing in `visible` | Not resolved: `groupKey` runs only for a visible annoyance line, but the window also added 2 lines, so it cannot show that hidden records alone allocate nothing |
| Nothing per frame without new lines, open, 1 KB interval, running game | 9,472 bytes over 20 seconds and no line: `update`, `family`, `add`, `append`, `remember` | 3,096 and 2,072 bytes with 3 and 2 lines in the first runs; 4,144, 9,464, 0 and 7,552 bytes with 2, 1, 1 and 2 lines in four reruns | Not resolved at this interval: frames with and without lines share the window. See the paused rows below |
| Nothing in frames without records, panel closed, paused game, 1 KB and 32 KB | `remember` charged 2 to 4 KB in each running window | 0 bytes in all six paused windows, at stress 0 and 50 (2026-10-23, after names moved to frames with records) | Met |
| Nothing in frames without records, panel open, paused game, 1 KB and 32 KB | not measured | 0 bytes in five of six paused windows; 1,152 bytes in `update` in one stress 50 window with one housemate selected, a single 1 KB sample that a rerun of the same configuration did not repeat | Not met in one window of six; the cause is not identified |
| Selection change while open (reported, not a per-frame threshold) | rebuilt inside the frame, not measured | rebuilt in a task of its own after the frame: 1.8 to 3.8 ms at stress 0 and 4.2 to 6.0 ms at stress 50 | Outside the frame's log work, within one frame |
| Show earlier entries, a click and its frame (reported, not a per-frame threshold) | 7.1 to 29.6 ms at stress 0 and 8.2 to 39.0 ms at stress 50, growing with the rows shown | 4.5 to 6.6 ms at stress 0 and 3.7 to 7.9 ms at stress 50, over windows of 400 to 1,316 rows | Within one 16.6 ms frame for every window measured, up to 1,316 rows; windows of up to 2,000 rows were not measured |
| Retained JS difference at most 160 KiB, store full, stress 0 | Median 79,460 bytes (first measurement) | Median 20,256 bytes | Met |
| No wasm growth after the store is full | Page pairs at stress 100: 655 to 983 KB more with the log on (first measurement); Node runs at stress 100: 64 KB less with the log on | Page pairs: median 0 at stress 100, one 64 KB page at stress 0; Node runs at stress 100 and over 36 household days: identical | Met in the deterministic Node runs; the page pairs' small medians lie within their page-to-page spread |
| Simulation cost within 2 percent | Household median chunk ratios -1.29, +0.05 and +0.86 percent for seeds 20260728, 7 and 42 | +0.11, -0.06 and -0.71 percent for the same seeds, every 95 percent interval's upper end below +1.6 percent | Met |
| Staging ring holds every record a frame stages | Household of six: at most 63 records a frame | Household of six: at most 74 records a frame | Met for households; stress 100 still overflows at a day's end |
| The log never changes the simulation | Hashes equal after every game day in every lockstep run | Hashes equal after every game day in every lockstep run | Met |

## Frame time and log work

The log sampler times the store's drain and the panel's update in each frame. It does not include the ResizeObserver callback that follows the dock and finishes a scroll to the newest line, or the style and layout of appended rows, which run in the frame's rendering after the sampler stops; those are not measured per frame. Each stress 0 run measured 540 ticks after 60 warm-up ticks at 3x speed. Work is the page's own frame timer; on and off are the enabled and `?activitylog=0` pages of a pair.

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

Opening the panel and changing a filter recompose the rendered window from the store in the click handler, outside the frame's log work. Show earlier entries now composes and inserts only the up to 200 lines it reveals and keeps the rendered ones; before `2a5158129` it recomposed the whole store and every shown line. These costs come once per click, so they are reported rather than held to the per-frame limits.

Two modes of `scripts/activity-log-proof.cjs` time them with the store full. The `rebuild` mode clicks back to back and times each click's script, then the style and layout it leaves, read back at once. The `clicks` mode pauses between clicks and charges each click its script plus the main-thread work of the frame after it beyond a frame without a click; work a click defers to that frame, such as a ResizeObserver scroll, counts too. Both clear the selection first so every person's lines show.

### First measurement, 2026-10-19, rebuild mode at stress 100

The two `rebuild-stress100-*-fix-*.json` runs of each bundle went in alternation. They meant to show every person, but the runs paused the page after filling the store with a frame clock ahead of real time, so the roster never reported the cleared selection and each run showed whatever selection the page already had. The windows held 101 to 200 lines when opened.

| Click | Before: script p50, max | Before: layout p50, max | After: script p50, max | After: layout p50, max |
| --- | --- | --- | --- | --- |
| Open | 2.06 to 2.18, up to 9.05 ms | 0.02 to 0.03, up to 0.20 ms | 0.59 to 2.14, up to 7.11 ms | 1.13 to 3.14, up to 5.31 ms |
| Filter change | 1.66 to 1.83, up to 2.39 ms | 0.02, up to 0.04 ms | 0.48 to 1.95, up to 5.06 ms | 0.92 to 2.45, up to 4.58 ms |
| Show earlier entries | none: no window passed 200 lines | none | 14 clicks in `rebuild-stress100-after-fix-2.json`, windows of 400 to 1,474 rows: script 7.23 to 29.41 ms, median 16.22 ms | 0.03 to 0.47 ms |

The largest single click after those fixes took 29.9 ms of script and layout, a Show earlier entries click on the 1,474-row window, and the cost grew with the rows already shown. Opening a 200-line window took 12.4 ms at most. Before those fixes the largest was 9.2 ms, on opening a 125-line window; no before run reached Show earlier entries.

### Second comparison, 2026-10-23, at stress 0 and 50

Before is `71f210201`, which still recomposed everything on Show earlier entries; after is `1380c51f7`. Every run showed every person; the raw reports are the `rebuild-stress*-show-earlier-fix-*.json` and `clicks-stress*-show-earlier-fix-*.json` files. In the `clicks` table each value is the click's script plus its frame's work, in milliseconds; the median frame without a click took 0.21 to 0.26 ms and is subtracted.

| `clicks` mode | Before, stress 0 | After, stress 0 | Before, stress 50 | After, stress 50 |
| --- | --- | --- | --- | --- |
| Open, 200 lines | 4.0 to 4.8 | 5.7 to 8.3 | 4.7 to 6.0 | 6.8 to 9.4 |
| Filter change, 56 clicks a column | median 3.2, max 7.4 | median 4.6, max 10.3 | median 3.8, max 6.0 | median 5.4, max 7.6 |
| Show earlier entries | 22 clicks, 400 to 1,225 rows: 7.1 to 29.6, median 14.1 | 20 clicks, 400 to 1,193 rows: 4.5 to 6.6, median 5.5 | 24 clicks, 400 to 1,407 rows: 8.2 to 39.0, median 21.1 | 22 clicks, 400 to 1,316 rows: 3.7 to 7.9, median 6.0 |

| `rebuild` mode, script and layout | Before, stress 0 | After, stress 0 | Before, stress 50 | After, stress 50 |
| --- | --- | --- | --- | --- |
| Open, 200 lines, largest | 2.7 and 2.3 | 2.4 and 3.5 | 3.2 and 3.6 | 3.4 and 5.0 |
| Filter change, largest | 2.9 and 2.5 | 2.7 and 3.2 | 3.2 and 4.0 | 3.9 and 4.4 |
| Show earlier entries, script | 24 clicks, 400 to 1,275 rows: 2.8 to 9.5 | 24 clicks, 400 to 1,234 rows: 1.3 to 2.4 | 24 clicks, 400 to 1,422 rows: 3.6 to 17.2 | 22 clicks, 400 to 1,303 rows: 1.7 to 3.6 |

Show earlier entries no longer grows with the rows already shown: after the change every click and its frame fit within one 16.6 ms frame for the windows measured, up to 1,316 rows, at most 7.9 ms, where before they reached 39.0 ms, more than two frames at 60 Hz. What remains of the click's cost that rises with the list is the layout of the longer list in its frame, 2.3 to 4.9 ms.

A selection change used to rebuild the list inside the frame's log work, unmeasured. It now waits for a task of its own after the frame, which the `clicks` mode times by changing the selection with the roster's first button and back to everyone (`clicks-selection-stress*.json`). Each rebuild also starts from the newest 200 lines: before that change, a rebuild after Show earlier entries recomposed every revealed line, up to 1,188 rows, and took 5.6 to 8.8 ms at stress 0 and up to 20.3 ms at stress 50 (`clicks-selection-*-full-window.json`). With 200 lines it took 1.8 to 3.8 ms at stress 0 and 4.2 to 6.0 ms at stress 50. Those runs measured Show earlier entries again at up to 7.0 ms at stress 0 and 12.6 ms at stress 50 over windows of up to 1,244 rows, still within a frame; the stress 50 figures were higher than the comparison's on the shared machine.

Opening the panel and changing a filter now cost about 1.4 to 2.7 ms more per click at the median, at most 10.3 ms with the frame. They scroll to the newest line inside the click, which lays out the new window there; the frame after still lays out and paints. Before, the scroll waited for a ResizeObserver report, which never came when the new list had the old one's height, and the list stayed where the player had scrolled. Those clicks still fit within one frame. The `rebuild` mode's back-to-back clicks also show the after bundle's open and filter clicks as slower, because its timer counts the scroll that the before bundle made later, outside the timer.

## Allocation

The [V11] procedure ran on the development server: 6 seconds of warm-up, a 20-second window, both garbage-collection inclusion flags. Attribution counts a frame as the log's when its module is an `activity-log-*.ts` module or it is one of the bridge's activity log methods.

| Run | Before | After |
| --- | --- | --- |
| Stress 0, closed, 32 KB | 0 bytes; 13 drains with records | 0 bytes in two runs; 12 and 10 drains with records |
| Stress 0, open, 32 KB | 0 bytes; 2 lines | 0 bytes in two runs; 2 and 1 lines |
| Stress 0, closed, 1 KB | 4,116 bytes, all `remember` | 4,116 and 3,096 bytes, all `remember` |
| Stress 0, open, 1 KB | 9,472 bytes; 0 lines | 3,096 and 2,072 bytes; 3 and 2 lines; `remember` and one sample in `groupKey` |
| Stress 0, open, 1 KB, reruns of 2026-10-23 | | 4,144, 9,464, 0 and 7,552 bytes; 2, 1, 1 and 2 lines |
| Stress 0, closed, 1 KB, reruns of 2026-10-23 | | 3,096, 3,096, 2,064 and 1,032 bytes, all `remember` |
| Stress 50, every person shown, open, 1 KB, rerun | | 209,148 bytes for 225 lines, 930 a line |
| Stress 50, one housemate selected, open, 1 KB, rerun | | 6,288 bytes for 194 records and 2 lines; `takeActivityLog` 4,200, the one view per drain |
| Stress 50, closed, 1 KB, rerun | | 9,444 and 12,624 bytes, about 76 and 91 a drain: `takeActivityLog` and `remember` |
| Stress 100, every person shown, open, 1 KB | 343,352 bytes for 292 lines, 1,176 a line | 311,328 bytes for 416 lines, 748 a line |
| Stress 100, one housemate selected, open, 1 KB | 43,584 bytes for 342 records and 0 lines; `visible` 37,348 | 6,320 bytes for 433 records and 2 lines; `takeActivityLog` 5,280, the one view per drain |
| Stress 100, closed, 1 KB | 8,340 bytes; about 97 a drain | 12,480 bytes; about 103 a drain, the one view |

The household adds at most a few lines in a 20-second window. At the specified 32 KB interval each sample stands for 32 KB, so a window with two lines reads 0 or 32 KB a line by chance: one run during this work charged a single 32 KB sample to `annoyed` over four lines. The first measurement's 4.6 KB a line came from four lines at the 1 KB interval. The figure per line here therefore comes from stress 100 with every person shown, where hundreds of lines arrive in the window. It includes the text, the list item's wrapper and the ResizeObserver callback, about 70 bytes a line. One stress 100 line can be much larger: a missed chore at a day's end carries a feeling from each of a hundred people and allocated about 40 KB when composed. A household's line carries at most five such clauses.

`ActivityLogNames.remember` ran at the roster's cadence whether or not the panel was open and was charged 2 to 4 KB in each 20-second window at the 1 KB interval. A Node loop of the same method showed no allocation, and neither did a loop in the page over the roster's real members, built fresh for each call as the roster builds them, so the cause of that charge is not identified. Since `9f8a1a669` a roster read only keeps a reference to its members, and the names are copied, as `learn`, when a drain brings records or the panel opens.

The allocation mode now also takes a 20-second window with the game paused, after the running one: no tick runs, so every frame of the paused window drains no records, and what the window charges to the log is the log's cost in frames without records. On 2026-10-23, at stress 0 and 50, the six closed-panel paused windows charged the log nothing. Five of the six open-panel paused windows charged nothing; one, at stress 50 with one housemate selected, charged a single 1 KB sample of 1,152 bytes to `update`. A rerun of that configuration, whose windows now count selection rebuilds, ran none and charged nothing. The reports are the `allocation-paused-window-*.json` files. In the running windows, `learn` is now charged 1 to 5 KB, in frames that drained records.

Two more stress 0 runs at the 1 KB interval, made during the fix and kept outside the repository, charged 45,996 and 19,692 bytes to the open panel at 00:13 and 00:16 UTC on 2026-10-19. Both ran on an earlier, uncommitted state of the fix: the development server served a panel module whose `update` sits at generated line 182 and whose `row` sits at 327, where `b9fa490d8` transforms to lines 176 and 318, and that `update` was charged 39,496 and 11,328 bytes for the clock arithmetic change 3 below removed. The after runs in the table, at 00:25 and 00:26 UTC, also ran before `b9fa490d8` was committed at 01:00 UTC. Their profile places `remember` where the committed revision does, but cannot prove the rest of the module was the same, so the measure ran again on 2026-10-23.

The four reruns charged the open panel 0 to 9,464 bytes in a 20-second window that added one or two lines. Every sample but one fell in functions that compose or append a new line (`lineText`, `conversationHead`, `compose`, `append`, `appendRow`, `row`, `reflectEmpty` from the append), or in `remember`; the other, 1,056 bytes in `update`, can be the append the engine inlined into it. A window that adds lines cannot separate frames with lines from frames without them, so whether a frame without new lines allocates is not resolved at this interval; what the reruns bound is the total, at most 9.5 KB in 20 seconds. The per-line check of the 1 KB stress 0 runs fails in three of the four for the same reason the 32 KB check cannot pass judgment: one or two lines make a sample of 1 KB a large share of a line. The figure per line comes from stress 50 with every person shown, 930 bytes over 225 lines.

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
6. **Show earlier entries grew with the rows shown.** It recomposed every record in the store and every rendered line on each click, up to 39.0 ms with its frame. It now composes only the lines it reveals and puts them above the kept rows, holding the old first row in place (`2a5158129`); see [One-off work on a click](#one-off-work-on-a-click).
7. **A filter change could leave the list where the player had scrolled.** A replaced list of the old height drew no ResizeObserver report, so the waiting scroll to the newest line never ran. Opening the panel and changing a filter now scroll in the click, and a list replaced from a frame observes the list afresh so the report arrives.

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
