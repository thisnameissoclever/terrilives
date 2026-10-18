# Activity log performance, measured 2026-10-18

This record holds the measurements Task 11 of the [activity log plan](../../../superpowers/plans/2026-10-18-activity-log.md) takes against [AL-perf] in the [specification](../../../specs/2026-10-18-activity-log.md). The release frame-time gate could not run as the specification defines it on the machine available, so the browser measures below were taken in substitute configurations. Every threshold is reported with the configuration it was measured in, and no threshold that was not measured as defined is marked as passed.

## Contents

- [What was run](#what-was-run)
- [Why the release gate could not run as defined](#why-the-release-gate-could-not-run-as-defined)
- [Verdicts](#verdicts)
- [Frame time and log work](#frame-time-and-log-work)
- [Allocation](#allocation)
- [Retained memory](#retained-memory)
- [Simulation cost](#simulation-cost)
- [Changes these measurements caused](#changes-these-measurements-caused)
- [Findings outside the log](#findings-outside-the-log)
- [What remains for the played check](#what-remains-for-the-played-check)

## What was run

- **Revision.** Branch `twcl/275-activity-log` at `23288060d` (Tasks 1 to 10 on main `2b15dcfea`), plus the harness, the stress-only sampler and the two panel changes this record's commit adds.
- **Machine.** Windows 11 Pro desktop, Intel Core i7-13700KF, 64 GB, NVIDIA GeForce RTX 4090, one display at 1920 by 1080 and 60 Hz; Chrome 155.0.8059.85 driven by Playwright Core 1.64 from Node 24.14.1; observed 2026-10-18. The machine was shared with other sessions' processes during the runs.
- **Builds.** `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`, then `npm run build` in `web/`, served by `vite preview` on 127.0.0.1:4173. The frame-time runs used bundle `index-BQj9_-3Y.js` and the memory runs `index-BKxPeWER.js`; they differ only by the allocation fix below. The allocation runs used the development server on 127.0.0.1:5174, where module paths and function names survive.
- **Harness.** `scripts/activity-log-proof.cjs` with the helpers it shares with the audio proof in `scripts/lib/browser-frame-gate.cjs`. Every page ran with `audio=0` and Chrome's `--mute-audio`. Raw reports are in [2026-10-18-performance/](2026-10-18-performance/).
- **Commands.**
  - `node scripts/activity-log-proof.cjs performance --stress 0` (three alternating pairs per panel state) and `performance --stress 100 --repetitions 1`.
  - `node scripts/activity-log-proof.cjs allocation --stress 0 --url http://127.0.0.1:5174/` at `--sampling-interval 32768` and `1024`, and `--stress 100 --sampling-interval 1024`.
  - `node scripts/activity-log-proof.cjs memory --stress 100 --fill-ticks 2160 --after-ticks 720`, `memory --stress 0 --fill-ticks 43200 --after-ticks 2880` and `memory --stress 0 --fill-ticks 46080 --after-ticks 2880`.
  - `cargo build --release -p terri-sim --example trace`, then five alternating pairs of `trace 28800` with `TRACE_ACTIVITY_LOG` set to `1` and `0`.

## Why the release gate could not run as defined

The gate in `docs/ARCHITECTURE.md` needs a display calibrated at 120 Hz and the `?stress=1000` page. Neither was available.

1. **The display runs at 60 Hz.** Every calibration achieved 58.6 to 59.2 Hz with a median interval of 16.67 ms, against 118 to 122 Hz and 8.0 to 8.7 ms. At 60 Hz the refresh interval itself sits at the 16.6 ms frame budget.
2. **`?stress=1000` never finishes starting.** The 1,000 filler agents spawn in 2.6 seconds, after which the page stays busy in character preparation (`prepareHeadSelection` and `setVisibleParts` under the character world's `prepare`, sampled four times with the debugger) and the renderer crashed after about four minutes. `?stress=300` had not finished starting after five minutes. `?stress=100` starts in about 25 seconds and then runs at 6 to 11 frames per second with the log on or off. None of this code is on the activity log branch; the branch changes no character code relative to main `2b15dcfea`.
3. **Under `?stress=N` every filler agent has a `SimId`.** The specification assumed the stress page's records come from the household; in fact each agent stages its own. At `?stress=100` the page drains 498 to 570 records in 540 ticks, and fast-forwarding five ticks a frame let the 256-record staging ring overwrite 53 records within the first game day.

The browser measures therefore ran at `?stress=0`, the household alone, which shows the frame a player sees, and at `?stress=100`, which drives the log with roughly twenty times the household's records or more.

## Verdicts

| Threshold | Measured | Verdict |
| --- | --- | --- |
| Calibrated 120 Hz display | 58.6 to 59.2 Hz, median 16.67 ms | Not met; the gate did not run as defined |
| Log drain and compose p95 at most 0.25 ms | 0.010 ms closed, 0.030 to 0.035 ms open at stress 0; 0.015 ms closed, 0.060 ms open at stress 100 | Met in every substitute run |
| Log drain and compose maximum at most 1 ms | Closed: 0.025 to 0.120 ms. Open: 0.900, 1.030 and 0.645 ms at stress 0, 0.935 ms at stress 100 | Exceeded in one of four open runs, on a frame that appended a line |
| Application-work p95 regression at most 1 ms | Stress 0 median of three pairs: -0.39 ms closed, -3.03 ms open | Met at stress 0 on a 60 Hz display; not measured as defined |
| No application-work frame over 16.6 ms | Up to 3 such frames per closed run and up to 7 per open run, in enabled and disabled pages alike | Not met in either mode; the frames occur without the log |
| No steady `simIdOf` call | 0 in every run after the selection fix below; 164 and 166 per open run before it | Met after the fix |
| Allocation, panel closed | 0 bytes attributed to the log at the specified 32 KB interval; at a 1 KB interval about 3 KB over 20 seconds, attributed to the roster-cadence name refresh | Met at the specified interval; see the finer run |
| Allocation, panel open | 0 bytes for one appended line at 32 KB; at 1 KB about 4.6 KB of composition per appended line, plus allocation for records whose lines stay hidden | Not met at the finer interval |
| Retained difference at most 160 KiB, store full | Stress 0 medians 79,460 and 107,688 bytes | Met at stress 0 |
| No growth after the store is full | Stress 0: JS median -33,816 bytes, wasm median 0. Stress 100: JS median -17.9 MB, wasm 655 to 983 KB more than the disabled page in every pair | Met at stress 0; not shown at stress 100 |
| Simulation cost within 2 percent | Median `Sim::tick` time 22,965 ms on and 26,131 ms off; runs varied from 16.2 to 33.2 seconds | Not resolved; run-to-run noise is several times the threshold |

## Frame time and log work

The log sampler times the store's drain and the panel's update in each frame. Application work is the page's own frame timer. Each stress 0 run measured 540 ticks after 60 warm-up ticks at 3x speed, about 1,080 frames.

| Stress 0 | Pair | Log p95 ms | Log max ms | Frames with records | Work p95 ms, on and off | Work frames over 16.6 ms, on and off |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Closed | 1 | 0.010 | 0.025 | 17 | 4.045 and 4.430 | 3 and 2 |
| Closed | 2 | 0.010 | 0.120 | 20 | 5.095 and 4.805 | 3 and 1 |
| Closed | 3 | 0.010 | 0.025 | 10 | 3.470 and 4.035 | 0 and 2 |
| Open | 1 | 0.030 | 0.900 | 18 | 4.300 and 9.710 | 1 and 3 |
| Open | 2 | 0.030 | 1.030 | 13 | 4.795 and 5.400 | 1 and 2 |
| Open | 3 | 0.035 | 0.645 | 11 | 8.230 and 11.260 | 2 and 7 |

With the panel closed, frames that drained records took at most 0.020 ms of log work. With the panel open, the largest log times were on frames that appended a line. A CPU profile of the open panel on the development server put the log's own time mostly in `fitAboveDock`, the selection poll's layout read every 100 ms, then in `append`, `atBottom` and `scrollToBottom`, which read layout after the frame's other HUD writes.

At stress 100 one pair per panel state ran: log p95 0.015 ms and maximum 0.060 ms closed over 498 records, 0.060 ms and 0.935 ms open over 570 records. Application work was 99 to 225 ms per frame in both modes. A direct timing of 600 `Sim::tick` calls in a paused stress 100 page gave means of 11.6 and 10.4 ms with the log on and 8.9 and 12.1 ms with it off, so the stress 100 frame differences are noise rather than log cost.

## Allocation

The [V11] procedure ran on the development server at stress 0: 6 seconds of warm-up, a 20-second window, both garbage-collection inclusion flags. Attribution counts a frame as the log's when its module is an `activity-log-*.ts` module or it is one of the bridge's activity log methods.

| Run | Window | Log bytes | Notes |
| --- | --- | ---: | --- |
| Closed, 32 KB interval | 602 ticks, 1,204 frames, 16 with records | 0 | Whole page 1.57 GB |
| Open, 32 KB interval | 601 ticks, 1,202 frames, 1 row added | 0 | Too few rows to resolve 2 KB a line |
| Closed, 1 KB interval | 613 ticks, 1,217 frames, 18 with records | 3,096 | All in `ActivityLogNames.remember` |
| Open, 1 KB interval | 631 ticks, 1,243 frames, 4 rows added | 29,820 | `update` 7,212 and `remember` 4,116; composition and append about 18,500, or 4.6 KB a row |
| Closed, stress 100, 1 KB | 536 ticks, 115 drains with records | 4,176 | `takeActivityLog` 2,112, 18 bytes a drain |
| Open, stress 100, 1 KB | 355 ticks, 299 records, 0 rows added | 69,864 | `visible` and `family` composing records hidden by the selected housemate |

A Node run of the same `remember` loop over two million calls showed no per-call allocation, so the remaining 3 KB at the 1 KB interval is not explained. At the open panel, composition allocates more than 2 KB a line, and records whose lines stay hidden still allocate during composition, which the specification's "nothing per frame without new lines" excludes.

## Retained memory

Panel closed, three alternating pairs, garbage collected twice before each sample. The first sample follows the fill ticks and the second follows the extra ticks.

| Run | Store at first sample | Retained difference per pair, bytes | Median | JS growth, log minus baseline, median | Wasm growth, log minus baseline, median |
| --- | --- | --- | ---: | ---: | ---: |
| Stress 0, 46,080 + 2,880 ticks | 2,000 in every pair | 16,816,368; 79,460; 32,652 | 79,460 | -33,816 | 0 |
| Stress 0, 43,200 + 2,880 ticks | 1,994, 1,942 and 2,000 | 155,736; -10,228; 107,688 | 107,688 | -29,236 | 0 |
| Stress 100, 2,160 + 720 ticks | 2,000 in every pair | 133,880; 590,120; -725,380 | 133,880 | -17,868,284 | 786,432 |

In the first stress 0 pair the disabled page held 16.8 MB less heap than every other page at the first sample; no heap snapshot was taken, so the cause is not known. The 43,200-tick run is kept because it was taken first; the 46,080-tick run fills the store before the first sample in every pair. At stress 100 the page holds about 1.43 GB after collection and grows by about 185 MB per 720 ticks in both modes, so its JS comparison cannot resolve 160 KiB. Its wasm memory grew 655 to 983 KB more with the log on than off in every pair; whether that growth is bounded was not measured.

## Simulation cost

Five alternating pairs of the release trace over 28,800 ticks, seed 20260728, timing only `Sim::tick`. Every run with the log on staged 45.5 records a game day and dropped none.

| Log | `Sim::tick` ms | Process ms |
| --- | --- | --- |
| On | 33,241; 16,785; 16,239; 26,380; 22,965 | 42,301; 21,217; 20,557; 33,409; 29,128 |
| Off | 26,131; 19,397; 28,020; 32,793; 21,101 | 32,964; 24,493; 35,377; 41,497; 26,611 |
| Median, on and off | 22,965 and 26,131 | 29,128 and 32,964 |

The medians put the log 12 percent faster, which only shows the noise: identical runs varied by a factor of two on the shared machine.

## Changes these measurements caused

1. **The selection poll no longer calls `simIdOf`.** The open panel read the selected housemate through `simIdOf` every 100 ms, which broke the gate's rule of no steady `simIdOf` calls in both modes. The panel now takes the selected `SimId` from the household roster's own read at the same cadence.
2. **The name refresh no longer takes an iterator.** `ActivityLogNames.remember` runs at the roster cadence whether or not the panel is open, and its `for...of` loop was the only log allocation with the panel closed at the 32 KB interval (32,772 bytes in one run). It now indexes the array.

## Findings outside the log

1. `?stress=1000` does not finish starting on current main, so the audio proof (`node scripts/audio-browser-proof.cjs performance`), which fixes that stress count, cannot run either. The plan's before and after audio reports for the helper extraction were therefore not produced.
2. The page allocated 0.46 to 1.71 GB in each 20-second sampling window. In two of the stress 0 windows an anonymous function in `src/render/character/resting-contact.ts` line 11 accounted for 649 and 835 MB, and `inverseAffine`, `multiply` and `boneFrame` in `src/render/character/math.ts` and `composeSkeletonPose` in `src/render/character/pose-joints.ts` led the others. [V11] recorded 1.38 MB for the whole page at 1,002 entities when it was measured.
3. At stress 100 the JS heap held about 1.43 GB after collection and grew about 185 MB per 720 ticks with the log on or off.

## What remains for the played check

The following needs a display that runs at 120 Hz and a stress page that starts. On a machine with both, check the refresh rate first: a calibration outside 118 to 122 Hz makes every frame-time verdict invalid.

1. Build the release wasm and the production bundle, then serve it on 127.0.0.1:4173 with `npm run preview` from `web/`.
2. Run `node scripts/activity-log-proof.cjs performance` with the default `--stress 1000`. If that page does not start within `--ready-timeout-ms` (600 seconds by default), the character preparation finding above is still open; record it and use the largest stress count that starts.
3. Run `node scripts/activity-log-proof.cjs memory --stress 0 --fill-ticks 46080 --after-ticks 2880`, and at the stress count used in step 2 with enough fill ticks that `held` equals `capacity` at the first sample.
4. Start the development server on 127.0.0.1:5174 and run `node scripts/activity-log-proof.cjs allocation --url http://127.0.0.1:5174/` at the specified 32 KB interval and at `--sampling-interval 1024`.
5. Run five alternating pairs of the release trace with `TRACE_ACTIVITY_LOG` set to `1` and `0` on an otherwise idle machine, and compare the medians of the `simulation wall time` line.
