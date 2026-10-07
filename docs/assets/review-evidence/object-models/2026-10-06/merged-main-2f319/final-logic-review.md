**Findings**

1. Blockers: none found in the reviewed native/content/save/web logic.
2. Lower-risk suggestions: none concrete enough to report as actionable within this bounded review.

**Inspected**

1. Migration and save safety: legacy book import grants the five starter titles only through the legacy path, sets `migration_granted`, and current V6 restore validates book, reading, seating, and edge-world state before accepting the save. See [books_migration.rs](D:/VIBES/.worktrees/f24d/terrilives/crates/terri-sim/src/save/books_migration.rs:31), [domain.rs](D:/VIBES/.worktrees/f24d/terrilives/crates/terri-sim/src/books/domain.rs:323), and [v6.rs](D:/VIBES/.worktrees/f24d/terrilives/crates/terri-sim/src/save/v6.rs:99).
2. Reading ownership, novelty, and returns: title memory is keyed by sim and title, stable taste uses fixed domains, and preemption converges through return or reservation release. See [domain.rs](D:/VIBES/.worktrees/f24d/terrilives/crates/terri-sim/src/books/domain.rs:570), [reading.rs](D:/VIBES/.worktrees/f24d/terrilives/crates/terri-sim/src/reading.rs:265), and [reading.rs](D:/VIBES/.worktrees/f24d/terrilives/crates/terri-sim/src/reading.rs:413).
3. Physical claims and moving furniture: active non-shelf targets are refused as in use, shelf moves stage reading reroutes before commit, and commit applies the reading move plan after the object placement revalidation. See [placement.rs](D:/VIBES/.worktrees/f24d/terrilives/crates/terri-sim/src/placement.rs:453), [reading/placement.rs](D:/VIBES/.worktrees/f24d/terrilives/crates/terri-sim/src/reading/placement.rs:21), and [placement.rs](D:/VIBES/.worktrees/f24d/terrilives/crates/terri-sim/src/placement.rs:552).
4. Web behavior: object descriptions toggle only on summary click, with hover/focus covered by tests; touch pan suppresses only the next click and resets on a new gesture. See [object-identity.ts](D:/VIBES/.worktrees/f24d/terrilives/web/src/ui/object-identity.ts:33), [object-identity.test.ts](D:/VIBES/.worktrees/f24d/terrilives/web/tests/object-identity.test.ts:44), and [input.ts](D:/VIBES/.worktrees/f24d/terrilives/web/src/input.ts:1415).
5. Durable receipts checked: upstream native verification, source receipt, merged affected web log, return boundary proof, browser recovery proof, and merged receipt. The return proof records `pass: true`, unchanged title memory, and one restored shelf copy.

**Unverified**

1. Sofa/fetch/shelve art and geometry remain unaccepted by instruction.
2. Player-facing copy remains proposed pending owner approval.
3. I did not start servers, mutate Git state, or rerun full passing suites. I inspected code and existing receipts only.
4. `receipt.json` still contains known stale wording, per your prompt; I did not count that as a logic finding.

I recommend publishing the native/web logic from this review scope, conditional on the pending art approval, copy approval, and the planned stale receipt text correction.

**Next step**: No user action is needed for the logic review; the remaining gate is owner acceptance of art and copy.

