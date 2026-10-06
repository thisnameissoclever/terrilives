# Contextual needs verification

Pre-integration local verification captured on 2026-10-06 in
`twcx/social-company-needs-fa6c`, based on `1a138df6`, before commit `10fc5aa3`.
This record covers the Social correction and subsequent needs corrections.
The patch was uncommitted and unpublished when these checks ran. Later
integration and delivery are recorded in
[the combined verification record](2026-10-06-integration.md).
No remote checks, deployment or manual browser play are claimed here.

## Implemented behavior

1. Hand washing at both sinks has no Comfort cost and cannot raise Hygiene
   above 40. It cannot reduce cleanliness already above that ceiling. Bathing
   can still raise Hygiene toward 100.
2. Seated TV, radio and full meals receive the occupied chair's own Comfort
   rate. Secondary use does not copy Fun or reclining Energy. Traveling and
   interrupted users receive no secondary seat payment.
3. Actual standing food consumption costs two Comfort points per ninety
   eating minutes. Preparation, gathering, travel and missing food give no
   such cost. Counter snacks receive the proportional standing cost.
4. Bunks advertise five Comfort; double beds advertise ten. Plain sitting
   and reclining have no Fun reward.
5. Shared reading, exercise and aquarium watching provide 0.12 Social per
   minute only during matching successful activities, with both preferences
   acceptable, separate objects, the same room, a four-tile contact radius
   and positive receiver affinity. Actual positions determine contact distance.
6. TV/radio retain exact same-device participation; meal Social retains real
   chairs facing the same table. These rules do not acquire the generic shared
   activity's extra room or radius restrictions.
7. Scoring, waiting and private-room alternatives use available contextual
   effects. Friendship readiness uses current participation and chair Comfort,
   rather than treating failed or prospective sharing as delivered Social.

The maintained [needs reference](../../NEEDS-INTERACTIONS.md) contains every
action's amounts, costs, conditions, modifiers and justification.

## Final checks

All commands ran in the repository root unless a prefix specifies otherwise.
Rust builds used one worker. Node commands used a 3,072 MiB heap and the web
test run used one worker. Heavy runs were sequential.

| Command | Exit | Result and evidence |
| --- | --- | --- |
| `cargo fmt --all -- --check` | 0 | PASS: formatted source |
| `cargo clippy --workspace --all-targets -j 1 -- -D warnings` | 0 | PASS: `clippy.txt` |
| `cargo test --workspace --no-fail-fast -j 1 -- --test-threads=1` | 0 | PASS: 1,543 tests; `rust-workspace.txt` |
| `python -B docs/evidence/needs-interactions/check_guards.py` | 0 | PASS: 25 guard deletions detected; `mutations.json` and individual failure logs |
| `python -B docs/evidence/needs-interactions/check_boundaries.py` | 0 | PASS: three additional authored-validation and meal-frame deletions detected; `boundary-mutations.json` |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` with `CARGO_BUILD_JOBS=1` | 0 | PASS: optimized browser package; `wasm-build.txt` |
| `npm --prefix web run typecheck` | 0 | PASS: `web-typecheck.txt` |
| `npm --prefix web test -- --maxWorkers=1` | 0 | PASS: 150 files, 1,986 tests; `web-tests.txt` |
| `npm --prefix web run build` | 0 | PASS: `web-build.txt`; existing large-chunk warning remains |
| `node --test scripts/build-changelog.test.mjs` | 0 | PASS: 12 changelog tests |
| `node scripts/build-changelog.mjs` | 0 | PASS: standalone changelog generated |
| `python -B check-doc-ids.py` | 0 | PASS: unique documentation IDs |
| `git diff --check` | 0 | PASS: no whitespace errors |
| Unslop phrase and document-structure scans | 0 | PASS: no flagged phrases or structure in the needs reference; no flagged phrases in the public note |

The native total comprises 126 core, 285 data, 960 simulation, 171 browser
boundary and one auxiliary test. Generated browser binaries and build output
are ignored; dependency manifests and lockfiles were not changed.

## Causal evidence and restoration

The simulation deletion suite first passed an unmutated 960-test baseline in
286.39 seconds, including compilation. Each mutated command had a 1,146-second
cap, calculated as the larger of 120 seconds and four times that baseline.
Each deletion produced an assertion failure, rather than a compilation failure.

The deleted mechanisms include the Hygiene ceiling, above-ceiling preservation,
score clipping, real-food and consumption-clock checks, travel and gathering
exclusions, actual seat rates, secondary payment, affinity, object and activity
identity, room and radius limits, both preference checks, failure exclusion,
actual helped needs, seat-derived help, refresh ownership, same-device use,
table facing and effective private-room alternatives.

The supplemental suite verifies that authored invalid Hygiene limits and
seat numbers fail at the compiler boundary, and that a meal's company frame
is rebuilt before payment. Each supplemental command first passed its own
unmutated baseline.

All 28 records report `restored_byte_identical: true` and include the source
SHA-256 checksum, command, exit code and actual failure log. The final workspace
suite ran after restoration and passed. `source-manifest.json` records the
reviewed source and documentation bytes.

## Review and corrections

Independent review found two readiness errors: a failed shared activity could
claim Social help through its prospective offer, and real seated meal Comfort
was absent from helped needs. Both were corrected through the current-activity
projection, with successful/failed and seated/standing controls. Deleting each
correction fails its regression. Deleting the relationship tick's refresh also
fails after removing the tests' preliminary refreshes.

The final reference states that snacks currently use a standing counter step;
it does not promise dining-chair selection for snacks. Standalone empty-table
sitting remains the existing rest action, with no Hunger or Social. The owner's
separate planned availability change is outside this correction.

No task-owned game pages or preview servers were started or left running.
