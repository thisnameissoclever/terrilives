# Character render allocation, measured 2026-10-25

This record holds the measurements for GitHub issue 305: the character renderer's allocation on every frame, the JavaScript heap at stress 50, and the cost of starting a stress page. It compares main at `afbe98af3` with the branch `twcl/305-character-render-allocation` under the same procedure. Most measurements were first taken on the branch at commit `c82aafc15`. The branch's code later changed in `e1cbff3f1`, `152052bd0` (a test only) and `ffa24c876`, which is the last commit that changes code; later commits change documentation only. The allocation, drawing, process memory and start-up measurements were therefore repeated on a build of `ffa24c876`, and both sets are given. The heap growth series and the per-call allocation table were not repeated and describe `c82aafc15`. The owner limited this work to `?stress=50`, so nothing here measures `?stress=100` or more; projections to 100 Sims are labeled as projections. The release performance gate measures 100 Sims by the owner's decision of 2026-10-25, so this record does not treat a 1,000-agent load as a requirement.

## Contents

- [Machine and builds](#machine-and-builds)
- [Procedures](#procedures)
- [When the churn started](#when-the-churn-started)
- [Cause](#cause)
- [Allocation before and after](#allocation-before-and-after)
- [Start-up and memory per character](#start-up-and-memory-per-character)
- [Process memory](#process-memory)
- [Heap growth at stress 50](#heap-growth-at-stress-50)
- [Drawing is unchanged](#drawing-is-unchanged)
- [What the 100-Sim release gate still needs](#what-the-100-sim-release-gate-still-needs)

## Machine and builds

- **Machine.** Observed 2026-10-25 on a Windows 11 Pro desktop: Intel Core i7-13700KF, 64 GB, NVIDIA GeForce RTX 4090, one display at 60 Hz. Chrome 155.0.8059.85 driven by Playwright Core 1.64 from Node 24.14.1. Other sessions shared the machine; the processor was at 2 percent load before the runs.
- **Builds.** Each revision's wasm was built with `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`, then `npx vite build --minify false --sourcemap --outDir <dir>` in `web/`. That is the production build with names kept and source maps written, so profiles attribute frames to source lines. Each build was served by `npx vite preview --port <port> --strictPort --host 127.0.0.1 --outDir <dir>`. Main's bundle was `index-DRhLGBrI.js`; the branch's bundle at `c82aafc15` was `index-CAFvqz7p.js` and at `ffa24c876` it was `index-DMpDQnnI.js`.

## Procedures

Every page ran with `audio=0` and Chrome's `--mute-audio`, one browser at a time, closed in a `finally` block.

- **Allocation.** `node scripts/character-allocation-proof.cjs --url <build> --stress <0|50> --windows 3`. This is adapted from the [V11] procedure of `docs/gpu-verification.md` (which ran on `?stress=1000`; this record uses `?stress=0` and `?stress=50`): speed 3, 6 seconds of warm-up, then three 20-second windows of V8's sampling heap profiler at a 32 KB interval with both garbage-collection inclusion flags, so short-lived objects count. Frames are counted with the page's own `requestAnimationFrame`. "Character" bytes are those whose frame maps to `src/render/character/`.
- **Per-call allocation in Node.** `web/tests/character-pose-allocation.test.ts` runs each pose many times after warming up and measures it with the same profiler through `node:inspector`.
- **Start-up.** `node scripts/character-startup-proof.cjs --url <build> --stress 50` records a CPU profile from navigation until the character world displays every agent, attributed by function.
- **Process memory.** A scratch script loaded `?stress=0` or `?stress=50`, set speed 3, and at 30 and 120 seconds forced two garbage collections, read `Runtime.getHeapUsage`, listed the browser's processes with `SystemInfo.getProcessInfo` and read each one's working set and private bytes from Windows (`Get-Process`). "Renderer" is the page's process, which holds the JavaScript heap and typed arrays; "GPU" is Chrome's graphics process.
- **Heap.** A scratch script loaded `?stress=50`, set speed 3, and every 30 seconds forced two garbage collections and read `Runtime.getHeapUsage` and the character world's buffer totals, for 180 seconds.
- **Drawing.** `node scripts/character-frame-capture.cjs --url <build> --out <dir> --frames 120,360,720,1200,1800,2400,3000,3600` replaces the page's clock and entropy before its scripts run, so every build starts the same seeded household and advances the same fabricated 60 Hz frames. The screenshots were compared with a Pillow pixel difference.

## When the churn started

Allocation at `?stress=0`, one process of the procedure above per revision, two 20-second windows each:

| Revision | Change | Megabytes per window | Kilobytes per frame |
| --- | --- | --- | --- |
| `e999fdf8f` | Before the 3D character renderer (pull request 255) | 30.5, 30.8 | 25 |
| `bb5ba9cde` | The full character creator and scene rendering (pull request 258) | 336, 1,513 | 273, 1,235 |
| `618a69369` | Seated poses and shower motion (pull request 259) | 1,581, 782 | 1,283, 640 |
| `afbe98af3` | Main when this work began | 911 to 1,521 | 746 to 1,233 |

Pull request 258 (`bb5ba9cde`, a squash merge) introduced every file in `web/src/render/character/`, including the pose, contact and head envelope code the profiles name. The page allocated about 25 KB a frame before it and hundreds of kilobytes to over a megabyte a frame after it. Later commits did not change the pose code materially. Reports: [reports/bisect-e999fdf8f-stress0.json](reports/bisect-e999fdf8f-stress0.json), [reports/bisect-bb5ba9cde-stress0.json](reports/bisect-bb5ba9cde-stress0.json), [reports/bisect-618a69369-stress0.json](reports/bisect-618a69369-stress0.json).

## Cause

Every animated character's pose is evaluated again on every frame, because its animation phase is the tick plus the frame's fraction. Four things made each evaluation allocate heavily.

1. **The rest skeleton was rebuilt every frame.** Each bone's shaped head and tail, rest frame and inverse depend only on the body shape, yet `configuredJointSetup` recomputed them, and `composeSkeletonPose` and the interaction solver each inverted every rest frame again.
2. **The bath contact rebuilt the thigh surface every frame.** `thighContactPatches` called `queryConfiguredSurface`, which allocates a position buffer for every vertex of the body to fill in both legs, about 10,000 triangles, and then built vector arrays for each triangle. On main at `?stress=0` this one function accounted for 412 MB and 953 MB in the two 20-second windows in which someone bathed.
3. **Shared math helpers boxed every number they read.** `multiply`, `transform` and the other helpers in `math.ts` receive many kinds of arrays: plain arrays of doubles and of small integers, frozen arrays, `Float32Array` and `Float64Array`. V8 then compiles their element reads generically, and each read or intermediate result becomes a heap-allocated number. A Node experiment measured 0.6 bytes for a monomorphic 4 by 4 multiply and 1,897 bytes once the same function had seen six kinds of array. `Math.hypot` is a builtin call that boxes its arguments the same way.
4. **The head envelope kept megabytes per character.** Each visible part selection stored maps from vertex to triangle list and a set of vertices, and each envelope kept per-vertex arrays of contribution objects after copying them into typed arrays. Measured on the branch before the head envelope change, at stress 50 a sampling profile found 878 MB still live after start-up; 662 MB of it was the selection maps and 182 MB was the per-vertex contribution objects.

Per-frame selection also re-serialized and re-validated each appearance for every renderer, though nothing had changed.

## Allocation before and after

Paired runs of the allocation procedure, main first, then the branch, at each stress level. The "branch, final" rows are a second run on `ffa24c876`:

| Stress | Build | Megabytes per window | Kilobytes per frame | Frames per window | Heap after window, MB |
| --- | --- | --- | --- | --- | --- |
| 0 | main | 1,521, 912, 1,171 | 1,233, 746, 950 | 1,205, 1,194, 1,204 | 84.3, 120.9, 84.5 |
| 0 | branch, `c82aafc15` | 144, 394, 194 | 117, 323, 158 | 1,202, 1,189, 1,203 | 48.4, 49.7, 49.7 |
| 0 | branch, final | 264, 414, 177 | 220, 346, 147 | 1,201, 1,196, 1,201 | 49.3, 49.8, 50.1 |
| 50 | main | 4,087, 3,714, 4,795 | 7,904, 7,834, 11,148 | 505, 463, 420 | 932.8, 956.5, 882.3 |
| 50 | branch, `c82aafc15` | 1,095, 1,336, 1,031 | 1,863, 2,181, 2,059 | 574, 598, 489 | 58.7, 69.9, 62.2 |
| 50 | branch, final | 926, 931, 1,239 | 1,690, 2,059, 2,140 | 548, 452, 579 | 61.8, 61.5, 76.9 |

Windows differ in what the household is doing, so compare medians. At stress 0 the median allocation is 1,171 MB a window on main, 194 MB on the branch at `c82aafc15` and 264 MB on the final build: between a quarter and a sixth as much. The median heap after a window is 84.5 MB on main and 49.7 MB on the branch, in both runs. At stress 50 the medians are 4,087 MB on main and 1,095 MB and 931 MB on the branch, about a quarter, while the page drew a median 463 frames a window on main and 574 and 548 on the branch. Stress 0 runs at the display's 60 Hz in all builds. Reports: [reports/allocation-main-stress0.json](reports/allocation-main-stress0.json), [reports/allocation-fix-stress0.json](reports/allocation-fix-stress0.json), [reports/allocation-final-stress0.json](reports/allocation-final-stress0.json), [reports/allocation-main-stress50.json](reports/allocation-main-stress50.json), [reports/allocation-fix-stress50.json](reports/allocation-fix-stress50.json), [reports/allocation-final-stress50.json](reports/allocation-final-stress50.json).

Per pose call in Node, bytes allocated by the original and the rewritten code for one body: the median of three sampled windows of at least 120 calls, after 30 warm-up passes over the clip's phases.

| Clip | Original | Rewritten |
| --- | ---: | ---: |
| talk | 144,502 | 19,229 |
| walk | 152,249 | 29,908 |
| bath | 10,957,549 | 151,122 |
| cook_v2 | 325,593 | 108,575 |
| mop | 555,389 | 179,615 |
| sofa_recline | 283,151 | 71,948 |

What remains per frame is mostly the pose's own output: fresh sampled matrices and pose rows, which the solvers edit in place, and the interaction solver's candidate poses. At stress 50, `interpolateTransform` returning its matrices is the largest single item, about 220 MB a window.

## Start-up and memory per character

`?stress=50` draws 53 characters: the household and 50 filler agents. All of them share one style and one body shape.

The branch's start-up was repeated, and so was main's, because the first main reading proved unrepresentative. Start-up profiles at stress 50, in the order taken (the first main reading and the first branch reading are the ones this record first reported):

| Build | Stress handle ready after navigation, s | CPU in `src/render/character/` functions, s |
| --- | --- | --- |
| Main | 19.1, 13.3, 10.5, 10.9 | 12.6, 7.2, 5.6, 5.7 |
| Branch: `c82aafc15`, then final four times | 10.9; 18.6, 11.7, 10.5, 10.5 | 5.7; 6.2, 5.7, 5.5, 5.6 |

Medians: ready after 12.1 s on main and 10.9 s on the branch; 6.5 s and 5.7 s of character CPU. **This record no longer claims faster start-up.** The readings overlap, and the earlier main reading (19.1 s and 12.6 s), which suggested a halving, was not reproduced in the three later main runs. The 18.6 s branch reading had 10.7 s of idle time in its profile; its cause was not established. Reports: [reports/startup-main-stress50.json](reports/startup-main-stress50.json), [reports/startup-fix-stress50.json](reports/startup-fix-stress50.json) and the `run` files beside them.

| Measure at stress 50 | Main | Branch |
| --- | ---: | ---: |
| JavaScript heap after start-up | 937.9 MB | 49.7 MB |
| JavaScript heap at stress 0, median after a window | 84.5 MB | 49.7 MB |
| JavaScript heap per filler character | about 17 MB | not resolved |
| GPU buffers, all characters | 1,604 MB | 1,604 MB |
| GPU buffers per character | 30 MB | 30 MB |

The per-filler figure for main is 937.9 MB at stress 50 less 84.5 MB at stress 0, over 50 fillers. On the branch the heap at stress 50 after start-up (49.7 MB) matches the stress 0 readings (48.4 to 49.7 MB), so a per-character figure is below what these readings can resolve; the 0.07 MB figure this record first gave came from unlike readings and is withdrawn.

Each character allocates 17 MB of GPU buffers of its own for subdivision and posed vertices, and 13 MB of static buffers that are shared only between characters with the same compacted geometry object. Each character compacts its own geometry, so no static buffers are shared even though every stress agent has the same style. On the branch at `c82aafc15` the remaining preparation time per character was geometry compaction (44 ms), shaping the cage for the appearance (37 ms) and creating its GPU resources (21 ms).

Projected linearly to `?stress=100`, 103 characters, and not measured: main would hold about 1.7 GB of JavaScript heap, which is consistent with the issue's 1.43 GB after collection, and the branch well under 100 MB. Both builds would spend about 11 seconds preparing characters, since their start-up CPU is about the same, and need about 3.1 GB of GPU buffers, which fits on the RTX 4090's 24 GB.

## Process memory

The figures above count only the JavaScript heap. Typed arrays, such as the head selections and the bath surface buffers, live outside it, so the whole renderer process was read as well (procedure above; one run per cell, readings at 30 and 120 seconds, MB):

| Build | Stress | JS heap | Renderer private | Renderer private less heap | GPU process private |
| --- | --- | --- | --- | --- | --- |
| Main | 0 | 94.5, 79.8 | 921, 859 | 827, 779 | 1,038, 982 |
| Branch, `c82aafc15` | 0 | 46.6, 47.9 | 881, 839 | 834, 791 | 1,039, 976 |
| Branch, final | 0 | 46.1, 47.5 | 873, 837 | 827, 789 | 1,025, 972 |
| Main | 50 | 881, 724 | 3,258, 2,822 | 2,377, 2,098 | 3,063, 2,896 |
| Branch, `c82aafc15` | 50 | 50.8, 54.7 | 2,478, 2,164 | 2,427, 2,109 | 3,043, 2,890 |
| Branch, final | 50 | 50.8, 54.8 | 2,436, 2,143 | 2,385, 2,089 | 3,060, 2,902 |

The renderer process holds 22 to 48 MB less at stress 0 (3 to 5 percent) and 780 to 820 MB less at 30 seconds and 660 to 680 MB less at 120 seconds at stress 50 (20 to 25 percent), nearly all of it JavaScript heap. What the renderer holds outside the heap is the same within about 50 MB on every build, so the typed arrays that replaced the maps (head selections, bath buffers) do not show at this resolution. The stress 50 pages sit about 1.6 GB above the stress 0 pages in both builds, 32 MB per character, mirroring the GPU buffers. The retained cost of those typed arrays is therefore below what one run per cell can resolve. Reports: `reports/process-memory-*`.

The bath surface buffers, about 2.2 MB, were kept per geometry object at `c82aafc15`. In the final build they are one shared set, because bath contacts run one at a time and finish with the buffers before the next begins. The head selections' typed arrays (the `visible` lookup, scan arrays and triangle lists) are kept for each prepared character and are not shared.

## Heap growth at stress 50

Heap after two forced collections, every 30 seconds at speed 3, about 5,000 ticks in all. Reports: [reports/heap-main-stress50.json](reports/heap-main-stress50.json), [reports/heap-fix-stress50.json](reports/heap-fix-stress50.json).

| Build | Heap, MB, at 0 to 180 seconds | Characters with GPU geometry |
| --- | --- | --- |
| Main | 938, 924, 954, 910, 809, 792, 760 | 56 falling to 46 |
| Branch | 50, 53, 56, 58, 59, 57, 57 | 56, varying to 42 |

Seven samples over 180 seconds cannot show whether either heap settles. Main's heap falls over the last four samples as characters leave the drawn set and their envelopes are released. The branch's heap, measured at `c82aafc15`, rose for the first four samples (49.7, 53.4, 55.8 and 58.1 MB over about 2,700 ticks) as characters met new activities and their selections were prepared, then read 58.6, 57.0 and 56.8 MB. That is no evidence of unbounded growth in this window and no conclusion about longer runs. The growth the issue measured at `?stress=100`, about 185 MB per 720 ticks, was not checked, because the owner's limit is stress 50; on main each newly prepared head selection cost megabytes per character, which is consistent with it.

## Drawing is unchanged

The frame capture procedure drew eight frames, at 120 to 3,600 pumped frames (ticks 20 to 600), from main twice, from the branch at `c82aafc15` once and from the final build once. Main against itself and main against each branch build differed in 0 of 1,260,000 pixels in every frame. The frames show the household walking, seated on the armchair and office chair, on the toilet, standing, and talking with speech bubbles above their heads. As a positive control, a build that raised every bone frame's origin by 1 cm differed from main in 685 to 3,041 pixels in every frame. No bath, shower, sleeping or exercise pose appears in these frames, so pixels check none of them. They rest on the unit tests, which require bit-identical skinning matrices for every clip and phase, including the bath, for six body shapes (every second body, so three, for the bookcase clips). The same tests compare the game's `configuredPose` route with seat, sleep and exercise bike contact artifacts against the original for two body shapes.

## What the 100-Sim release gate still needs

The frame-time release gate in `docs/ARCHITECTURE.md` and `node scripts/audio-browser-proof.cjs performance` now load `?stress=100`. They were not run for this record. Running them needs:

1. The owner's go-ahead to load `?stress=100` on a shared machine; this work stopped at `?stress=50`.
2. A display calibrated at 120 Hz; this desktop's display runs at 60 Hz, so the gate's calibration fails here regardless of the page.
3. Then `node scripts/activity-log-proof.cjs performance` and `node scripts/audio-browser-proof.cjs performance` on a production build served on 127.0.0.1, with their default `--stress 100`.

The issue's other `?stress=100` observations, the 25-second start at 6 to 11 frames per second and the heap growth of about 185 MB per 720 ticks, were not re-measured. At `?stress=50` the branch starts in about 10.5 to 11.7 seconds, as main mostly does, holds 49.7 MB of JavaScript heap after start-up and showed no unbounded growth over 180 seconds.
