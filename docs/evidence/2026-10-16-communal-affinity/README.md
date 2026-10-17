# Communal affinity verification, 2026-10-16

Scope: issue 257, pull request 260, branch `twcl/257-communal-affinity`.
Final head: `1b322f470`, which merges `origin/main` at `53771c266`.

## Local gate on the final head

`local-gate-0e4801462.log` and `local-gate-1b322f470.log` are the combined
logs for the head before the final review fixes and for the final head. Every
step ran in the branch worktree on the Windows development machine.

| Step | Result |
| --- | --- |
| `cargo fmt --all -- --check` | pass |
| `cargo clippy --workspace --all-targets -- -D warnings` | pass |
| `cargo test --workspace` | pass: 146 core, 322 data, 25 inherited runtime, 1,397 simulation and the wasm boundary suites, 0 failed |
| `python check-doc-ids.py` | pass |
| `node --test scripts/build-changelog.test.mjs`, `node scripts/build-changelog.mjs` | pass |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | pass |
| `npm run typecheck` | pass |
| `npx vitest run --maxWorkers=1` | On `0e4801462`: 254 files passed and `tests/atlas.test.ts` reported three five-second timeouts while a mutation sweep and a second web suite shared the machine; rerun alone, 14 passed. On `5c394fa2f`: two `tests/coverage-payload.test.ts` timeouts under the same load, 20 passed when rerun alone with `tests/atlas.test.ts`. On the final head `1b322f470`, run with a 20-second timeout: 255 files, 3,357 tests passed. |
| Sim core web-dependency guard (`cargo tree` for terri-core, terri-data, terri-sim on the native and wasm32 targets) | pass |

## Mutation sweeps over the branch diff

Both ran in place in a detached worktree with `cargo mutants --in-place
--in-diff <diff> --package terri-data --package terri-sim --test-workspace
true --timeout-multiplier 4 --minimum-test-timeout 120`.

| Sweep | Head | Result |
| --- | --- | --- |
| Whole branch diff against `origin/main` (`mutants-0e4801462-full-diff.log`) | `0e4801462` | 40 mutants in 2 hours: 34 caught, 4 unviable, 2 missed. One missed mutant is the accepted `replace < with <= in hated_communal_gain` recorded in `docs/mutants-baseline.txt` with its argument in `docs/mutation-baseline.md`. The other, `replace && with || in tick`, was an inert acceptance closure that participation already enforces; the next commit removed the closure. |
| Delta of that removal (`mutants-5c394fa2f-delta.log`) | `5c394fa2f` | 7 mutants in 21 minutes: 7 caught, 0 missed. |

The final head `1b322f470` merges `origin/main` and folds the day's changelog
entry; its Rust and web code is byte-identical to `5c394fa2f` plus main's
merged creator and help-proof changes, and the local gate below ran on it.

## Reviews

Two fresh-context adversarial reviews ran, one on the first head
`225cdfe2e` and one on the review-fix head `6f2a138e3`; a third pass covered
the final fix. Dispositions:

| Finding | Disposition |
| --- | --- |
| Predicted survivors in `hated_communal_gain` and the hatred cutoff comparison | Fixed: the redundant chance-at-one early return is gone, a below-cutoff case was added, and the practically unreachable `<` to `<=` comparison is recorded in `docs/mutants-baseline.txt` with its argument in `docs/mutation-baseline.md`. |
| A refused minute paid nothing, contradicting the promise that dislike never prevents recovery | Fixed: a refused minute pays the ordinary proximity rate and the activity still suspends friction. |
| Changelog said "instead of none" | Fixed. |
| Seed source was the pack's constant `rng_seed`, so every game rolled alike | Fixed: the roll hashes a digest of the saved generator state, which consumes nothing. |
| Two different "hates" cutoffs for people | Fixed: `grief_hated_affinity` is the one cutoff. |
| An equality assertion that could not distinguish the mechanism | Fixed: replaced by a different-seed assertion. |
| No direct test of the pairing arms | Fixed: `communal_pairs_need_the_same_table_or_device_and_distinct_shared_objects`. |
| Refused minutes paid friction for an incompatible hated pair | Fixed: `a_refused_minute_pays_proximity_and_keeps_friction_suspended`. |
| Redundant test import under `-D warnings` | Fixed. |
| Evidence directory named before it existed | Fixed by this record. |
| Stale line number in the baseline entry | Fixed; CI ignores the number. |
| Test placed above the module import | Fixed. |

## Played check

The change affects relationship numbers, not rendering, so no visual pass
applies. The live tree was played in the browser pane on 127.0.0.1:5174 to
confirm the build loads and the household behaves; affinity effects are
measured by the simulation tests above rather than by eye.
