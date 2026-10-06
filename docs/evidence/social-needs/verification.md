# Social need verification

Verified 2026-10-05 on Windows with Rust 1.94.1 and the project lockfiles.
The local branch is `twcx/social-company-needs-fa6c`, based on `1a138df6`.
The source manifest records the exact working-file hashes for this correction.
No dependency declarations or lockfiles changed.

## Behavior checked

1. Solo TV and radio cannot refill Social. Two admitted users keep distinct
   chairs or standing destinations; the receiving Sim must like an active user
   of that same device. Architecture boundaries and ordinary affinity-contact
   distance do not cancel valid shared use.
2. Empty-table sitting provides no Social. Meal Social requires real held food,
   simultaneous eating, separate valid chairs facing the same table and a
   positive feeling toward another qualifying diner. Different cooking batches
   can qualify. Standing, gathering, missing food, invalid facing and departure
   cannot provide company. Partial overlap receives only its actual minutes,
   without another terminal Social payout.
3. Chat delivers Social independently in each direction and only for positive
   affinity. A first conversation can establish friendship while Social still
   drains. Autonomous selection values the later relief after the estimated
   relationship-building effort. The first loaded tick rebuilds compatibility
   and reproduces utility bits and the resulting world hash.
4. Privacy routing, urgent alternatives, emergency checks and waiting masks
   use effective benefits rather than unconditional Social advertisements.
   Standing destinations remain exclusive during substitution and replanning.
   Authored negative Social costs remain intact.
5. Shared media saves preserve active and travelling owners, capacity and
   distinct destinations. Invalid ownership is rejected without changing the
   previous world. Recipe preference addresses resolve recipe step tags.
6. Food quality scales food rewards but not the Social value of company.
   Relationship eligibility uses that same effective Social benefit.

## Executed checks

| Command | Exit code | Result |
| --- | --- | --- |
| `cargo fmt --all -- --check` | 0 | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | PASS |
| `cargo test --workspace --no-fail-fast` | 0 | PASS: 126 core, 281 data, 946 simulation, 171 boundary tests and one ancillary test; 1,525 total |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | 0 | PASS: optimized browser simulation generated |
| `npm --prefix web run typecheck` | 0 | PASS against the rebuilt browser simulation |
| `npm --prefix web test -- --maxWorkers=1` | 0 | PASS: 150 files, 1,986 tests; 50.76 seconds |
| `npm --prefix web run build` | 0 | PASS: site built in 7.99 seconds |
| `node --test scripts/build-changelog.test.mjs` | 0 | PASS: 12 tests |
| `node scripts/build-changelog.mjs` | 0 | PASS: standalone changelog built |
| `python -B check-doc-ids.py` | 0 | PASS: unique documentation ids |
| `git diff --check` | 0 | PASS |

The web checks used one worker and a 3,072 MiB Node heap limit. The first full
web run passed 1,983 tests but timed out in three atlas hash checks at the
default five-second limit. All 14 atlas tests then passed in isolation in 0.2
seconds. The final unchanged full run passed every test with the same default
limit. The site build retains its existing large-chunk warning; this correction
does not change bundling.

## Guard evidence

`python -B docs/evidence/social-needs/check_guards.py --baseline-seconds 165.7556733`
exited 0. All 13 deliberate mechanism changes caused their named tests to fail
with exit code 101. Every source file was restored byte for byte. The command,
source hash, failure output and restoration result for each case are recorded
in `mutations.json` and `mutation-*.txt`.

The guarded mechanisms are directional liking, shared-device identity, media
capacity, standing destinations, terminal Social exclusion, preserved negative
costs, friendship effort, first-load preference rebuilding, actual food,
effective privacy benefits, effective media waiting, effective recipe waiting,
and recipe-address resolution.

The first final guard attempt exceeded its fixed 120-second cap while
rebuilding. The unmutated workspace command then took 165.7556733 seconds,
including compilation, while its selected test took 0.11 seconds. The final
runner used workspace features consistently and the project's required cap of
at least four times the measured baseline: 664 seconds. Its assertions were
unchanged. On another host, measure the unmutated command before supplying
`--baseline-seconds`; do not reuse this host's measurement as an assumption.

Independent review identified and verified corrections to the first-load
cache, recipe preference lookup and raw waiting/urgency consumers. The
[need rewards audit](2026-10-05-need-audit.md) records the remaining design
questions without changing those rewards.

These are automated local checks. A human playthrough and production
publication were not performed. The changes are uncommitted in this worktree.
