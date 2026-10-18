# Schema-17 saves from before job search became each housemate's setting

These two saves were written by main at commit `2b15dcfea9b6a147eec87b11607118f3c3349e1d`, the last revision whose current save is schema 17 and whose job search is one household setting. They test the move to schema 18 in [job search for each housemate](../../../../../docs/specs/2026-10-18-job-search-per-person.md) with bytes this branch's writer did not produce. `manifest.json` records each file's length and SHA-256.

1. `shipped-household.sav` is 6,907 bytes, SHA-256 `137ccd5547de8173e060eaa3ba00ce6e06e822583c10ed1f7f0399de77159ba1`. It is the shipped household from `SimHandle::from_lot()` with the household job search left on, saved after 4,920 ticks, Thursday at 10:00, when the search has hired a housemate.
2. `job-search-off.sav` is 6,904 bytes, SHA-256 `823f63aa95d5827b0a7f21aea2da2dc798a4d972ed74c63559d747f8805356d3`. It is the same household after `set_career_autonomy(true, false)` and `flush_commands()` at tick 0, which turned job search off for the whole household, saved after the same 4,920 ticks.

The producer was a scratch example in a temporary worktree at the source revision, run with `cargo run --release -p terri-wasm --example write_job_search_v17_fixtures -- <output directory>` and then removed with the worktree. It ticked each `SimHandle` 4,920 times, checked that `save_bytes()` wrote schema 17, and wrote the bytes unchanged. It ran natively with rustc 1.98.0 on Windows; the published browser build was not involved. The saves came from fresh local simulations, not from anyone's save data.

`src/job_search_tests.rs` loads both files through `load_bytes` and checks every living person's setting, and `web/tests/save-worker.test.ts` sends `job-search-off.sav` through the storage worker's schema-17 recovery path.
