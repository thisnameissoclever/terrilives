# Implement radial object actions and automatic books

> Execute natively in this chat after plan approval, then obtain one fresh-context review of the complete branch. Use the executing-plans and test-driven-development skills during implementation.

**Goal:** Give new households three distinct books, make book management automatic, apply the owner's reading order, and expose object actions through the approved radial menu.

**Architecture:** Rust owns book choices, placement, prices, transactions, reading eligibility and saved commands. The browser renders native quotes and capabilities, invokes those commands, and opens the existing Build controller on the clicked object. The menu reads the rendered-object anchor rather than creating another owner of world position.

**Tech stack:** Existing Rust workspace, WebAssembly bridge, TypeScript interface, Vite and Vitest. No added or upgraded dependencies.

**Specification:** [Radial object actions and automatic books](../../specs/2026-10-09-radial-object-actions-and-automatic-books.md).

**Design base:** `faed1ccb192a027f80fd41970b967c64c2ebbea5`. Branch: `twcx/radial-object-actions-books`. Reconcile newer main changes before delivery, particularly interaction-index, seating and rendering changes. Do not overwrite the approved sofa default action or per-pixel-depth design.

## Global constraints

1. Implement the radial mockup and the specification's stated defaults. Do not add title or destination choices, tutorial notices or permanent upgrade text.
2. Keep all historical copies, memories, slot reservations and old command codes. Starter grants belong only to fresh-household construction.
3. Quotes are native, read-only and exact. Refuse stale transactions before changing Funds or ownership.
4. Do not use browser randomness, wall time or the global simulation random stream for commerce previews or slot allocation.
5. Use one worker for local web tests. Do not overlap heavy builds and suites under memory pressure; stop only task-owned processes.
6. Use the existing artwork, prices, resale policy, seat admission and interaction indices. No content-price or rendering-art rewrite is part of this plan.
7. Complete implementation, local checks, independent review, commit, push, merge, synchronization, deployment and live verification after implementation approval.

## Review focus

1. Old headers containing new command tags must fail; extending a shared enum must not expand historical acceptance.
2. Borrowed copies retain reserved homes. A visually empty slot is not necessarily free capacity.
3. Menu refreshes and current-save loads must preserve bytes, hash and simulation randomness.
4. Read on one bookcase must still prefer an unfinished reachable title on another, without multiplying probability tickets.
5. No selected Sim, decorative objects, long menus, enlarged text and viewport edges must retain the build action and usable radial controls.

## Task 1: Native commerce and versioned commands

**Files:** `crates/terri-core/src/books.rs`, `command.rs`, `save.rs`, `save_v6.rs`; new `save_v7.rs` and `save_v8.rs`; `crates/terri-sim/src/books/domain.rs`, `commands.rs`, `lib.rs`, `save/v6.rs`; `crates/terri-wasm/src/lib.rs`, `browser_books.rs`; `web/src/storage/save-header.ts`, `save-worker.ts`; existing native book/save/storage tests.

**Interfaces produced:**

```rust
// New records in terri_core::books; preserve existing saved-library fields.
pub struct BookPurchaseQuote {
    pub title: String,
    pub price: u32,
    pub home: ShelfSlot,
    pub next_copy_id: u32,
}
pub struct BookSaleQuote {
    pub copy: BookCopyId,
    pub shelf: BookShelfId,
    pub price: u32,
}
// Append after the frozen Purchase=0, Transfer=1 and Read=2 variants.
AutoPurchase { quote: BookPurchaseQuote }, // code 3
Sell { quote: BookSaleQuote },            // code 4
Recover { copy: u32 },                   // code 5
```

Add the following methods, returning existing book errors plus `stale_quote` and `no_shelf_space` refusal codes:

```rust
fn quote_purchase(&self, funds: Funds, world: &BookWorld<'_>) -> Result<BookPurchaseQuote, BookError>;
fn purchase_quoted(&mut self, quote: &BookPurchaseQuote, funds: &mut Funds, world: &BookWorld<'_>) -> Result<BookCopyId, BookError>;
fn quote_sale(&self, shelf: BookShelfId, world: &BookWorld<'_>, resale_fraction: f32) -> Result<BookSaleQuote, BookError>;
fn sell_quoted(&mut self, quote: &BookSaleQuote, funds: &mut Funds, world: &BookWorld<'_>, resale_fraction: f32) -> Result<BookCopyId, BookError>;
fn shelve_inventory(&mut self, world: &BookWorld<'_>) -> Result<Vec<BookCopyId>, BookError>;
fn recover_automatically(&mut self, copy: BookCopyId, world: &BookWorld<'_>) -> Result<BookCopyId, BookError>;
```

The quote wire envelope is `(1u8, Result<Quote, String>)`, where the String is a refusal code. Add WebAssembly projections `bookPurchaseQuote(): Uint8Array` and `bookSaleQuote(shelf): Uint8Array`; staging exports `buyAutomaticBook(quoteBytes)`, `sellBook(quoteBytes)` and `recoverBook(copy)` return whether the request was admitted to the command queue. Staging decodes the complete bounded envelope and admits only a successful quote. Runtime commands store the typed quote. Retain current explicit-title APIs.

Use the existing native `world(0)` fixture for this first read-only regression:

```rust
#[test]
fn automatic_purchase_quote_does_not_change_book_state() {
    let library = BookLibrary::new(43);
    let before = library.state().clone();
    let first = library.quote_purchase(Funds(100), &world(0)).unwrap();
    assert_eq!(library.quote_purchase(Funds(100), &world(0)).unwrap(), first);
    assert_eq!(*library.state(), before);
    assert!(first.home.slot < 24);
}
```

- [ ] Add native tests before implementation: reserved-home counting; unequal shelf counts; full selected case with capacity elsewhere; no case; every case full; insufficient Funds; duplicate preference; physically shelved sale eligibility; borrowed-copy refusal; exact payout; stale quotes; and title-memory preservation after selling the last copy.
- [ ] Define stable, separately tagged 64-bit hash domains for title choice, equal-count shelf choice and free-slot choice. Inputs are `taste_seed`, `next_copy_id` and sorted candidate identities. Use integer wrapping arithmetic; do not use process-seeded hashers or `SimRng`. Preview calls cannot mutate any library field.
- [ ] Make a purchase quote select the title, price, least-reserved available case and seeded free slot. Revalidate the complete quote at drain time; if it differs, emit `stale_quote` and refresh the browser quote without charging. Select sales using the specification's duplicate/unfinished/copy-id order and the existing `placement::sale_value` policy.
- [ ] Commit commerce and Recover through the existing clone-library/clone-Funds transaction seam. Publish both only after the operation succeeds. Recovery prefers a valid retained home, otherwise the automatic allocator; it never takes a borrowed copy. Inventory placement only affects unborrowed inventory copies and does not charge Funds. Check payout addition against existing currency limits. Update feedback, enum matches, aggregate queue validation and command hashing. Preserve historical command formats, intent and execution order.
- [ ] Freeze three-variant historical book commands and exact V6/V7 snapshot records. Convert those validated records to current runtime types. Create an explicitly named V8 envelope, dispatch V8 to current validation, and keep V1 through V7 decoders explicit. Keep the library's saved fields unchanged.
- [ ] Bump native and browser current versions to 8 and add `terri-save-1.v7-backup.bin`. Existing backup maps remain intact. Stale well-formed queued operations can restore and later refuse; malformed record shapes, unknown identities and forged prices cannot restore.
- [ ] Test original command bytes and complete consumption; reject all three new variants under V6/V7 headers; round-trip V8 with pending operations; preserve combined command ordering and limits; prove failed loads preserve live bytes/hash/random state; prove V7 backups match original bytes.
- [ ] Run `cargo test -p terri-core -- --test-threads=1`, `cargo test -p terri-sim books:: -- --test-threads=1` and `cargo test -p terri-wasm book -- --test-threads=1`. Run `npm --prefix web test -- --maxWorkers=1 --reporter=default tests/save-worker.test.ts tests/save-store.test.ts tests/legacy-save.test.ts`.
- [ ] Commit the coherent native commerce and compatibility change after these targeted checks pass; do not push until its player notes and full release checks are ready.

## Task 2: Fresh-household gifts and automatic placement

**Files:** `crates/terri-sim/src/lib.rs`, `books/domain.rs`, `books/commands.rs`, `placement/sale.rs` and the existing successful furniture-purchase path; native constructor, inventory, shelf-sale and bookcase-render tests.

**Consumes:** Task 1's native allocation and transaction rules. **Produces:** A three-copy fresh household and automatic placement of unborrowed inventory copies at normal command drains.

```rust
// Explicit fresh-game starter set; historical migration keeps all five.
const NEW_HOUSEHOLD_STARTER_COUNT: usize = 3;
// In the fresh-household constructor, after spawn_household:
// grant one copy of each of MIGRATION_STARTER_TITLES[..3], without charging.
fn grant_new_household_starters(&mut self, world: &BookWorld<'_>) -> Result<Vec<BookCopyId>, BookError>;
```

- [ ] Test the real fresh-household constructor for exactly three distinct titles, unchanged Funds and distributed free slots. Test low-level constructors and current restoration for no grant. Keep positive controls for the five-book historical migration and repeated loads.
- [ ] Add a fresh-only grant after lot/library/household initialization. Validate that all three titles exist and the fresh library has no issued copies before changing it. Use seeded automatic placement for each gift; overflow gifts remain inventory copies. Leave the historical `migration_granted` marker's meaning intact. Do not call this grant from `BookLibrary::new`, generic adoption or historical conversion.
- [ ] Add a named automatic-inventory policy after the ordinary command drain, including the paused drain. Invoke Task 1's inventory-placement method only when unborrowed inventory copies and free shelf capacity exist. This covers relevant bookcase additions/removals and commerce, and allows imported inventory to settle at the first normal drain. Do not run the policy inside restoration or add commands to a full historical queue.
- [ ] Fill the least-reserved available case for each incoming copy. Keep existing valid shelf homes, carried copies, dropped copies, active returns and their reservations fixed. Recovery of a dropped copy uses its retained available home when valid, otherwise the automatic allocator.
- [ ] Test case addition, sale and insufficient capacity with borrowed reservations. Verify no duplicate copy IDs, no lost title memories and deterministic continuation across save/load. Check new grants across all four bookcase facings using existing slot/render mappings.
- [ ] Load a valid full historical command queue with inventory. Verify conversion preserves the exact pending count and ordering; then drain and verify the new placement policy applies without exceeding the command limit. Verify a current V8 load itself remains byte-identical before any normal drain.
- [ ] Run the affected native book, constructor, placement and renderer tests. Manually remove reserved-home counting and the fresh-only grant boundary in turn; require the corresponding tests to fail, then restore the exact mechanism.
- [ ] Commit the fresh-household and arrival-placement change after the targeted checks pass.

## Task 3: Hard reading priority across reachable shelves

**Files:** `crates/terri-sim/src/reading/planning.rs`, `reading.rs` and existing reading/autonomy tests; native book projections and `crates/terri-wasm/src/browser_books.rs`.

**Consumes:** Existing saved `TitleMemory`, legal routes and seat reservations. **Produces:** Shared automatic-choice behavior and a read-only preview for the browser.

Expose `automaticReadingChoice(person, object, action): Uint8Array` as `(1u8, Option<(String, String, f32)>)`, containing title id, display title and progress percent. Decode only complete version-1 envelopes, and reject progress outside 0 through 100. A missing choice disables Read; it does not produce a title-picker explanation.

```text
unfinished = progress_ticks + progress_fraction > 0 and current pass incomplete
unread = no completed pass and no current progress
rank:
  unfinished: latest last_read_tick first
  unread: existing interest and route scoring
  completed: oldest last_read_tick, then lowest effective repeat penalty
```

- [ ] Add a regression where a preferred unfinished book has less utility than an unread book and sits on another case. The unfinished book must win for both automatic directed Read and autonomous reading.
- [ ] Add unread-over-finished and oldest-finished tests, plus multiple unfinished titles, repeat-penalty ties, fractional progress, inaccessible copies, borrowed copies and current save/load continuation.
- [ ] Widen shelf-origin enumeration to reachable household shelves while keeping the clicked reading object/action and a selected reading chair as the destination context. Reuse native path, shelf-access, seat, privacy and return eligibility.
- [ ] Apply hard title priority after legal availability and before weighted selection in the common representatives seam used by `best_plan` and `choose_plan`. Preserve the existing preference and seat chooser inside the best group. Do not make reading mandatory over other needs.
- [ ] Deduplicate equivalent title/action/seat opportunities so extra bookcases do not create extra outer autonomy tickets. Test this with a second equivalent source case.
- [ ] Add native `automaticReadingChoice` projection with title ID/name and progress, using the same eligibility and ranking without drawing randomness. Repeated previews must preserve save bytes, world hash and random state.
- [ ] Run targeted native reading/autonomy tests. Remove the hard priority filter and widen neither source enumeration nor grouping in separate mutations; require each corresponding regression to fail, then restore it.
- [ ] Commit the reading-priority change after the targeted checks pass.

## Task 4: Radial menus and simplified book controls

**Files:** `web/src/input.ts`, `main.ts`, `bridge.ts`, `books/codec.ts`, `books/results.ts`, `ui/object-menu.ts`, `ui/keyboard-target.ts`, `ui/placement-actions.ts`, `ui/build-tools.ts`, `ui/builder-controls.ts`, `index.html`; new `ui/object-menu-layout.ts` and `ui/book-commerce.ts`; retire `ui/book-tool.ts` and `ui/book-tool-controls.ts` after the reference scan. Use existing input/menu/keyboard/book/placement-action test files.

**Consumes:** Task 1's quotes and commands and Task 3's automatic-read preview. **Produces:** The approved radial menu, direct Build selection, and compact book commerce in Build.

```ts
// Append menu actions; preserve existing interaction indices and action shapes.
type ObjectCommerceAction =
  | { kind: 'build'; object: number }
  | { kind: 'buy-book'; quote: BookPurchaseQuote }
  | { kind: 'sell-book'; quote: BookSaleQuote }
  | { kind: 'recover-book'; copy: number };
// Menu entries gain presentation capabilities, not new simulation ownership.
interface ActionPresentation {
  enabled?: boolean;
  price?: number;
  secondary?: string;
}
```

Define the browser quote types from the native wire records: preserve title, price, home shelf/slot, next-copy id, sale copy and sale shelf. Shelf IDs decode as bigint; prices, slots and copy IDs decode as bounded numbers. Keep the complete native quote bytes for staging through the facade. Add a versioned quote codec and malformed/overflow rejection tests. `BookCommerce` owns pending submission and quote refresh only; native code owns every eligibility and price decision.

- [ ] Test right-clicking decorative furniture, a bookcase and an appliance with no selected Sim. The build action must be enabled; Sim actions must be disabled. Test the same path through keyboard targeting and long press. Do not merely remove the early return without separating actor-dependent actions.
- [ ] Handle build and commerce actions before selected-Sim dispatch. Close the menu, enter the existing Furniture tool through its controller/hooks, and call `builder.select(object)`. Check the object still exists. While a modal is open, disable the build action and close the radial menu through the existing modal owner; never dismiss the modal on the player's behalf. Do not move the object or change the selected Sim when opening Build.
- [ ] Create pure radial layout calculation using the existing rendered-object anchor and viewport keep-outs. Render individual native buttons and click-only identity at the center. Preserve data-to-action mapping when paging long menus. Use six slots per page; more than six actions become five plus More actions, with Back on subsequent pages. Keep a separate center Close control.
- [ ] Test all viewport edges, 390 by 844, short landscape and 200 percent text. Require at least 44px touch targets, no clipping, no button overlap, and preserved keyboard focus after page changes. Escape/outside click, world replacement and invalidation must discard stale actions. Only buttons and identity own pointer input.
- [ ] Put each buy/sell price inside its own button beneath the label, including existing furniture Buy actions. Prefix the existing grouped Funds format with `$`, matching the approved mockup; the underlying currency and prices are unchanged. Preserve accessible names with actual price and action. Never draw the price in a separate badge or synthesize it from mockup amounts.
- [ ] Remove Books navigation, title/destination selectors, transfer lists, title-specific menu rows and their tutorial prose. Keep only book count and Buy/Sell controls for the selected bookcase in Build. Generic Read invokes existing native automatic reading; use Task 3's preview as its optional secondary line.
- [ ] Keep the existing explicit-title bridge APIs for compatibility and tests. Replace old UI-tool tests with commerce-controller tests for pending operations, stale quotes, rejected transactions, non-selected Sim use and load reset. Retain decoder, ownership, migration and malformed-save regressions.
- [ ] Run the focused web input, menu, keyboard, book and contextual-price tests with one worker, then `npm --prefix web run typecheck`.
- [ ] Commit the coherent menu and book-control change after the focused tests and typecheck pass.

## Task 5: Documentation, acceptance and delivery

**Files:** `docs/player-visible-strings.md`, `GAME-SYSTEMS.md`, `ARCHITECTURE.md`, relevant book/build specs and roadmap entries, the current delivery-date entry in `docs/changelog/`, and dated evidence under `docs/assets/review-evidence/radial-books/`. Preserve other contributors' same-day notes.

- [ ] Complete an impact scan for retired UI-tool symbols, title-choice descriptions, version-7-current claims, starter-household rules, price rendering and menu-selection requirements. Update current guidance; leave historical evidence intact.
- [ ] Apply the writing and changelog skills. Public notes describe three starter books, easier automatic book commerce, reading preference and direct object Build access. Keep command/version/test details in internal evidence.
- [ ] Run `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace -- --test-threads=1`. Build WebAssembly using the existing wasm-pack command. Do not overlap the heavy native checks with the full web suite.
- [ ] Run `npm --prefix web test -- --maxWorkers=1 --reporter=default`, TypeScript checks and the production build. Bound the Node heap to 8 GiB if host memory permits; check available host memory first. Run changelog tests/generation, document-id checks and affected asset tests. Record commands, relevant output, exit codes and PASS/FAIL/SKIPPED verdicts.
- [ ] In isolated browser storage, verify a new game has three distinct books; enter Build on a decorative object and bookcase without a selected Sim; compare radial placement against the approved mockup; test automatic buying into another case, exact displayed charges, automatic sales, full capacity, dropped-book recovery, keyboard/long press and enlarged text. Check bookcase rendering in all facings.
- [ ] Seed historical fixtures on a blank page before the app starts. Verify startup and manual load separately, inspect the exact input version at manual Load, check V7 recovery bytes, queued V8 commands and no repeated starter grants. Test unfinished-on-another-case, unread and completed-title choices through real actions.
- [ ] Close task-owned game pages in finally blocks and stop task-owned preview servers. Obtain one fresh-context whole-branch review against the specification and fix actionable findings; rerun only checks affected by fixes.
- [ ] After approved implementation passes required local checks, commit and push this branch with notes and evidence, create/attach the PR, merge under the plan's delivery authorization, verify the remote merge, synchronize this checkout to remote main and leave a clean working tree. Do not wait for duplicate remote checks without a specific new failure or enforced protection.
- [ ] Verify the exact deployed revision and the executed Pages deploy step. Inspect the public game in isolated storage for the new starter count, radial Build access and automatic commerce. Report local checks, merge and publication separately. Do not close the conversation while any required outcome remains unverified.

## Handoff

Only the design references and planning documents are changed at this stage. Review the pricing, capacity, inventory-arrival and finished-book ordering defaults before implementation. Native execution with one final independent review is recommended because command, save, reading and interface changes share tightly coupled contracts.
