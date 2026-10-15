# Release-candidate desktop measurement

The built game ran for 30 seconds in displayed Chrome 155.0.8059.39 with six visible people under the normal simulation driver and two animated reading previews. The viewport was 2400 by 1200 pixels, with device pixel ratio 1. The host is the same Intel Core i7-13700KF and NVIDIA GeForce RTX 4090 desktop recorded in the [earlier host inventory](../../2026-10-14-main-integration/host-before-final-checks.json). The graphics adapter reported NVIDIA Lovelace. No task-owned test or build ran concurrently; a bounded Git upload remained active. Other applications were left untouched.

This measurement precedes the numeric-control layout repair. That repair changes the creator's input layout; it does not change the renderer, simulation, or the separate canvases used by this workload. The receipt retains the measured build's source hashes.

| Measurement | Median | 95th percentile | 99th percentile | Maximum | Frames over 16.6 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Game execution | 3.61 ms | 6.70 ms | 7.70 ms | 22.15 ms | 1 / 1,800 |
| Game completion | 8.03 ms | 10.86 ms | 11.96 ms | 29.03 ms | 4 / 1,800 |
| Combined world and preview completion | 8.97 ms | 11.61 ms | 12.87 ms | 29.17 ms | 4 / 1,797 |

The 95th and 99th percentiles meet the desktop target; individual slow frames remain. The [slow-frame receipt](release-01/slow-frames.json) lists all four combined frames above the target. No contact construction, population change, camera change, focus loss, or visibility change occurred during the measured interval. Person-identity picking established six visible characters before and after the interval. Diagnostics were empty. This unprofiled run does not establish the cause of individual delays.

Navigation reached the diagnostic interface in 6.209 seconds. The separate cold configuration window recorded maximum game execution of 361.34 ms and completion of 404.49 ms. First preview construction took 193.49 ms. These setup costs are not sustained gameplay measurements.

Explicit buffers totaled 205,431,584 bytes; estimated textures totaled 1,328,246,785 bytes. Browser-reported JavaScript heap use was 739,425,544 bytes, and WebAssembly memory was 2,555,904 bytes. Texture estimates exclude driver padding, staging allocations, and canvas swapchains. These are allocation snapshots, not process peaks. Real-phone performance remains unmeasured.

Command: `node scripts/character-creator-repair/measure-world.cjs`, with `GAME_URL=http://127.0.0.1:5193`, `NORMAL_DRIVER=1`, `LIVE_STEP_MS=0`, `MEASURE_MS=30000`, `RUN_LABEL=release-01`, and `PERFORMANCE_EVIDENCE_DIR=docs/evidence/2026-10-15-merge-review/performance`. Exit 0; the browser closed in `finally`.

1. [Complete measurements and source hashes](release-01/game-30000-normal-driver.json).
2. [Raw timings](release-01/raw-30000-normal-driver.json).
3. [Actual six-person scene and linked previews](release-01/six-characters-preview.png).
