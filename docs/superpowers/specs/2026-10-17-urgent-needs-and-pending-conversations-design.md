# Urgent needs and pending conversations

Current contract: [player orders and attendance](../../specs/2026-10-17-player-orders.md)
supersedes this dated design's work priority and request cleanup for player-owned
orders. Player orders delay work and survive critical needs. A new front order
can redirect a person without deleting another person's request. Existing
recipient activity still finishes first. The V15 design below remains the
published historical format; current persistence uses V17 around V16 and V15.

This design defines proposed behavior for autonomous need recovery, pending conversations, and truthful activity reporting. It is the basis for the [implementation plan](../plans/2026-10-17-urgent-needs-and-pending-conversations.md). Approval of the plan is separate from implementation and publication.

## Intent and evidence

Sims should make understandable choices when several needs are critical. Personality and randomness still influence those choices. A conversation chosen by a hungry initiator remains a valid choice. When the recipient is already addressing an urgent need, the conversation waits behind that activity instead of being canceled and selected again.

Diagnostic evidence was collected on 2026-10-17 against `7c7cfa227`. In the shipped house with random seed 42, Tim started with Hunger 10, Social 0, Fun 0, Energy 35, the other needs 65, and self-preservation 50. He spent 65 consecutive updates in the displayed deciding state. His position alternated between `(9, 2)` and `(8.75, 2)`, while his visual action and facing were both zero. Each canceled attempt had selected a conversation. At ten updates per second and one game minute per update, that interval represents 6.5 seconds and 65 game minutes. Raising only Hunger to 30 removed the repeated cancellations and idle movement in the matched 150-update comparison. An unmodified new household also exhibited the same cancellation sequence during a 12,000-update run. These are native simulation measurements, not a replay of the owner's saved game or a browser visual acceptance result.

Selection currently admits conversations that `social_episode::maintain` cancels for critical Hunger, Energy, or Bladder. Movement runs between selection and cancellation. A fresh route anchors a fractional position at its rounded tile center, producing the repeated reversal. Cancellation removes the walking state before the display reads it. Separately, an initiator legitimately waiting for a busy recipient can be labeled as deciding because that wait has `Target` and `Blocked`, but lacks the item-wait marker recognized by the activity projection.

Handwashing already has a Hygiene ceiling of 40, and ordinary autonomous scoring applies that ceiling after personality scaling. Do not diagnose a missing ceiling or replace it with a duplicate. Existing cap tests disable exploration, so they do not establish the behavior of repeated choices under normal randomness. Low self-preservation scales low-need scores down to 0.02 at zero instinct; physically eligible unrelated choices remain available. The revised balance must be measured separately from the cancellation repair.

## Behavior contracts

### Choices during a crisis

1. Keep the existing critical threshold of 20 and low threshold of 40. Consider all seven needs when identifying a crisis; retain the existing Hunger/Energy death rules separately.
2. Evaluate whether each candidate can actually improve a currently critical need. Account for restoration caps, natural decay, costs, travel, action duration, meal completion, actual company, and the held chair. Personality preferences affect desirability, not the calculation of physical restoration. Personality restoration multipliers still affect restoration.
3. Keep the existing weighted selection within useful and unrelated alternatives. Apply a probability limit to the unrelated alternatives as a group when an immediately actionable critical-need remedy exists. The proposed limits are 5% for one critical need and 1% for two or more. These are proposed balance defaults, not measured release results or previously approved requirements.
4. Preserve positive probability for eligible unrelated choices within that limited share. A low-instinct Sim can make poor choices, but repeated irrelevant actions should not be the ordinary response to four critical needs. Self-preservation, preferences, relationships, repetition, and travel still distinguish choices within the useful group. Preserve normalization by target so adding equivalent actions does not multiply an object's chance.
5. A pending conversation is not immediate Social recovery. Score its benefit with the expected wait before selecting it. Once selected, the initiator commits to approaching and waiting; do not reroll their decision merely because they have other low needs. A reachable conversation with a finite protected-activity wait is a delayed remedy for Social or Fun, with that delay included in its utility and risk estimates. An indefinitely blocked or off-lot request is not an available critical remedy.
6. An activity qualifies as critical relief only if its predicted net change improves at least one need that is critical at the decision boundary. A handwash that only recovers a tiny drop near Hygiene 40 does not qualify when Hunger, Energy, Social, and Fun are critical. Preserve meaningful low-Hygiene washing, full-body bathing, and manual handwashing.
7. If no immediate remedy exists, retain the ordinary feasible choices and report why recovery is unavailable. Never manufacture relief, route through walls, force occupied furniture free, or use an endless retry loop.
8. An idle Sim with an immediately usable critical remedy must publish an action or an explicit wait/block reason on the next simulation update. A known rejected candidate must not be retried unchanged each update. This is a decision-resolution requirement, not a promise that travel or the activity will finish within half a second.
9. Do not replace an already-running activity every update because two critical meters exchange order. Preserve the established stable priority for urgent privacy goals and the current player-command precedence. This work does not introduce universal emergency interruption of every running activity.

### Conversations

1. Separate the initiator's conversation commitment from ownership of the recipient. Keep a social `Target` on the initiator while approaching or waiting, so ordinary autonomy does not replace the decision. A pending incoming request must not assign `Reserved` to a recipient who is still carrying out their own activity.
2. Use one authoritative admission decision for autonomous proposals, player orders, pending-request promotion, movement, and continuation. Possible results are start/approach, defer with a reason, and reject because the request is invalid. Critical need values alone are not grounds for rejection.
3. Protect the recipient's current activity, including its travel and complete meal or reading sequence. An action that addresses a need that was critical when the request arrived remains protected until completion, cancellation, or an existing legitimate interruption. Do not begin talking merely because the need crosses 20 during that same action.
4. After that activity finishes, the pending conversation receives priority over the recipient choosing a fresh discretionary activity. Do not require the recipient to fill every need before allowing the conversation. A new explicit player order and mandatory work retain priority.
5. The initiator approaches and waits, as directed by the owner. Choose a reachable waiting position near the recipient's current activity or current destination. Respect occupied bathroom privacy and furniture access. If the recipient continues a meal sequence, the initiator can keep that waiting position until the full sequence finishes, then make the final approach. Do not chase a changing recipient position by restarting a fractional walking segment every update.
6. An initiator's critical physical need does not automatically cancel their chosen conversation. Their meters can continue to drain during a deliberate wait. If mandatory work interrupts the initiator, suspend the request and release its physical claims until return. Death, household departure, invalid interaction identity, explicit cancellation, and superseding player orders have defined cleanup. These are real lifecycle changes, not an excuse to cancel because the initiator is hungry.
7. Order requests by creation update and stable request ID. Allow several incoming requests per recipient. Allow at most one outstanding autonomous outgoing request per initiator. Coalesce repeated autonomous requests for the same unordered pair. Preserve intentionally repeated player orders as distinct conversations, using their existing order IDs.
8. A pending request must not hold the recipient hostage. Coalesce only reciprocal autonomous proposals. Preserve distinct player orders. If two opposite player orders are ready, run the earlier request first and retain the other as a distinct subsequent conversation; both people can participate in the first without consuming the later order. For a three-person cycle, the oldest ready request temporarily suspends the recipient's outgoing approach, preserving its order and age, and restores it after the first conversation. Claim a pair atomically so one Sim cannot join two conversations at once. Blocked requests do not prevent unrelated ready pairs from starting.
9. Work and temporary route blockage defer an existing request without retaining physical reservations. Do not generate new autonomous requests to off-lot people. Retry blocked routes when relevant geometry, participant position, or availability changes, not by repeatedly moving and canceling. Pending requests have no arbitrary timeout that would discard a request merely because sleep or cooking is long; bounded outgoing autonomous ownership prevents accumulation.
10. Preserve player queue order. A pending player conversation retains its original order ID and displayed place. It is fulfilled once, after both participants are available. Clearing or removing that order removes its request. A replace-action command cancels only the requests it supersedes; appending a command preserves earlier orders. An unrelated command to the recipient defers incoming requests rather than deleting the initiating player's orders.
11. Exempt a committed conversation from `privacy::route` substituting a food or sleep goal merely because another need is critical. Continue to apply safe routing and private-room boundaries. A waiter for someone approaching a toilet or bath must wait outside that protected room before private use begins, so the waiter cannot prevent the recipient from starting the action they are waiting to finish. Use a reachable exterior staging tile near a room entrance, not the fixture's interior use contacts. If no exterior staging route exists, retain the commitment at a safe reachable position and publish the blockage; never force entry.
12. The request, not the presence of `Target`, owns the commitment. Career and command cleanup can remove physical components without erasing it. If the recipient leaves for work, the initiating Sim remains a committed waiter until the recipient returns, unless their own mandatory work or an explicit cancellation intervenes. If the initiating Sim must work, suspend their request while work owns them and resume the commitment on return. Ordinary autonomy must not run merely because a suspended or route-blocked request temporarily lacks `Target`.

### Activity and movement presentation

1. Derive the current activity and its reason from the same simulation facts. The recipient continues to display their active need-care activity while incoming conversations wait. The initiator displays walking toward the person or waiting to talk, and the action queue retains the chosen conversation.
2. Proposed functional labels are `Waiting to talk to {name}`, `Conversation queued with {name}`, `No reachable way to satisfy {need}`, and `Idle`. Replace the misleading generic deciding label with `Idle`; do not use an unexplained deciding state as a persistent fallback. Record the exact wording in the player-visible string inventory before implementation is accepted.
3. Treat an arrived conversation waiter as waiting even though they retain a target. An incoming request does not replace the recipient's current activity. A work-suspended outgoing request appears as pending in the queue while work owns the current activity.
4. Preserve safe route anchoring and position interpolation. Remove the repeated contradictory decisions that cause oscillation. Do not freeze coordinates, suppress frames, disable animation, or add a cosmetic sway to conceal movement.
5. At a legitimate final walking update, motion presentation must retain the actual movement direction until interpolation reaches the final position. Establish this with the production render samples before deciding whether a small presentation adjustment is necessary. A stationary idle Sim must not accumulate movement from presentation code.

### Self-preservation defaults

Use the owner's exact distribution for newly generated Sims. Choose the band with a weighted draw, then choose an integer uniformly within that inclusive band:

| Inclusive values | Chance |
| --- | ---: |
| 11 through 30 | 5% |
| 31 through 50 | 10% |
| 51 through 60 | 10% |
| 61 through 70 | 25% |
| 71 through 80 | 30% |
| 81 through 90 | 15% |
| 91 through 95 | 5% |

Random generation never produces 0 through 10 or 96 through 100. Keep explicit player-selected values from 0 through 100 valid in both creation and editing. Preserve every existing saved value, including zero, and preserve historical missing-value migration behavior. Put the bands and weights in authored tuning and share their sampler across starter households, random move-ins, and character-creation paths that request a random value. Do not reroll rejected creations or edits to an existing Sim.

This is a separate balance change. Compare existing values with the new distribution after the logic repair, so improved averages cannot hide an unresolved bug at low instinct.

## Architecture and compatibility

Keep decisions in Rust and the browser as a reader of simulation state. Extend the existing social episode system rather than creating another conversation owner in JavaScript. Introduce focused modules for pending conversation admission and crisis-choice probabilities; do not broadly reorganize the existing large simulation files.

A request needs an ID, initiator, recipient, social interaction, origin, creation update, and phase. Player-origin requests carry the existing order ID. Runtime references use live entities; persisted references use stable Sim identities. Persist deferred, approaching, arrived-waiting, suspended, and talking requests. Started conversations retain their origin and order ID alongside the existing active conversation record until completion. Complete or cancel the exact owned order, never the first order that happens to name the same partner and interaction. Derived availability and display reasons do not need to be saved.

The inspected current save format is V14. Add a V15 envelope for request state and its next-ID counter; do not modify any frozen V1 through V14 layout. Reconfirm the current format before implementation and use the next unused version if another delivered feature has taken V15. Preserve existing active conversation, topic, voice, meal, career, appearance, queue, and random-generator state. Older incoming ordinary-chat claims migrate to matching approaching or waiting requests; they do not disappear because an actor is hungry. Fight claims retain their existing separate validation and lifecycle and do not become ordinary-chat requests. Load into a candidate world and reject invalid or contradictory records before adoption. Current saves must retain the queued request across reload instead of rebuilding it from guessed intent.

Older saves do not record whether an ordinary chat owns a matching player order. Preserve an imported old chat as `LegacyUnattributed` and preserve all queued orders; its completion consumes no guessed order. This conservative migration can leave one additional conversation queued when an older active chat originally came from that order. It avoids silently deleting an identical order the player issued later. Current-format requests always preserve exact origin and do not have this ambiguity. Document and test this historical compatibility limitation rather than claiming perfect recovery of information that was never saved.

Retain the frozen legacy social payload for the one physically admitted approach or wait per recipient. New request records are canonical for ordinary chats in the new runtime; validate that every ordinary-chat legacy claim has exactly the matching new request when reading the new format. Exempt fight claims from this chat matching while retaining their existing validation. Additional incoming requests and suspended records have no legacy recipient claim. Their initiator's target is preserved only while that request owns the initiator's current activity. This keeps old layout readers frozen without permitting two disagreeing live owners. Include every causal request field in deterministic world hashing. Inspect the existing older-format export helpers and keep their historical behavior explicit; do not accidentally make a current save take a lossy older writer.

Append new bridge status codes rather than changing existing numeric meanings. Expose the pending partner and deferral reason through a typed status reader shared by the HUD and queue. Preserve save-worker version checks, crash-safe writes, backup retention, and rejection of a stale browser attempting to overwrite a newer save.

## Acceptance

1. The reproduced hungry/lonely/bored case no longer selects, moves toward, cancels, and reselects the same request. The initiator approaches and waits under one stable commitment while the recipient finishes their activity.
2. A recipient on the way to food, a toilet, or a bed completes the protected activity and then honors the pending conversation. Both participants receive conversation benefits exactly once.
3. Under normal randomized selection, unrelated choices stay within the authored aggregate probability limit when a critical remedy is immediately available. Handwashing at or near its cap does not masquerade as a remedy for other critical needs.
4. No eligible idle Sim remains in an unexplained no-action state for more than one update. Legitimate long waits and travel remain allowed and accurately described.
5. Save/load resumes deferred requests, real approaches, arrived waits, and active conversations without duplication, lost commands, or changed deterministic continuation.
6. Desktop browser play at normal and fast speed shows no repeated quarter-tile reversal with a fixed idle body. The visual review must reject the known defective behavior before accepting the repair. Also check the mobile status and queue layout, pause/resume, and reduced motion.

## Proposed defaults and boundaries

The owner's confirmed direction is to retain selected conversations, have the initiator approach and wait, queue conversations behind the recipient's urgent action, eliminate the repeated cancellation and movement loop, keep unrelated crisis choices rare rather than impossible, apply the exact creation distribution above, and explain actual waiting. The 5%/1% unrelated-choice limits are recommended initial tuning under that direction. Keep any later answers synchronized between this design and its plan.

No dependency changes, new character art, altered need decay, food rewards, death thresholds, or automatic rewriting of existing personalities are part of this work. The owner authorized implementation, commits, pushes, merge, and required deployment on 2026-10-17, with local checks and a fresh adversarial review replacing duplicate remote CI and review.
