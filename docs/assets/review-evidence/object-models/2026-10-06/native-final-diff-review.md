# Final native diff review

This was a focused read-only review of the native integration, followed by the parent's authorized correction. It did not rerun the full suite or claim an exhaustive audit.

1. Restored the published `the_flitting` preference for `dining_table/sit_properly` at 1.05. Removing it was a leftover from retiring the old false table action; the current chair-backed Sit remains supported. The personality file now matches upstream exactly.
2. Removed the stale statement that reading balance awaits runtime integration. The comment still records pending owner review.
3. The inherited ordinary-device adoption limitation remains explicitly accepted. The labelled 845101d two-viewer TV witness migrates and round-trips in current schema 7; ordinary new admission remains exclusive. This release does not claim complete uniqueness validation for every ordinary device.

The scoped correction passed `cargo test -p terri-data --lib disposition -- --test-threads=2` (8 tests), `cargo test -p terri-data --lib the_shipped_household_is_three_sims_on_three_different_archetypes -- --test-threads=2` (1 test), and the documented `TERRI_WRITE_RUNTIME_FIXTURE=1` authoring test for `inherited_runtime_fixture_compiles_real_model_actions_and_rounding` (1 test). Every exit code is zero in `native-final-personality-exits.json`; terminal receipts are beside this file.

The derived current runtime fixture was regenerated through its authoring test. Its SHA-256 is `312a63613bee28f5f9d3627ffa5ee075cd43d483cb32ad3a4b7c8d73e044bca6`. Historical fixtures were unchanged. The earlier native freeze remains preserved; `native-delivery-final-freeze.json` identifies the final source copy and manifest.

**Next steps**: Rebuild release WASM so it contains the restored published preference. No further native source edits are pending.
