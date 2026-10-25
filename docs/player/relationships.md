# Relationships

## Feelings have a direction {#directional-feelings}

Each person has their own opinion of every other housemate. Alex liking Sam does not mean Sam likes Alex. Select Alex and open [People](ui-elements/#people) to read Alex's feelings, then select Sam to see the other direction.

:::illustration sim-people

The labels run from Hostile through Dislikes, Wary and Stranger to Warm, Friendly and Close. Feelings change through contact, conversations, domestic work and incidents. Family ties are a separate classification, so a relative can still be disliked.

Relationships affect how rewarding company feels and how nearby people affect mood. They are separate from the Social meter. A friend in the room can be comforting without directly relieving loneliness.

## What changes feelings {#causes}

| Cause | Whose opinion changes | What helps or harms |
| --- | --- | --- |
| Completed Chat | Each participant's feeling toward the other | Usually positive when the needs and hygiene requirements hold; compatibility affects the gain |
| Disliked chat topic | The listener's feeling toward the initiator | A small penalty replaces that listener's normal completion gain |
| Low-need interruption | Recipient toward the person starting the conversation | A low need left unhelped by the conversation makes the approach unwelcome |
| Critical-need interruption | Recipient toward the initiator | The same problem at critical level has a larger penalty |
| Entering private use | Bathroom user toward the entrant | Entering after private toilet, bath or shower use has begun violates the user's privacy |
| Starting private use beside someone | Existing occupant toward the user | The person already in the room is annoyed when someone starts private use beside them |
| Pleasant proximity | Each eligible person's feeling toward the other, checked separately | Awake housemates close together in the same enclosed room can grow closer |
| Recognized shared activity | Each eligible participant toward the other | Shared media, seated meals and matching pastimes build feelings faster than passive proximity |
| Opposing interests | Each affected person's feeling toward the other | Strongly incompatible activity preferences cause friction during ordinary contact |
| Time passing | Each living person's feeling toward another living person | Positive and negative feelings drift toward neutral |
| Another person's dishes | Observer toward the dishes' creator | Visible mess and a dirty setting that forces standing can cause resentment |
| Completed cleaning | Other living housemates toward the actual cleaner | Physical completion earns appreciation, even without an assignment |
| Argued duty completed in time | Initiator and annoyed witnesses toward the assigned person who did the work; that worker toward the initiator | Finishing the same duty within the repair window gives an additional reward |
| Neglected chore | Other living housemates toward the responsible owner | A missed duty can harm feelings when work and opportunity existed |
| Covering a deliberately skipped duty | Helper toward its owner | The helper can resent the owner even while others appreciate the helper |
| Nuisance from object use | Bothered observer toward the user | Somebody using an object kind the observer strongly dislikes in the same room causes ongoing annoyance |
| Completed Fight | Both participants toward each other | Both lose opinion and receive a temporary negative moodlet |
| Finished portion cooked by someone else | Eater toward the cook | A completed real portion earns appreciation once |

## Conversations and topics {#conversations}

Chat supplies Social and Fun while the participants actually talk. Their own feeling toward the other person controls each person's reward; dislike reduces the benefit but does not eliminate Social. Family adds a separate company bonus. Need delivery does not wait for the friendship reward at completion.

The initiator chooses a topic from enjoyed activities. Each person's bubble reflects their own reaction to that topic. A listener who dislikes it takes a small opinion penalty toward the speaker instead of their ordinary positive completion gain. The initiator's outcome is separate. A topic both enjoy permits positive completion even when ordinary needs or hygiene would otherwise block it.

For other topics, poor Hygiene in the other person or a critical need the chat does not help can block positive friendship gain. Starting a chat when the recipient has an unhelped low or critical need can also cause an immediate interruption penalty. A later interrupted chat earns no completion gain, but does not erase the earlier penalty.

A chat request can wait while the recipient finishes an existing activity, including meal or reading work. The initiator waits outside during private bathroom use. A chat you order also waits for a sleeping recipient to wake up. A housemate never chooses a chat of their own with someone who is asleep, and gives up a chat they were waiting for when the recipient falls asleep; they may ask again after the recipient wakes. New player instructions can redirect either person. See [orders](home-and-controls/#orders) for priority and cancellation.

:::numbers Numbers and limits
An ordinary Chat starts from {{number:tuning.relationship_gain_per_talk}} opinion points per eligible direction at completion, before compatibility and family. The base unmet-need penalties are {{number:tuning.social_unmet_need_penalty}} for low needs and {{number:tuning.social_critical_need_penalty}} for critical needs, before shyness and family. These are opinion points, not Social need points.
:::

## Shared time and compatibility {#shared-time}

Awake housemates close together in the same enclosed room can develop feelings gradually. Ordinary positive contact requires acceptable Hygiene in the other person and no critical need in the subject left unhelped by their current activity. Being disliked does not by itself prevent the relationship recovering.

Eligible shared activity grows feelings faster than passive company. This includes using the same TV or radio, eating real food seated at the same table, or using separate matching reading, exercise or aquarium objects when both accept the pastime. Shared activity replaces the passive contact reward and suspends incompatibility friction during that contact. A conversation uses its completion reward instead of adding proximity rewards while talking.

Strongly hated company is slower to repair: some shared minutes give only ordinary proximity gain rather than the larger communal gain. Hygiene and critical-need requirements still apply. You can create opportunities for recovery without guaranteeing a friendship from one session.

Compatibility comes from activity preferences, disposition traits and hobbies. Shared enjoyment helps; strongly opposing preferences cause friction. Unrelated interests and shared dislikes do not become a shared positive interest. Capability traits, conditions, skill deficiencies and shyness do not create incompatibility by themselves.

Outside is one named area, but it does not make distant outdoor people count as passive room companions. Shared-device and shared-table Social have their own rules. A Social benefit is not proof that every friendship requirement is satisfied.

:::numbers Numbers and limits
Feelings range from -1 to +1, with zero neutral. Ordinary relationship contact requires the same enclosed room within {{number:tuning.relationships.contact_radius}} tiles. Eligible shared contact has {{number:tuning.relationships.shared_activity_multiplier}} times the baseline passive rate, before compatibility and family. At or below {{number:tuning.grief_hated_affinity}}, the larger rate is allowed with probability {{number:tuning.hated_communal_chance}} per contact minute, on a 0 to 1 probability scale. Refused minutes can still receive ordinary proximity gain.

Baseline passive gain is {{number:tuning.relationships.proximity_per_hour}} opinion points per game hour before family. Completed Chat has baseline {{number:tuning.relationship_gain_per_talk}} points in each eligible direction before compatibility and family. Living feelings drift toward zero at {{number:tuning.relationship_decay_per_tick}} opinion points per game minute.
:::

## Privacy and inconvenient interruptions {#privacy}

The room containing a toilet, shower or bath defines its privacy boundary. Entering after use begins annoys the user. Starting private use while someone is already inside annoys that occupant. These are different directions of harm, and open-plan placement can make the boundary larger than expected.

Shyer people are more likely to respect privacy and react more strongly to violations. Autonomous people can choose another fixture, detour or wait. Desperate need can override that avoidance. Direct object orders bypass avoidance, while conversation approaches wait outside occupied private rooms. The opinion consequences still apply.

Leaving a private room is allowed. Necessary commute routes remain usable. A privacy preference does not turn a doorway into a solid wall.

## Meals and appreciation {#meal-appreciation}

Finishing another housemate's cooked portion improves the eater's opinion of its actual cook. This happens once for that eater's portion in the batch, whether they eat seated, standing or at a counter. It is independent of communal meal Social and can occur without the cook present at the table.

Cooking, invitations, plating, collecting food, gathering and interrupted eating award no appreciation. Snacks, a cook eating their own meal, and eating without a matching cooked portion do not count. If the cook has died before completion, the eater still finishes the food without changing their preserved opinion of the cook.

The cook does not automatically gain affection toward the eater, and other diners receive no opinion change from somebody else's portion. Each person's completed portion is their own event. Another cooked batch can reward the same eater again. Food quality does not change this appreciation; family still scales the positive event.

:::numbers Numbers and limits
Completing an eligible portion gives the eater {{number:tuning.meal_appreciation_gain}} opinion points toward the cook before family, once for that eater in that cooked batch. There is no separate daily appreciation cap.
:::

## Mess and nuisance {#mess-and-nuisance}

Old visible dishes can lower mood, including a person's own dishes. Somebody else's dishes can also reduce the observer's opinion of their creator. People with a higher cleanliness preference react more strongly. Fresh mess gets a grace period before ordinary mood penalties and complaints: two game hours continuously at maximum grime, or a full game day unfinished. Cleaning remains available during that time.

A dirty place that makes a diner stand can cause an immediate complaint about the dishes' creator, even during the grace period. Entering the room or noticing a new visible pile can prompt cleanup; staying beside the same pile does not charge a fresh opinion penalty every minute. Returning later can produce another reaction. Completed washing removes the mess and earns [cleaning appreciation](relationships/#chores).

Object likes and dislikes can create another ongoing nuisance. A person strongly disliking TV, radio or exercise can be bothered by someone actively doing that activity in the same room. This harms the bothered person's mood and opinion toward the user. The user's feelings do not change automatically. A harmless object simply existing is different from a disliked activity being used nearby.

## Chores and responsibility {#chores}

The weekly chore board assigns an owner, but someone else can do the work. Completing a physical cleaning task improves every other living housemate's opinion of the actual cleaner. Housemates with a higher cleanliness preference appreciate it more. This works with the board off, without an assignment, and on later completed tasks. A completed batch of dish washing earns appreciation once; the board does not pay it again. The cleaner does not automatically gain affection toward everyone else.

Starting work, carrying dishes, partly wiping a surface or canceling before completion earns no cleaning appreciation. Dirt already removed stays removed. A task that removes nothing earns no reward. Finishing one batch of dishes can earn ordinary appreciation while other dishes remain; repairing an argued duty has stricter requirements below.

When a helper covers an owner who deliberately skipped an overdue duty, the helper can also feel worse toward that owner. At midnight, missed work can produce neglect consequences once for that day's duty, after the [mess grace period](relationships/#mess-and-nuisance). Work must have been needed and the owner must have had an opportunity. A no-work day or unavailable owner is exempt. Settlement waits when the grace period has not ended or the original day's work is still active. A settled duty does not receive repeated settlement penalties.

Liking a chore is separate from responsibility and current needs. A preferred chore can affect the worker's mood; it does not directly rewrite somebody else's opinion. Urgent Hunger, Energy or Bladder can reduce autonomous cleanup even for a meticulous person. Use [Chores](ui-elements/#chores) to inspect duties and [Do now](activities/#housework) to direct actual work.

:::illustration chores-profile

### Repair after a chore argument {#chore-repair}

Completing an argument aimed at the assigned owner about their still-unfinished duty opens a four-game-hour chance to repair feelings. The owner makes one decision about starting that work. A higher cleanliness preference, responsibility, commitment history, liking the chore, liking the initiator and a better mood all make acceptance more likely. Waiting does not give another roll, and a refusal does not prevent you from directing that person to do the duty in time.

Accepted work takes priority over the person's ordinary daily chore decision. Critical needs, work, book returns and your orders still take precedence. A failed route ends that automatic attempt. The four hours keep passing while they wait.

If that same duty is completed in time and its assigned owner earns the completion credit, the argument's initiator and other living housemates who actually complained about that duty gain additional opinion toward that owner. The owner also gains opinion toward the initiator, but not automatically toward the witnesses. These gains depend on each affected person's cleanliness preference and receive normal family scaling. Overlapping arguments cannot pay the same beneficiary repeatedly for one completion.

For floors, surfaces and bins, the assigned owner must complete the physical cleaning task. A helper doing that task earns ordinary appreciation toward the helper, without giving the owner a repair reward.

Dish repair uses the largest actual contribution to the current unfinished duty, rather than whoever washes the final plate. The assigned owner must have that contribution credit and must also wash some dishes during the repair window. If the owner washes most and a helper washes the last plate before the deadline, the owner can still earn repair. If the helper washes most, the owner's final plate cannot earn it. Each washer separately earns ordinary appreciation for their own completed batch. Old washing totals do not count toward new mess, and repair waits until all dishes are washed.

Repair requires the original duty and assignment. Reassignment, replacement mess, a missed deadline, canceled work without completion or an interrupted argument gives no repair reward. Partial washing can keep the original duty open while its remaining dishes still exist. The argument itself neither cleans anything nor erases a recorded missed duty.

:::numbers Numbers and limits
The neutral response probability is {{number:tuning.chore_fight_response_base}} on a 0 to 1 scale, before personal adjustments. The repair window lasts {{number:tuning.chore_fight_response_ticks}} game minutes after the argument finishes. Eligible repair adds {{number:tuning.chore_repair_base}} plus up to {{number:tuning.chore_repair_cleanliness}} opinion points per affected direction, according to that person's cleanliness preference, before family scaling. This is additional to ordinary cleaning appreciation.
:::

## Fights {#fights}

Choose Fight in another person's action menu to direct an argument. Both people meet as they do for a chat. You can order one without a current grievance. Its red topic can come from either participant's recent history, including an old problem already resolved. With no relevant history, the game chooses an ordinary subject. The topic alone does not prove that somebody just caused a new incident.

Fights refill no need. Completing one lowers both participants' opinions of each other and gives both a temporary Had a fight moodlet. It gives no hobby satisfaction, practice or positive friendship reward. Interrupting before completion gives no fight completion loss or moodlet.

An autonomous argument needs an actual grievance against that person: a privacy violation, a nearby hated activity they performed, a chat that interrupted an unhelped low or critical need, or an overdue assigned chore the initiator has actually complained about. A mutually enjoyed chat topic keeps its interruption exemption. Bad mood, grief, work trouble and incompatible interests alone supply no culprit. Dislike alone is also insufficient, and liking someone does not make an argument impossible.

Chore blame must match the current owner and the same unfinished duty. A complaint about someone who made dirty dishes cannot blame a different person merely because that person was assigned to wash them. Cleaning or reassigning the duty removes that reason for an automatic argument. An old recorded miss with no work left does not qualify.

An idle person considers their strongest eligible grievance. A worse mood, stronger dislike and a more severe grievance increase the chance of an argument; a better mood and liking the other person reduce it. The result remains a chance. Privacy violations and need interruptions can prompt one argument each; an ongoing nuisance does not become a new reason every minute. An unresolved chore can become eligible again after a day, while its complaint remains current.

Neither participant can begin an autonomous argument while their Had a fight moodlet is active, while at work or commuting, or during a Hunger, Energy or Bladder crisis. If those needs become urgent, the game withdraws its own argument. It also withdraws an automatic chore argument when that duty is resolved or reassigned, even if the argument has started. The game also never starts an argument with someone who is asleep, and withdraws one that has not started when the other person falls asleep; the grievance can still cause an argument after they wake. A Fight you order waits until a sleeping recipient wakes up. A recent fight while waiting can cancel an automatic argument before it starts. Your explicit Fight orders retain their ordinary priority through critical needs and can take precedence over a pending automatic argument.

A fight does not remove mess, reassign a chore or change its recorded outcome. Completing a relevant chore argument can invite the owner to [do the work and repair feelings](relationships/#chore-repair); the argument alone supplies no repair. There is no physical injury from it.

:::numbers Numbers and limits
A completed fight loses {{number:tuning.fight_relationship_loss}} opinion points in each direction before family. Had a fight contributes minus {{number:tuning.fight_mood_penalty}} mood points for {{number:tuning.fight_mood_ticks}} game minutes and prevents another autonomous argument involving either participant during that time. A later player-ordered fight restarts its timer.

An incident can prompt a new autonomous argument for {{number:tuning.fight_grievance_ticks}} game minutes. An unresolved chore has a repeat delay of {{number:tuning.fight_repeat_grievance_ticks}} game minutes. Player-ordered topics can use incident history for {{number:tuning.fight_history_ticks}} game minutes. The base autonomous probability is {{number:tuning.fight_chance_per_tick}} per eligible game minute on a 0 to 1 scale, before mood, opinion and severity adjustments. There is at most one chance per idle initiator each minute, regardless of how many possible recipients exist.
:::

## Family, fading feelings and loss {#family-and-decay}

Partners, parents, children and siblings have family ties separate from opinion. Family strengthens positive opinion events and softens negative ones. It also adds a separate Social-company bonus. Being related does not make an incompatible topic or privacy violation consequence-free.

Living relationships slowly drift toward neutral. This softens grudges and fades friendships; it does not guarantee forgiveness after an incident. Family does not change that neutral drift. Explicit relationship edits and restored saved feelings retain their own values.

After a death, survivors keep their feelings toward that person for [grief](the-world/#death). A closer positive relationship produces stronger, longer grief. Hatred gives neither grief nor a happiness reward.

:::numbers Numbers and limits
Family multiplies positive opinion events by 1.5 and negative ones by 0.5. Feelings stay within -1 to +1. The Social-company multiplier is the larger of 0.25 or one plus directional feeling times {{number:tuning.relationship_delta_scale}}, with another 0.25 for family. A group chooses its strongest eligible affinity multiplier and adds the family bonus once. That bonus and the opinion-event multipliers are separate effects.
:::

## When nothing changes {#no-effect}

Standing near someone does not directly refill Social. Empty-table sitting provides neither food nor communal meal Social. Preparing food does not earn meal appreciation. Carrying dishes or canceling unfinished cleaning earns no cleaning appreciation. Waiting for an occupied object affects mood without automatically blaming its occupant through a separate waiting penalty.

An interrupted chat earns no completion gain. A failed or rejected shared pastime does not qualify for that activity's company. Poor Hygiene or an unhelped critical need can block positive contact. A meter at its ceiling or a feeling at its limit also cannot gain further points.
