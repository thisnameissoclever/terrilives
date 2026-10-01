# Combined relationship and privacy verification

Measured 2026-10-01 for [PR #196](https://github.com/thisnameissoclever/terrilives/pull/196), integrating game changes through `39bfa599` and changelog-authoring rules through `a69c79cd`. This includes the completed covered-bed renderer. One editor changed the worktree; independent read-only reviewers checked privacy/domestic composition and save/digest migration. No dependencies changed. [Final settings](final-settings.json) pin the tuning source and matrix executable.

## Balance

All aggregate targets pass in calibration seeds 1-16, reused validation seeds 17-24 and confirmation seeds 25-32. The confirmation cohort was declared before seeing this integrated candidate's results; those seed numbers also exist in older, different simulation records. This is confirmation of the integrated configuration, not a claim that these seeds have never been used.

Each seed covers the shipped household, furnished two-, three- and four-person homes, recovery from 0 and +0.5 after a real privacy incident, and strongly incompatible people with privacy penalties disabled. Runs use seven settling days and 56 measured days. Fixtures include dish sinks; shyness and self-preservation are 50. The shipped household retains its authored interests and career.

Final tuning is privacy respect 0.65, shyness influence 0.08, pleasant proximity +0.062/hour, shared activity ten times that rate, strongest incompatibility friction -0.0075/hour, conversation completion +0.17 and symmetric neutral drift 0.000005/tick. Privacy and critical/low need penalties remain 0.25, 0.20 and 0.11. Mess affinity is `-(0.0003 + 0.0027 * cleanliness)` per noticed episode; noticing, mood, cleanup choices and durations remain unchanged. Neutral drift is strictly positive in both directions. Halving its previous rate doubles unattended friendship and grudge lifetimes; there is no incident-specific forgiveness timer.

The matrix runs the merged release executable with `--proximity=.062 --decay=.000005`; all other coefficients come from authored source. Final authored content matches these overrides. The rebuilt stock source reproduces all 90 seed-one result records, including final hashes and relationship contributions, exactly; [comparison](stock-source-replay.json). Eleven independent processes partition seeds 1-32 into groups of three. [Process exits](release-exits.json) are all zero. [Matrix summary](release-summary.json) retains complete contributions, contact, waiting, need levels, chain progress, subsequent incidents and unfinished observations. Cohort logs are [calibration](release-calibration.txt), [reused validation](release-validation.txt) and [confirmation](release-confirmation.txt).

| Measure | Target | Calibration 1-16 | Reused validation 17-24 | Confirmation 25-32 |
| --- | --- | --- | --- | --- |
| Scenario runs | Complete | 112 | 56 | 56 |
| Ordinary incidents per Sim-week | 0.75-1.25 | 0.9707 | 0.9063 | 0.9466 |
| Mean recovery from 0, days | 1.5-2.5 | 2.0240 | 1.5768 | 1.6707 |
| Mean recovery from +0.5, days | 1.5-2.5 | 2.3325 | 1.7194 | 1.9537 |
| Mean strong-incompatibility hostility, days | 14-28 | 17.8503 | 17.0406 | 19.0178 |
| Non-incompatible samples above -0.5 | At least 90% | 96.7654% | 96.3255% | 96.5535% |
| Unfinished recoveries or hostility observations | Zero | 0 | 0 | 0 |

Recovery medians from 0/+0.5 are 2.0952/2.5952 calibration, 1.6691/1.7889 reused validation and 1.5525/2.0230 confirmation days. Corresponding 90th percentiles are 2.8576/3.2313, 2.4486/2.5215 and 3.2403/3.9715. Maxima are 3.5368/3.5285, 2.4486/2.5215 and 3.2403/3.9715. Each calibration baseline includes two subsequent privacy incidents during recovery, reused validation includes one, and confirmation includes none. All slow and unfinished observations remain in the summary.

Incompatible shared activities contribute +2.7306, +1.9840 and +2.4567 across these cohorts, while compatibility friction contributes -34.9016, -17.6289 and -18.1200. Enjoyable activities help, but ordinary friction dominates without privacy penalties.

Pooled acceptance does not imply every layout meets the target. The shipped layout alone has 1.5599/1.5052/1.5417 ordinary incidents per Sim-week and 75.2108%/71.8285%/73.5770% non-incompatible samples above hostility across the three cohorts. It remains substantially more conflict-prone than the adequately furnished neutral layouts. Emergencies are counted separately. This layout limitation is not hidden by the aggregate pass.

The corrected [sink baseline](sink-summary.json) identified recurring mess costs; the [mess-only comparison](mess-summary.json) reduced their amplitude to one tenth. Earlier [0.075](summary.json), [0.06](final-summary.json), [single-rate grid](grid-summary.json) and [joint 0.063](joint-summary.json) trials are preserved as failed candidates. Conflicting recovery bounds led to the final joint calibration of existing contact and neutral-drift rates.

Need access remains a measured limitation. Focused tests prove emergency overrides, late alternatives, stable waiting goals, own-reservation release and chain continuation. Traces retain empty needs during waits and action/chain intervals. An action disappearing before its terminal step is reported as abandoned; ordinary interruptions also produce this record. These traces cannot prove that no earlier privacy delay contributes to a later empty need.

## Checks

Every final command below exits zero. Earlier failures remain in separate logs.

1. `cargo test --workspace -j2`: PASS, 1,403 tests: 111 core, 277 data plus one integration, 850 simulation and 164 browser-runtime tests. [Log](release-rust.txt). Adjusted dish expectations preserve the lower authored penalty; the clamping fixture still proves requested and actual changes differ at the bound.
2. `cargo fmt --all -- --check` and `cargo clippy --workspace --all-targets -- -D warnings`: PASS. [Formatting](release-format.txt), [Clippy](release-clippy.txt).
3. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`: PASS. [Optimized runtime](combined-wasm-build.txt).
4. `npm --prefix web test -- --maxWorkers=1`: PASS, 1,799 tests in 123 files. [Complete suite](release-web-tests.txt). An atlas hash scan timed out under simultaneous native simulation load; its unchanged [unloaded rerun](atlas-unloaded.txt) and the complete suite passed. `npm --prefix web run typecheck` and `npm --prefix web run build`: PASS. [Type check](combined-typecheck.txt), [build](combined-web-build.txt). The build reports the existing large-chunk warning.
5. `node --test scripts/build-changelog.test.mjs`, `node scripts/build-changelog.mjs`, `python check-doc-ids.py` and `python -B -m unittest discover -s .github/scripts -p 'test_*.py'`: PASS. [Changelog tests](release-changelog-tests.txt), [generation](release-changelog-build.txt), [document IDs](release-doc-ids.txt), [workflow tests](release-workflow-tests.txt).
6. The updated mirrored changelog skills pass `npm --prefix web test -- --maxWorkers=1 tests/agent-skill-mirrors.test.ts`; [log](release-skill-mirrors.txt). Repository asset checks: PASS, all eight command exits recorded in [combined-assets.json](combined-assets.json). [Generated atlas validation](combined-assets.txt) passes with 1,833 sprites. This does not replace visual acceptance.
7. Three targeted mutations are killed: removing owned-station routing, omitting cleanup suspension and recording mess as neutral decay. [Results](mutations.json). Source bytes were restored and causal tests passed. This is targeted evidence, not a full remote mutation sweep; historical privacy/hash/reward mutations retain their dated records.

Save tests cover published domestic-first V5 order, frozen local bed order, historical bytes, running cook steps, multibyte interior cuts, absent frozen-bed state, unknown-source rejection, retained-state comparisons and canonical resaves. Malformed loading leaves the world unchanged. Independent review found no actionable defect in the integrated save/digest and privacy guards.

## Browser and interface

[Final controlled Chrome cases](release-browser-cases.json) prove waiting earns no penalty, an ordered intrusion affects only the correct direction, proximity is positive, shared reading pays ten times its base rate, and incompatibility is negative. All 40 ticks of each save/load replay match world hashes. The final coefficients are asserted within 0.000001 and no page errors occur.

[Interface evidence](release-browser-ui.json) and [screenshot](browser-details-final.png) verify shyness inside Personal details, a 360-pixel default flyout and a 540-pixel expanded view. Compact phone viewports 320 by 568, 390 by 844 and 640 by 400 have no horizontal overflow and a 44-pixel close control. Changelog desktop/phone and dark/light checks retain [layout evidence](release-changelog-browser.json). Owned pages close in finally blocks; the owner's existing tab remains untouched.

Meals and TV do not receive the shared-activity bonus. Covered sleeping poses are implemented by the integrated bed release; they are static poses. Directional hostility indicators, reactions and activity avoidance remain planned under B-hostility-expression. Publication, automatic deployment and live behavior are separate observations.
