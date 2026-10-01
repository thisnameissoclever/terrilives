# Privacy and relationship verification with bed places

Historical checkpoint: the starting double bed was still at `(0, 6)` for this report. The later [starting-layout correction and combined verification](bed-layout.md) supersede its shipped-household measurements; the other six fixture types remain unchanged.

This report records the local privacy implementation integrated with bed branch `c912fffc9cf997657397ac8154b16c655c93fa79`. Privacy changes remain uncommitted and unpublished. Root was the sole editor; independent reviewers inspected source without editing. No dependencies changed. The checkpoint, patch, manifest and retained autostash preserve the implementation from before this integration. [Earlier measurements](verification.md) remain tied to `66a248ec`.

## Integrated behavior

Privacy substitutes and late emergency checks now use the same physical-place admissions and authored approaches as bed autonomy. A half-occupied bed can accept a second sleeper only through a reachable free side. Cancelling or changing an errand releases only that actor's claim. A partner's target, place, countdown and assignment remain intact.

New privacy routes use the held place's valid approach, rotated from the authored base facing. Historical routes remain untouched until a replacement is needed; player orders bypass autonomous privacy rerouting. Survival risk precedes assignment preference. Among safe bed alternatives, the actor's assigned place is preferred, then an unassigned place, then another person's place. Non-sleep alternatives remain eligible.

The V5 order is chronotype offsets, optional grouped sleeping places, shyness, then boundary decisions. A complete bed-era group loads with the two privacy fields absent. Padding cannot complete a cut bed group or accept an explicitly encoded absent group. Command 19 remains bed assignment.

Three [independent optimized bed-only WASM fixtures](../../../crates/terri-wasm/tests/fixtures/README.md) cover two travelling sleepers, two active sleepers, and a pending assignment-clear command. Their original fields and bytes are preserved; only the two empty privacy vectors are appended. The command drain preserves both active claims while clearing only the requested assignment. Each fixture replays 40 ticks identically after another current save/load.

## Fresh balance measurements

The frozen release executable ran seeds 1-16 and 17-24, seven settling days followed by 56 measured days, with unchanged settings: respect 0.72, shyness influence 0.08, proximity 0.057/hour, shared activity ten times proximity, friction 0.018/hour and conversation completion 0.17. Penalties stay 0.11, 0.20 and 0.25. These are regression cohorts previously used during tuning, not untouched holdouts.

| Measure | Target | Seeds 1-16 | Seeds 17-24 |
| --- | --- | --- | --- |
| Scenarios | Complete matrix | 112 | 56 |
| Ordinary incidents per Sim-week, pooled | 0.75-1.25 | 1.1048 | 1.1094 |
| Mean recovery from neutral, days | 1.5-2.5 | 1.5040 | 1.9346 |
| Mean recovery from +0.5, days | 1.5-2.5 | 2.1861 | 2.3726 |
| Mean time to strong-incompatibility hostility, days | 14-28 | 17.2593 | 21.7364 |
| Non-incompatible samples above -0.5, percent | At least 90 | 98.6807 | 98.9822 |

All aggregate targets pass. All 48 controlled recoveries and all 48 incompatible directions finish. Recovery from neutral has median/P90 1.6889/2.4257 days in calibration and 2.0566/2.4431 in validation. Recovery from +0.5 has median/P90 1.9327/3.8937 and 2.3049/3.9299 days. No subsequent incident occurs before these controlled recoveries finish; later incidents remain counted over the full horizon.

Shared activities still help incompatible pairs: their total positive contribution is 4.7263/3.0543, while incompatibility contributes -63.7419/-32.2635. Conversation and decay contributions remain separately visible in the [summary](bed-integration/summary.json) and raw [calibration](bed-integration/calibration.txt) and [validation](bed-integration/validation.txt).

### Layout and need-access limits

| Layout | Incidents/week, calibration | Incidents/week, validation | Above hostility, calibration | Above hostility, validation |
| --- | --- | --- | --- | --- |
| Shipped household | 1.8880 | 1.9063 | 89.89% | 92.20% |
| Furnished two-person | 0.2227 | 0.2188 | 100% | 100% |
| Furnished three-person | 0.6719 | 0.7396 | 100% | 100% |
| Furnished four-person | 1.2832 | 1.2344 | 100% | 100% |

The weekly target is a pooled result, not a per-layout guarantee. The shipped calibration household narrowly misses the 90% healthy-sample target considered on its own. At this bed revision, the new-game double bed at (0,6) has one authored approach blocked by its room wall. The independent bed-only save fixtures use the separately corrected (0,8) placement; loading those fixtures does not change this checkout's new-game layout. Later bed-layout changes need their own shipped-household measurement. Bed visual acceptance also remains separate.

All 288 ordinary residents survive. Calibration/validation record 1,697/852 ordinary incidents and 195/89 emergency incidents, with no player-directed incidents. Contact is 49,001.935/24,820.201 directional hours. Waiting totals 23,039/11,414 Sim-minutes, with maxima of 125/201 minutes; these maxima include noncritical waits. Ten/zero essential-empty minutes overlap privacy waiting. That overlap is an observation, not proof that the wait caused deprivation. The raw logs retain empty needs by action and critical minutes by need.

There are 4,883/2,467 observed chain completions, zero observed abandonments, and 13/5 active chains at the horizon. Causal tests establish emergency access and preservation of unfinished chains; the matrix does not turn every long action or unfinished chain into a claim of deadlock. The older authored-stat 120,000-tick trace remains historical evidence, not a fresh trace on this bed integration.

## Verification

| Command or check | Exit | Result |
| --- | --- | --- |
| `cargo test --workspace --no-fail-fast -- --test-threads=1` | 0 | PASS: 1,351 tests; core 111, data 274 plus one integration, simulation 807, WASM 158 |
| `cargo fmt --all -- --check` | 0 | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | PASS |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | 0 | PASS: optimized WASM |
| `npm test -- --maxWorkers=1 --reporter=dot` in `web` | 0 | PASS: 115 files, 1,622 tests against rebuilt WASM |
| `npm run typecheck`, `npm run build` in `web` | 0, each | PASS; WASM asset `terri_wasm_bg-CqB6LUri.wasm` |
| Seven asset suites, atlas reproduction, CI-routing and workflow tests, documentation IDs, dependency purity on Windows/Linux/WASM | 0, each | PASS; exact commands in [check records](bed-integration/repository-checks.json) |
| Seven new manual mutations | 101, each | PASS: assertion failures, followed by exact source restoration |
| Release `relationship_balance` with `1 16 all` and `17 24 all` | 0, each | PASS execution and aggregate targets, 168 scenarios |
| Five controlled browser cases and 40-tick replay | No page errors | PASS |

[Rust output](bed-integration/rust-final.txt), [Clippy](bed-integration/clippy-final.txt), [WASM build](bed-integration/wasm-build.txt), [web tests](bed-integration/web-tests.txt), [type checking](bed-integration/web-typecheck.txt), [build](bed-integration/web-build.txt) and [mutation records](bed-integration/mutations.json) are retained. Each mutation removes or corrupts partner reservation ownership, the sleep place, cross-bed preference, survival ordering, authored base facing, bed-era prefix acceptance or explicit-None rejection. [Assertion output](bed-integration/mutation-assertions.txt) accompanies the restored-source hashes. Remote CI and a full mutation sweep have not run.

The final independent source review found no remaining actionable privacy/bed integration defect. Review findings corrected whole-object reservation assumptions, actual place access, authored facing fallback and assignment-versus-survival ordering. New regression fixtures also use coherent saved architecture, supported facings and real arrival before asserting active sleep.

### Browser coverage and cleanup

The QA inventory covers waiting outside private use, a player-ordered private action beside another occupant, passive proximity, shared reading and incompatibility. Historical byte loading and pending command 19 are independently exercised through the production native WASM boundary tests. The browser uses the rebuilt production app in an isolated muted headed Chrome context at 1365 by 1000, with native rendering and the actual Pause radio label.

| Controlled case | One-tick result, including neutral decay |
| --- | --- |
| Wait outside active private use | A stays at x=1.25; neither direction loses affinity |
| Player-ordered private action beside A | A toward B becomes -0.249990; B toward A stays unchanged |
| Pleasant proximity | Both gain 0.000940 |
| Shared reading | Both gain 0.009490; Overview shows Reading and Shyness 50 |
| Strong incompatibility | Both lose 0.000290 |

All five 40-tick replays match their saved world hashes. Observation itself leaves the simulation at tick one. The inspected [privacy capture](bed-integration/browser-ordered.png) shows A's directional Dislikes label; the [reading capture](bed-integration/browser-reading.png) shows the current action and shyness. The small fixture deliberately lacks beds and displays that separate mood consequence. [Raw readings](bed-integration/browser-results.json) contain no page errors.

Headless SwiftShader could not provide this host's WebGPU adapter. The verified headed system Chrome configuration worked. Harness locator corrections addressed Pause's actual radio-label role and scoped Overview to its sheet. These were harness fixes, with no application workaround. Owned contexts closed in `finally`; the owned preview server stopped and port 4185 has no listener.
