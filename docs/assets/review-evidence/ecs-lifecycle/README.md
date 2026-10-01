# Component-removal history retention

The standalone Bevy ECS world retained removal messages across every schedule
run. The fix rotates trackers once after each full tick and paused command
drain. It leaves one completed update's removals available and expires older
ones. No simulation data, save format, or audio behavior changes.

## Reproduction

The shipped main binary at `6df7c045145d59073bfd2fcafd946978b7126a64` was copied
from the audio verification worktree. SHA-256:
`e4f9add0f7746018373b835849d8071b732df59fc00ed803cdbc929246155c11`.
The workload uses seed low `104729`, high `130363`, the shipped lot, and the
actual `web/src/debug/stress-spawn.ts` helper to add 1,000 agents, for 1,037
entities total. It calls simulation ticks and render-buffer synchronization
without a browser or audio. The original report is
`wasm-baseline-original.json`.

| Tick | Baseline WASM capacity bytes | Saved bytes | World hash |
| --- | ---: | ---: | --- |
| 60 | 5,308,416 | 77,770 | 1689968484302009063 |
| 600 | 17,104,896 | 79,226 | 6672627640496136405 |
| 1,140 | 50,855,936 | 79,747 | 10010906560745498215 |
| 1,680 | 118,095,872 | 80,182 | 17615774119548958193 |

All four hashes matched both the enabled and disabled audio diagnostic runs.
Hash/save observation did not grow capacity at those checkpoints. WASM capacity
is a high-water allocation, not a count of live allocations, and freeing the
simulation does not shrink its linear memory.

## Native causal diagnostic

`native-retention.rs` wraps the native System allocator to count outstanding
requested allocation sizes. It also counts removal messages across both Bevy
buffers. It used cached native release libraries, not a freshly provenance-
verified main build. All four world hashes nevertheless matched the main WASM
workload exactly. The paired run added only `--clear-trackers`, calling the
maintenance operation immediately after each tick. This is a diagnostic against
the old library; do not add that flag when testing the fixed library, which
already rotates its trackers.

| Tick | Original live requested bytes | Maintained live requested bytes | Original removal messages | Maintained removal messages |
| --- | ---: | ---: | ---: | ---: |
| 60 | 2,667,786 | 1,625,354 | 53,491 | 796 |
| 600 | 11,082,754 | 1,969,282 | 498,477 | 1,131 |
| 1,140 | 36,521,006 | 2,245,358 | 1,441,607 | 1,925 |
| 1,680 | 71,003,186 | 2,373,362 | 2,482,699 | 1,924 |

Both ended with 116 archetypes/tables, 5,672 summed table capacity, 959 autonomy
decisions, 23,015 scored choices, and 601,512 bytes of telemetry capacity.
Both returned to 27,570 live requested bytes after dropping the simulation.
These native counts exclude allocator overhead and are not WASM measurements.
The complete outputs are `native-baseline.csv` and `native-counterfactual.csv`.

Toolchain: Rust 1.94.1. SHA-256 of the cached libraries used:

1. `terri_sim-f4dc26cb2c480431.rlib`: `e55b3c600de07451fa42ca581d3e35b5cfca185f0d9af6b2a7530cc82bdd4aa8`.
2. `terri_core-94c7ccd52216191f.rlib`: `ef3615a08263995e27029f325fb85257c879ae539878f3794897ca748480569c`.
3. Frozen diagnostic source: `ced8eba97dcd103a88d325789a9d461c459db8a110297f7c0692b8f9504d5870`.

## Regression and mutation checks

`cargo test -p terri-sim ecs_lifecycle_tests --locked -j 1` before the fix:
exit 101, two failures and one pass. Both public-boundary tests failed with
`the finished boundary must rotate its newest removals`, actual `1`, expected
`0`. With the fix: exit 0, three passes.

The same tests reject rotating twice and rotating before the schedule, each
with exit 101 and actual assertion failures. `mutations.json` preserves the
outputs and restored source hash. Restoration was byte-identical and the
focused suite passed again. These are targeted manual mutations, not a full
remote mutation sweep.

The ordering fixture was corrected after review found that its first and last
selection were identical. Reversing either the outer lot-edit drain or the
ordinary command drain now fails with actual `Some(0)`, expected `Some(1)`.
`ordering-mutations.json` records both failures and byte-identical restorations.

## Release verification

From the repository root, after building the current WASM package and installing
the existing web lockfile, run:

```powershell
node docs/assets/review-evidence/ecs-lifecycle/wasm-retention.mjs
```

Optional arguments specify the JavaScript binding file, WASM binary, and report
path, allowing the same script to check a frozen original build. The probe
asserts the four expected world hashes and records save SHA-256 values for
comparison. Final fixed-build results and complete local gates are recorded
below.

The release build includes audio merge `26145f4f`; that merge changes no Rust
code. Fixed WASM SHA-256:
`da49265e97644cb5f3dcc2aef11ef0406a0682f468145d0df472640d929bf9dd`.
`wasm-baseline.json` and `wasm-fixed.json` come from the same probe. All four
world hashes, complete save SHA-256 values, save lengths, entity counts, seed,
and stress-spawn source hash match.

| Tick | Original capacity bytes | Fixed before observation | Fixed after hash/save observation |
| --- | ---: | ---: | ---: |
| 60 | 5,308,416 | 4,194,304 | 4,194,304 |
| 600 | 17,104,896 | 4,194,304 | 4,587,520 |
| 1,140 | 50,855,936 | 4,849,664 | 5,242,880 |
| 1,680 | 118,095,872 | 5,242,880 | 5,242,880 |

The final capacity is 95.56% lower in this workload. Observation itself grows
the fixed binary's capacity at two checkpoints. This is not a claim of zero
allocation, a universal memory budget, or a live-allocation measurement.

## Local checks

All commands exited 0 unless an intentional mutation failure is stated above.

1. `cargo fmt --all -- --check` and `cargo clippy --workspace --all-targets --locked -j 1 -- -D warnings` passed. The initial format check requested wrapping in the new test; formatting was applied before these passes.
2. `cargo test --workspace --locked -j 1` passed, including 721 simulation and 149 WASM-boundary tests. The subsequent ordering-fixture-only correction passed the three focused lifecycle tests and both reverse-order mutations.
3. `CARGO_BUILD_JOBS=1 wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` passed with wasm-pack 0.15.0 and Rust 1.94.1.
4. The frozen-original and fixed `wasm-retention.mjs` probes passed. A separate comparison required equality of all four complete save SHA-256 values and world hashes.
5. `npm --prefix web run typecheck`, `npm --prefix web test -- --maxWorkers=1`, and `npm --prefix web run build` passed against that fresh WASM. Web: 1,713 tests in 114 files. Node: 24.14.1.
6. `python check-doc-ids.py` and CI script tests passed, 15 script tests. The seven asset unittest suites from `ci.yml` passed, 219 tests. `python assets/sprites/gen/build.py --check` confirmed 1,370 sprites at 8192 by 4806.
7. `cargo tree` checks for terri-core, terri-data and terri-sim passed on both native Linux and wasm32 targets without web dependencies. `git diff --check` passed.

The production preview passed a browser smoke check with audio disabled through
the existing stress harness. Six ordinary household-button selection changes
kept tick 334 unchanged. Traits opened through Sim details. Returning to 1x
advanced naturally to tick 340. The 390 by 844 mobile view selected Bill and
had no horizontal overflow. No application page errors occurred. Screenshots
`game-desktop.png` and `game-mobile.png` were inspected. This is a focused UI
regression pass, not a new audio or full gameplay acceptance sweep.

The first browser assertion ran before the existing throttled panel projected
its new name. The corrected assertion waits for the actual displayed selection
while driving the real frame body, then checks the clock. The initial page
also requested the absent favicon; this was a 404, not an application exception.
Both task-owned game pages closed in `finally`; the task-owned preview server
was stopped.

This simulation fix does not clear the separate held ambience memory gate.
Its raw audio-specific result remains failed until the audio owner completes
the unchanged acceptance procedure.

## Production verification

PR #186 merged as `c0949f0554f818571b233d0e5f76bb599039a045`. [Main CI](https://github.com/thisnameissoclever/terrilives/actions/runs/36865105430) and [Pages deployment](https://github.com/thisnameissoclever/terrilives/actions/runs/36865695578) both completed successfully.

At 2026-10-01 13:05 UTC, the public site served `terri_wasm_bg-CrjyIyxa.wasm`, SHA-256 `42056e09d128cc133ba1554bc3d6270b0eab11f3d636fd8083e0f4d5b68d9f4f`. This is the deployed Linux-built artifact, distinct from the locally built artifact above. `production-artifact.json` records the exact entry script and binary URLs.

The same probe ran against those downloaded production WASM bytes. It passed with exit 0. Every checkpoint's entity count, world hash, save length, complete save digest, and before/after observation capacity exactly matched `wasm-fixed.json`; final capacity was 5,242,880 bytes. The complete report is `production-retention.json`. All four state digests also match the original baseline. This proves the served binary has the measured fix; the audio acceptance gate remains separate.
