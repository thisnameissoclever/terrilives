# Desktop rendering measurements

The final built-game run keeps six visible people and two animated Reading previews within the 16.6 ms target at the 95th and 99th percentiles. Every measured game callback executes within the target. Four combined world-and-preview completion samples exceed it, with a maximum of 26.125 ms. This is a measured desktop result, not a guarantee that every frame or device meets the target.

## Workload and final results

The [hardware receipt](hardware.json) identifies an Intel Core i7-13700KF, 64 GiB of system memory, an NVIDIA RTX 4090 with 24 GiB of graphics memory, driver 616.56, and Windows 11 Pro 10.0.26300. The final run uses Chrome 155.0.8059.39, a 2400 by 1200 viewport, device scale 1, the normal 1x simulation driver, and 608 by 800 plus 96 by 128 animated previews. Both previews use the game's graphics device and renderer. The scene renders at twice the display dimensions before color reduction.

| Measurement | Median | 95th percentile | 99th percentile | Maximum | Above 16.6 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Game execution | 5.250 ms | 7.685 ms | 8.665 ms | 13.520 ms | 0 / 1,800 |
| Game entry through graphics completion | 8.170 ms | 11.495 ms | 13.400 ms | 25.925 ms | 1 / 1,800 |
| Combined world and preview completion | 9.065 ms | 12.180 ms | 14.065 ms | 26.125 ms | 4 / 1,797 |
| Frame observer | 0.010 ms | 0.015 ms | 0.020 ms | 0.110 ms | 0 / 1,797 |

A percentile describes the time at or below which that share of samples finished. Game execution starts at actual callback entry; complete latency also retains the browser's scheduling delay. [Timing verification](../measurement-v2/README.md) explains this distinction and the deliberately broken tests that verify it. Median game cadence is approximately 60 Hz. Median preview cadence is 59.99 Hz; its longest interval is 34.35 ms.

[The full built-game receipt](sleep-v2-release/game-30000-normal-driver.json) retains every sample, source hashes, actual action changes, camera position, visibility, focus, person-picking checks, and allocations. [The four slow samples](sleep-v2-release/slow-frames.json) occur around 12, 45, 79, and 28,062 ms after measurement starts. They are not removed as warmup or outliers. No support input preparation, compilation, shader creation, or camera change occurs during the measured interval. All six people remain visible, and the browser reports no application or graphics errors.

The separate [development run](sleep-v2-dev/game-30000-normal-driver.json) records 1,801 game samples with a 13.40 ms maximum execution time. One of 1,800 combined samples exceeds 16.6 ms, reaching 26.345 ms. Both acceptance runs are unprofiled and use isolated browser storage. No other task-owned heavy test or build runs alongside them.

## Allocation and startup costs

The built run retains 162 explicit graphics buffers totaling 205,428,868 bytes and 20 textures estimated at 1,328,246,785 bytes. The texture estimate includes the shared scene and asset textures; it excludes driver padding, staging allocations, and canvas swapchains. Browser-reported used JavaScript heap is 749,780,075 bytes, and native WebAssembly memory is 2,424,832 bytes. These readings are snapshots, not peak process memory.

Cold startup reaches the diagnostic interface in 11.393 seconds. The separate configuration window loads a fresh household, creates three people, and initializes preview resources. It contains a 349.58 ms game execution sample; initial preview construction takes 246.52 ms. These costs remain visible and are not described as steady gameplay. Required contact compilation happens before admitting the configuration, and first activity entry reuses those results. [Actual sleeping review](../sleep-contact-compilation/adversarial-play-01/README.md) verifies first use, shared occupancy, exit, and re-entry without new preparation or cover buffers.

## Earlier failures retained

Paused-household measurements did not establish normal gameplay performance. Earlier normal runs exposed repeated head-envelope allocation, changing-action body reconstruction, first exercise fitting, and first sleeping support/cover construction. The repairs preserve exact rendered attachments while retaining body resources and preparing required contacts before admission.

`release-final/` is the earlier built run before sleeping preparation and the allocation-free observer. Its old timestamp-based field named CPU reaches 164.155 ms, and combined completion reaches 183.65 ms. The precise cause of that burst was not independently established. It must not be attributed to sleeping solely because a later diagnostic found a bed-entry cost.

`tail-profile/` establishes a separate first-bed-entry path with surface fitting, cover construction, and garbage collection in its recorded stack. That 40-second workload also loses a person and is therefore invalid as a six-person acceptance measurement. Its failure and profile remain intact. `contact-final/` and `contact-profile/` were recorded while another game was active on the desktop; their results are retained, with that host workload documented. No unrelated process was stopped.

## Reproduction and limits

From the repository root, with the final build served locally:

```powershell
$env:RUN_LABEL='new-measurement-label'
$env:MEASURE_MS='30000'
$env:NORMAL_DRIVER='1'
$env:GAME_URL='http://127.0.0.1:5190'
node scripts/character-creator-repair/measure-world.cjs
```

The recorded `sleep-v2-release` command exits 0. Keep the browser foregrounded and do not overlap other heavy work. The recorder fails if the camera changes, the page loses focus, the population changes, a person is not visibly pickable, required preparation occurs during measurement, or source hashes change. It reports budget overruns rather than deleting them or converting them into a workload failure.

Phone performance and performance on weaker desktop hardware remain unmeasured. Profiling runs are diagnostic evidence, not substitutes for the unprofiled acceptance run.
