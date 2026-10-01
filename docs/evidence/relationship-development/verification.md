# Privacy avoidance and relationship development verification

This report records the privacy implementation before the local bed integration at `c912fffc`. Its measurements apply only to `66a248ec`; [the subsequent bed integration report](bed-integration.md) contains the combined build's new tests and balance measurements.

Implemented and verified locally on `twcx/need-social-privacy`, integrated with main at `66a248ec`. One editor made the changes; independent reviewers remained read-only. Changes are uncommitted and unpublished. No dependencies changed. The [behavior specification](../../specs/2026-09-30-relationship-development.md) describes the mechanics. [Earlier evidence](verification-pre-integration.md) applies to the implementation before newer autonomy and sleep scheduling changed its pacing.

## Balance and scope

Every scenario has seven settling days and 56 measured days. Each seed covers the shipped household, furnished two-, three- and four-person homes, controlled recovery from 0 and +0.5, and strong incompatibility with privacy penalties disabled. Normal fixtures set shyness and self-preservation to 50. The shipped layout retains its authored personalities and job; furnished layouts use neutral personalities and ordinary needs.

The frozen settings are privacy respect 0.72, shyness influence 0.08, proximity +0.057 per eligible hour, shared activity ten times that rate, strongest incompatibility friction -0.018 per eligible hour, and conversation completion +0.17. Penalties remain 0.11, 0.20 and 0.25. These are conditional rates; eligible contact, compatible preferences and avoidance opportunities still determine actual changes.

| Measure | Target | Calibration 1-16 | Reused validation 17-24 | Fresh confirmation 25-40 |
| --- | --- | --- | --- | --- |
| Ordinary incidents per Sim-week, pooled | 0.75-1.25 | 1.0820 | 1.1276 | 1.1009 |
| Mean recovery days from 0 | 1.5-2.5 | 1.5040 | 1.9346 | 1.5240 |
| Mean recovery days from +0.5 | 1.5-2.5 | 2.1861 | 2.3726 | 1.8552 |
| Mean days to hostility for strong incompatibility | 14-28 | 17.2593 | 21.7364 | 20.8396 |
| Non-incompatible samples above -0.5, percent | At least 90 | 99.4996 | 98.6688 | 99.1156 |

All aggregate targets pass in each cohort. The first two cohorts contain 112 and 56 scenarios; the predeclared fresh cohort adds 112. Seeds 17-24 were reused after a failed recovery result and are not an untouched holdout. Seeds 25-40 were declared before observation and ran once after tuning froze.

### Layout variation

| Layout | Calibration incidents/Sim-week | Validation incidents/Sim-week | Fresh incidents/Sim-week | Non-hostile sample percentages, calibration / validation / fresh |
| --- | --- | --- | --- | --- |
| shipped | 1.7969 | 1.9792 | 1.9349 | 96.16% / 89.79% / 93.24% |
| two | 0.2227 | 0.2188 | 0.2539 | 100.00% / 100.00% / 100.00% |
| three | 0.6719 | 0.7396 | 0.7214 | 100.00% / 100.00% / 99.99% |
| four | 1.2832 | 1.2344 | 1.1836 | 100.00% / 100.00% / 100.00% |

The weekly target passes in aggregate, weighted by person-weeks. It does not pass in every layout. The shipped layout remains near two incidents per Sim-week and its validation non-hostile percentage is slightly below 90%; the two-person layout has far fewer incidents. No quota forces incidents to occur. Open-plan toilets and inadequate facilities remain stress cases outside the ordinary frequency target.

### Fixture correction and calibration history

The original furnished fixture had beds, a kitchen, two bathrooms, reading, exercise and aquariums, but no television. Under newer autonomy, critical Social blocked many positive relationship opportunities: in the matched eight-seed recovery diagnostics it occupied 62.67% of person-minutes. Adding a television reduced that figure to 1.49% and improved recovery at unchanged rates. This supports classifying the old fixture as a Social-access stress case; it does not isolate a causal Social effect because the television also changes Fun, routing, choices and random draws. The harness retains it with `--social-stress`. Shared television use is still not implemented.

Calibration then adjusted positive gains and incompatibility friction. At proximity 0.054, the prescribed calibration cohort passed, but validation recovery from +0.5 averaged 2.6343 days. The fixed final rate 0.057 passes both cohorts and the fresh confirmation. The 0.060 trial had recovered too quickly from zero. These misses and the earlier censored observations remain in [calibration history](integration/calibration-history.json); the failed 0.054 [calibration](integration/candidate054-calibration.txt) and [validation](integration/candidate054-validation.txt) logs are retained. The significant privacy penalty was never reduced.

The normal furnished fixture recognizes shared reading and aquarium watching. It has only one exercise bike, so these household runs do not demonstrate autonomous shared exercise; causal tests cover the general recognition rule. They do not establish that every house needs a television or that general social scheduling is solved.

### Recovery and conflict tails

A controlled recovery sets the affected direction to its baseline, triggers a real player-directed private start, then resumes autonomy. Recovery is reaching baseline minus 0.01. Subsequent incidents stay in the observation. The initial hit is 0.25 at shyness 50.

| Cohort / baseline | Finished / unfinished | Median days | P90 days | Maximum days | Further incidents before recovery / over 56 days |
| --- | --- | --- | --- | --- | --- |
| Calibration 1-16 / 0 | 16 / 0 | 1.6889 | 2.4257 | 2.4979 | 0 / 34 |
| Calibration 1-16 / +0.5 | 16 / 0 | 1.9326 | 3.8937 | 4.8125 | 0 / 28 |
| Reused validation 17-24 / 0 | 8 / 0 | 2.0566 | 2.4431 | 2.4431 | 0 / 18 |
| Reused validation 17-24 / +0.5 | 8 / 0 | 2.3049 | 3.9299 | 3.9299 | 0 / 20 |
| Fresh confirmation 25-40 / 0 | 16 / 0 | 1.4077 | 2.3271 | 3.9986 | 0 / 29 |
| Fresh confirmation 25-40 / +0.5 | 16 / 0 | 1.5847 | 3.1257 | 5.0326 | 0 / 21 |

All 80 controlled recoveries and all 80 incompatible directions finished. Duration summaries label statistics over completed observations and retain a cohort mean lower bound that assigns the 56-day horizon to each unfinished case. A previous baseline had one unfinished +0.5 recovery: its 10.8181-day completed-only mean corresponded to a 13.6419-day cohort lower bound. Failed recoveries cannot disappear behind a mean.

Strong incompatibility reaches the balance threshold of -0.5 without privacy penalties. The existing People panel's literal Hostile label begins at -0.6. Individual directions can take longer than four weeks:

| Cohort | Median hostility days | P90 | Maximum | Shared activity gain | Compatibility friction | Conversation gain | Neutral decay |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Calibration 1-16 | 17.3257 | 20.1201 | 22.0625 | 4.7263 | -63.7419 | 3.6975 | 25.5603 |
| Reused validation 17-24 | 20.6816 | 31.2840 | 35.3687 | 3.0543 | -32.2635 | 1.4025 | 12.8077 |
| Fresh confirmation 25-40 | 20.6152 | 29.3708 | 30.5167 | 8.1938 | -66.6878 | 3.0175 | 25.5202 |

Contributions are cohort sums after clamping. Common enjoyable activities help, while personality friction exceeds the positive contributions. Need-interruption effects remain enabled and are separately recorded in the [complete summary](integration/summary.json).

## Need access and deterministic measurement

All 480 ordinary-household residents survived. Empty essential needs still occur, especially in the shipped household; the following counts do not establish that privacy never contributed to later deprivation.

| Cohort | Ordinary incidents / emergencies | Contact hours, directional | Entry / start waiting minutes | Longest wait | Empty Hunger or Energy person-minutes / while waiting | Completed / abandoned / active chains |
| --- | --- | --- | --- | --- | --- | --- |
| Calibration 1-16 | 1662 / 166 | 49010.101 | 7116 / 14672 | 239 | 95925 / 36 | 4901 / 0 / 17 |
| Reused validation 17-24 | 866 / 88 | 25003.168 | 3696 / 7052 | 263 | 36445 / 0 | 2499 / 0 / 6 |
| Fresh confirmation 25-40 | 1691 / 168 | 49331.869 | 8026 / 16841 | 271 | 90444 / 32 | 4923 / 0 / 19 |

No ordinary run had a player-directed incident. One offending action counts once even if several victims receive penalties. The raw output records cause, requested and actual contributions, critical minutes by need, first actual positive contact, waits by reason, empty needs by current activity, and outstanding chains. Chains are counted as completed only after observing their terminal countdown. Long progress gaps include walking, work and urgent detours; they do not by themselves prove deadlock. No chain abandonment was observed, but active chains at the observation horizon remain visible.

Causal regressions establish relevant emergency access, unrelated urgent-goal switching, stable priority between critical needs, current-occupancy checks, safe alternatives and preservation of reservations and unfinished chains. Diagnostic additions reproduced all 16 matched recovery RUN records and world hashes in the [observation replay check](integration/diagnostic-replay.json). The unit suite independently proves that observation consumes no randomness and changes neither hashes nor saves.

## Verification

| Command or check | Exit | Result |
| --- | --- | --- |
| `cargo test --workspace --no-fail-fast -- --test-threads=1` | 0 | PASS: 1,272 tests: core 108, data 271 plus one integration, simulation 741, WASM 151 |
| `cargo fmt --all -- --check` | 0 | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | PASS |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | 0 | PASS, optimized WASM |
| `npm test -- --maxWorkers=1 --reporter=dot` in `web` | 0 | PASS: 99 files, 1,369 tests against rebuilt WASM |
| `npm run typecheck` and `npm run build` in `web` | 0, each | PASS; asset `terri_wasm_bg-BuDfAFg5.wasm` |
| `cargo run -p terri-wasm --example relationship_qa -- <fixture-directory>` | 0 | PASS: five V5 fixtures validated through the production loader |
| Five controlled Chromium cases and 40-tick replay per case | No page errors | PASS: numeric effects and refreshed visible panels |
| Seven integration mutations | 101, each mutated test | PASS: assertion failures, then exact byte restoration |
| `python -B -m unittest discover -s <asset-suite> -p 'test_*.py'` for all seven CI asset suites, then `python assets/sprites/gen/build.py --check` | 0, each | PASS: atlas reproduces 1,362 sprites |
| `cargo tree -p <crate> --target <target>` for core/data/simulation on Windows, Linux and WASM | 0, each | PASS: no browser dependencies in pure crates |
| `python -B -m unittest test_changes` in `.github/scripts` | 0 | PASS: 11 CI-routing tests |
| `python check-doc-ids.py` and `git diff --check` | 0, each | PASS |
| Release balance matrix, seeds 1-40 | 0, all invocations | PASS execution: 280 scenarios, aggregate targets in all three cohorts |
| `cargo run --release -p terri-sim --example trace -- 120000` | 0 | PASS execution; heterogeneous household limitation below |

The release example was built and copied before long runs. Reproduce a cohort with `cargo run --release -p terri-sim --example relationship_balance -- 1 16 all`; use `17 24` or `25 40` for the other cohorts. The recorded copied executable used explicit equivalent overrides `--respect=0.72 --proximity=0.057 --friction=0.018`. Every run prints its effective settings; incompatible scenarios print a zero privacy penalty. The final raw [calibration](integration/calibration.txt), [validation](integration/validation.txt) and [fresh confirmation](integration/supplemental.txt) retain complete seed/scenario matrices. Regenerate their JSON with `python docs/evidence/relationship-development/summarize.py <log> ...`.

[Native tests](integration/rust-tests.txt), [Clippy](integration/clippy.txt), [WASM build](integration/wasm-build.txt), [web tests](integration/web-tests.txt), [typecheck](integration/web-typecheck.txt), [web build](integration/web-build.txt), [assets](integration/assets.txt) and dependency-purity records accompany this report. Remote CI and a full automatic mutation sweep have not run because the branch is unpublished.

The [seven mutations](integration/mutations.json) remove the boundary hash, entry guard or start guard; reverse the offended direction; duplicate an activity reward; discard a stroll's already-walked distance; or reorder published V5 fields. Each [failed an assertion](integration/mutation-assertions.txt). The field-order script initially made no edit because of line endings; after requiring changed source bytes, the actual mutation was detected. Earlier slices retain fifteen and thirteen additional targeted mutation records. Those older results are historical, not a fresh full sweep on this integrated tree.

Historical save tests preserve published self-preservation and chronotype field order, accept complete old tails, reject malformed partial records atomically, and continue a saved wait through decision expiry and action completion without rerolling or replaying an incident. Independent review also checked current autonomy integration, the full stroll budget, reservation ownership, urgency and measurement accounting; no actionable production finding remained.

### Browser evidence and cleanup

The final production build ran at 1365 by 1000 in an isolated muted Chromium context. Visible Pause, household selection, Overview and People controls were exercised. Controlled V5 worlds entered through the real loader; exact numbers came from the public bridge. Selected-person text was refreshed and asserted before capture.

| Case | One-tick observation, including neutral decay |
| --- | --- |
| Wait outside active private use | A remains at x=1.25; neither direction loses affinity |
| Player orders private use beside A | A toward B is -0.249990; B toward A is unchanged; People shows Dislikes and Overview lists Uneasy around B |
| Pleasant proximity | Both gain 0.000940 |
| Shared reading on separate objects | Both gain 0.009490; selected panel shows Reading and Shyness 50 |
| Strong incompatibility | Both lose 0.000290 |

All five 40-tick save/load replays produced matching world hashes. [Readings](integration/browser-results.json), [privacy screenshot](integration/browser-ordered.png) and [reading screenshot](integration/browser-reading.png) are retained. The small fixture's default front-door projection sits outside its floor; it is a controlled verification fixture. Owned contexts closed in a `finally` block and the owned preview server stopped, with its port verified closed.

### Longer authored-household limitation

The 120,000-tick [trace](integration/household-trace.txt) uses authored shyness and self-preservation rather than the normal-50 calibration settings. It ended at hash `68a6fa158ca816de`, recorded 67 ordinary privacy actions and 32 emergencies, and ended with five directions below -0.5. It retained 59 finished and 33 unfinished recoveries from actual losses exceeding the 0.01 tolerance, plus eight victim records already within that tolerance. Finished-only mean/median/nearest-rank P90 were 8.646/4.205/22.756 days, with further incidents included. Natural recoveries begin at different times and therefore have different observation horizons.

This roughly 83-day heterogeneous run does not pass the controlled two-day recovery expectation and cannot establish ordinary-household balance. It is retained because the pooled normal-fixture pass does not guarantee peaceful cohabitation with authored personalities, variable stats, limited facilities and repeated incidents. The shipped layout and broader social access remain tuning risks. Future hostility-expression avoidance must remeasure this contact and recovery balance.

The final review corrected natural-recovery accounting: zero or tiny clamped losses are now reported separately, rather than counted as immediate recovery. Median and P90 use the same definitions as the matrix summarizer. [Replay evidence](integration/trace-accounting-replay.json) proves that the correction preserved the world hash and every non-recovery observation. The [previous trace](integration/household-trace-before-accounting-fix.txt) remains for comparison; this diagnostic correction does not change any calibration result.
