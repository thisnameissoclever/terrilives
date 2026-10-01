# Privacy avoidance and relationship development verification

The measurements below cover the original local implementation on `e4ecd68`. These results predate integration with `66a248ec`, whose autonomy and sleep scheduling required recalibration. The [current verification report](verification.md) supersedes these historical measurements. The [behavior specification](../../specs/2026-09-30-relationship-development.md) describes the implementation; this report records measurements and their limits.

## Balance

Each scenario uses seven settling days followed by 56 measured days. Calibration covers seeds 1-16; validation covers 17-24. Each seed includes the shipped household, furnished two-, three- and four-person homes, recovery from affinity 0 and +0.5, and a strongly incompatible pair with privacy penalties disabled. Ordinary-household Sims have shyness 50. The shipped household retains its authored personalities and job; the furnished households use neutral personalities and ordinary needs.

The final tuning is 0.90 privacy respect, 0.08 shyness influence, +0.016 proximity per eligible hour, ten times that for recognized shared activity, -0.030 strongest incompatibility friction per eligible hour, and +0.17 base conversation completion. Low-need, critical-need and privacy penalties remain 0.11, 0.20 and 0.25.

| Measure | Target | Calibration | Validation |
| --- | --- | --- | --- |
| Ordinary autonomous incidents per Sim-week, pooled | 0.75-1.25 | 1.0052 | 1.0234 |
| Mean recovery days, starting at 0 | 1.5-2.5 | 1.6785 | 1.7016 |
| Mean recovery days, starting at +0.5 | 1.5-2.5 | 1.9697 | 2.0931 |
| Mean days for strong incompatibility to reach -0.5 | 14-28 | 24.4956 | 23.8076 |
| Non-incompatible directional samples above -0.5 | At least 90% | 98.7865% | 99.5746% |

These targets pass as aggregate measures. Privacy frequency varies substantially with contact opportunities:

| Layout | Calibration incidents/Sim-week | Validation incidents/Sim-week |
| --- | --- | --- |
| Shipped | 1.4141 | 1.4896 |
| Two people | 0.1484 | 0.1016 |
| Three people | 0.6693 | 0.6302 |
| Four people | 1.3789 | 1.4297 |

No individual layout lands inside the nominal weekly band. The pooled target is weighted by person-weeks, not an assurance of one incident every week in every household. There is no incident quota. Open-plan toilets and inadequate facilities remain outside this calibration target.

Calibration observed 1,544 ordinary incidents over 1,536 Sim-weeks, plus 282 emergencies. Validation observed 786 over 768 Sim-weeks, plus 137 emergencies. There were no player-directed incidents in the ordinary household runs. One offending action is counted once even when several people receive penalties. Directional eligible contact totals were 54,122.967 and 26,740.767 hours. Non-incompatible relationships were sampled hourly, yielding 494,592 and 247,296 directional observations.

The validation seeds informed tuning: at a +0.15 conversation reward, recovery from +0.5 averaged 2.5451 days and failed the upper bound. The final +0.17 reward passed after rerunning both cohorts. Seeds 17-24 are therefore reused validation evidence, not an untouched statistical holdout. Earlier proximity/friction rates also failed recovery or incompatibility pacing; the significant privacy penalty was never reduced in this extension.

### Recovery and conflict tails

A recovery case sets the affected relationship to its stated baseline, triggers a real player-directed private start through the simulation, then resumes autonomy. Recovery means reaching at least baseline minus 0.01. The initial privacy penalty is 0.25 at shyness 50. Subsequent incidents remain in the observation; they do not restart or disappear from the measurement.

| Cohort / initial affinity | Finished / unfinished | Median days | P90 days | Maximum days | Further incidents before recovery | Further incidents over 56 days |
| --- | --- | --- | --- | --- | --- | --- |
| Calibration / 0 | 16 / 0 | 1.5972 | 2.2313 | 3.2437 | 1 | 15 |
| Calibration / +0.5 | 16 / 0 | 2.0174 | 2.7972 | 3.4979 | 1 | 17 |
| Validation / 0 | 8 / 0 | 1.6966 | 1.9174 | 1.9174 | 0 | 9 |
| Validation / +0.5 | 8 / 0 | 2.1222 | 3.1229 | 3.1229 | 0 | 14 |

Strong incompatibility reached -0.5 in all 32 calibration directions and all 16 validation directions. P90 times were 32.6090 and 36.2514 days; maxima were 39.9868 and 36.5931. The target is a mean, so individual pairs can take longer than four weeks. This balance threshold is -0.5; the existing People panel's literal Hostile label begins at -0.6.

Incompatible validation pairs received +0.110667 from shared activities, +25.585005 from conversations and +12.542533 from decay, against -50.622439 from compatibility friction and -1.319485 from low-need interruptions. Privacy penalties were zero. Personality friction exceeds the positive contributions by itself; ordinary need interruptions remain enabled. Shared activity helps without turning opposing preferences into an automatic friendship. These are sums over the cohort, not per-person changes.

The [summary](summary.json) retains all relationship causes, including requested versus clamped changes and contributions until recovery. Mean durations exclude unfinished observations; their counts are always reported. All controlled recovery and incompatibility observations finished in the final matrix.

## Need access and chain evidence

All 288 ordinary-household residents survived the measured period. Calibration recorded 61,576 person-minutes with Hunger or Energy at zero; validation recorded 29,305. Only 10 and 3 of those minutes coincided with a privacy wait. Most empty-need time was in the shipped household, particularly work, walking and cooking. The raw output separates Hunger and Energy by activity and whether a privacy wait occurred within the preceding two hours. Counting Hunger and Energy separately can exceed the combined person-minute total.

These observations do not prove that earlier privacy waits never contribute to later deprivation. A separate avoidance-disabled diagnostic also showed empty needs, but changing avoidance changes random draws, choices, relationships and mood; that comparison does not isolate a causal effect. The controlled access regressions provide the causal evidence: relevant emergencies can cross, unrelated errands yield to critical food/sleep goals, newly clear obstructions preserve accumulated urgency, competing critical goals keep a stable wait clock, and safe alternatives are rechecked against late occupancy.

Waits before entry totalled 19,711/8,915 minutes in calibration/validation; waits before starting private use totalled 169,941/79,132. Maximum individual waits were 393/399 minutes. Noncritical Sims may wait longer than the ten-minute critical-need override. Neither the 30-minute decision cache nor the emergency rule promises that every wait ends within ten minutes.

Chain diagnostics observe a terminal step's final countdown before counting completion. Other disappearances are recorded as abandoned. Ordinary calibration/validation runs recorded 1,895/911 completions, zero abandoned chains and 5/9 chains still active at the horizon. Maximum observed chain ages were 1,007/933 minutes; maximum intervals without step/countdown changes were 830/769 minutes. Such intervals include walking, urgent-need detours and work pauses; they are not necessarily deadlocks. Age measures the observed interval after the measurement boundary. Outstanding ordinary chains had gone at most 32 minutes without a step/countdown change at cutoff. Per-actor horizon records remain in the summary and raw logs.

## Verification

| Command or check | Exit | Result |
| --- | --- | --- |
| `cargo test --workspace -- --test-threads=1` | 0 | PASS: 1,210 tests: core 107, data 270 plus one integration test, simulation 696, WASM 136 |
| `cargo fmt --all -- --check` | 0 | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | PASS, including the final diagnostic example |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | 0 | PASS, including optimization |
| `npm test -- --maxWorkers=1 --reporter=dot` in `web` | 0 | PASS: 81 files, 1,228 tests against rebuilt WASM |
| `npm run typecheck` in `web` | 0 | PASS |
| `npm run build` in `web` | 0 | PASS; WASM asset `terri_wasm_bg-BtRYSbzJ.wasm` |
| `cargo run -p terri-wasm --example relationship_qa -- <output-directory>` | 0 | PASS: five controlled V5 worlds validate through the production loader |
| Controlled Chromium cases | 0 page errors | PASS: waiting, directed privacy violation, proximity, shared reading, incompatibility, and save/load replay |
| Thirteen targeted manual mutations | 101 for each mutated test | PASS: each failed an assertion; source bytes were restored afterward |
| `cargo build --release -p terri-sim --example relationship_balance`, then copied `balance-talk17-final.exe 1 16` and `balance-talk17-final.exe 17 24` | 0, each | PASS: 112 calibration and 56 validation scenarios; aggregate targets above |
| Repeat final executable with seeds `1 12` and `13 24` after adding chain counters | 0, each | PASS: 168 identical world hashes and prior RUN records |
| `python docs/evidence/relationship-development/summarize.py docs/evidence/relationship-development/calibration.txt docs/evidence/relationship-development/validation.txt` | 0 | PASS: complete unique seed/scenario matrix, all causes and unfinished observations retained |
| `python check-doc-ids.py` and `git diff --check` | 0, each | PASS |

The mutation records and assertion logs cover removed entry/start guards, repeated rerolls, omitted saved/hashed state, reversed relationship direction, duplicate activity rewards, shared-dislike compatibility, late alternatives, stale conversations and urgent-goal handling. They supplement the original feature's fifteen mutations. These targeted checks are not a full automated mutation sweep. Remote CI was not run because the branch was not published.

Historical native and real-WASM save tests cover older V5 tails and reject cuts inside records and variable-length counts. Mid-wait replay continues across expiry and completion without rerolling or repeating an incident. Diagnostic-only observation is excluded from saves and hashes.

The release example was built once and copied before launching long runs so Windows could rebuild other binaries without replacing a running executable. The final raw [calibration](calibration.txt) and [validation](validation.txt) logs contain 112/56 unique RUN records and 32/16 incompatible PAIR records. [Replay checks](replay-check.json) confirm that adding chain measurements changed no world hash or earlier RUN metric across all 168 scenarios. [Rust](rust-tests.txt), [WASM](wasm-build.txt), [web](web-tests.txt) and [mutation assertion](mutation-assertions.txt) outputs are retained alongside the report.

Asset and dependency-purity checks from the [original feature evidence](../need-social-privacy/verification.md#earlier-full-implementation-checks) remain applicable: this extension changes no assets, dependency manifests or lockfile. Those checks passed seven Python suites (83/26/30/14/8/13/3 tests), atlas reproduction and dependency trees for core/data/simulation on Windows, Linux and WASM targets.

### Browser observations

The final production build ran in an isolated Chromium context at 1365 by 1000. Existing pause and household-selection controls were exercised; controlled worlds were loaded through real V5 save bytes. Public simulation inspection supplied exact values, and rendered HUD text and screenshots confirmed the displayed person and consequence.

| Case | Observed result after one tick |
| --- | --- |
| Respect a private room | A remains at x=1.25; no relationship penalty |
| Ordered private use beside A | A's opinion of B becomes -0.249990; B's opinion stays unchanged; HUD shows Dislikes and Uneasy around B |
| Pleasant proximity | Both directions gain 0.000256667 after ordinary decay |
| Shared reading on separate objects | Both gain 0.002656667 after decay; HUD shows Reading |
| Strong incompatibility | Both lose 0.000490 after decay |

All five cases reproduced the same world hash after a 40-tick save/load replay. [Browser readings](browser-results.json), [privacy screenshot](browser-ordered.png) and [shared-reading screenshot](browser-reading.png) are retained. The small fixture has a default front-door projection outside its floor; it is a verification fixture, not a shipped room design. Owned contexts closed in a `finally` block and the owned preview server was stopped.

The broader `cargo run --release -p terri-sim --example trace -- 120000` also exited 0, ending at hash `97dde33234d60406`. It used authored shyness and personalities, unlike the neutral-shyness calibration. It recorded 50 ordinary privacy actions and 25 emergencies, with 53 finished and 23 unfinished natural incident recoveries. Finished recovery mean/median/P90 were 10.081/5.312/23.972 days, with repeated incidents retained. Two directions were below -0.5 at the end. This heterogeneous 83-day run does not establish the controlled average-compatibility recovery target; it shows why that target cannot promise two-day recovery for every person and incident.

Independent read-only review covered production ordering, reservations, save validation, hash determinism, activity eligibility and the measurement harness. It found late-occupancy alternatives, stale-conversation eligibility and urgent-goal priority issues; those were fixed and regression-tested. Reporting fixes retain omitted contributions and outstanding chains. No new production defect remained in the final review.
