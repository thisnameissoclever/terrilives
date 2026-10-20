# Needs and their interactions

This reference explains every need reward and cost in the shipped content,
the conditions that permit delivery, and the reason for each mapping. Update
it when changing an interaction, its advertised effects, seating, or need
delivery. The content files hold balance values; this document explains their
meaning. Dated verification belongs in `docs/evidence/`.

Base need drain rates are two thirds of the previous balance. Existing
personality, sleep and work multipliers still apply to those rates.

## What each meter represents

| Need | Meaning | Activities that help | Exclusions |
| --- | --- | --- | --- |
| Hunger | Having eaten enough food | Eating a snack or meal | Getting ingredients, cooking, carrying food and sitting beside a table do not feed anyone. |
| Energy | Alertness and physical reserves | Sleeping; a small amount from reclining | Sitting upright, entertainment and company do not replace sleep. |
| Hygiene | General cleanliness, including body odor | Bathing; partial improvement from washing hands | Hand washing cannot clean the whole body or remove the body-odor penalty. |
| Bladder | Relief from needing the toilet | Using a toilet | Sinks, bathing and food do not provide toilet relief. |
| Social | Company, with affinity and family scaling its benefit | Conversation and eligible concurrent shared activities | Correspondence provides Social while alone. Solo media, solo food, empty tables, travel and passive proximity provide no Social. |
| Fun | Active entertainment or an engaging pastime | Media, reading, exercise, correspondence, aquarium watching and conversation | Plain sitting or lying down restores physical comfort rather than entertainment. |
| Comfort | Physical ease and relaxation | Restful furniture, beds, bathing and watching fish | Washing hands has no Comfort cost. Standing eating has a small physical cost. |

All meters stay between 0 and 100. A positive effect cannot overflow the
ceiling, and a cost cannot take a meter below zero. A missing effect means
that the action leaves that need alone, apart from normal decay.

## Rewards and costs by action

The complete player explanation is authored in [Activities](player/activities.md), with per-need entry points in [Needs](player/needs.md). The generated baseline table reads `docs/player/generated/reference.json`, exported from the current compiled pack. It includes resolved object-specific recipe schedules rather than substituting generic chain defaults. Do not maintain a second hand-copied numerical table here.

The engineering contract distinguishes ordinary per-use rates, food completion payments, secondary chair Comfort and contextual Social. Preparation and travel do not grant the later food reward. Standing eating has its own Comfort cost. Cleaning the home changes grime, dishes and mood rather than bodily Hygiene. Work, sleep, personality, actual use, ceilings and interruptions remain part of physical delivery.

## Actual chair Comfort

Media and meals use the occupied chair's rate. Furniture with its own resting
action uses that action's positive Comfort divided by its authored duration.
Chairs without a standalone action have an explicit `seat_comfort_per_tick`
value in `content/objects.toml`.

Current chair values come from the compiled object actions and `seat_comfort_per_tick` entries in the generated reference. Use the resolved rate of the chair actually occupied, not a default dining-chair value for every model.

The rate applies only while actively using the claimed chair. Merely reserving
a seat, walking toward it or standing beside it gives no secondary Comfort.
Meal chairs must face their claimed table. Media chairs must remain valid for
the device and occupied endpoint. Interruption stops delivery immediately.

Secondary use copies only Comfort. Watching television from a sofa does not
also collect the sofa's Energy reward; that belongs to reclining. Reading
chair Fun belongs to reading, so it is not added to television or radio Fun.
An ordinary sitting action receives its own authored Comfort once, without
an extra secondary-seat payment.

Standing eating costs `2 / 90`, approximately 0.0222 Comfort per actual eating
minute. A nominal 90-minute standing meal costs 2; a 35-minute standing snack
costs approximately 0.778. The cost applies to real food consumption, including
tableless eating. Gathering diners, preparing food, carrying a plate, waiting
and walking do not incur it. This cost is additional to normal Comfort decay.
Snacks currently do not claim dining chairs, so they provide no chair Comfort
or communal meal Social. The full meal chains own food consumption at dining chairs. Standalone table
sitting also claims a real chair, but receives only its own authored Comfort
and no secondary-seat or Social bonus.

## Hand washing's limit

`handwashing_hygiene_ceiling` is 40 in `content/tuning.toml`. Each sink stops
adding Hygiene at that level. Washing at a higher level neither adds Hygiene
nor reduces existing cleanliness. Positive personality multipliers cannot
cross the cap, and repeated washing cannot raise it.

The ceiling cannot exceed the low-Hygiene threshold used for body-odor
consequences. Those consequences require Hygiene above 40 to disappear, so
hand washing alone cannot remove them. Bathing has no partial-wash ceiling
and can restore Hygiene toward 100. Both hand-washing actions leave Comfort
unchanged apart from normal decay.

## Social from company and correspondence

Relationship affinity is a directional feeling between -1 and +1. Company
provides a positive Social benefit even at maximum dislike. Its multiplier is
`max(0.25, 1 + affinity * relationship_delta_scale)`, with another 0.25 for
family. The shipped relationship scale is 0.5. A group uses the strongest
eligible affinity multiplier and adds the family bonus once if any eligible
participant is family. More participants do not multiply the rate.

1. **Television and radio:** another Sim must actively use the same device
   and interaction. A reservation or a travelling co-user is insufficient.
   Seated and valid standing users can participate. The device's valid viewing
   area determines shared use; the generic friendship contact radius and room
   boundary do not impose extra Social restrictions on the same device.
2. **Meals:** both diners must actively consume real food in separate chairs
   facing the same table. Standing diners, empty-table sitting, nearby tables
   and someone carrying a plate do not count. Food can come from different
   portions or cooking batches. Social is paid only for overlapping eating
   minutes, rather than as an unconditional completion reward.
3. **Reading, exercise and aquarium watching:** both Sims must actively use
   different objects with matching `shared_activity` metadata, in the same
   room within four tiles. Both must accept that activity according to their
   personality, traits and hobbies. A failed activity does not count. The
   additional rate is 0.12 Social per overlapping game minute.
4. **Chats:** each participant receives Social scaled by their own affinity,
   family relationship and satisfaction multiplier. Neutral and disliked
   partners still provide company. Conversation Fun remains a separate reward.

Walking, working off-lot, commuting and interruptions exclude active shared
participation. General proximity can develop friendship or affect mood, but
does not refill Social. Shared-activity recognition and need delivery are
derived from current state; save/load does not store a separate company bonus.

## Delivery, modifiers and decisions

Ordinary actions use `authored delta / authored duration` as their rate. Their
actual lengths vary by up to 40 percent around the authored duration, with a
bias toward shorter actions. Longer use therefore gives more total benefit
and cost; interruption gives only the minutes actually completed. Recipes
instead pay their food benefit once after consumption.

Personality's per-need satisfaction multiplier scales positive delivery.
Costs arrive in full. Failed ordinary actions reduce positive benefits,
and food quality reduces recipe food benefits. Food quality and a cooking
failure do not scale chair Comfort or companionship Social: the chair and
other diner remain the sources of those effects.

Habituation, which makes repetition less appealing, activity preferences,
hobbies and sleep rhythm affect action choice. They are not extra need
payments. Hobbies also scale completion-based life satisfaction. Conversations
scale positive Social delivery by the affinity and family formula above. Other
positive chat benefits retain their existing affinity scaling.

Skills improve through completed attempts and influence capability-linked
fumble chances and the chance that a meal burns at the hob through mastery;
practice itself refills no need. A burnt meal feeds nobody and sends the cook
back to the fridge. Repetition
above the ordinary appeal range can create Overdoing and Feeling sick
moodlets. Those affect mood and life satisfaction, without changing the
need-delivery rates. Object likes and dislikes also affect mood, and annoyance
at another Sim's media use can reduce the affinity multiplier on
Social. They do not directly refill needs or replace relationship affinity.

Autonomous scoring, private-room alternatives, urgent-need decisions and
waiting frustration use effects available at the planned destination. They
exclude capped hand washing and unavailable company, and include a valid
media seat's Comfort and eligible shared activity. Cooking cannot promise a
future seat or dining company before diners actually sit together.

Autonomous critical-need selection additionally estimates the net physical result after
travel, waiting, work and decay. Critical needs never override explicit player
orders; need decay and death remain enabled under the
[player-order contract](specs/2026-10-17-player-orders.md). If useful critical relief is available,
unrelated actions share at most 5% probability with one critical need or 1%
with several. Self-preservation and preferences still influence which useful
action appeals most. A chosen conversation remains committed while the
recipient finishes care; low meters do not repeatedly cancel and restart it.
Prediction and delivery share physical reward scaling and restoration ceilings.
Reading retains its physical taste and disposition effects. During critical-need selection, each eligible book and seat contributes its own predicted outcome to the shared choice distribution. Execution uses that selected plan without a second title draw. Forecasts separate
active rewards from travel, pickup, return and shelving, and apply food payment
after work's decay has clamped at zero. Unknown future failures and changes in
company still make these nominal forecasts rather than guaranteed outcomes.
See the [autonomy specification](specs/2026-09-30-varied-autonomy.md).

Every need also decays throughout ordinary life:

| Need | Points lost per game minute before modifiers |
| --- | --- |
| Hunger | 0.0413333333 |
| Energy | 0.034 |
| Hygiene | 0.048 |
| Bladder | 0.068 |
| Social | 0.0173333333 |
| Fun | 0.032 |
| Comfort | 0.0213333333 |

Personality multiplies each decay rate. Sleeping multiplies decay by 0.4;
being at work multiplies it by 0.5. Commuting uses normal decay. Work provides
no direct need reward. The calendar and career working days determine when
that work modifier applies; days off retain normal decay. Normal decay can make a meter fall during an action
whose positive rate is too small to offset it.

## Systems that are not need refills

Mood combines current needs, conditions, nearby relationships, grief,
environmental mess and waiting. Removing dishes can improve mood without
giving Hygiene points. Being near a friend can improve mood without providing
Social points. A low meter can also block positive friendship development
unless the current activity actually helps that need.
An active food recipe counts its eventual food benefit for this friendship
readiness check. Chair Comfort and companionship count only when their actual
participation conditions hold. Future action offers are not evidence that an
interrupted or failed activity is currently helping a need.

Friendship changes a Sim's directional affinity toward another Sim. It does
not convert affinity points into need points. Life satisfaction records
completion rewards and long-term mood; it is separate from all seven meters.

Fights provide no need reward. Current autonomous arguments require an attributable grievance; player orders can use relevant history or an ordinary subject. Completed physical cleaning can earn directional appreciation even with the board off. Completing an argued assigned duty can separately repair feelings. These effects change relationships rather than bodily needs; the [public relationship reference](player/relationships.md#fights) and [fight contract](specs/2026-10-16-fights.md) own the requirements and exceptions.

## Source and verification map

| Responsibility | Source |
| --- | --- |
| Authored actions, rewards, durations and secondary chair values | `content/objects.toml` |
| Food preparation, consumption and cleanup | `content/chains.toml` |
| Conversation rates | `content/social.toml` |
| Caps, contextual rates, decay and modifier values | `content/tuning.toml` |
| Personality, trait and hobby preferences | `content/personalities.toml`, `content/traits.toml`, `compatibility.rs` |
| Contextual benefits, caps and physical Comfort delivery | `crates/terri-sim/src/need_interactions.rs` |
| Actual participants and affinity/family company scaling | `crates/terri-sim/src/social_company.rs` |
| Argument admission, subjects and cleanup appreciation/repair | `crates/terri-sim/src/social_conflicts.rs`, `fights.rs`, `chore_repair.rs` |
| Ordinary, recipe and chat delivery | `crates/terri-sim/src/systems/interact.rs`, `chain.rs`, `social.rs` |
| Physical claims and valid seating | `crates/terri-sim/src/seating.rs`, `media.rs`, `dining.rs` |

Regression tests must verify actual need changes, including negative cases,
interruption and save/load. A score or pose alone does not prove delivery.
Follow [the testing protocol](testing-protocol.md) to delete each important
guard, observe its test fail, restore it and check the original bytes.
