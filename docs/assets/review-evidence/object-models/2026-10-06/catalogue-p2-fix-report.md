# Scoped catalogue P2 corrections

Both reviewed buying-fact defects are corrected in source. Raw saved roles, save identity and runtime food behavior remain unchanged. Production ownership is released to the renderer worker. The parent requested stopping before another standalone module build; the combined renderer/facts build must regenerate the live projection.

1. `crates/terri-sim/src/recipe_actions.rs` adds `usable_buying_role`, which requires an actual current recipe or physical-seat route. The inactive `eating_surface` tag no longer claims desk functionality. A renamed model with that same tag also remains inactive; adding an actual routed use makes it eligible. No model-ID exception was added.
2. `recipe_buying_requirements` uses actual managed dining to separate required fridge/preparation counter/stove from optional table/chair seating. Counter fallback is preserved. `crates/terri-wasm/src/browser_books.rs` projects those facts, with a new optional-requirements tail in the browser-only action tuple. `web/src/books/codec.ts` decodes and validates that tail, and `web/src/ui/buy-tool-controls.ts` renders required and optional facts separately.
3. The source-derived 30-model/24-title table is regenerated at `.tmp/object-models/catalogue-balance-and-copy-review.md` and frozen in `catalogue-p2-fix-package/`. Its desk row makes no food claim, the stove row states minimum required hardware costs 570 Funds, and dinner lists optional seating with counter fallback. The delivery report retains 690 as the exact studied configuration, not a minimum. The table explicitly says the fresh combined WASM export is pending; it does not pretend the old module contains these corrections.
4. Changed production paths: `crates/terri-sim/src/recipe_actions.rs`; top fact-helper exports only in `crates/terri-sim/src/lib.rs`; `crates/terri-sim/src/domestic/tests.rs`; `crates/terri-wasm/src/browser_books.rs`; `web/src/books/codec.ts`; `web/src/ui/buy-tool-controls.ts`; `web/tests/book-codec.test.ts`; `web/tests/purchase-facts.test.ts`. The captured `sim/lib.rs` also contains the parent's disjoint render work; that is outside this fact repair.

| Focused command | Receipt | Result |
| --- | --- | --- |
| `cargo test -p terri-sim buying_facts -j 2 -- --test-threads=2` | `catalogue-p2-sim.txt` | PASS, exit 0, one generic role/required-versus-optional/read-only control. |
| `cargo test -p terri-wasm browser_ -j 2 -- --test-threads=2` | `catalogue-p2-wasm.txt` | PASS, exit 0, eight native metadata/codec controls, including independent literal optional-tail bytes and unchanged save bytes. |
| `npm test -- --maxWorkers=1 tests/book-codec.test.ts tests/purchase-facts.test.ts` | `catalogue-p2-web-unit.txt` | PASS, exit 0, nine codec/facts tests, including truncation and optional seating/fallback wording. |
| `npm run typecheck` | `catalogue-p2-typecheck.txt` | PASS, exit 0. |

An own module build launched just before the parent's stop instruction was cancelled through its verified own process tree. A pending native export was also stopped at the parent's request; its temporary test writer was removed. Neither is claimed passing or required for this scoped handoff. No study, browser or broad suite was rerun. No own process remains.

The small fix package contains nine source/artifact paths and the focused receipts. The review JSON applies the native-tested corrections to the prior frozen projection, retaining other values. The parent must replace it with the final combined producer output before final publication review.

**Next steps**: Fresh scoped review of these two fixes, then the renderer owner builds the combined module and validates the actual metadata/store output. No further catalogue worker task is pending.
