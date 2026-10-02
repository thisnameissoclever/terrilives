# Quieter footsteps verification

Observed 2026-10-01 on Windows, based on main `1d6b68878d02d200825fd9e57c97e6c722d90543`.

The owner requested quieter footsteps, cancellation of indoor background noise
and inclusion of the selected toilet recording. This delivery contains only the
footstep adjustment and cancellation documentation. Toilet audio remains on its
separate development branch while its release requirements are unresolved.

Footstep peak amplitude changes from 0.045 to 0.0225 before Effects and master
gain, a reduction of approximately 6 decibels. Duration, pitch, waveform, cadence
and other sounds remain unchanged. This does not claim half the perceived volume.
Indoor ambience was not released. Pull request 184 was closed; its branch and
evidence remain recoverable. No ambience code or asset is included here.

## Checks

1. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`:
   PASS, exit 0. Built from this worktree, not the primary checkout's generated files.
2. `npm --prefix web run typecheck`: PASS, exit 0.
3. `npm --prefix web test -- --maxWorkers=1`: PASS, exit 0; 125 files and 1,779 tests.
   Node heap limit was 1,024 MiB. The added regression exercises the public
   AudioController and checks the footstep's scheduled peak amplitude.
4. `npm --prefix web run build`: PASS, exit 0. JavaScript bundle
   `index-ZKWHbKxZ.js`; WebAssembly bundle `terri_wasm_bg-BbfVQqLz.wasm`.
   The existing large-chunk warning remains a warning, not a failed build.
5. `node --test scripts/build-changelog.test.mjs`: PASS, exit 0; 12 tests.
6. `node scripts/build-changelog.mjs`: PASS, exit 0.
7. `python check-doc-ids.py`: PASS, exit 0.
8. `git diff --check`: PASS, exit 0.

The same regression failed against gain 0.045 before the root editor changed it
on the integrated toilet branch. That branch's failure was `expected 0.045 to be
0.0225`; the isolated delivery preserves the tested change without the toilet feature.

Independent read-only source review found no material issues and confirmed that
no toilet feature entered this delivery. Release publication is recorded in the
pull request. Local
verification does not establish deployment or owner listening acceptance.
