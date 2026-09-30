# Preserve each person's sleep rhythm

Status: implemented; local automated checks and the scoped displayed-game
review passed. This fixes the existing
authored chronotype contract; it does not add a bedtime editor or retune sleep.

## Behavior

1. Starters and new housemates receive the chosen personality's exact
   `chronotype_offset_ticks`: early riser -90, neutral 0, night owl +180 in
   the current content.
2. The value shifts the sleep-drive schedule. Sampling at `clock - offset`,
   wrapped within the day, moves a negative offset earlier and a positive
   offset later. Needs, exhaustion, available beds and competing activities
   still influence actual bedtimes.
3. Saves retain the exact signed value for each person. Older saves without
   this field retain their historical zero rather than adopting new content
   settings on load. No additional random draws are needed.
4. The offset and its owner contribute to the deterministic world hash.
   Saving, loading and failed lot-edit rollback must preserve them together.

## Save boundary

Append sparse nonzero chronotype rows to V5; do not modify the frozen entity
records inside older snapshots. Rows must be in canonical entity order, unique,
and refer to living people with personality state. Missing whole historical
tail fields may default to empty. Truncated rows and malformed current payloads
must not be accepted as historical saves.

## Verification

1. Check starters and every newcomer personality against authored values.
2. Round-trip a nondefault signed offset and compare continued simulation,
   not only the immediate snapshot. Check historical zero defaults separately.
3. Change only an offset, then only its owner, and require the hash to change.
   Restore the original state and require the original hash.
4. Test early and late schedules against the shipped morning and evening
   curve, midnight wrapping and extreme signed offsets.
5. Reject duplicate, unsorted, unknown and invalid-owner rows, and truncated
   byte payloads, through the release-mode public load boundary. A refused
   load must leave the running world unchanged.
6. Remove load-bearing mechanisms, observe assertion failures, and restore
   exact source bytes before the final clean test run.
7. Build the browser package and inspect a displayed game. Exercise housemate
   creation and save/reload. Record what was actually visible; a screenshot
   cannot prove an exact phase offset or a stable long-term sleep balance.

The implementation review found both missing lifecycle propagation and the
wrong offset sign. Testing only `phase` with its own arithmetic expectation
had preserved the latter mistake. Tests must also express the intended
early-riser and night-owl behavior against the authored curve.

## Causal regression evidence

The test-first run failed on starter offset `0` instead of `-90`, loaded offset
`0` instead of `-731`, and an unchanged hash after changing only the offset.
The actual-curve test also failed with the former addition-based phase.

Twelve compiling mutations failed assertions. Each mutation was removed with
an inverse patch and its pre/post SHA-256 compared equal before continuing.
Those comparisons were recorded as booleans, not retained per-mutation digests.

| Mutation | Observed failure |
| --- | --- |
| Remove capture sorting | Rows were `[(1,180),(0,-90)]` instead of entity order. |
| Remove duplicate/order guard | Duplicate owner rows loaded successfully instead of returning `InvalidValue`. |
| Allow descending rows but still reject duplicates | Descending rows loaded successfully. |
| Remove zero-entry guard | A sparse `(34,0)` row loaded successfully. |
| Remove Agent ownership guard | A personality-only entity was accepted. |
| Remove Personality ownership guard | The test caught a panic instead of the required error return. |
| Remove sparse zero filtering | Capture included the unwanted `(2,0)` row. |
| Omit hash offset | Changing only the value left hash `2632837079132535101` unchanged. |
| Omit hash owner | Moving the value left hash `8606166187428030238` unchanged. |
| Replace phase subtraction with addition | `at(1200,-90) > at(1200,0)` failed. |
| Ignore chronotype rows when checking padded decoding | Release decoding accepted a partial tail at byte 3143. |
| Remove canonical padded re-encoding check | Release loading accepted a truncated noncanonical empty-list length. |

Sim mutations used `cargo test -p terri-sim <focused-filter> -- --nocapture`;
decoder mutations used `cargo test -p terri-wasm --release chronotype_v5_rejects
-- --nocapture`. All exited with code 1 from assertions, not compile failures.
The restored focused runs passed 9 chronotype tests, 21 circadian tests and
15 release save-version tests. Full integration results are recorded separately.

## Local integration checks

The full `cargo test --workspace`, `cargo fmt --all -- --check` and
`cargo clippy --workspace --all-targets -- -D warnings` passed. An additional
complete-malformed-row test then passed with all 16 release save-version tests;
lint passed again after that addition. Native Windows and WASM dependency trees
for all three simulation crates contain no web dependencies.

All 182 sprite/model tests and atlas reproducibility passed. `wasm-pack build
crates/terri-wasm --target web --out-dir ../../web/src/wasm`, web typechecking,
all 1,247 web tests and the production Vite build passed. Before rebuilding,
typechecking correctly failed on stale generated exports from the prior main.
The first rebuilt web run found two pinned byte fixtures that omitted the new
tail byte. Their offsets and malformed cuts were updated without changing the
corruption targets; the rerun passed. Independent review approved both the
implementation and supplemental boundary/fixture changes.

The displayed browser on isolated origin `127.0.0.1:5197` created a night-owl
housemate named Sleep check, saved, reloaded and retained all four people.
The saved-world status appeared and normal activities continued. The review
observed sleep status at Day 2 08:14 with energy 53, then a cooking chain at
11:54 with energy 97.7. Captured images show the loaded household and the later
cooking state, not every intervening animation frame. Cancel left the roster
unchanged. The owned tab and server were closed.

See `[A-sleep-schedule-lifecycle]` in `docs/alpha-feel-notes.md` for the visual
findings and a development-server warning requiring separate follow-up.

After integrating main `29d128f3` (the office-chair update), formatting, lint,
all 1,208 Rust tests, rebuilt WASM, typechecking, all 1,252 web tests and the
production build passed. The changed sprite suites passed again (89 generator
tests and 8 office tests); together with the unchanged suites, 188 asset tests
are covered. Atlas reproducibility passed for 1,250 sprites. The production
bundle loaded the previous test save with four people and continued running.
`production-loaded.jpg` records that integrated build. Its brief browser error
query was empty; this does not resolve the earlier development-server warning.
