# Privacy avoidance and relationship development

This implements [needs and privacy behavior](2026-09-30-need-social-privacy.md) under the [approved plan](../superpowers/plans/2026-09-30-relationship-development.md), composed with individual sleeping places and meals/cleanup. [Publication evidence](../evidence/relationship-development/publication/verification.md) records the combined build's measurements, checks and limitations. Earlier [relationship](../evidence/relationship-development/verification.md), [bed integration](../evidence/relationship-development/bed-integration.md) and [starting-layout](../evidence/relationship-development/bed-layout.md) records describe their respective historical revisions.

## Deliberate privacy choices

The significant base penalties remain 0.11 for a low unmet need, 0.20 for a critical unmet need and 0.25 for a bathroom privacy violation. The offended person's shyness still scales the reaction. Privacy uses the actual room containing the active toilet, shower or bath, including a living room containing a toilet.

Autonomous errands, chain routes and wandering share a privacy check. A Sim normally seeks a route around active private use or a free substitute that satisfies the original activity's most depleted need. A chain substitute must serve the current step's role and preserve fixed domestic stations, communal capacity and distinct dining seats. The policy builds a temporary traversal grid; it never edits the lot's real walkability. Stroll detours retain the distance already walked and must fit the original stroll limit. Waiting keeps the actor's reservation and unfinished chain. Changing destinations releases only the actor's previous claim. Bed substitutes retain separate physical places and preserve the other sleeper's reservation. Newly generated routes use the chosen place's authored approach and contact edge, with the object's authored facing as the fallback. Safe assigned places retain their preference across beds; survival risk can override that preference.

When there is no safe substitute, the Sim waits before crossing the boundary or beginning private use beside an occupant. Both checks run during ordered movement, so a route chosen earlier cannot ignore someone who arrived or began using the bathroom earlier in the same tick. Emergency checks revalidate alternatives against that updated occupancy. Leaving a room always remains possible. A waiting Sim can attend to another critical need at available furniture, then resume an unfinished chain. If that urgent furniture also requires a private route, the Sim first changes to the relevant goal, then applies its normal waiting/emergency rule. Clearing the original obstruction does not erase an unrelated urgent need accumulated during the wait.

Occasional lapses remain possible. The decision lasts 30 simulated minutes, including across repeated selections and save/load; repeated checks cannot fish for a successful roll each tick. The cached respect probability is 0.65 at shyness 50, adjusted by `0.08 * (shyness - 50) / 50`. Higher shyness increases respect. Clear conditions allow immediate progress without waiting for that cache to expire. There is no weekly incident quota.

A critical need that the blocked action would satisfy can override waiting after ten minutes without a safe substitute. A relevant need at or below five overrides immediately. An unrelated critical need does not license barging into a bathroom to watch television. Explicit player orders bypass avoidance. Commutes seek a detour but may use a required route. Every actual violation retains its normal directional consequence.

An already-critical goal remains selected while waiting. Another need can replace it when it reaches five or below and the current goal's need is still above five. These existing urgency classes prevent two critical needs from repeatedly swapping targets and resetting the wait timer.

The earlier small scoring preference against inconvenient conversations remains. Conversation penalties are recorded separately from privacy penalties.

## Compatibility

Compatibility is directional and derived from authored preferences. For each activity tag, average the personality's explicit interaction weights, defaulting to one. Multiply by matching disposition-trait weights, subtract one, add 0.5 if the tag is a hobby, then clamp to [-1,1]. Repeated tags and hobbies count once. The structural bathroom-privacy tag is excluded.

For A's opinion of B, sum the products of overlapping preferences, except that two dislikes contribute zero. Divide by the larger of one and the sum of A's absolute preference strengths. Shared interests help, opposing preferences cause friction and unrelated interests are neutral. Names, capability traits, condition traits and shyness do not determine compatibility.

Scores below -0.2 produce friction. Scores at or above -0.2 permit pleasant-proximity gains. Each direction is evaluated separately. Positive conversation and shared-activity gains use `clamp(1 + compatibility, 0.25, 2)`. Friction grows linearly from zero at -0.2 to its full authored rate at -1.

## Company and activities

Contact is evaluated once per simulated minute. Both Sims must be awake, present, in the same architecture-derived room and within four tiles. Sleep, private bathroom use, commuting and time away at work are excluded.

A positive change in A's opinion requires B's hygiene above the low-need threshold and no critical need of A's left unhelped by A's current activity. Active chain work and both live conversation roles count as helping their advertised needs; interrupted conversations do not. A failed attempt with no positive delivery cannot claim to help. Existing dislike and relationship-derived mood never prevent recovery.

Pleasant proximity gains 0.075 per eligible simulated hour. Recognized shared activity pays ten times that rate before compatibility scaling, replaces the proximity reward and suspends incompatibility friction for the pair during that activity. Recognition requires simultaneous matching `shared_activity` metadata on different objects, with neither person disliking the activity and neither attempt having failed. Initial supported groups are reading, exercise and aquarium watching. Matching room occupancy alone does not qualify.

A conversation keeps one completion reward, with a calibrated base of 0.17. The conversation pair does not also earn proximity or shared-activity rewards. Need delivery, sampled duration and hobby satisfaction remain governed by their existing rules. An unmet critical need can prevent a positive completion reward even though the conversation still delivers its ordinary benefits. The strongest incompatibility friction is 0.0075 per eligible hour.

The existing drift toward neutral still applies. Affinity continues through existing social scoring, nearby-relationship mood and mood-driven satisfaction. Household mess has its separate cleanliness-scaled directional penalty, `0.0003 + 0.0027 * cleanliness`, while its noticing, mood and cleanup rules remain governed by the domestic system. There is no duplicate satisfaction charge and no automatic forgiveness timer.

## State and measurement

V5 retains the published self-preservation, chronotype and domestic fields, then the grouped optional sleeping-place state, before appending shyness and sparse boundary decisions: stable actor identity, lapse decision and expiry, waiting start, current goal and player-directed chain origin. The loader validates identities, references and time bounds before replacing the live world. This behavioral state enters the world hash. Earlier V5 saves default to no pending decision; loading does not replay an incident or reroll a saved decision. A frozen decoder preserves the earlier local bed format. Compatibility, room membership and activity recognition remain derived.

The native diagnostic journal exposes each tick's cause, responsible and affected Sim, requested change and actual change after clamping. Privacy victims from one action share an event ID. Separate records cover conversation completion, low/critical interruptions, privacy entry/start, proximity, activity, incompatibility, household mess and decay. Contact and blocked-wait observations are read-only. Journals consume no randomness and enter neither saves nor hashes.

`cargo run --release -p terri-sim --example trace -- 120000` reports the shipped household's contributions, contact, waits, incident recoveries and hostile directions. `relationship_balance` runs the reproducible calibration matrix: seeds 1-16 for calibration, 17-24 for validation, seven settling days and 56 measured days. It includes the shipped household and furnished two-, three- and four-person layouts, controlled recovery from 0 and +0.5, and strongly incompatible Sims with privacy penalties disabled.

Acceptance targets are 0.75-1.25 ordinary autonomous incidents per Sim-week, mean recovery in 1.5-2.5 days, mean strong-incompatibility hostility within 14-28 days and at least 90% of non-incompatible directional samples above -0.5. Emergencies, player orders, subsequent incidents and unfinished recoveries must remain visible in the report. Open-plan toilets and inadequate facilities are stress cases outside the ordinary frequency target. Calibration changes avoidance first, positive gains second and incompatibility friction third, then rechecks every target.

The historical 168-scenario matrix on `66a248ec` measured 1.0820/1.1276 ordinary incidents per Sim-week in calibration/reused validation, pooled across layouts. Recovery means were 1.5040/1.9346 days from zero and 2.1861/2.3726 from +0.5. Strong incompatibility reached -0.5 in 17.2593/21.7364 days on average with privacy penalties disabled. Non-incompatible samples stayed above -0.5 in 99.4996%/98.6688% of observations. All controlled recoveries and incompatible directions finished.

A predeclared fresh cohort, seeds 25-40, added 112 scenarios after tuning froze. It independently met the aggregate targets: 1.1009 incidents per Sim-week, recovery in 1.5240/1.8552 days, hostility in 20.8396 days and 99.1156% of non-incompatible samples above -0.5. Seeds 17-24 were reused after a failed recovery-rate trial; their final result is acceptance evidence, not an untouched holdout.

In that historical matrix, the weekly target passes only in aggregate. The shipped layout has nearly two incidents per Sim-week, and its validation non-hostile sample percentage is 89.79%. Two-person homes have far fewer incidents. The normal furnished fixture now includes independent Social relief from a television; `--social-stress` retains the earlier fixture without it. Adding the television changes other choices too and does not prove a general social-scheduling fix. These fixtures demonstrate shared reading and aquarium watching; they contain only one exercise bike.

The report retains per-layout variation, recovery tails, outstanding chains and empty-need episodes. Focused regressions prove critical-need access and stable waiting behavior; household traces cannot prove that no earlier privacy delay contributes to later deprivation. A longer run with authored stats still ended with five hostile directions and many unfinished natural recoveries. Average targets do not promise two-day recovery for every household or incident. Earlier implementation results remain available as historical evidence.

## Remaining work outside this slice

Shared meals and meal invitations are implemented by the [domestic system](2026-09-30-meals-and-cleanup.md). They do not yet qualify for the shared-activity affinity bonus. Shared televisions and general coordinated groups still need participation and reservation support. Object-waiting affinity, fights, relationship-triggered invitations and extroversion thresholds remain planned.

Hostility presentation is tracked as [B-hostility-expression](../FEATURES.md#b-hostility-expression-make-interpersonal-hostility-visible): directional visual indicators, accessible reactions and possible animations, plus mild avoidance of activities in a disliked person's room. That future avoidance must yield to needs and player orders and trigger a new pacing check when it reduces contact.
