# Domestic interaction verification

Local evidence for the meals and cleanup changes in `twcx/meals-and-cleanup`.
The owner authorized merging the corrected work. These receipts establish
local verification; publication and deployment are reported separately.

The owner rejected the original oversized stacks. `meal-dishes.png` and
`washing.png` preserve that rejected attempt and are not acceptance evidence.
The corrected captures below supersede them. A fresh-context adversarial
visual reviewer passed the replacement after the wash pose was corrected.

## Behavior and compatibility

The simulation tests exercise every tick of snack, meal, cleanup and shared
meal saves; all stages, actual counter and table locations, four simultaneous
diners at distinct places, the three-guest cap, exclusions, attributed dishes,
needs-adjusted willingness, once-per-entry randomness, directional annoyance,
cancellation, furniture sale protection, exclusive claims and malformed saves.
The WASM tests include real pre-change V5 meal and snack bytes, old-step mapping,
transactional rejection, and historical optional-field padding.

### Historical checks before current-main integration

The following table records the earlier feature revision. It does not describe
the final integrated tree; the final receipts appear below.

| Command | Result | Exit |
| --- | --- | --- |
| `cargo test --workspace -- --test-threads=1` | Core 105, data 266 plus 1 integration, simulation 670, WASM 134: all 1,176 passed | 0 |
| `cargo test -p terri-sim domestic::tests -- --test-threads=1` | 20 domestic tests, including gathering and final save-validation guards | 0 |
| `cargo test -p terri-sim gathering_yields -- --test-threads=1` | Final restricted-seat regression passed after the full suite | 0 |
| `cargo test -p terri-wasm -- --test-threads=1` | 134 passed, including previous-save bytes and dynamic labels | 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | Passed with no warnings | 0 |
| `cargo fmt --all --check` | Passed | 0 |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | Release browser module built | 0 |
| `npm test -- --maxWorkers=1` in `web/` | 82 files, 1,236 tests passed | 0 |
| `npm run typecheck` in `web/` | Passed | 0 |
| `npm run build` in `web/` | Production bundle built | 0 |
| `python -B -m unittest discover -s assets/models/sims/sim-01` | 29 passed; complete registered clips, unchanged rig, palette geometry and camera proof | 0 |
| `python -B -m unittest discover -s assets/sprites/gen` | 86 passed, including support geometry and preceding atlas pixel/index guards | 0 |
| `python -B -m unittest discover -s assets/models/domestic` | Passed: all 192 cleanup frames, palette geometry, registration, source and saved-model hashes | 0 |
| `python assets/sprites/gen/build.py --check` | Reproducible 1,533-sprite atlas, 8,192 by 4,919 | 0 |
| `python check-doc-ids.py` | Passed | 0 |

## Earlier deliberate regression checks

Each check deleted the mechanism below, ran the named test, observed its actual
assertion failure, and restored the original file bytes in a `finally` block.
The script compared the full restored bytes before moving to the next mutation.
These are targeted mutation checks; a full remote mutation sweep was not run.
The transcripts and hashes below belong to the earlier behavior implementation,
before the visual repair and later scheduler tests. Current passing counts are
in the table above; these historical counts do not describe the final tree.

### hash

Removed mechanism:

```rust
domestic::hash(&self.world, &mut hasher);
```

Command: `cargo test -p terri-sim the_hash_observes_domestic_identity_memory_claims_and_quality -- --test-threads=1`. Exit: `101`.

Actual failure:

```text
---- domestic::tests::the_hash_observes_domestic_identity_memory_claims_and_quality stdout ----

thread 'domestic::tests::the_hash_observes_domestic_identity_memory_claims_and_quality' (82904) panicked at crates\terri-sim\src\domestic\tests.rs:611:9:
assertion `left != right` failed: hash observes domestic field 0
  left: 331991111031127688
 right: 331991111031127688
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace


failures:
    domestic::tests::the_hash_observes_domestic_identity_memory_claims_and_quality

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 660 filtered out; finished in 0.00s

error: test failed, to rerun pass `-p terri-sim --lib`
```

Restoration: byte-identical; SHA-256 `d1bd0fc46ae12731453f8000757cd8efca7a88babff4f21a003f15dbd0031fea`.

### entry

Removed mechanism:

```rust
if entered
            && !piles.is_empty()
```

Command: `cargo test -p terri-sim a_visitor_draws_once_per_entry_at_one_fifth_of_own_willingness -- --test-threads=1`. Exit: `101`.

Actual failure:

```text
---- domestic::tests::a_visitor_draws_once_per_entry_at_one_fifth_of_own_willingness stdout ----

thread 'domestic::tests::a_visitor_draws_once_per_entry_at_one_fifth_of_own_willingness' (15844) panicked at crates\terri-sim\src\domestic\tests.rs:544:9:
assertion `left == right` failed: remaining in the room does not roll again
  left: SimRng { state: 14678909342070756876, inc: 1 }
 right: SimRng { state: 13885033948157127959, inc: 1 }
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace


failures:
    domestic::tests::a_visitor_draws_once_per_entry_at_one_fifth_of_own_willingness

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 660 filtered out; finished in 0.01s

error: test failed, to rerun pass `-p terri-sim --lib`
```

Restoration: byte-identical; SHA-256 `36aa6c78d25b34aec5f036a47eabc6e21f99061800d4c9f5d4c2a70c6500f3ad`.

### wash

Removed mechanism:

```rust
visit.seen.retain(|id| !task.dishes.contains(id));
```

Command: `cargo test -p terri-sim cleanup_collects_each_surface_and_washes_only_its_claimed_dishes -- --test-threads=1`. Exit: `101`.

Actual failure:

```text
---- domestic::tests::cleanup_collects_each_surface_and_washes_only_its_claimed_dishes stdout ----

thread 'domestic::tests::cleanup_collects_each_surface_and_washes_only_its_claimed_dishes' (66580) panicked at crates\terri-sim\src\domestic\tests.rs:237:14:
cleanup saves load, including washing completion: InvalidValue
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace


failures:
    domestic::tests::cleanup_collects_each_surface_and_washes_only_its_claimed_dishes

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 660 filtered out; finished in 1.03s

error: test failed, to rerun pass `-p terri-sim --lib`
```

Restoration: byte-identical; SHA-256 `36aa6c78d25b34aec5f036a47eabc6e21f99061800d4c9f5d4c2a70c6500f3ad`.

## Played browser evidence

The task-owned localhost game used the release WASM module with audio disabled.
Existing public bridge ticks advanced the actual simulation between actions;
the real WebGPU renderer produced these captures.

1. [Corrected meal](corrected-meal.png): a normal-scale used plate supported by
   the dining table and a preparation bowl on the counter. The plate is modeled
   at 0.30 world units across, with a thin ceramic rim.
2. [Pickup and carrying](corrected-carry.png): the collected pile has left its
   surface, and the carrier holds a plate. Surface and carried counts conserve
   the collected load until washing completes.
3. [Washing](corrected-wash.png), [ordered frames](wash-sequence.png) and
   [eight-frame motion](wash-motion.webp): the plate stays over the sink basin,
   with supporting hand contact and body occlusion throughout the wash motion.
4. [Completion](cleanup-complete.png): empty hands and clean dirty surfaces;
   prepared food is preserved rather than deleted with the dishes.
5. [All facings at 1x](four-facings-1x.png) and [2x](four-facings-2x.png): the
   actual renderer shows snack, preparation clutter with three food portions,
   and four table places in all four furniture directions.
6. [Near/far occlusion](occlusion-2x.png) and [night lighting](night-occlusion-1x.png):
   people and props sort correctly, with local light and sky shade applied.
7. [Four-person dining](shared-dining.png): the cook and all three invited
   guests actively eat at distinct places around the actual table. At tick
   687, all four report eating action 2 and activity 3. Their hunger rises
   from 30 to 100 by tick 817, with zero uncollected portions. Save/load
   succeeds with the same world hash afterward.

The independent visual reviewer inspected this evidence and passed support,
scale, separation, all-facing placement, near/far occlusion, carrying and the
corrected washing motion. The original shared-serving capture showed available
portions while guests were busy; it did not prove collection.
The final four-diner capture also passed visual review. It shows standing
shared dining, consistent with the existing eating pose, rather than seated
dining. No new intersections or unsupported surface props were found.

The shared-meal browser setup is reproducible with
`cargo run -p terri-wasm --example domestic_review -- web/review/domestic.save`.
It gives four friends stable needs, runs the real cooking chain to plating,
and places the three guests at legal non-food stations whose activities end
on the plating tick. The browser loads those bytes through the existing
bridge and advances ordinary simulation ticks. This controls the starting
conditions, not the claims, food payout or table assignment. A fresh local
test origin avoids obsolete intermediate prototype saves from earlier art
captures; shipped-save compatibility is covered by the frozen V5 byte tests.

The original 144 prepare/cook/wash exports retain the unchanged source rig.
The replacement cleanup set supplies 192 carry-walk, carry-idle and wash frames
in three shirt palettes and four facings. Original wash frames are superseded.
The rig SHA-256 remains
`919e8994cbf7510a4d9947f173abec8b41ac77d61f6e829bcf5981c8d2fcddce`.
Accepted atlas prefix pixels remain unchanged.

The fridge labels were checked at breakfast, tick 861 (14:21, lunch), and
tick 1061 (17:41, dinner). Native tests cover the exact boundaries.

Shared-meal scheduler tests complete a guest's non-food activity on the real
plating-completion tick. They cover immediate idle acceptance, queued orders,
critical rest, occupied tables, cancellation of the cook and later meals by
the same cook. A second adversarial reviewer confirmed the corrected batch
lifetime and transactional save guards without finding a remaining blocker.
The actual four-person test requires at least 30 ticks with all four diners
eating at distinct positions after gathering starts. Further checks replay
every gathering tick after save/load and release gathering for critical needs,
player interruptions, outside occupants and walls restricting table access.
Both task-owned browser pages were closed in a finally block, and the preview
server was stopped. The final game page reported no console errors.

Longer duration also lowers meals' score in the existing benefit-per-time
autonomy formula. The presentation guard directs a cook rather than depending
on a rare autonomous meal. Snacks remain the faster hunger option; no separate
meal-choice preference was added in this change.

## Documentation coordination

The needs/bathroom workstream in the separate `b770` checkout received the
ownership and integration details for this dedicated interpersonal document,
meal specification, V5 append, personality field and fingerprint bridge.
Its interactions are identified as separate workstream changes until integrated.
Other conversations' worktrees and documentation were not edited.

## Final integration and played evidence

The branch incorporates current furniture, autonomy, chronotypes, waiting
needs, command queues, authored activity bubbles, dock layout and packed
render batches through main revision `250c73b3`, followed by the changelog
integration at `416570d5`. The merge preserves main's
published sprite prefix and appends the domestic artwork after its icons.
The final atlas contains 1,700 sprites at 8,192 by 5,658 pixels.

The frozen `public-main-meal.hex` fixture was written and validated by the
native public-main implementation at `6d2499d4`. It retains three distinct
instinct values (0, 93, 47), chronotype offsets (-317, 629), and the exact random
generator state. Loading maps old eating step 3 to new step 5 with 31 work
ticks remaining. Round-trip and continued simulation hashes agree.

The final browser captures use the release WASM and actual renderer on an
isolated, task-owned localhost tab. The existing household bytes were restored
before closing the tab. No media preference was changed; reduced motion was
confirmed false.

1. [Shared dining](final-shared-dining.png): tick 619, all four Sims report
   eating action 2 and activity 3 at distinct table places.
2. [Used dishes](final-eaten-dishes.png): tick 749, all four hunger values are
   100 and no food portions remain. The table has four dirty units; the counter
   has five, including preparation before this meal.
3. [Carrying](final-carrying-dishes.png): tick 825, the cook walks with five
   collected units. Collection then includes the table pile.
4. [Wash phases 0](final-wash-0.png), [1](final-wash-1.png),
   [2](final-wash-2.png), and [3](final-wash-3.png): ticks 863, 868, 873 and 878,
   action 12, facing 4, nine carried units. The renderer selects sprite indices
   1485, 1486, 1487 and 1484. The plate and hands visibly move together over the
   basin. Earlier `integrated-wash-close-*` captures had insufficient frame
   separation and do not establish motion.
5. [Completed collection](final-cleanup-complete.png): tick 998, the cook has
   empty hands and the table is clear. Three counter units remain at this
   later checkpoint, so this is not evidence that the entire household has
   no new mess. Save/load succeeds and preserves the world hash.

A fresh-context adversarial review passed the final dining, used plates,
carrying, wash motion, hand contact, basin support and activity readability.
The final browser reported no warnings or errors. All task-owned game tabs
were closed. Static integrated fixtures also passed all four furniture
facings at 1x and 2x, near/far occlusion and night lighting.

The final [targeted regression receipts](integration-mutations.md) record
seven deliberate production mutations, their actual assertion failures,
exit codes and byte-identical restoration hashes. These are targeted checks,
not a completed remote mutation sweep.

### Final local check receipts

All results below apply after current-main integration and the activity fixes.
The full native run caught two stale assertions for authored handwashing;
those expectations were corrected and the complete workspace run passed.

| Command | Result | Exit |
| --- | --- | --- |
| `cargo test --workspace -- --test-threads=1` | PASS: core 107, data 269 plus 1 integration, simulation 753, WASM 151; 1,281 tests total | 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS: no warnings | 0 |
| `cargo fmt --all --check` | PASS | 0 |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS: release WASM | 0 |
| `npm test -- --maxWorkers=1` in `web/` | PASS: 118 files, 1,770 tests | 0 |
| `npm run typecheck` in `web/` | PASS | 0 |
| `npm run build` in `web/` | PASS: production bundle | 0 |
| `python -B -m unittest discover -s assets/sprites/gen` | PASS: 126 tests | 0 |
| `python -B -m unittest discover -s assets/models/sims/sim-01` | PASS: 29 tests | 0 |
| `python -B -m unittest discover -s assets/models/domestic` | PASS: 1 complete cleanup-export test | 0 |
| `python -B -m unittest discover -s assets/models/furniture -p 'test_*.py'` | PASS: 30 tests | 0 |
| `python -B -m unittest discover -s assets/models/kitchen -p 'test_*.py'` | PASS: 15 tests and hashed source-view checks | 0 |
| `python -B -m unittest discover -s assets/models/bathroom -p 'test_*.py'` | PASS: 8 tests | 0 |
| `python -B -m unittest discover -s assets/models/bedroom -p 'test_*.py'` | PASS: 13 tests | 0 |
| `python -B -m unittest discover -s assets/models/office -p 'test_*.py'` | PASS: 8 tests | 0 |
| `python assets/sprites/gen/build.py --check` | PASS: 1,700 sprites; 8,192 by 5,658 | 0 |
| `python -B -m unittest discover -s .github/scripts -p 'test_*.py'` | PASS: 23 CI guard tests after changelog integration | 0 |
| `node --test scripts/build-changelog.test.mjs` | PASS: 7 changelog tests | 0 |
| `node scripts/build-changelog.mjs` | PASS: generated public notes including this feature | 0 |
| `cargo tree -p CRATE --target TARGET` for core, data and sim on `x86_64-pc-windows-msvc` and `wasm32-unknown-unknown` | PASS: all six trees generated; no `wasm-bindgen`, `web-sys` or `js-sys` | 0 |
| `python check-doc-ids.py` | PASS: unique, allocation-free ids | 0 |

The corrected native and release-browser determinism fixture independently
produces `0x21c21e6232f46614`. A fridge without a preparation counter no longer
offers a physically impossible snack, so the old fridge-only golden changed.
The tests also keep cleanliness and self-preservation controls on distinct
trait keys while changing each value.

The task-owned preview server was stopped after closing the final tab. No
other conversation's browser page or server was stopped. Remote CI and the
full remote mutation sweep are separate from these completed local checks.
