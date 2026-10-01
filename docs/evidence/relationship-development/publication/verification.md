# Combined relationship and privacy verification

Measured 2026-10-01 for [PR #196](https://github.com/thisnameissoclever/terrilives/pull/196), integrating main through `93968a17`. One editor changed the worktree; independent reviewers checked privacy/domestic composition and save/digest migration without editing. No dependencies changed. The native executable and tuning source are pinned in [final settings](final-settings.json).

## Balance

The full matrix uses seeds 1-16 for calibration and 17-24 for validation, with seven settling days and 56 measured days per scenario. Each seed covers the shipped household, furnished two-, three- and four-person homes, recovery from 0 and +0.5 after one real privacy incident, and strongly incompatible people with privacy penalties disabled. Fixtures include dish sinks so the meals system can actually clean its dishes. Shyness and self-preservation are 50; the shipped household retains its authored interests and career.

Frozen tuning: privacy respect 0.65, shyness influence 0.08, pleasant proximity +0.075/hour, shared activity ten times that rate, strongest incompatibility friction -0.0075/hour, and conversation completion +0.17. Significant privacy and unmet-need penalties remain 0.25, 0.20 and 0.11. Mess affinity is `-(0.0003 + 0.0027 * cleanliness)` per noticed episode. Its mood consequences, episode boundaries, cleanup decisions and durations are unchanged.

The corrected [sink baseline](sink-summary.json) exposed substantial recurring mess costs. The [mess-only comparison](mess-summary.json) reduced that amplitude to one tenth before further relationship calibration. The [four-seed candidate](candidate-summary.json) passed aggregate targets; the shipped layout was still more conflict-prone. Final cohorts use authored source values with no command-line overrides, so the mess reduction is applied once.

Commands: `cargo build --release -p terri-sim --example relationship_balance`, then `target/release/examples/relationship_balance.exe 1 16 all` and `... 17 24 all`. Runs were partitioned into four independent processes per cohort; every process exit is recorded. The [summarizer](../summarize.py) retains unfinished observations, subsequent incidents, all relationship contributions, eligibility, need levels, waiting reasons and chain progress. Calibration output is [calibration.txt](calibration.txt); validation output and the completed comparison table accompany the final summary.

| Measure | Target | Calibration 1-16 | Validation 17-24 |
| --- | --- | --- | --- |
| Ordinary incidents per Sim-week, pooled | 0.75-1.25 | 0.9577 | 0.9089 |
| Mean recovery from 0, days | 1.5-2.5 | 1.6913 | 1.2264, FAIL |
| Mean recovery from +0.5, days | 1.5-2.5 | 1.9375 | 1.4870, FAIL |
| Mean strong-incompatibility hostility, days | 14-28 | 23.9998 | 22.3931 |
| Non-incompatible samples above -0.5 | At least 90% | 97.5093% | 98.7400% |

These .075 proximity results are preserved in [summary.json](summary.json). The untouched validation cohort recovers too quickly, so the aggregate calibration pass is not treated as final acceptance. A .06 proximity trial reuses seeds 1-24; seeds 25-32 are predeclared for fresh confirmation after that setting is chosen. All other coefficients remain fixed.

Calibration includes all 112 scenarios. All 32 controlled recoveries and all 32 incompatible directions finish. Recovery medians are 1.6698/2.0542 days, 90th-percentile times are 2.5965/2.8875, and maxima are 3.4708/3.3576. Each recovery baseline has two subsequent privacy incidents during recovery, retained in the result. Incompatible shared activities contribute +2.7375 and conversations +0.8925, while compatibility friction contributes -44.6678 across the full cohort.

Aggregate acceptance does not promise identical household pacing. Calibration ordinary incidents per Sim-week are 1.5781 shipped, 0.2969 two-person, 0.6719 three-person and 1.0371 four-person. Non-hostile percentages are 80.9043% shipped and 100% in the furnished neutral layouts. Shipped emergencies are counted separately. Its authored interests, facilities, social contact and need delivery still produce substantially more conflict.

Need access remains a measured limitation rather than a blanket claim. Focused tests prove relevant emergency overrides, late alternatives, stable waiting goals, own-reservation release and chain continuation. The trace retains empty needs during waits and long action/chain intervals. An action disappearing before its terminal step is reported as abandoned; this includes ordinary interruption and does not by itself prove a stuck chain. Long household traces cannot establish that no earlier privacy delay contributes to a later empty need.

## Checks

All listed commands exit 0 unless a mutation is deliberately killed. Logs preserve relevant output and earlier failures rather than overwriting them.

1. `cargo test --workspace`: PASS, 1,397 tests, including 111 core, 276 data plus one integration, 847 simulation and 162 browser-runtime tests. [Final passing log](final-rust-pass.txt). Two dish expectations and the clamping fixture were updated for the lower authored penalty; [focused clamping](final-mess-clamp.txt) proves requested and actual changes differ at the bound.
2. `cargo fmt --all -- --check` and `cargo clippy --workspace --all-targets -- -D warnings`: PASS. [Formatting](final-format.txt), [Clippy](final-clippy.txt).
3. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`: PASS. [Optimized build](final-wasm-build.txt).
4. `npm --prefix web test -- --maxWorkers=1`: PASS, 1,788 tests in 121 files. `npm --prefix web run typecheck` and `npm --prefix web run build`: PASS. [Tests](web-latest-tests.txt), [type check](web-latest-typecheck.txt), [final build](final-web-build.txt).
5. `node --test scripts/build-changelog.test.mjs`, `node scripts/build-changelog.mjs`, `python check-doc-ids.py` and `python -B -m unittest discover -s .github/scripts -p 'test_*.py'`: PASS. [Changelog tests](final-changelog-tests.txt), [generation](final-changelog-build.txt), [document IDs](final-doc-ids.txt), [workflow tests](final-workflow-tests.txt).
6. Repository asset checks: PASS, with exact commands and exits in [assets.json](assets.json). Generated atlas validation passes; no new visual asset approval is inferred from those checks.
7. Three targeted mutations are killed: removing owned-station routing, omitting cleanup suspension, and recording mess as neutral decay. [Mutation results](mutations.json). Source bytes were restored and causal tests passed. This is targeted evidence, not a full remote mutation sweep; earlier privacy/hash/reward mutations remain tied to their historical records.

Save tests cover published domestic-first V5 order, the frozen local bed order, real historical bytes, running cook-step preservation, multibyte interior cuts, explicit absent frozen-bed state, unknown-source rejection, full retained-state comparisons and canonical resaves. Loading malformed state leaves the live world unchanged. Replay checks cover saved boundary decisions and interrupted domestic work.

## Browser and interface

Controlled Chrome cases use the final optimized browser runtime. [Final results](final-browser-cases.json) prove waiting produces no penalty, a player-ordered intrusion applies the negative opinion in the correct direction, proximity is positive, shared reading pays ten times its rate, incompatibility is negative, and every tick of a 40-tick save/load replay has the same world hash. No page errors occur.

[Interface evidence](browser-ui.json) and [screenshot](browser-details.png) place shyness inside Personal details. Default flyout width is 360 pixels; expanded details use 540. Phone widths 320, 390 and 640 have no horizontal overflow and a 44-pixel close control. The integrated changelog is readable on desktop and phones in both themes; [layout evidence](changelog-browser.json) records dark/light states and overflow. Owned browser pages close in finally blocks; the owner’s existing tab is untouched.

Meals and TV do not receive the shared-activity bonus. Occupied bed poses still require separate visual acceptance. Directional hostility indicators, reactions and activity avoidance remain planned under B-hostility-expression. Publication and automatic deployment are verified separately from local behavior.
