# Purposeful fights and chore reconciliation

Issue 314 extends the shipped fights contract. The owner authorized conversation issues through implementation, local checks, independent review, merge and publication. Their standing instruction to proceed without routine permission questions applies here. Values below are implementation choices; the issue supplies the exact neutral 80 percent chore-response baseline.

## Required behavior

1. Worse current mood increases autonomous fight likelihood; better mood reduces it.
2. Autonomous fights require a real attributable grievance. Privacy fights require an actual privacy event. Chore fights require currently unfinished work assigned to the recipient.
3. An autonomous reason must remain valid through waiting and admission. Resolving or reassigning the chore withdraws its system-owned fight without disturbing player orders.
4. A completed chore fight gives the recipient an 80 percent baseline chance to attempt that duty promptly, modified by personal factors. Acceptance is one saved decision. Critical needs, work, incoming ownership and player orders retain priority.
5. Finishing the requested duty within a few game hours improves the participants' relationship and the feelings of people who were annoyed about that same work.
6. Real completed cleaning improves all other living housemates' opinions of its actual worker, including with the board disabled and after that day's board credit has settled. Cleaner observers appreciate it more; messy observers still gain something.
7. Player fights use relevant current or remembered subjects. Only player fights receive a random ordinary topic when no relevant subject exists.
8. Update the fight, relationship, cleanliness and persistence documentation, the in-game Help and the public release notes. The separate public-guide structure requested in issue 313 remains subject to its explicit owner approval; do not implement that site's organization here.

## Proposed triggers and topics for delivery

| Attributable cause | Evidence | Topic |
| --- | --- | --- |
| Entering someone's room during private use, or starting private use beside an occupant | The actual accepted privacy effect identifies the offended person and responsible person. | Privacy |
| An overdue assigned duty that still needs work | Current assignment, unfinished physical work and its continuous grace identity agree. | Unfinished dishes or unfinished cleaning |
| Another person's hated television, music, exercise or other activity | The nuisance producer observes the responsible person actually using that category in the same room. | The observed activity |
| Starting an inconvenient conversation | The actual unhelped low/critical-need interruption effect is applied. Shared-interest exemptions remain effective. | An inconsiderate interruption |

Bad mood, grief, an employer's decision, ordinary waiting, incompatible personalities and disliked plants do not identify another person's misdeed. They do not independently authorize a fight. Existing opinions modify likelihood rather than inventing a cause.

## Frequency and resolution

Use the HUD's existing derived mood. Store no second mood value. Replace the hard hostile-affinity gate for genuine grievances with a bounded opinion modifier. Select one deterministic strongest eligible cause and recipient, then spend at most one probability draw per idle initiator per tick.

The initial neutral chance is 0.001 per eligible game minute. The mood multiplier is 1 at zero, 2 at -100 and 0.25 at +100, linear on each side of zero. The opinion multiplier is 1 at neutral, 0.5 for the strongest liking and 1.5 for the strongest dislike. Scale by grievance severity relative to a 0.25 privacy incident, bounded from 0.1 to 2. Clamp the resulting probability to 0 through 1. Existing zero/certain test tuning remains explicitly controllable.

Require both people to be free of the existing eight-hour fight cooldown, including a fresh check before a waiting automatic order starts. Keep crisis withdrawal for either participant and exact system-order identity. Running player fights retain their current commitment rules. Autonomous chore fights also end without fight outcomes when their actual duty ceases to be unfinished or assigned to that recipient.

Privacy and interruption events can produce one autonomous argument each. Coalesce one continuous nuisance episode without renewing a consumed argument every tick. A still-unfinished chore can be raised again after one full game day, in addition to both participants' cooldowns. Completed or replaced work cannot reactivate an old argument. Player fights may use remembered history without these autonomous restrictions.

Recent incidents remain autonomously relevant for six game hours. Keep up to seven game days of history for player-selected relevance. Retention and per-person/global bounds must be explicit and deterministic. Preserve rows referenced by an active fight or repair window until that reference ends. Use indexed lookups; save admission permits far more actors than the household creation control.

Use recorded directed annoyance as the autonomous candidate set. Do not manufacture an observer's blame merely because an unfinished duty exists. Chore recording can preserve the current obligation for witnesses even when a dish creator differs from its assigned owner, but autonomous chore selection requires the responsible person to be that assigned owner. A historical unscoped chore complaint may inform a player fight and cannot authorize an autonomous one.

## Saved evidence and identity

Add a V20 envelope around frozen V19. Never extend published records or change their enum layouts. Older saves start without invented past grievances or repair promises. Existing running older fights finish under their retained topic and ownership; do not manufacture a concrete old duty for them.

The separate saved resource needs three collections:

1. Grievances: unique monotonic identity, affected and responsible permanent SimIds, cause, optional chore obligation or nuisance source, first/last occurrence, active/history expiry, severity and last completed argument. Capture actual privacy, interruption, nuisance and chore-annoyance events at their owners, not from the reset diagnostic stream.
2. Active fight context: both actors, whether the order is autonomous, exact reason, displayed topic, exact order ID where owned, accepted-start tick and explicit historical-adoption marker. Maintain separate running and pending indexes, each with its exact order context. Current saves require a separate context for every running and autonomous pending fight; queued player fights select at contact. Use `SavedOrderActor` for named and bare player participants; never fabricate SimIds. Reuse the existing outer actor-reference resolver.
3. Chore repair windows: recipient, initiator, exact chore obligation, completed-fight tick, deadline, accepted/attempted/working state, actual post-fight washed units and prior annoyed witnesses. A separate completed fight has a separate deadline. Multiple valid windows may inform one completion, but an observer receives one repair bonus for that completion.

A chore obligation is `(ChoreKey, assigned owner SimId, continuous duty actionable_since)`. This distinguishes fresh dirt and reassignment from an older missed episode. Retain admitted work's identity through real gradual cleaning even when its last dirt falls below the owner's tolerance before the task finishes. Clear continuation on cancellation, replacement, discharge or source removal; fresh work receives a fresh identity.

Validate finite values, live distinct people, actor tags, source references, sorting, uniqueness, bounded histories and times. Hash all behavioral memory. Preserve it through build cancellation/commit, ordinary transactions, land changes and current snapshot views. Death prunes invalid participants and witnesses. Pausing advances neither expiry nor pending decisions.

The new reader may accept the extended fight topic vocabulary only under the V20 outer contract, passed through shared restoration. Historical readers keep their original rejection behavior. Every new extended topic must have a matching valid fight context. Ordinary chat topics remain distinct. Freeze the V19 storage worker and retain its original backup before a V20 overwrite.

Initial retention policy permits 64 grievances per affected person and 100000 globally, plus 16 repair windows per recipient and 100000 globally. Evict the oldest unreferenced history deterministically before admitting more; never evict the cause of a running fight. Index pair, cause and chore witness lookups. Aggregate witness storage must also have an explicit runtime retention bound so the writer cannot produce a save its reader rejects.

Current compiled content uses attributable rules for new games and old-save upgrades. Authenticated historical reference content explicitly selects published fight rules through an appended compiled tuning field, preserving its original random draws and outcomes. Never infer this policy from save version or cell layout, and never alter frozen published wire records.

## Chore response and appreciation

The initial response window is four game hours after a completed chore fight. Only a still-current unfinished assigned duty creates a window. No response is created by an interrupted, generic, random-topic or irrelevant historical fight.

Center acceptance at exactly 0.80 for neutral inputs. Add bounded centered modifiers for cleanliness, responsibility, commitment, the preference for that duty, the recipient's opinion of the initiator and current mood. Initial weights are 0.20, 0.10, 0.05, 0.05, 0.05 and 0.05 respectively; use normalized inputs centered at 0.5 for 0-to-100 traits and zero for signed values. Clamp to 0.05 through 0.98. Save the result of one draw from the existing chore random stream. Reloading, waiting and retries do not reroll it.

An accepted response uses ordinary nondirected chore admission after higher-priority obligations permit it. Do not rewrite the daily willingness decision. Do not create a protected player order. Route failure ends that admission attempt; inability to start because of real higher-priority work may wait until the deadline. Declining the response does not prevent a later genuinely completed matching duty from earning reconciliation within its window.

Ordinary appreciation retains the existing `0.006 + 0.006 * observer cleanliness` reward, but moves from board settlement to genuine completed physical work. Keep the board's commitment and contribution-leader accounting separate. Zero-work finishes and cancellations grant nothing. Actual washing batches can earn appreciation before the household's whole dish duty is complete. Avoid double awards through both washing and board settlement.

The initial repair bonus is `0.08 + 0.04 * affected person's cleanliness`. Award it toward the recipient/worker from the initiator and proven annoyed observers, and reciprocally toward the initiator from the worker. Deduplicate beneficiaries across valid windows. Use the central opinion helper so family scaling and clamps apply once. Resolve the promised duty and consume its repair windows once. For dishes, preserve the largest-contribution definition of who completed the household duty, with the existing SimId tie-break. Store actual units in a bounded V20 ledger keyed by continuous obligation and contributor; frozen board totals continue to serve board accounting only. The recipient must also contribute positive washed units during the repair window. Another person's finish cannot award credit from an older load. Remaining original dish IDs, matched through their source timers, preserve continuity below the owner's threshold until the physical duty ends.

Record annoyed witnesses when the penalty happens. Washing deletes dish rows and visit deduplication data before board settlement, so completion-time inspection of visits cannot recover that history. Include later matching witnesses when settling the repair. Unrelated chores, another worker, fresh dirt and expired promises grant no repair bonus.

## Boundaries and interfaces

1. `terri-core/save_v20.rs` owns the new wire records and envelope.
2. `terri-sim/social_conflicts.rs` owns indexed behavioral memory, event recording, snapshots, restoration and hashing.
3. `terri-sim/fights.rs` owns reason selection, mood probability, exact autonomous order checks and fight context lifecycle. It uses conflict memory and asks `chore_repair` for current overdue obligations.
4. `terri-sim/chore_repair.rs` owns duty identity, the saved compliance decision, ordinary admission, completion matching and reconciliation. Existing chore and domestic owners report actual work and actual annoyed observers.
5. Save integration owns V20 dispatch, actor/topic mode transport, transactions, current test views, browser recovery and writer version. Reuse existing voice timing and assets.

## Verification

Start with behavioral red tests through existing APIs: mood causally changes fight frequency, an actual privacy incident can cause a fight, stale/reassigned duties cannot, and board-disabled real cleanup earns appreciation. Add exact response baseline and modifier tests, one-draw persistence, participant cooldowns, no-reason/no-draw, source resolution before admission and during a system fight, and player random fallback.

Drive real privacy and nuisance producers. Require no invented grievance after load. Test helper versus recipient completion, cancelled partial work, zero units, grouped duties, partial dish batches, clean/messy observers, family scaling, late witnesses, deadline edges, fresh dirt and rejected current payloads. Round-trip during an argument, pending acceptance, admitted cleanup and final partial cleaning with future hashes and random streams unchanged.

Use targeted fault deletion and automated mutations on the new guards. Run relevant local native, browser, format, lint, type, build, changelog and persistence gates. Measure controlled fight frequency and ordinary household play in release, including the existing critical-needs deadlock cohort. Obtain fresh adversarial and played visual review. Merge and publish without duplicate remote checks, then verify the public game.
