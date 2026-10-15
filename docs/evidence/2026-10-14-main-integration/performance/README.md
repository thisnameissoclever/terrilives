# Integrated local-build performance

The final built game ran for 30 seconds with six visible people under the normal simulation driver, plus enlarged and game-size animated reading previews. This was displayed Chrome 155.0.8059.39 on an Intel Core i7-13700KF and NVIDIA GeForce RTX 4090 desktop, at 2400 by 1200 pixels with device pixel ratio 1. No task-owned test or build ran concurrently. Other applications were left untouched.

| Measurement | Median | 95th percentile | 99th percentile | Maximum | Over 16.6 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Game execution | 3.53 ms | 7.04 ms | 8.13 ms | 20.52 ms | 1 / 1,800 |
| Game completion | 7.87 ms | 10.92 ms | 12.15 ms | 24.82 ms | 2 / 1,800 |
| Combined world and preview completion | 8.82 ms | 11.84 ms | 13.27 ms | 27.50 ms | 2 / 1,798 |

A percentile is the time at or below which that share of measured frames finished. The 16.6 ms target is met at the 95th and 99th percentiles, but not by every frame. The two combined slow frames took 19.74 and 27.50 ms, about 11.51 and 18.76 seconds into measurement. No shader or pipeline creation, contact compilation, support-input preparation, focus loss, visibility change, camera change, or population change was recorded during measurement. This unprofiled run does not establish the cause of those two delays.

Median preview cadence was approximately 60.04 Hz. All six people passed person-identity picking checks before and after measurement. The actual action set changed during normal gameplay, including walking and sleeping, while the separate previews continued reading. Browser and graphics diagnostics were empty.

## Startup and allocation limits

Cold navigation reached the diagnostic interface in 6.459 seconds. A separate configuration window loaded a household, created three people, and initialized the previews. Its maximum game execution was 358.77 ms and maximum completion was 402.63 ms; first preview construction took 212.95 ms. These initialization costs are retained separately and are not described as sustained gameplay performance.

The snapshot recorded 162 explicit graphics buffers totaling 205,431,584 bytes, textures estimated at 1,328,246,785 bytes, browser-reported JavaScript heap use of 584,203,290 bytes, and WebAssembly memory of 2,490,368 bytes. Texture estimates exclude driver padding, staging allocations, and canvas swapchains. These are snapshots, not process peaks. Real-phone performance remains unmeasured.

## Reproduction and receipts

Run `node scripts/character-creator-repair/measure-world.cjs` with `GAME_URL` pointing at the accepted local build, `NORMAL_DRIVER=1`, `LIVE_STEP_MS=0`, `MEASURE_MS=30000`, `RUN_LABEL=accepted-01`, and `PERFORMANCE_EVIDENCE_DIR=docs/evidence/2026-10-14-main-integration/performance`. Use a fresh run label for another measurement. The recorded run exited 0 and closed its isolated browser in `finally`.

1. [Complete measurement and source hashes](accepted-01/game-30000-normal-driver.json).
2. [Raw frame times](accepted-01/raw-30000-normal-driver.json).
3. [Slow-frame records](accepted-01/slow-frames.json).
4. [Actual six-person scene and linked previews](accepted-01/six-characters-preview.png).
5. [Host inventory](../host-before-final-checks.json).
