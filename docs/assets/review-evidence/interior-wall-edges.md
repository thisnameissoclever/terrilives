# Interior walls on cell boundaries

Status: implementation and local verification in progress; not published.
Base: `412bf5c14cb1ad2fd3311673e203453c4d3418dc`.

The house stays 16x12. All furniture origins stay unchanged. The 28 former
wall cells become floor. There are 34 boundary segments: 29 solid and five
doors. See `docs/superpowers/plans/2026-09-20-interior-wall-edges.md` for exact
coordinates and the ring connecting the five rooms.

## Save boundaries

1. V1 migration requires the frozen shipped object positions, complete old
   collision bitmap and reviewed destination geometry. It changes only the
   wall cells and architecture resource. The bathtub migration remains a
   preceding, separately tested operation.
2. Custom V1 worlds that pass the historical content rules retain the frozen
   legacy presentation. V1 never stored enough information to infer arbitrary
   wall ownership from collision. V2 persists that choice; resaving is not a
   second chance to silently convert it.
3. V2 stores explicit architecture and requires strict byte decoding. It
   validates wall coordinates, duplicates, furniture spanning solid edges,
   remaining movement segments and active contact. A stationary object target
   must have an accessible route endpoint. Person targets may move before
   arrival, so stale social routes need runtime contact checks.
4. Before replacing a V1 file, the browser worker writes its original bytes
   to `terri-save-1.v1-backup.bin`. Existing backups are never overwritten.
   Web Locks serialize origin-wide file operations. Failed loads pause saving.
   Browser storage deletion can still erase both files; no external recovery
   service is implied.
5. The origin lock does not detect stale supported-version progress. Two
   game tabs remain last-writer-wins, and older cached workers do not take
   this lock. Header checks do not establish full payload validity. The
   regression for an unsupported primary file installed after startup first
   failed with `ok: true` instead of `false`; the worker now refuses that
   overwrite under the same lock.

## Checks recorded so far

Combined checkpoint: `cargo test --workspace -j 2 --quiet` passed 760 tests
(80 core, 203 data, one data integration, 395 simulation and 81 WASM), exit 0.
`cargo fmt --all` ran before that suite. Final lint, rebuilt WASM and visual
acceptance are still tracked separately below.

1. Core boundary tests cover both directions, distance fields, interaction
   contact and 128 three-by-two barrier patterns. Removing movement and
   contact barriers failed their respective assertions.
2. Seven migration tests passed. They compare every old cardinal step and
   object approach, the five doorways, state preservation and idempotence.
   The 172 sampled snapshots came from the current engine running frozen
   legacy geometry over 1,200 ticks, not a separately compiled old binary.
   The retained pre-bathtub browser fixture provides historical bytes.
3. Removing source validation broke custom-world preservation; removing
   barrier installation broke the boundary assertion. Restored migration
   source SHA256: `6fe41c56459ea08b69c852927501b2183de7c4051931cb2f50b2fcd92ff247c1`.
4. The full simulation suite passed 388 tests after static-target endpoint
   validation. Its new regression first failed because a route ending across
   a solid wall was accepted. A historical collision expectation was updated
   to include the explicitly reclaimed 28 wall cells.
5. Native release WASM checks passed 79 tests before the additional spawn
   guards. The complete web run passed 742 of 747 tests before rebuilding
   WASM; the five failures expected new exports and schema 2 from the old
   generated module. These are red checkpoints, not final acceptance.
6. Renderer/lighting focused tests passed 98 cases. Removing door-arm
   separation and light boundaries failed their focused regressions. Source
   files were restored and 42 relevant tests passed again.
7. Persistence checks passed 38 focused tests covering failed loads, backup
   creation failure, immutable backups and two competing worker instances.
   Five targeted mechanism deletions failed, then restored files passed.
8. Fractional-path mechanism checks removed the boundary iteration and the
   source-center insertion separately. The first failed
   `!grid.segment_can_cross(a, b)`; the second returned `[(2,0),(3,0)]`
   instead of `[(1,0),(2,0),(3,0)]`. Both exited 1. Restored grid source
   SHA256 matched `3c32e6a9815873ddd831fd50b8e718db03435268d76a8d86768d8659524457f9`;
   both focused tests then passed, exit 0.
9. Seven new social-arrival regressions produced five expected failures before
   the guard. All 15 movement tests passed after it; disabling it reproduced
   the five failures, and exact restoration passed again. The guard does not
   consume random draws or discard queued intent when a partner moved away.
10. Edge-mode spawn guards each failed their targeted deletion checks. The
    complete native WASM suite then passed 81 tests. Legacy spawning behavior
    is unchanged. The rebuilt-browser bridge check remains pending.
11. All 70 sprite tests and atlas `--check` passed. The old office-prefix test
    now checks the exact four appended half-wall names while retaining its
    unchanged historical 1,141-record digest.
12. After the primary-header overwrite fix, the worker/controller suites
    passed 37 tests, exit 0. Documentation IDs passed.

## Atlas

The atlas adds four half-wall end pieces, for 1,221 records at 4096x7926.
Every prior 1,217 record and decoded sprite is unchanged. Their combined
preservation digest is
`a515c86ef643a1addeb0805b1c33768785f470abcb4d456cfe0f758d99b31c85`.
New PNG SHA256:
`404bdb982035c34bdf395a86b33e2b605515f4c47c2c4682be2b17bc02d81b23`.
Six Python wall tests passed. Half-panels are clipped from the existing full
raster so opposite halves reproduce it exactly without diagonal rounding
differences.

## Remaining acceptance

Production verification remains pending. Source changes alone do not prove
live publication.

## Browser and independent review

The dedicated local preview at port 4188 used the production build, not a
mock renderer. The first rebuilt checkpoint passed all 761 Rust and 773 web
tests, typecheck, format and lint. One initial web run timed out while hashing
Sim sources during another build; this recurred on the next overlapping run.
The final isolated run passed all 773 tests in 8.93 seconds under the original
timeout. No assertion or timeout was weakened. Do not overlap this disk-heavy
source-hashing suite with native compilation on this shared machine.

1. The retained 2,580-byte historical save loaded at tick 134 with all 37
   entities and 34 wall segments. UI Save wrote schema 2. Its immutable
   backup hash matched the original
   `1b4393f7741a66896b7d655d5378dd27a888e32b6d0cbb409cd4e96cd0def2ec`.
   Reload restored tick 134. Loading the actual backup bytes through the
   rebuilt browser loader succeeded with the same entity count and edges.
2. An unsupported version 99 was deliberately installed in this disposable
   local slot. UI Load reported rejection and paused saving; the stored
   version remained 99. Restoring our test bytes and retrying UI Load
   succeeded and re-enabled Save. No production storage was changed.
3. Commands through the production bridge drove Tim across all five doors:
   V(8,2), H(3,6), V(6,9), V(12,8), H(13,6). The trace sampled rounded
   displayed walking positions, not internal paths. It establishes traversal,
   not completion of every requested object interaction. A separate actual
   UI Work command sent Casey from the bathroom to the desk; after 37 fixed
   ticks she was using the desk from (8,6). Manual UI Save/Load also succeeded.
4. Primary and independent reviewers inspected the actual room at normal
   and enlarged zoom in flat and night lighting. No gaps, doubled posts,
   filled door apertures or obvious solid-wall light leak were found.
   Foreground aquarium/shower occlusion, enlarged-view cropping and stepped
   local lighting remain visible, accepted limitations.
5. Final code review found legacy off-lot interaction had become unreachable.
   Three new tests first failed, then all 83 core tests passed after restoring
   the no-solid-barrier contact rule. Separate path/contact and distance-field
   fallback deletions failed their respective tests. Source was restored
   exactly. This correction does not alter the shipped house geometry.
6. The stress helper now adds exactly the requested population or fails.
   Requests are bounded to 0..10,000, and blocked spawn cells are skipped.
   Its 24 tests passed, including rejection and partial-population cases.
   The final rebuilt browser with `?stress=25` reported exactly 62 entities:
   the 37-entity household plus 25 synthetic agents.

Final source checkpoint: `cargo test --workspace -j2 --quiet` passed 764 tests
(83 core, 203 data, one integration, 396 simulation, 81 WASM), exit 0.
`cargo clippy --workspace --all-targets -j2 -- -D warnings`,
`cargo fmt --all -- --check`, web typecheck, 773 web tests and the optimized
WASM/Vite build passed. Local final bundle: `index-CTQ_UefL.js`,
`terri_wasm_bg-BQ4S4FvI.wasm`. In that final browser build, 200 save/load
round trips across 2,400 further ticks all succeeded; the 37 entities remained.
The Work screenshot demonstrates standing desk use, not a new seated-work
animation. This release does not change interaction poses.

A staged-only export under `output/interior-release-export/` passed all 70
sprite tests, `python assets/sprites/gen/build.py --check` (1,221 sprites,
4096x7926) and documentation-ID validation, exit 0. This export contains no
ignored source renders, local dependencies, `.tmp/` or prior output evidence.

Retained images: `interior-edges-flat.png`, `interior-edges-close.png`,
`interior-edges-night.png`, and `interior-edges-work.png` in this directory.
