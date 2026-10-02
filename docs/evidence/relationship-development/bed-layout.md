# Relationship verification after the starting-bed correction

The local privacy implementation now includes the reviewed starting-layout correction from `ddb67d62f13cf2bc6a406a35e300e1fa462eb04d`, applied over the previous `c912fffc` integration. Both double-bed places are reachable in a new game. Existing saves retain their furniture positions. Root was the sole editor, and independent source review found no new integration defects. These changes remain uncommitted and unpublished.

The earlier [bed integration report](bed-integration.md) records the old starting layout. The [upstream correction report](../../assets/review-evidence/bed-assignment/starting-layout.md) describes the placement constraints and its own branch's checks. The checks below were run on the combined privacy implementation.

## Change and persistence

The only production change in this correction moves the starting double bed from `(0, 6)` to `(0, 8)`. Its facing, footprint and two sleeping places stay the same. The new position opens both authored approaches without moving walls or household spawns. Privacy penalties, avoidance and relationship tuning remain unchanged.

Historical test builders use a shared frozen manifest of 34 furniture placements instead of inheriting current new-game positions. The production migration validators and historical byte fixtures remain unchanged. New shipped-household tests verify separate walking and sleeping places, exact assignments, advancing action timers, and save/load continuation. A saved bed at the old position keeps its complete state and world hash when loaded.

## Refreshed measurements

The frozen release executable ran 24 new shipped-household scenarios: seeds 1-16 and 17-24, each with seven settling days and 56 measured days. The other six scenario types explicitly clear the prefab placements and construct their own furniture, so their 144 completed runs from the previous integration remain applicable. The combined matrix contains 168 scenarios; it is not described as 168 fresh runs. [Cohort provenance](bed-layout/cohort-provenance.json) records both inputs and their hashes. These seeds were previously used during calibration and are not untouched holdouts.

| Measure | Target | Seeds 1-16 | Seeds 17-24 |
| --- | --- | --- | --- |
| Ordinary incidents per Sim-week, pooled | 0.75-1.25 | 1.1257 | 1.1328 |
| Non-incompatible samples above -0.5, pooled | At least 90% | 98.7608% | 98.5034% |
| Mean recovery from neutral, retained fixture | 1.5-2.5 days | 1.5040 | 1.9346 |
| Mean recovery from +0.5, retained fixture | 1.5-2.5 days | 2.1861 | 2.3726 |
| Mean strong-incompatibility time to hostility, retained fixture | 14-28 days | 17.2593 | 21.7364 |

All pooled targets pass. All 48 controlled recoveries and all 48 incompatible directions finished. Their recovery tails, later incidents and shared-activity contributions remain in the [combined summary](bed-layout/summary.json). Shared activities help incompatible pairs, while personality friction remains the larger contribution.

The shipped household still differs from the furnished fixtures. Its ordinary incident rate is 1.9714/2.0000 per Sim-week, and its non-incompatible samples above hostility are 90.4994%/88.5262%. Its validation cohort misses the 90% target when considered alone. Moving the bed fixes access; it does not establish one incident per week for every layout or remove the shipped household's relationship problems. The two-, three- and four-person fixture results remain as recorded in the earlier report.

The refreshed shipped cohort records 757/384 ordinary incidents, 149/74 emergencies and no player-directed incidents. All 72 residents survive. It records 1,079/565 completed chains, no observed abandonments, and two/zero active chains at the horizon. Privacy waiting totals 11,930/7,085 Sim-minutes, with maximum waits of 326/220 minutes, including noncritical waits. Essential-empty needs overlap waiting for 15/10 minutes. These observations retain the need-access limitations; they do not prove that every deprivation episode is independent of an earlier wait. Raw [calibration](bed-layout/calibration-shipped.txt) and [validation](bed-layout/validation-shipped.txt) logs include contact, contributions, critical needs and unfinished chains.

## Combined validation

| Command or check | Exit | Result |
| --- | --- | --- |
| `cargo test --workspace --no-fail-fast -- --test-threads=1` | 0 | PASS: 1,353 tests; core 111, data 274 plus one integration, simulation 809, WASM 158 |
| `cargo fmt --all -- --check` | 0 | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | PASS |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | 0 | PASS: optimized WASM |
| `npm test -- --maxWorkers=1 --reporter=dot` in `web` | 0 | PASS: 115 files, 1,622 tests |
| `npm run typecheck` and `npm run build` in `web` | 0, each | PASS; WASM asset `terri_wasm_bg-C0oUKkc1.wasm` |
| `python check-doc-ids.py` | 0 | PASS |
| Release `relationship_balance` with `1 16 shipped` and `17 24 shipped` | 0, each | PASS: 24 completed scenarios |
| Shipped household in rebuilt browser | No page errors | PASS: both sleeping places and save/load replay |

[Command records](bed-layout/checks.json), [Rust output](bed-layout/rust.txt), [release executable hash](bed-layout/release-build.json) and the adjacent build/test logs preserve these results. Previously passing asset, dependency-purity and targeted mutation checks remain recorded in the earlier report; their inputs were not changed by this correction. Remote CI and a full mutation sweep have not run.

The browser check used the real starting household in an isolated, muted headed Chrome context. Through public commands, Tim and Bill received different places on bed 19 and both entered Sleeping after 53 simulation ticks. A walking save replayed ten ticks identically, and a sleeping save replayed twenty ticks identically, comparing full save bytes and world hashes. Assignments and both occupancy claims survived. The Overview showed Sleeping. [Raw observations](bed-layout/browser.json) and the inspected [capture](bed-layout/browser-two-sleepers.png) record the result. Occupied sleep poses remain separate bed-feature work; this check does not approve them.

Owned browser contexts closed in `finally`. The owned preview server stopped, and port 4185 had no listener after cleanup.
