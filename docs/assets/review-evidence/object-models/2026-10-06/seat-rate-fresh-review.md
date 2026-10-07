## Real Goal

Secondary media seating should pay the physical seat’s own Comfort once. Ordinary seat hardware supplies Comfort. Book-reading bonuses stay in reading and do not leak into TV/radio media.

## Diagnosis Check

[D1] The fourth literal should not be another expectation tweak. The failing `sofa` case is using the shipped `sofa` model, whose authored type is `ottoman`, not the `sofa` object type and not the dining-chair type. See `content/objects.toml:671-679`.

[D2] The shipped `sofa` model inherits `ottoman.lounge`, which comes from the `lounge` template: Comfort `20.0` over `40` ticks. See `content/objects.toml:131-138` and `content/objects.toml:317-325`.

[D3] The `9 / 30` expectation is from `dining_chair.sit`, not from the `sofa` model or the `ottoman` type. See `content/objects.toml:412-426`.

[D4] The rate helper is not reading a named “Sit” action. `CompiledObject::seat_comfort_rate()` scans all non-book-reading interactions, takes positive Comfort divided by `duration_ticks`, then folds with `seat_comfort_per_tick`. See `crates/terri-data/src/pack.rs:461-473`.

[D5] The need path pays that rate from the claimed physical chair, not from the television’s media action. `seat_rate()` validates a media lease, resolves `lease.chair`, reads that object’s `seat_comfort_rate()`, and `tick()` fills Comfort with it. See `crates/terri-sim/src/need_interactions.rs:120-156` and `crates/terri-sim/src/need_interactions.rs:329-398`.

[D6] The fixture is not mutating content for this test. It calls `Sim::new_with_lot`, spawns the requested `seat_kind` from the current pack, queues a media intent against the device, and later calls `need_interactions::tick()` directly. See `crates/terri-sim/src/seating/tests.rs:94-116` and `crates/terri-sim/src/seating/tests.rs:625-680`.

## What Was Taken As Fixed But Is Not

[F1] “`sofa` means sofa type” is false here. `sofa` is the model id for the Low Profile ottoman. The long sofa is the model whose type is `sofa`. See `content/objects.toml:671-679` and `content/objects.toml:761-769`.

[F2] “Ordinary Sit9/30” is fixture-misidentified. It is a dining-chair override, while this fixture’s `sofa` model inherits ottoman lounge `20/40`.

[F3] The production default and fixture-specific path are separate. This test’s fixture uses production compiled content; the only fixture mutation is runtime state: it inserts neutral personality, sets needs to 30, and directly invokes the contextual need tick.

## Recommendation

[R1] Correct the test by deriving the expected sofa rate from resolved non-book authored interactions for the spawned seat, while separately asserting the authored evidence that makes it non-oracular: model `sofa` has type `ottoman`, its inherited non-book action has Comfort `20.0` and duration `40`, and its reading action is marked `book_reading` and ignored. Do not use `seat_comfort_rate()` itself as the expected oracle. A good independent causal assertion would fail if `seat_comfort_rate()` stopped filtering `book_reading`, stopped applying inherited template actions, or started reading only a literal action named `sit`.

## What I Could Not Determine

[C1] I did not run tests, builds, Git, a server, or any mutation. This is a read-only ruling from source and the supplied logs. The logs confirm the same `sofa` failure after the last two attempts at `.tmp/object-models/upstream-2f319c3b-20261006/seating-focused.log:55-65` and `.tmp/object-models/upstream-2f319c3b-20261006/focused-repairs.log:95-105`.

**Next step**: No user action is needed for this review; the editor should stop changing literals and add an authored-resolution assertion around the ottoman-inherited lounge rate. 
