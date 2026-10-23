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

Positive and comparison results must be recorded from the integrated repair before delivery. Phone tests use a 402 by 874 CSS-pixel viewport at device scale three. This is a test configuration based on the reported model's physical display, rather than measured browser-window dimensions on the affected phone. Desktop tests use 1440 by 900 at device scale one.

## Player guide and acceptance limits

The storage change preserves gameplay, controls, layout and documented values. Existing guide articles, effect mappings and screenshots require no behavioral changes. Source fingerprints must be refreshed only after reviewing the final loader, ownership, sampling and coverage changes; compiled reference verification remains a separate check.

Complete local source, asset and browser evidence establishes the measured reduction and rendering preservation. The affected iPhone's recovery remains unobserved until the published repair runs on that device. Keep that limit separate from successful publication and the controlled memory test.
