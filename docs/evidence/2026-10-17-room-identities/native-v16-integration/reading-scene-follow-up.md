# Reading scene construction audit

## Real goal

[G1] Generate a current V16 browser review save showing two people actually reading together, with the intended standing and seated poses, in a real indoor room. The unchanged production loader must admit the complete save and preserve its state exactly.

## Diagnosis check

1. [D1] The immediate failure is an impossible book-fetch route. The frozen `reading-tool-better-way-source/relationship_qa.rs:173-182` places the bookshelf at `(2, 2)` and reading chair at `(3, 2)`. Its lines 219-226 correctly mark furniture footprints blocked. The bookshelf inherits exactly one authored pickup offset, `[1, 0]`, from `content/objects.toml:349-355`. `spawn_object` uses the model's base facing (`crates/terri-sim/src/lib.rs:2164-2180`), and relative base rotation preserves that offset (`crates/terri-data/src/pack.rs:530-539,601-602`). The sole pickup tile is therefore `(3, 2)`, inside the chair. `legal_shelf_contact` requires that tile to be walkable (`crates/terri-sim/src/reading.rs:60-82`; `crates/terri-core/src/grid.rs:233-240`). `route_to` rejects it, and `plans` skips both copies before constructing a destination (`reading.rs:100-117`; `reading/planning.rs:138-150`). This explains zero journeys, including zero Fetch stages, without invoking a timing problem.

2. [D2] Queue acceptance was mistaken for activity admission. `selected_order` checks person, object, action, title and queue capacity; it then inserts an order without testing routes (`crates/terri-sim/src/books/commands.rs:98-145,169-174`). `serve_intents` separately chooses a feasible reading plan and inserts `Blocked` when none exists (`systems/action.rs:731-780`). The exact observed result is two successful purchases and two accepted orders, both books still shelved and unborrowed, and no journey (`.local-build/v16-reading-03-run.log:7-12`). Another arrival predicate or longer wait cannot make the occupied pickup tile legal.

3. [D3] The corrected origin observer is appropriate but cannot repair admission. Execution installs `plan.target` and retains the player's distinct origin in `ReadingJourney` (`crates/terri-sim/src/reading.rs:220-240`). Shelf-origin reading can choose another reading seat; only a seat-origin order pins its seat (`reading/planning.rs:69-95`). With one available chair, issuing the shelf order first can let that person claim the chair and block the person intended to sit. Standing fallback is generated only when no usable seated destination exists (`reading/planning.rs:152-186`). Fixing shelf access alone does not establish the intended mixed poses.

4. [D4] The original fabricated activity was inconsistent with current persistence. An active reading target without a `ReadingJourney` is explicitly rejected (`crates/terri-sim/src/reading/persistence.rs:445-449`). Generic `Eating` cannot supply the missing owned copy, journey and seat claims. I verified this invariant, but did not independently recover the first two attempts' complete source revisions and error logs.

5. [D5] The scene also lacks its intended indoor context. Its explicit empty architecture is at frozen `relationship_qa.rs:107-112`. Current social room lookup removes Outside (`crates/terri-sim/src/room_regions.rs:10-21`). Shared reading requires a nonempty common room, distinct stations, accepted activity and proximity (`social_company.rs:49-77`), plus successful actual Read stages (`social_company.rs:303-316`). Empty architecture cannot demonstrate that behavior. The room spec explicitly preserves this distinction (`docs/specs/2026-10-17-room-identities.md:107`).

6. [D6] Missing skills, title eligibility and low utility are not the demonstrated cause. Both people already have `SimId`, Position and Needs (frozen `relationship_qa.rs:118-130`); admission defaults missing personality (`reading/planning.rs:58-67,128-136`). Skills enter the optional fumble calculation after travel (`reading.rs:491-510`). The selected title exists and both purchases succeeded. No content retuning or runtime rule change is needed to address the proven rejection.

## What was taken as fixed but is not

1. [F1] Object coordinates were treated as presentation details. They define access, seat endpoints and paths. Construct a usable layout first and derive the review from its admitted state. Preserve blocked furniture; move the chair away from the shelf's authored front.

2. [F2] Simultaneous queue insertion was treated as necessary. The scene needs simultaneous reading, which can be established by ordinary commands in a deliberate order. Let the chair reader reach Read first, then order the shelf reader. Pickup clears its transfer claim on entry to Travel (`reading.rs:472-483`); a real seated owner prevents the shelf order from selecting that chair.

3. [F3] A blank lot was treated as an indoor room. Explicit enclosure is part of the scene data. Existing tests already construct an actual perimeter and initialize room identities (`crates/terri-sim/src/test_content.rs:553-589`), then assert common indoor membership (`reading/tests.rs:562-568`). That helper is private test code, not an export available to the example.

## Alternative routes

1. [ALT1] Repair the controlled scene through valid geometry and normal admission.

   Mechanism: retain the small authored scene, construct its real perimeter, keep the bookshelf at `(2, 2)`, and place the chair at `(4, 2)`. Preserve pickup `(3, 2)` and chair approach `(5, 2)` as walkable. Purchase two copies; admit B's pinned chair order through actual Read, then issue A's shelf order. With the only chair owned, the existing planner can select standing `(3, 3)` rather than occupied `(4, 2)`. These are source-derived candidate coordinates, not an executed success claim.

   Work required: change only developer scene construction and its preconditions. Assert authored shelf and seat access, paths, room identity, available title, real command results, and the actual mixed seated/standing state. Keep the existing finite wait and complete V16 capture.

   Costs and risks: small scope; compact geometry still needs runtime validation. Future model access changes should fail explicit scene preconditions immediately.

   Makes easier or harder later: preserves the scene's exact visual purpose and keeps gameplay admission authoritative; the tool remains responsible for its authored layout.

2. [ALT2] Author the review through the production lot and Build workflow.

   Mechanism: start a production household and construct the reading area through ordinary room and object commands, inspecting placement and build results before buying books and issuing reads. Existing entry points include `new_from_shipped_lot` (`crates/terri-sim/src/lib.rs:2193`) and `begin_build`, `prepare_build_commit`, `commit_build`, `end_build` (`build_transaction.rs:227,300,487,557`). Use real admitted seat ownership to establish the mixed poses.

   Work required: isolate the reading scenario from the other four controlled scenes and explicitly manage the household, budget, objects and build lifecycle.

   Costs and risks: substantially more setup; shipped household behavior can add unrelated activity and framing noise. It must still prove the intended reading overlap.

   Makes easier or harder later: inherits production placement and household invariants; exact small-scene composition becomes harder to maintain.

## Recommendation

[R1] Take [ALT1], the controlled scene with valid geometry and normal admission. The runtime is correctly refusing an inaccessible shelf. Repair the authored scene at that boundary, explicitly enclose it, and establish the chair owner before asking the other reader to use the shelf. This preserves both intended poses without fabricating activity or altering reading rules. Do not change loaders, historical fixtures, content tuning or time limits. An unavailable requested title should fail scene preparation through the existing `reading_available_titles` API (`crates/terri-sim/src/reading.rs:1070-1112`), before any long wait.

## Verification and falsification

1. [V1] Existing positive and negative controls directly support the diagnosis: `reading_journey_front_access_rotations_and_solid_boundary` asserts available plans, blocks the exact transfer contact, and asserts no plans remain (`reading/tests.rs:1688-1731`). `reading_journey_two_standing_readers_leave_the_shelf_front_available` requires concurrent actual Read stages, distinct destinations, and destinations outside shelf contacts (`reading/tests.rs:2177-2207`). These assertions were inspected, not rerun during this audit.

2. [V2] For [ALT1], the controlled scene with valid geometry and normal admission, require a loadable idle baseline, a feasible title before each order, B actually reading with the chair claim, and then both journeys simultaneously at Read with their intended origins, distinct owned copies, A standing and B seated. Require both positions in the same non-Outside room within the configured radius. Retain `support::capture` exact complete reload and final production load (`reading-tool-better-way-source/support-mod.rs:19-33`; frozen `relationship_qa.rs:266-269`). Advance original and restored worlds identically and compare complete saves. A capped Social meter cannot prove positive refill; any reward claim needs a separate measurable observation.

3. [V3] The proposed route is falsified if the requested title remains unavailable despite independently legal shelf access, a free copy, valid routes and B's actual chair ownership; or if current loading rejects the normally admitted mixed state. Record that first failed precondition and state before further changes. Do not respond by extending ticks or editing claims manually.

## What I could not determine

1. [U1] I did not execute [ALT1], the controlled scene with valid geometry and normal admission, or run Cargo, builds or browser playback. Its exact overlap duration and production-loader acceptance remain execution gates for the source owner. Existing reading integration fixtures use larger worlds and some altered tuning (`reading/tests.rs:571-578`); they establish mechanisms, not this scene's success.

2. [U2] I verified all three supplied frozen file hashes against their manifest. I did not mutate source, the index, HEAD or historical evidence. Only this report was written. The memory registry search found no relevant earlier entry; the source and repository lessons supplied the evidence used here.

**Next steps**: The source owner should implement [ALT1], the controlled scene with valid geometry and normal admission, and verify [V2], the complete current-save and mixed-pose checks. No user decision is needed for this scoped scene repair.

## Follow-up: proposed scene failed its availability precondition

1. [D7] [ALT1], the controlled scene with valid geometry and normal admission, was attempted by the source owner after the initial audit and failed [V3], the explicit falsification gate. The initial recommendation above was unexecuted at publication and must not be read as a successful repair. Frozen `reading-tool-better-way-source/relationship-alt1.rs:27-41,55-56` establishes authored pickup and chair approach coordinates, walkability, paths, strict baseline admission and two added copies before reaching the failed title assertion at lines 67-70. `.local-build/v16-reading-alt1-run.log:8-11` identifies that assertion, but omits person, target and simulation clock. The assertion can be called at both line 90 and line 110. The log cannot establish whether it failed before B's order or before A's later order. No fifth scene trial was performed for this follow-up.

2. [D8] The availability API answers a narrower question than the proposed precondition assumed. `reading_available_titles` resolves the live person, object and action, then enumerates new plans (`crates/terri-sim/src/reading.rs:1070-1112`). It does not ask whether an existing journey already owns the title or whether an existing order can continue. `plans` returns empty for a person carrying anything (`reading/planning.rs:55-56`) and skips copies that are not on shelves or already have borrowers (`reading/planning.rs:138-143`). Other rejection gates include absent identity, position or reading tuning, unavailable seat or endpoint, illegal shelf contact and unreachable fetch or destination paths. An empty result alone does not identify which gate failed. Removing the assertion would discard information without establishing a valid scene.

3. [D9] The revised scene does not preserve A's initial state while admitting B. It ticks the complete simulation (`relationship-alt1.rs:90-94`), and A has Agent, Position and Needs (`relationship-alt1.rs:223-235`). Those are sufficient for the autonomous selector's person query; Personality and IntentQueue are optional (`crates/terri-sim/src/systems/action.rs:1376-1403`). Reading preparation also includes idle agents without a directed intent (`reading/planning.rs:376-435`). Thus a concrete possible interleaving is: B receives the pinned order; B claims the chair; B releases shelf transfer after pickup; A autonomously reserves the other copy for standing reading; B reaches Read; the later A query finds no unborrowed shelf copy, or finds A already carrying its copy. This would produce the observed empty title result at A's second call. The source permits that interleaving; the retained log does not prove it happened. A missing component or geometry defect must not be asserted in its place either.

4. [F4] The proven single-reader helper does not establish two-reader preparation. `start_owned_reading` issues a real read and checks an actual journey (`crates/terri-wasm/src/lib.rs:5971-5996`). Its projected-reading caller creates one agent (`lib.rs:6024-6034`); it neither leaves a second idle person choosing activities nor asserts title availability after advancing that second person. The existing two-standing-reader control queues both orders before ticking (`reading/tests.rs:2193-2196`). Neither control proves that a two-person scene can safely treat the non-commanded person as unchanged while waiting for the first person. The initial recommendation omitted this required observation.

5. [V4] The minimum useful diagnostic record belongs at the failed availability call: label first or second call; record person, target, action, requested title, clock, returned titles, that person's Position, SimId, Carrying, Target and intent queue; retain all reading journeys and copy locations plus borrowers. If the first call fails, include actual facing, legal interaction across each shelf/seat contact and physical claims or endpoint owners. This separates early API rejection, existing ownership and route rejection. Existing actor-less output cannot reconstruct that state, and the failed run emitted no completed reading save. A new diagnostic run or any implementation change requires the parent's next authorized decision; this audit did neither.

6. [ALT3] Production authoring from a verified scene baseline.

   Mechanism: use the same public person, placement, room, purchase and reading operations as the game, starting from a baseline already shown to admit real reading. Treat each person's actual commitment and ownership as an input to subsequent commands rather than assuming an idle actor stays idle. Any reused scene must be loaded and checked through the unchanged current loader; a historical or single-reader scene is not proof of this two-reader result.

   Work required: establish an inspected baseline and explicit two-person preparation contract before implementation. Observe current ownership between operations and verify the intended simultaneous mixed poses and complete reload.

   Costs and risks: more setup and potentially less compact framing; production initialization includes unrelated objects, people and decisions that must be understood. The production API does not itself suspend autonomous choice, so using it without an ownership contract would retain the same preparation error.

   Makes easier or harder later: production initialization owns identity, placement and persistence invariants; reproducing a tightly composed review scene becomes less convenient. This is an architectural candidate, not an approved replacement or an executed repair.

7. [R2] Suspend [ALT1], the controlled scene with valid geometry and normal admission, pending [V4], the actor and ownership diagnostic record. The first defect, blocked shelf access, remains proven; the new failure is not explained by the retained runtime evidence. Do not launch another geometry variant, weaken the title guard, fabricate holds or claims, or claim the compact scene is fixed. Continue independent integration work. If later authorized to revisit scene construction, compare [ALT3], production authoring from a verified scene baseline, against a controlled fixture with an explicit contract for every actor's commitment; either route must first account for the observed rejection.

**Next steps**: The parent should retain this scene blocker, continue independent integration work, and obtain [V4], the actor and ownership diagnostic record, before authorizing further reading-scene changes.
