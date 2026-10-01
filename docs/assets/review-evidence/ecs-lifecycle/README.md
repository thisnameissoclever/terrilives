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
after they finish.

This simulation fix does not clear the separate held ambience memory gate.
Its raw audio-specific result remains failed until the audio owner completes
the unchanged acceptance procedure.
