# Urgent Needs and Pending Conversations Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for the tightly coupled simulation changes. Obtain a fresh independent review before delivery. If the owner chooses delegated implementation, use `superpowers:subagent-driven-development` with explicit file ownership. The checkboxes describe future implementation work.

**Goal:** Make critical-need choices coherent, preserve a chosen conversation while its recipient finishes their activity, eliminate repeated canceled movement, and report what each Sim is actually doing.

**Architecture:** Rust owns candidate evaluation, conversation requests, movement, and activity status. A conversation request commits its initiator but does not seize a busy recipient. A shared admission policy governs selection, approach, waiting, and continuation; a separate probability policy makes unrelated crisis choices rare while retaining personality and randomness.

**Tech stack:** Existing Rust simulation and content compiler, WebAssembly bridge, TypeScript interface, and WebGPU renderer. No dependency changes.

**Spec:** [Urgent needs and pending conversations](../specs/2026-10-17-urgent-needs-and-pending-conversations-design.md). Read the whole design before implementation; it contains the owner's decisions and the diagnostic evidence.

## Global constraints

1. This document proposes implementation. The owner authorized implementation, local checks, a fresh adversarial review, merge, and required deployment on 2026-10-17.
2. The initiating Sim approaches and waits after choosing a conversation. Do not silently give them a different activity because their Hunger, Energy, or Bladder is low.
3. A recipient already addressing a critical need completes that activity, including travel and the full meal or reading sequence. The request waits behind it.
4. Keep critical and low thresholds at 20 and 40. Preserve need decay, physical rewards, death rules, existing saved personalities, and explicit player control.
5. Preserve positive choice probabilities. Proposed initial aggregate limits for unrelated choices are 5% with one critical need and 1% with two or more, when a viable critical remedy exists. These are balance defaults for the plan; the owner approved the rare-but-possible behavior.
6. Random creation uses the exact seven-band distribution in Task 6. Manual creation and editing continue accepting every integer from 0 through 100.
7. Keep existing saved layouts frozen. The inspected current format is V14; use a new V15 envelope unless another delivered change takes that number before implementation.
8. Respect player order IDs, queue ordering, deterministic random draws, privacy, physical reservations, and single ownership of an action. No new browser-owned gameplay policy.
9. Do not alter character art or suppress movement to hide the bug. Preserve wall-safe route anchoring.
10. Run local Rust tests with one test thread and bounded build jobs. Run web tests with one worker. Do not overlap heavy test/build jobs or interfere with other chats' processes.
11. Do not commit review videos or animated substitutes. Keep task-owned browser pages and preview servers under scoped cleanup.

## Review focus

1. A recipient changes rooms or begins toilet use while a committed initiator approaches; the waiter must not block the recipient's privacy or restart a fractional step every update. Task 3 owns this proof.
2. Two opposite player orders, a three-person conversation cycle, or several people approaching one recipient must preserve exact order identity and still make progress. Tasks 3 and 4 own these proofs.
3. A handwash just below its cap, a meal whose food arrives only at completion, and an interaction with unavailable company must advertise attainable relief. Task 2 owns these proofs.
4. Save/load during a pending or active conversation, including a cached older browser writer, must preserve state or reject safely. Task 4 owns these proofs.
5. Very low manually selected instinct and death-disabled worlds must still receive coherent crisis choices. Changing creation defaults must not conceal broken behavior at those values. Tasks 2, 6, and 7 own these proofs.

## Task 1: Preserve the failures as executable regression cases

**Files:** Add `crates/terri-sim/src/social_episode/decision_tests.rs`; extend `crates/terri-sim/src/social_episode/tests.rs`, `crates/terri-sim/src/render_buffer.rs`, and `crates/terri-sim/examples/trace.rs`. Register the new test module beside the existing social tests.

**Interfaces:** Exercise `Sim::tick`, `Sim::sync_render_buffer`, `DecisionTelemetry`, the normal shipped-house constructor, and existing snapshot readers. Do not create a replacement decision algorithm in tests.

1. [ ] Add `critical_chat_commits_instead_of_restarting`: reproduce seed 42 and the exact need values in the design. Initially observe repeated canceled social choices, absent target/path after movement, and alternating quarter-tile positions. The repaired assertion requires one stable request that approaches, waits, or talks; it does not require the same sampled action after the probability changes.
2. [ ] Add `chosen_chat_survives_initiator_critical_needs`: force a legitimate social choice through the real admission path, then test Hunger, Energy, and Bladder separately at 20 and below. Assert retained request identity and no cancellation solely from those values. Pair this with a healthy control.
3. [ ] Add `recipient_care_finishes_before_pending_chat`: cover ordinary sleep, toilet use, a traveling recipient, and a complete food sequence. Assert unchanged recipient action identity and remaining work while the initiator approaches and waits. Assert eventual conversation and positive Social delivery after completion.
4. [ ] Add `committed_social_wait_has_waiting_activity`: establish an arrived waiter with a social target, then read the real render activity and HUD-facing status. Require waiting with the partner's identity, not activity zero with no reason.
5. [ ] Extend the existing trace with consecutive unexplained-idle updates, canceled approaches by reason, new versus repeated request IDs, waiting duration by reason, position reversals while idle, chosen critical relief, and actual delivered relief. Keep all observations read-only and outside the world hash and random stream.
6. [ ] Run `cargo test -p terri-sim social_episode -- --test-threads=1`. Record actual assertion failures against the defective revision. A compiler error does not count as a reproduced failure. Retain a small wall-bearing case; a barrier-free fixture bypasses the anchoring responsible for the observed reversal.

## Task 2: Score attainable relief and limit unrelated crisis choices

**Files:** Add `crates/terri-sim/src/systems/critical_choices.rs`; update `systems/autonomy.rs`, `systems/action.rs`, `need_interactions.rs`, its tests, the content tuning definition/compiler, and `content/tuning.toml`. Keep raw content rewards unchanged.

**Interfaces:** Introduce `NeedOutcome { net_change: [f32; 7], first_relief_ticks: [Option<u32>; 7], completion_ticks: u32 }` and `critical_relief_mask(needs: &Needs, outcome: &NeedOutcome, threshold: f32) -> u8`. Add `critical_choice_probabilities` beside the existing grouped sampler. It accepts candidate identities, utilities, risks, outcomes, needs, and tuning, and returns the actual flattened sampling probabilities. Extend telemetry with the relief mask and the reasons an action cannot deliver a claimed benefit.

1. [ ] Add deterministic outcome tests for full and partial handwashing caps, personality-scaled restoration, natural decay during travel and work, positive and negative effects, unavailable Social company, held-chair Comfort, and terminal meal rewards. Use a zero-duration-variance fixture to compare the predicted outcome against actual execution. Validate stochastic actions within their authored duration bounds separately.
2. [ ] Keep physical restoration separate from preferences. Derive available positive amounts from the existing delivery rules after restoration multipliers and caps, and retain real costs. Calculate net need change over estimated travel, waiting, and work. A positive advertised number alone is insufficient to classify relief.
3. [ ] Score the complete food goal, not merely fetching or cooking. A pending conversation includes the recipient's remaining protected work and the final approach in its time estimate. Where continuation is not finite or knowable, classify it as blocked rather than inventing immediate Social relief.
4. [ ] Partition candidates into those that improve at least one currently critical need and the remaining candidates. An action can count as relief even if it helps a different critical need than the lowest meter. This preserves the owner's freedom to choose conversation while hungry when Social or Fun also needs attention.
5. [ ] Within each partition, reuse the existing target-then-interaction weighting. Determine partition weights from their best utilities and survival risk using the existing probability machinery, then cap the unrelated partition's total at the authored 0.05 or 0.01. Normalize within each partition and flatten once. Preserve a representable positive bucket for each eligible alternative. Do not let duplicated equal actions multiply a target's probability.
6. [ ] When no viable critical remedy exists, retain the ordinary feasible distribution. Distinguish no route, occupied object, missing preparation station, unavailable company, and an existing commitment in diagnostics and status. An impossible candidate is not an unlucky random choice.
7. [ ] Test all instinct anchors, including 0 and 100, with death both enabled and disabled. Assert finite normalized probabilities, aggregate unrelated limits within one sampling-bucket tolerance per candidate, and unchanged ordinary selection when no need is critical. Test four critical needs with a sink at Hygiene 39.9 and 40 alongside food, sleep, and entertainment options under the shipped randomness settings.
8. [ ] In a fixture where an additional critical meter changes no candidate's attainable effects or utility, test that the helpful partition's probability does not fall. Also test that an action which worsens the newly critical need can correctly lose preference. Prove that equal-choice duplication within a target does not buy additional target probability. Test classification at 20 and immediately above 20.
9. [ ] Run `cargo test -p terri-sim critical_choices -- --test-threads=1` and `cargo test -p terri-sim need_interactions -- --test-threads=1`. Run the affected content compiler tests. Remove the cap and substitute nominal handwashing reward in separate temporary mutations; the intended assertions must fail before restoring byte-identical source.

## Task 3: Implement a stable conversation commitment and queue

**Files:** Add `crates/terri-sim/src/social_episode/requests.rs` and request tests. Integrate with `social_episode.rs`, `systems/action.rs`, `systems/movement.rs`, `systems/social.rs`, `privacy.rs`, command cancellation, and the schedule in `lib.rs`. Keep the existing social delivery, topics, and voice ownership.

**Interfaces:** Add `ConversationRequestId(u64)`, `ConversationOrigin::{Autonomous, Player { order_id: u64 }, LegacyUnattributed}`, and request phases `Approaching`, `Waiting`, `Suspended`, and `Talking`. A request records the participants, interaction, creation update, origin, and optional waiting tile. Introduce `ConversationAdmission::{Approach, Wait(reason), Reject(reason)}`. Add shared `admission`, `before_choices`, `before_movement`, `after_actions`, `cancel_request`, and `complete_request` operations in the requests module. The status reader and save layer consume these records; they must not infer ownership from matching partner names. `LegacyUnattributed` is created only by historical-save migration and never consumes a guessed player order.

1. [ ] Add tests for one request surviving a critical initiator, busy receiver, moving receiver, changing need values, and the transition from protected care to talking. Add request-ID assertions over every update, not just a final component count.
2. [ ] Record one autonomous outgoing commitment per initiating Sim. Retain its social `Target` while approaching or waiting, and exclude it from ordinary reselection. Consult the canonical request as well as physical components: a missing `Target` during work cleanup or route blockage must not grant autonomy permission to replace the commitment. Do not mark the busy recipient `Reserved` or put them into the selection pass's claimed-person list merely because someone wants to talk.
3. [ ] Include recipients traveling toward valid activities in social candidate evaluation. Before choosing a request, resolve its waiting estimate and safe approach. Keep work/off-lot exclusion for new autonomous requests. Reject invalid identities and impossible social interactions before movement.
4. [ ] Use a stable request queue, ordered by creation update and request ID. Honor repeated player orders separately. Coalesce only autonomous duplicates for the same unordered pair. If the other side already has a player request, an autonomous duplicate joins that request rather than creating a second request or consuming the player order.
5. [ ] Before ordinary choices, promote a ready queued request when the recipient's protected action has finished. Before movement, validate newly proposed requests against the recipient's actual chosen activity and claims. After action completion, update readiness without erasing movement already performed. All three phases use the same admission function and must be idempotent within an update.
6. [ ] Choose a waiting tile near the recipient's current action destination, ordered by path length and then tile coordinates. For a recipient with a path, start from its endpoint; for a nonprivate active station, use reachable adjacent contacts. For toilet/bath/shower use, enumerate reachable staging tiles on the exterior side of room entrances, including before use starts. Do not filter the fixture's interior contacts and assume an exterior tile will remain. Keep the recipient's use contact unobstructed. If no safe staging route exists, hold the commitment at a safe reachable position and report the blockage. Use the existing privacy/navigation rules rather than treating a critical initiator as permission to intrude.
7. [ ] Keep a valid approach and waiting tile stable. Replan after destination, geometry, or privacy changes invalidate it, or after the recipient becomes ready for final contact. Preserve progress on the current fractional segment before turning. Do not rebuild a route solely because another simulation update occurred. Preserve ordinary wall-safe anchoring for genuinely new routes.
8. [ ] Protect the recipient's complete current goal. Preserve meal preparation, consumption, and cleanup ownership according to the actual action boundary; do not regard an intermediate station transition or crossing above need level 20 as completion. For a read/meal chain, use its existing goal-completion event rather than guessing from a missing `Path`.
9. [ ] Exempt a committed conversation from the urgent-goal substitution in `privacy::route`, while retaining privacy routing. Integrate both branches of career cleanup: a recipient leaving for work keeps the initiator committed to waiting; an initiator's own mandatory work suspends the request and resumes it on return. Death, permanent household departure, and explicit player replacement cancel through named request operations. A temporary loss of `Target` or `Path` must not be treated as cancellation.
10. [ ] When the recipient is only committed to another pending conversation, do not classify that outgoing target as ordinary busy work forever. For reciprocal player requests or a three-person cycle, admit the oldest ready request, suspend the recipient's outgoing request without consuming it, and restore that request after the admitted conversation completes. Reserve each person for at most one active pair.
11. [ ] Retain request origin and exact player order ID during `Talking`. Replace partner/interaction-based completion removal with `remove_order(order_id)` for the owned player order. Autonomous completion must not remove a player order appended during the conversation. Fights retain their separate behavior and must not accidentally enter the ordinary chat queue.
12. [ ] Test player append versus replace, removal of a specific duplicate order, clear orders, recipient redirection, mandatory work and return, death, departure, object movement, private-room waiting, unreachable approaches, multiple initiators, reciprocal requests, and three-person cycles. Require that the protected recipient continues making progress and no participant receives duplicate benefits or voice ownership.
13. [ ] Run the social, movement, privacy, command, fight, and queue suites with one test thread. Targeted mutations must expose a removed urgency exemption, premature receiver reservation, repeated route reset, dropped order identity, and changed queue ordering.

## Task 4: Persist commitments and preserve existing saves

**Files:** Add `crates/terri-core/src/save_v15.rs` and `crates/terri-sim/src/save/v15.rs`; extend social persistence and hashing, the WebAssembly save reader/writer, browser save-header handling, and their native/browser tests. If the current format has advanced, use the next unused version consistently.

**Interfaces:** Define `SavedConversationRequests { next_id: u64, requests: Vec<SavedConversationRequest> }` with stable Sim IDs, interaction identity, origin/order ID, creation update, phase, and waiting tile. Define `SaveSnapshotV15 { legacy: SaveSnapshotV14, conversation_requests: SavedConversationRequests }`. Preserve the current historical-format readers.

1. [ ] Add round-trip tests at approach, arrived wait, work suspension, reciprocal-request suspension, and active talking. Require identical subsequent decisions, positions, need changes, voice/topic ownership, queue contents, and world hashes after loading into the same implementation.
2. [ ] Preserve the V14 payload and its historical validation. Convert old ordinary-chat claims into canonical requests after identity remapping. Mark imported chats `LegacyUnattributed` because those formats do not record exact social-order ownership. Preserve every queued order and make imported completion consume none. Test and document the possible additional queued conversation when an older active chat originally came from that order. Fight claims remain under their existing lifecycle and validation, without an ordinary-chat request.
3. [ ] For new saves, validate the agreement between canonical requests and the frozen payload's admitted ordinary-chat claims and active ordinary conversations. Reject duplicate request IDs, dangling people, invalid interactions, impossible self-conversations, contradictory phases, double active ownership, invalid order references, nonmonotonic counters, out-of-bounds waiting tiles, and truncated or trailing payload data transactionally. Explicitly exempt fight claims from ordinary-chat matching; prove saves during both a fight approach and an active fight still load and continue.
4. [ ] Preserve origin/order identity across actual conversation start and completion. Persist suspended outgoing requests during another conversation; they must not be mistaken for a second active owner.
5. [ ] Hash all causal request fields in stable ID order. Exclude derived labels, sampled diagnostics, and wall-clock times. Loading or reading a status must not consume randomness, advance simulation time, or normalize away an intentional zero instinct.
6. [ ] Extend the WebAssembly boundary and browser save-version constant together. Verify save backup retention, atomic replacement, load failure retaining the current world, and an older cached writer refusing to overwrite a newer saved payload. Use authentic existing fixtures, including the released social/character save fixtures.
7. [ ] Run the native save suites, WebAssembly save suites, and browser persistence tests after rebuilding WebAssembly. Add malformed nonempty request fixtures; empty-array round trips alone are insufficient.

## Task 5: Report waiting truthfully and verify the motion

**Files:** Add `crates/terri-sim/src/activity_status.rs`; integrate with `lib.rs`, `action_queue.rs`, and `render_buffer.rs`; expose it through `crates/terri-wasm/src/lib.rs` and `web/src/bridge.ts`; update `web/src/ui/game-hud.ts` and queue rendering/tests. Touch `web/src/render/character/scene-plan.ts` only if a legitimate arrival still publishes movement without a walking presentation after the simulation fix.

**Interfaces:** Add an append-only `ActivityStatusCode` with current-action and wait reasons, plus optional partner identity. Use a typed `activityStatusOf(entityIndex)` bridge reader. The queue adds pending/active request identity rather than reconstructing it from label text. Keep existing numeric activity codes compatible.

1. [ ] Add status tests for approaching, waiting for a busy partner, waiting outside a private room, route blockage, work suspension, and a recipient continuing need care. Confirm that the recipient's current activity is not overwritten by an incoming request.
2. [ ] Make one Rust projection the source of the activity, reason, and related person. Remove the rule that blindly suppresses every wait reason whenever `Target` exists. Classify social waiting independently of the occupied-item mood marker; a display fix must not add an unrelated mood penalty.
3. [ ] Use literal functional labels from the design. Replace the generic `Deciding what to do` label with `Idle`. Show `Waiting to talk to {name}` for a committed waiter. Show suspended/pending conversation rows in the queue and an explicit reason for unavailable urgent care. Preserve selected-Sim changes, empty selection, removed partners, keyboard access, and mobile wrapping.
4. [ ] Assert that useful critical-need actions resolve by the next update when no existing commitment owns the Sim. Genuine waiting and normal travel are valid outcomes; an unexplained empty state is not. Do not use a timer to conceal an unresolved state after half a second.
5. [ ] Compare previous/current render positions, final activity, body action, and facing across the original reproduction and legitimate arrival. Require no repeated alternating quarter-tile displacement with idle action. If a real last step loses its walking presentation, carry its actual motion direction only through that interpolation interval. Do not change simulation coordinates to satisfy this visual assertion.
6. [ ] Run status/HUD/queue/character-scene tests, then play the actual rendered game at 1x and 3x. Inspect captures personally. Have a fresh independent reviewer reject the known defective result before reviewing the repaired one. Check 390 by 844 mobile layout, pause/resume, and reduced motion. Close task-owned game tabs in a finally block and stop only the task's preview server.

## Task 6: Apply the exact creation distribution

**Files:** Extend `content/tuning.toml` and its compiler types/validation; add a shared creation sampler used by `crates/terri-sim/src/household.rs`; update only creator/random-move-in paths that request a random instinct. Preserve `save/self_preservation.rs` historical migration semantics. Update creator tests and the functional explanation.

**Interfaces:** Add copyable `CreationInstinctBand { min: u8, max: u8, weight: u8 }`, an authored seven-entry band table, and `sample_creation_instinct(rng: &mut SimRng, bands: &[CreationInstinctBand; 7]) -> u8`. Keep explicit-value validation at 0 through 100.

| Inclusive values | Percentage | Band draw in 0 through 99 |
| --- | ---: | --- |
| 11 through 30 | 5 | 0 through 4 |
| 31 through 50 | 10 | 5 through 14 |
| 51 through 60 | 10 | 15 through 24 |
| 61 through 70 | 25 | 25 through 49 |
| 71 through 80 | 30 | 50 through 79 |
| 81 through 90 | 15 | 80 through 94 |
| 91 through 95 | 5 | 95 through 99 |

1. [ ] Select the band with `rng.range(100)`, then select uniformly inside that band's inclusive bounds with a second bounded draw. Draw only after creation validation succeeds. Explicit values bypass both draws.
2. [ ] Test every band boundary by an injected draw seam, every allowed endpoint, the exact 100-bucket allocation, and uniform conditional selection within each band. A finite random sample supplements these tests; it does not prove the specified probabilities by itself.
3. [ ] Prove random creation never produces 0 through 10 or 96 through 100. Prove manual creation and editing accept 0, 10, 96, and 100 unchanged. Prove rejected creation consumes no draws, accepted random creation uses the shared sampler, and editing does not silently reroll instinct.
4. [ ] Prove current saves preserve their exact values and historical missing-value migration retains its published behavior. Do not apply the new generation distribution when loading an existing Sim. Document the intentional new-game random-sequence change and review any affected current golden hash; do not rewrite frozen historical expectations.
5. [ ] Run household, creator, command, content-validation, and self-preservation save tests. Keep this change in a separate reviewable commit from the decision/cancellation repairs when implementation delivery is authorized.

## Task 7: Measure behavior, document the change, and prepare delivery

**Files:** Extend the existing trace rather than adding a competing balance tool. Add dated evidence under `docs/evidence/`; update `docs/specs/2026-09-30-varied-autonomy.md`, conversation documentation, `docs/NEEDS-INTERACTIONS.md` where predictions change, `docs/player-visible-strings.md`, and the relevant lesson. Add the player changelog during implementation delivery, using the actual delivery date.

1. [ ] Run matched 12,000-update traces for seeds 17, 42, and 88 at fixed instinct 0, 30, 50, 70, and 100. Repeat creation-distribution runs separately so the sampler cannot hide a logic regression. Include death-disabled and blocked-resource scenarios in focused fixtures rather than duplicating every long run.
2. [ ] Record critical time by need, chosen versus delivered relief, repeated capped handwashing, pending conversation age/reason, conversation starts/completions, canceled requests by legitimate cause, unexplained idle duration, movement reversals, and deaths. Separate travel, protected waiting, and active relief from unexplained inactivity. Preserve the exact seed, content, revision, and machine context for performance measurements.
3. [ ] Require the deterministic probability bounds and all behavioral contracts to pass. Require zero repeated same-request cancellation from unchanged critical need values, zero persistent unlabeled waits, and zero canceled-approach oscillations. Report starvation or long waits still caused by unreachable care, long chosen commitments, or low instinct explicitly. Do not claim that all Sims are guaranteed to survive or that a chosen conversation wait cannot worsen Hunger.
4. [ ] Run the affected suites during each task. For the integrated change, run `cargo test --workspace -- --test-threads=1`, `cargo fmt --all -- --check`, and `cargo clippy --workspace --all-targets -- -D warnings` with bounded build jobs. Rebuild WebAssembly with `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` before the web checks. In `web`, run `npm test -- --maxWorkers=1`, `npm run typecheck`, and `npm run build` sequentially.
5. [ ] Run `python check-doc-ids.py`, the relevant changelog tests/build, and `git diff --check`. Complete targeted mutations for admission, stable request identity, exact order completion, probability limits, status classification, and the distribution boundaries. Describe targeted mutation evidence separately from any full remote mutation sweep.
6. [ ] Obtain a fresh whole-change adversarial review and an independent visual review. Resolve findings against the reproduced failures, queued-conversation semantics, and saved-state contracts. Update the lesson with the disagreement between selection and continuation, the observable effect, and how to detect it.
7. [ ] If the owner subsequently authorizes commit, push, and merge, apply the changelog skill before each push and merge. Preserve same-day notes already on main. Do not wait for duplicate remote checks after the corresponding local checks pass, but address known failures and enforced protections. Verify the merged pull request and remote main separately from deployment. Synchronize the checkout and report a clean tree. Run live deployment verification if included in that later delivery authorization.

## Implementation order and review boundary

Implement the regression fixtures first, then candidate outcomes/probabilities, conversation ownership, persistence, presentation, and creation sampling. Conversation ownership and save changes must be reviewed together before shipping. The new creation distribution cannot be used as proof that low-instinct behavior is fixed.

The breadth is necessary because the defect crosses decision selection, movement, cancellation, persistence, and presentation. A smaller patch that only removes the critical-need cancellation would leave premature recipient claims, privacy substitution, misleading waits, and exact player-order completion unresolved. No general animation rewrite or broad simulation refactor is needed.

The owner has chosen the waiting behavior, preservation of randomness, and exact generation bands. The numerical 5%/1% crisis limits and the explicit scheduling details are implementation recommendations presented for review with this plan. No game implementation or publication is claimed by this document.
