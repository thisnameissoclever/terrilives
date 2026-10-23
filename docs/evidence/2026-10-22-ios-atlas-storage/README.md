# Lossless artwork storage and startup resource verification

The player reports an iPhone 17 Pro running iOS 27.0.1. Both Safari and Chrome show loading before the browser's page-failure screen. The prior upload-pacing repair shipped in commit `c393c60bce9bb88b211880c4dcb6b41ff2d8e671`; the player reports that the same failure remains. No physical iPhone logs or device execution are available to this investigation.

## Source and representation

The reference game is deployed commit `553e4ef4f9450554a188cbbffb6d8b9b593d572b`. Its entry bundle is `assets/index-0F6GhQY4.js`, SHA-256 `56484f616c1bf465366b81b956c491056d165de49837bb7c3c81adcc80eb7ab0`. This revision's game inputs equal the prior upload-pacing repair.

The original image array requests 922,746,880 bytes, or 880 MiB. The new representation retains all 55 logical layers and every source RGBA byte. It stores 869,230 distinct bordered image blocks in 21 physical pages. Physical images request 352,321,536 bytes, and the lookup requests 14,417,920 bytes: 366,739,456 bytes total, or 349.75 MiB. The difference is 530.25 MiB. Other graphics resources remain separate.

Producer commits `4540746ea474629230ff877b79b1654b0b2fc5cb` and `bbb03cae2cf38aef08f000a6de256b4e72f2dd60` retain the original source pages, grime, companion pages and catalogues. Exact source-file comparison against the deployed reference passed for every logical layer. Source geometry, animation, image density, rendering resolution, indices and save formats remain unchanged.

## Independent reconstruction

`python -B -m unittest discover -s scripts -p test_runtime_atlas.py` passes 15 focused tests. `python -B scripts/build-runtime-atlas.py --check` verifies all current sources and CPU coverage without writing repository files.

The verifier independently reconstructs the complete center image in required logical row and column order. It separately calculates clamped source coordinates for all four halo sides, including corners. It compares exact bytes with the original pixels. Producer-only column-order and border mutations fail this verifier. This closes the correlated-error gap found in initial independent review, where production and checking shared a source-block extractor.

CPU verification independently decodes opaque bits and partial alpha indices, compares every dish alpha byte, and recomputes indicator bottoms using the original threshold and density. Binary filename hashes identify encoded gzip bytes; descriptor hashes and lengths identify unpacked payloads including their headers.

## Actual graphics sampling

`node scripts/verify-atlas-sampling.cjs` runs the production coordinate helper on the installed Chrome graphics device. At production dimensions it compares integer loads and filtered samples with dense reference images, including seams, fractional coordinates, clamped virtual edges, zero lookup cells, physical array layers and logical layers 0, 1, 27 and 54.

All 9,524 probes match exactly. Altering a physical halo causes 56 channel mismatches. This negative control demonstrates that the comparison detects damaged borders. The task browser closes in the script's `finally` block.

## Controlled resource limit

`scripts/verify-startup-atlas-storage.cjs` tracks requested texture and buffer bytes and their explicit destruction. A controlled one-GiB limit rejects a request before allocation. This measures logical graphics storage, rather than operating-system residency, driver overhead or an actual iPhone termination threshold.

The reference game fails before completing its first frame under that limit. The failure records an essential rejected buffer allocation, an uncaught controlled-budget error, zero completed frames and no available scene target. Removing the loading cover is insufficient evidence of startup: the deployed animation error path also removes it. Successful startup requires a completed frame, valid scene attachments, completed graphics submission and nonempty rendered identities.

The compiled repair at `2bd4d4c42986be695f1bfa7788f88fc1fb48e495` completes startup and the saved-household comparison within the same limit. Both views have zero budget denials or browser diagnostics. Color, surface depth and picking identities match the reference byte-for-byte and remain stable on repeated paused captures. The repaired entry is `assets/index-CXN1KiA8.js`, SHA-256 `bac164d853e64d7ffa361d86ada5850734b060dbd8af7ebc4ac22dc800a50339`.

| View | Reference requested peak at startup | Repair requested peak at startup | Comparison |
| --- | --- | --- | --- |
| Phone, 402 by 874 CSS pixels, scale three | 1363.94 MiB | 785.44 MiB | All three scene buffers identical |
| Desktop, 1440 by 900 CSS pixels, scale one | 1193.09 MiB | 643.07 MiB | All three scene buffers identical |

These totals are snapshots through observed startup frames. Temporary targets and timing can change the total difference between runs; the representation's independently measured saving remains exactly 530.25 MiB. The phone viewport is a test configuration based on the reported model's physical display, rather than measured browser-window dimensions on the affected phone. Both views use the installed Windows Chrome graphics device. The release build is served from `/terrilives/` on a local static server, exercising the project-relative resource paths.

The [comparison receipt](verification.json) retains source bundle identities, allocation records, exact attachment dimensions and hashes, bitmap-sampling results and browser cleanup. Four selected screenshots show the paired scenes. The full raw scene buffers remain in ignored local storage.

## Local checks and played pass

The clean source revision `2bd4d4c42986be695f1bfa7788f88fc1fb48e495` passed the local web runner: WebAssembly compilation, compiled player-reference verification, TypeScript checking, all 3,978 web tests across 286 files and the production build. The runner recorded unchanged source before and after execution. Its report reference is `sha256:a2c7f3bd6a082135cbc32a7c6de7b4b77c1ff1f57d37b46da87062c40c202320`. Native simulation sources are unchanged; no unrelated native regression sweep was repeated.

Documentation identifiers pass. All 38 guide, changelog and branding tests pass. The 331-case script run found one outdated expected artwork-command list and skipped one optional environment-specific case. The correction retains the complete old list and adds the two new local atlas checks; all 29 affected policy and local-runner tests then pass. The unaffected cases passed in the original run. No application source changed after the successful web build.

The build reports its existing large entry bundle and mixed static/dynamic character-asset imports as warnings. It exits successfully. This repair does not suppress those warnings or change dependencies.

A separate headed, muted Chrome session exercises Options and runs the production game at 3x for 36 seconds. The sampled frame count advances from 260 to 2,191, and the simulation advances from tick 134 to 1,103. Character positions and activities change through several furniture interactions. The session reports no script or graphics diagnostics, pauses afterward and closes its browser in `finally`. Two selected stills and [the played-session record](played-report.json) retain that evidence. This is a targeted played pass for the storage change, rather than a complete retest of every game feature.

## Player guide and acceptance limits

The storage change preserves gameplay, controls, layout and documented values. Existing guide articles, effect mappings and screenshots require no behavioral changes. Source fingerprints were refreshed after reviewing the final loader, ownership, sampling and coverage changes. Compiled reference verification passes separately.

Complete local source, asset and browser evidence establishes the measured reduction and rendering preservation. The affected iPhone's recovery remains unobserved until the published repair runs on that device. Keep that limit separate from successful publication and the controlled memory test.
