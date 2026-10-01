# Sleeping-place navigation checkpoint

2026-10-01, local branch `twcx/bed-place-runtime`, checkpoint `01abe01d`.
Merged upstream main `5d332287` locally as `81902f23`. Unpublished work; occupied
double-bed rendering remains a separate acceptance gate.

## Behavior

The double bed authors two ordered physical places. In its default SE facing,
place zero uses `(0,-1)` and `(1,-1)`; place one uses `(0,2)` and `(1,2)`.
Offsets rotate from the definition's base facing. They are navigation data,
independent of presentation sockets. The lower bunk retains its existing
whole-perimeter access because its single place has no authored access record.

Content compilation requires unique nonempty place IDs, distinct cardinal
perimeter tiles, nonempty approach lists and one record per shared physical
place for multi-place beds. Alternate sleep interactions use their maximum
capacity rather than adding slots. An object with no sleeping capacity cannot
declare places.

Each free place is checked against the distance field and its contact edge.
Autonomy compares actual distance-dependent survival risk first, assignment
preference second, utility third and ordinal last. It publishes one candidate
per object/interaction and reconstructs only the selected route. Player orders
retain a reachable held place, then prefer their assignment and unassigned
places. A reachable occupied place remains waitable. An order with no reachable
sleeping place ends. Fractional starting positions still use grid anchoring.

Authored access governs new and replacement routes. Physically valid saved
walks and running actions keep their existing geometry, including after a
historical save is written as modern V5 and loaded again. The loader does not
silently reroute a Sim or reject an old walk solely for ending on another side.

## Save compatibility

The new fingerprint hashes the frozen previous digest plus length-delimited
object IDs, ordered place IDs and canonical approach sets. Reordering approaches
does not change path tie breaking or the digest; reordering places does.

| Exact new content shape | Reviewed previous shape |
| --- | --- |
| Live `b38e71a123bb8273` | `c2cf291984ed61f7` |
| Reconstructed pre-rotation `9ac7e41e24d4c921` | `d396b3f39e3c6685` |

Only these two exact destinations inherit the existing public bridges.
Acceptance and historical-name/interaction classification use the same
normalization. Pre-rotation bathtub saves still require physical migration;
they are not directly compatible with the live geometry. Changed place IDs,
order, coordinates or counts close the bridges. Tests also reject changed
sleep access through the transactional bathtub migration boundary.

## Verification

The navigation regressions cover four facings, non-SE authored bases,
blocked approach tiles, open tiles behind closed contact edges, inaccessible
assignments, occupied fallback, fully inaccessible orders, simultaneous
distinct claims, fractional anchoring, actual-risk comparison and unchanged
candidate counts. Historical V1 through V5 walks retain their path through
migration and a second modern save/load.

| Command | Result | Exit |
| --- | --- | --- |
| `cargo test --workspace -- --test-threads=1` | Core 109, data 270 plus 1 integration, simulation 747 passed. WASM passed 150 and failed two old expected-digest assertions; see repair below. | 101 |
| `cargo test -p terri-data -p terri-wasm -- --test-threads=1` | PASS after repair and restored faults: data 270 plus 1 integration; WASM 152 | 0 |
| `cargo test -p terri-sim beds:: -- --test-threads=1` | PASS: all 28 after fault restoration | 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS after the final WASM fixture repair and upstream integration | 0 |
| `cargo fmt --all --check` | PASS | 0 |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS: rebuilt release artifact | 0 |
| `npm run typecheck`, in `web` | PASS | 0 |
| `npm test`, in `web` | PASS: 1,580 against rebuilt WASM; 1,598 after upstream audio integration | 0 |
| `npm run build`, in `web` | PASS | 0 |
| `python check-doc-ids.py`, `git diff --check` | PASS | 0 |

Together these establish 1,279 passing native tests. The full-workspace
command itself is not reported as a clean run: its two failing expectations
were repaired and the complete affected crate was rerun. The upstream integration adds the paper review page and suspended-audio
cancellation repair, without changing Rust or bed content. Web typecheck,
all tests and the production build passed again after that integration.
Existing browser control evidence remains in `runtime-ui.md`; no new occupied visual or public
deployment acceptance is claimed.

The fresh reviewer compared the complete failed WASM snapshots: only the
content fingerprint differed. Both expectations now replace that field using
a separate fresh shipped simulation, then retain complete world equality.
This uses the WASM crate's existing simulation dependency; it does not read
back the migrated result or add a data-crate dependency. The historical bytes
and source pins stay unchanged. A first attempt to call the data crate directly
failed compilation because it is not a direct dependency; no dependency was added.

Five deliberate faults each failed a named assertion and exited 101:

| Fault | Detecting test |
| --- | --- |
| Wrong SW rotation | `sleeping_place_geometry_rotates_from_the_authored_base` |
| Whole-perimeter distance substituted for exact contact | `an_unreachable_assignment_falls_back_for_blocked_tiles_and_contact_edges` |
| Remove survival-risk priority | `autonomy_keeps_one_candidate_and_chooses_safety_before_assignment` |
| Duplicate a place candidate and risk row | `autonomy_keeps_one_candidate_and_chooses_safety_before_assignment` |
| Accept an arbitrary pack's pre-access digest | `sleeping_access_bridges_are_exact_and_keep_migration_classification` |

The last assertion reports its custom message, `mutation 0`. The runner first
rejected that log because it looked for generic assertion wording; inspection
confirmed the named assertion failed. The corrected targeted detection run
passed. Each fault restored its original file bytes in a finally block and
verified their SHA-256. Restored files:

| File | SHA-256 |
| --- | --- |
| `terri-data/src/pack.rs` | `A71F6040EE26CC6219FE57B7CB786AEAFE914061A188D248FCAE71122F5C8588` |
| `terri-data/src/lib.rs` | `2CE5AD1434702C822AD156E50DFE81107D42490DABE02EED2A0C02295467D153` |
| `terri-sim/src/beds/navigation.rs` | `1F1BF0E34C8C7D4CBFCD13C7C870B80805390548FD93494807140D2B7ED48343` |
| `terri-sim/src/systems/action.rs` | `174EB77595262E245DA54AA84FC06A6B800C7745FC68DC3FF7AB2E54B603F50E` |

These targeted faults are additional evidence, not a full mutation sweep.

## Ownership integration follow-up

Four additional tests in `beds/tests/lifecycle.rs` exercise actual system
boundaries rather than only the release helper:

1. Staggered and simultaneous completions preserve permanent assignments,
   keep the bed reserved for the remaining sleeper and release the last lease.
2. Starting a worker's shift clears only that person's sleep commitment. The
   partner's target, remaining duration and place stay unchanged; both permanent
   assignments remain and the worker cannot reacquire the bed while commuting.
3. Losing the target's furniture definition at arrival clears both travelling
   leases and the final reservation marker.
4. A single autonomous selection pass assigns distinct places to two Sims and
   makes the third wait without acquiring a target or place.

`cargo test -p terri-sim beds::tests::lifecycle -- --test-threads=1` passed all
four with exit 0. `cargo clippy -p terri-sim --all-targets -- -D warnings` passed
with exit 0. Only test code changed in this follow-up; the prior full simulation
run remains applicable. The combined native count is now 1,283.

## Review

Two read-only adversarial reviews found no production routing or fingerprint
defect. Review identified stale expected-current digest assertions and requested
the additional bathtub-boundary rejection checks, which were added. A third,
fresh-context review after fingerprint fixture failures in successive crate
suites verified that the two remaining whole-world differences were only their
expected digest. It found no production migration defect or further stale
expected-current digest. Reviewers did not claim the unimplemented occupied
visuals were ready.

Before release, integrate and verify the occupied body fit, composite layers,
picking and indicators. Rebuild after those changes and review the complete
feature before merging and checking its actual deployment.
