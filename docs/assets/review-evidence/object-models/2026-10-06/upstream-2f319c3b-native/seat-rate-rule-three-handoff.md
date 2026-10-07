# Secondary seat rate review

Goal: integrate upstream contextual Comfort into the approved owned-book model hierarchy. Secondary media seating must pay physical Comfort once, without borrowing the reading specialization, Fun or Energy. Travel must supply no chair benefit. Preserve actual occupancy, existing source saves, names, prices and art.

1. Full native run: `secondary_seats_supply_their_own_rate_without_fun_or_reclining_energy` failed for `reading_chair`, expecting old flat reading benefit15/46. Updated to ordinary Sit29/41 after removing book-reading actions from hardware-rate derivation.
2. Seating focused run: same test failed for `sofa`, expecting old flat model34/50. Inspected authored current sofa model (an ottoman) and changed expectation to Sit9/30.
3. Final focused85 run:84 passed, same sofa case still failed at seating/tests.rs:118. Stop further expectation changes until fresh review identifies the actual cause.

Fresh-context better-way dispatch returned `agent thread limit reached`. No fourth test variation has been run. Other verification continues independently.

Read-only files: crates/terri-sim/src/seating/tests.rs (especially fixture_with_device and this test), crates/terri-data/src/pack.rs (CompiledObject::seat_comfort_rate), content/objects.toml, crates/terri-sim/src/need_interactions.rs, crates/terri-sim/src/media.rs and seating.rs.

Receipts: sim-wasm-tests2.log, seating-focused.log, focused-repairs.log in this directory. Native sweep1254 passed/8 failed; all other seven failures were corrected and included in the84 focused passes. Data final344 passed. Production source compiles and authentic2f pack/seven saves pass.

Please identify actual fixture/model modifiers and the causal source of the delivered rate. Recommend a correction with independent authored-value evidence. Do not run tests, builds or Git or make edits; read and search source and receipts only. Do not weaken assertions or substitute the implementation's own getter as an expected oracle.

