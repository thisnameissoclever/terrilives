# Needs, privacy and shyness verification

Local evidence, 2026-09-30. Branch `twcx/need-social-privacy`, base `e4ecd68`. Implementation is uncommitted; no push, merge or deployment was requested. [Behavior specification](../../specs/2026-09-30-need-social-privacy.md).

This is historical evidence for the original needs/privacy/shyness slice. The [relationship-development verification](../relationship-development/verification.md) supersedes its avoidance policy, conversation reward and balance results. Preserve the readings below as observations of the earlier implementation.

## Earlier tuning follow-up

The owner requested one more slight reduction after the first long-run result. At this stage, base penalties became 0.11 for low needs, 0.20 for critical needs and 0.25 for privacy, down about 15%, 13% and 17% respectively from 0.13/0.23/0.30. Shyness scaling, mild avoidance and the 0.15 completion gain were unchanged. At neutral shyness a completed low-need chat then netted +0.04, and a critical-need chat netted -0.05.

| Follow-up command | Exit | Result |
| --- | --- | --- |
| `cargo fmt --all -- --check` | 0 | PASS |
| `cargo test -p terri-sim interpersonal -- --test-threads=1` | 0 | PASS: 19 tests, including current numerical penalties and shyness responses |
| `cargo run --release -p terri-sim --example trace -- 120000` | 0 | PASS execution; hostility remains a balance limitation |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | 0 | PASS |
| `npm test -- --maxWorkers=1 tests/bridge.test.ts tests/game-hud.test.ts` in `web` | 0 | PASS: 58 tests against rebuilt WASM |
| `npm run build` in `web` | 0 | PASS |
| `python check-doc-ids.py` and `git diff --check` | 0, each | PASS |

The new 120,000-tick run ended with these directional opinions:

| Offended person | Opinion of Tim | Opinion of Bill | Opinion of Casey |
| --- | --- | --- | --- |
| Tim | - | -0.998 | -0.783 |
| Bill | -0.827 | - | -0.997 |
| Casey | -0.667 | -0.980 | - |

All six remain strongly negative. Some finish less negative than in the previous run, but autonomous choices diverge as affinity changes, so this is not an isolated measure of each penalty's effect. Four of 360,000 person-ticks were frozen/unexplained. Of 47 started chains, 46 completed, none were abandoned, and one was still active at the cutoff. Wander paths stayed within three tiles. Satisfaction ended at 79.6/1039.6/598.9; final hash `0x6c996b13919bc14c`.

The following full-suite, mutation and browser evidence predates this final numerical adjustment. The focused checks above cover the adjustment; the four browser screenshots/readings are retained as historical observations at 0.13/0.23/0.30, not presented as current numerical readings.

## Earlier full implementation checks

All commands ran in this worktree with existing tooling. Heavy checks ran sequentially. Web dependencies were a physical copy of already installed dependencies matching the identical manifests and lockfile; no dependency version changed.

| Command | Exit | Result |
| --- | --- | --- |
| `cargo fmt --all -- --check` | 0 | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | PASS |
| `cargo test --workspace -- --test-threads=1` | 0 | PASS: 1,181 tests; core 107, data 267 plus one integration, simulation 671, WASM 135 |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | 0 | PASS, including optimization |
| `npm run typecheck` in `web` | 0 | PASS |
| `npm test -- --maxWorkers=1` in `web` | 0 | PASS: 81 files, 1,228 tests |
| `npm run build` in `web` | 0 | PASS |
| `cargo tree -p <crate> --target <target>` | 0, each | PASS: core/data/simulation have no wasm-bindgen, web-sys or js-sys for Windows, Linux and wasm32 targets |
| `python check-doc-ids.py` | 0 | PASS: unique, allocation-free IDs |
| `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'` | 0 | PASS: 83 tests |
| `python -B -m unittest discover -s assets/models/sims/sim-01 -p 'test_*.py'` | 0 | PASS: 26 tests |
| Same discovery command for `assets/models/{furniture,kitchen,bathroom,bedroom,office}` | 0, each | PASS: 30, 14, 8, 13 and 3 tests |
| `python assets/sprites/gen/build.py --check` | 0 | PASS: atlas up to date, 1,225 sprites, 4096x7928 |

Purity targets were `x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu` and `wasm32-unknown-unknown`; crates were `terri-core`, `terri-data`, `terri-sim`. Each tree command's success was checked before searching its output. Assets were checked before the shyness amendment; that amendment changed no assets.

Initial failures exposed old test cuts that assumed waiting was the final save field. Native and real-WASM browser fixtures now account for shyness, preserve historical field boundaries, and reject cuts inside records and two-byte lengths. The final suites pass. The corresponding lessons entry records the prevention rule.

## Causal checks and review

Fifteen manual mutations were detected by failing test assertions, with exit 101. Each helper restored captured source bytes in a finally block and verified equality after restoration. [Actual assertion output](mutations.json) records each result.

The first seven removed helped-need exclusion, changed critical classification, deleted private-start or entry hooks, reversed an offended/responsible pair, joined doorway regions, or let furniture partition rooms. They were run against the original approved implementation. The eight after the shyness amendment removed actual object/social choice costs, suppressed the wander alternative, removed victim scaling, changed the initial-stat seed, dropped saved values, omitted hash values, or disabled older V5 padding. Each targeted command was `cargo test -p <owning-crate> <test-filter> -- --test-threads=1` after applying that mutation; the original seven used `--nocapture` instead. These are targeted manual checks. A full automated `cargo mutants` sweep and remote CI were not run.

Independent read-only review found and resolved frozen-legacy room separation, failed legacy conversation contact, missing causal wander coverage and an unpinned initialization mapping. Final review reported no further correctness, save/hash or determinism findings. It also found the old six-field decoder description; the documentation now describes seven fields.

## Earlier long-run balance

`cargo run --release -p terri-sim --example trace -- 120000` exited 0. The requested reduced base penalties and mild shyness-aware avoidance were enabled. The household's initial shyness values are Tim 89, Bill 22 and Casey 30.

| Offended person | Opinion of Tim | Opinion of Bill | Opinion of Casey |
| --- | --- | --- | --- |
| Tim | - | -0.955 | -0.992 |
| Bill | -0.994 | - | -0.965 |
| Casey | -0.992 | -0.988 | - |

All six opinions remain strongly negative after about 83 simulated days. Lower single-event penalties and mild avoidance have not produced broadly friendly household balance. This is a measured balance limitation, not a passed acceptance claim. No further tuning was silently substituted for the owner's request. A further balance pass is needed if ordinary households should remain broadly friendly; the results do not justify making the requested slight avoidance into a prohibition.

Only four of 360,000 person-ticks were classified as frozen/unexplained, about 0.0011 percent. All 48 started chains completed, with none abandoned. Wander paths remained within their three-tile cap. Tim still reached zero in hunger, energy, hygiene, bladder and social; Bill/Casey bladder minima were 30.7/23.6. Satisfaction ended at 220.1/1055.8/625.3. Final hash: `0x5aaffad5e3a6d38d`.

An earlier comparison with all three incident penalties disabled ended with positive opinions, 0.344 to 0.997. It preceded shyness and avoidance, so it establishes a reference, not a controlled attribution of the final combined change. The long-run trace does not directly count privacy incidents or prove their aggregate reduction; the choice tests and mutations establish the implemented bias.

## Earlier browser observation

PASS: headed Chromium ran the optimized production build at `http://127.0.0.1:5187/?stress=0`. Controlled saved worlds crossed the public bridge, then one real simulation tick and the real frame/HUD path. [Observed readings](browser-results.json) and [selected-person screenshot](entry.png) preserve the results.

| Scenario | Offended person | Shyness | Affinity after one tick | Visible relationship meter |
| --- | --- | --- | --- | --- |
| Critical bladder, conversation initiated by A | B | 100 | -0.287490 | -0.287 |
| A enters during B's toilet use | B | 100 | -0.374990 | -0.375 |
| B starts while A is already present | A | 1 | -0.226490 | -0.226 |
| Same start with a toilet in an open room | A | 1 | -0.226490 | -0.226 |

Ordinary per-tick relationship drift accounts for the 0.00001 difference from the initial event magnitudes. All reciprocal readouts remained empty. Shyness changed from 1 to 100 on selection and cleared on deselection. Fresh need/action and mood readings were checked alongside the stat, rather than allowing a cached panel from the previous fixture to count as evidence. No page errors were observed.

Pause is a native radio with a visible label, not a button. After three failed button locators, the required fresh read-only review identified the correct control. Clicking `#time-controls label[for="speed-0"]` selected the real driver pause. Every observed fixture remained at tick 1 after its explicit tick and rendered frame. Browser contexts and task-owned preview servers were closed in cleanup; port 5187 had no remaining listener.

These are controlled public-bridge gameplay and HUD observations. The screenshot does not establish loaded architecture rendering or live release acceptance; room geometry and event order are constrained by the native and real-WASM tests. No owner visual acceptance or live deployment verification has been claimed.

## Integration boundary

The parallel meals/cleanup chat reports uncommitted additions to V5 and tuning plus new `docs/SIM-RELATIONSHIPS.md`. Those changes are absent from this base. When both branches converge, preserve its domestic behavior, combine the appended save fields and backward-compatible decode rules, reconcile pack/fingerprint fixtures, and link this feature specification from the shared relationship overview. No files in that other worktree were edited here.
