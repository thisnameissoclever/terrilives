# Needs and their interactions

This reference explains every need reward and cost in the shipped content,
the conditions that permit delivery, and the reason for each mapping. Update
it when changing an interaction, its advertised effects, seating, or need
delivery. The content files hold balance values; this document explains their
meaning. Dated verification belongs in `docs/evidence/`.

## What each meter represents

| Need | Meaning | Activities that help | Exclusions |
| --- | --- | --- | --- |
| Hunger | Having eaten enough food | Eating a snack or meal | Getting ingredients, cooking, carrying food and sitting beside a table do not feed anyone. |
| Energy | Alertness and physical reserves | Sleeping; a small amount from reclining | Sitting upright, entertainment and company do not replace sleep. |
| Hygiene | General cleanliness, including body odor | Bathing; partial improvement from washing hands | Hand washing cannot clean the whole body or remove the body-odor penalty. |
| Bladder | Relief from needing the toilet | Using a toilet | Sinks, bathing and food do not provide toilet relief. |
| Social | Satisfying company with someone the receiver likes | Conversation and eligible concurrent shared activities | Solo entertainment, solo food, empty tables, travel and passive proximity provide no Social. |
| Fun | Active entertainment or an engaging pastime | Media, reading, exercise, correspondence, aquarium watching and conversation | Plain sitting or lying down restores physical comfort rather than entertainment. |
| Comfort | Physical ease and relaxation | Restful furniture, beds, bathing and watching fish | Washing hands has no Comfort cost. Standing eating has a small physical cost. |

All meters stay between 0 and 100. A positive effect cannot overflow the
ceiling, and a cost cannot take a meter below zero. A missing effect means
that the action leaves that need alone, apart from normal decay.

## Rewards and costs by action

Amounts below are nominal points over the authored duration, before
personality and the meter ceiling. One simulation tick is one game minute.
Ordinary actions deliver a rate throughout actual use. Recipes pay Hunger
once food is consumed at completion; contextual Comfort and Social accrue
only during active eating or shared use.

| Object and action | Authored duration | Need effects | Reason |
| --- | --- | --- | --- |
| Fridge: grab a snack | 20 getting, 30 plating, 35 eating minutes, plus travel | Hunger +40 after eating; standing-eating cost during the counter eating step | The snack is real food. Preparation and travel carry no food reward. Snacks currently use a standing counter step. |
| Cook and eat dinner | 500 working minutes across the recipe, plus travel; 90 eating minutes | Hunger +70 after eating; chair Comfort or standing-eating cost; conditional Social +11 over 90 eating minutes | Food feeds the diner. A chair supplies physical comfort; liked company supplies Social. Food quality does not manufacture either effect. |
| Collect and eat a prepared shared meal | 25 collecting and 90 eating minutes, plus travel | Same meal rewards and contextual costs as dinner | The portion supplies the same food benefit, whether the diner cooked it or collected it. |
| Bunk bed: sleep | 180 minutes | Energy +100, Comfort +5 | Sleep restores Energy. A bunk is a real resting place, with half the double bed's nominal Comfort. |
| Double bed: sleep | 210 minutes | Energy +108, Comfort +10 | A longer sleep and a more comfortable bed provide greater total relief. |
| Shower | 45 minutes | Hygiene +70, Energy -12 | Whole-body washing restores cleanliness. Standing and washing require effort. |
| Bathtub: soak | 78 minutes | Hygiene +58, Comfort +31, Energy -3 | Bathing washes the body; a seated soak relaxes it with less effort than a shower. |
| Toilet | 24 minutes | Bladder +95 | Toilet use directly relieves Bladder. It does not wash hands automatically. |
| Bathroom sink: wash hands | 21 minutes | Hygiene +32, capped at 40; no Comfort cost | Washing hands is useful partial cleaning. It cannot substitute for bathing. |
| Kitchen sink: wash hands | 23 minutes | Hygiene +20, capped at 40; no Comfort cost | This action washes hands, rather than dishes. Its lower cleaning rate is a furniture balance difference, not a different bodily consequence. |
| Television: watch | 55 minutes | Fun +30; conditional Social +24; occupied-chair Comfort when seated | Television entertains. Company and the chair supply their own separate effects. |
| Radio: listen | 38 minutes | Fun +22; conditional Social +5; occupied-chair Comfort when seated | Music entertains. Listening alone provides no Social. |
| Ottoman: sit | 50 minutes | Comfort +34 | Sitting relieves physical discomfort without an active pastime. |
| Long sofa: lie down | 72 minutes | Comfort +43, Energy +9 | Reclining is physically restful, with a small Energy benefit that is much weaker than sleep. Plain reclining provides no Fun. |
| Armchair: sit | 41 minutes | Comfort +29 | Supported sitting relieves discomfort. |
| Dining table: Sit | 62 minutes | Comfort +37; no Hunger or Social | Resting at the table requires a real chair. It creates neither food nor company. Eat is offered separately when a prepared portion is available. |
| Bookshelf: read | 34 minutes | Fun +26; conditional shared-activity Social | Reading is an engaging pastime. Eligible simultaneous reading supplies mild company. |
| Reading chair: read | 46 minutes | Comfort +15, Fun +19; conditional shared-activity Social | The chair provides comfort while the book provides entertainment. |
| Exercise bike: exercise | 83 minutes | Fun +28, Energy -8, Hygiene -5; conditional shared-activity Social | Exercise is an active pastime. Exertion costs Energy, and sweat reduces cleanliness. |
| Desk: correspondence | 58 minutes | Fun +36, Energy -7 | The game treats correspondence as engaging desk work with a small effort cost. It is not a conversation with another household Sim and provides no Social. |
| Aquarium: watch fish | 67 minutes | Fun +25, Comfort +21; conditional shared-activity Social | Watching fish entertains and relaxes the viewer. Eligible shared watching also provides mild company. |
| Chat | 67-minute authored rate; actual length follows the chosen voice clips | Social +50.25 and Fun +10.05 over 67 minutes; Social requires positive receiver affinity | Conversation entertains and provides satisfying company. Each participant's own feeling controls their Social reward. |
| Clean dishes, including a targeted pile or surface | Collection and washing work, plus travel | No direct need reward | Cleaning removes dishes and their environmental mood consequences. It does not wash the Sim's body or refill a need. |
| Clean floor | 24 work minutes per patch, plus travel | No direct need reward or additional need cost | Work removes actual grime and its mood effect; normal need decay accounts for time spent working. |
| Wipe surface | 45 work minutes, plus travel | No direct need reward or additional need cost | Wiping cleans furniture rather than the Sim. Grime, mood and commitment credit change separately. |
| Empty bin | 60 work minutes, plus travel | No direct need reward or additional need cost | Waste removal changes the household environment and commitment outcomes; it does not refill a bodily need. |

Objects without actions or a secondary seating role do not refill needs.
Decoration can affect presentation or the environment without becoming a
need interaction. A dining chair or desk chair can supply Comfort while used
as a secondary seat, despite having no standalone action.

## Actual chair Comfort

Media and meals use the occupied chair's rate. Furniture with its own resting
action uses that action's positive Comfort divided by its authored duration.
Chairs without a standalone action have an explicit `seat_comfort_per_tick`
value in `content/objects.toml`.

| Occupied seat | Comfort per game minute | Source |
| --- | --- | --- |
| Dining chair | 37 / 62, approximately 0.597 | Authored secondary-seat value, matching table sitting's baseline |
| Desk chair | 37 / 62, approximately 0.597 | Same simple-chair baseline |
| Ottoman | 34 / 50 = 0.68 | Its own sitting action |
| Long sofa | 43 / 72, approximately 0.597 | Its own resting action |
| Armchair | 29 / 41, approximately 0.707 | Its own sitting action |
| Reading chair | 15 / 46, approximately 0.326 | Its own reading action |

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

## Social requires actual, liked company

Relationship affinity is a directional feeling between -1 and +1. The receiver must have
a value strictly above zero toward at least one eligible participant. One-way
liking can therefore restore one Sim's Social without restoring the other's.
More participants do not multiply the rate.

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
4. **Chats:** each receiver must like the other participant. A neutral first
   chat can develop friendship without refilling Social; later chats can
   refill it once the receiver's feeling becomes positive. Conversation Fun
   remains separate from that Social condition.

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
scale positive need delivery by `1 + affinity * 0.5`; direct chat Social still
requires strictly positive relationship affinity.

Skills improve through completed attempts and influence capability-linked
fumble chances through mastery; practice itself refills no need. Repetition
above the ordinary appeal range can create Overdoing and Feeling sick
moodlets. Those affect mood and life satisfaction, without changing the
need-delivery rates. Object likes and dislikes also affect mood, and annoyance
at another Sim's media use can lower the relationship feeling that permits
Social. They do not directly refill needs or replace relationship affinity.

Autonomous scoring, private-room alternatives, urgent-need decisions and
waiting frustration use effects available at the planned destination. They
exclude capped hand washing and unavailable company, and include a valid
media seat's Comfort and eligible shared activity. Cooking cannot promise a
future seat or liked dining company before diners actually sit together.

Every need also decays throughout ordinary life:

| Need | Points lost per game minute before modifiers |
| --- | --- |
| Hunger | 0.062 |
| Energy | 0.051 |
| Hygiene | 0.072 |
| Bladder | 0.102 |
| Social | 0.026 |
| Fun | 0.048 |
| Comfort | 0.032 |

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

## Source and verification map

| Responsibility | Source |
| --- | --- |
| Authored actions, rewards, durations and secondary chair values | `content/objects.toml` |
| Food preparation, consumption and cleanup | `content/chains.toml` |
| Conversation rates | `content/social.toml` |
| Caps, contextual rates, decay and modifier values | `content/tuning.toml` |
| Personality, trait and hobby preferences | `content/personalities.toml`, `content/traits.toml`, `compatibility.rs` |
| Contextual benefits, caps and physical Comfort delivery | `crates/terri-sim/src/need_interactions.rs` |
| Actual participants and positive-affinity company gates | `crates/terri-sim/src/social_company.rs` |
| Ordinary, recipe and chat delivery | `crates/terri-sim/src/systems/interact.rs`, `chain.rs`, `social.rs` |
| Physical claims and valid seating | `crates/terri-sim/src/seating.rs`, `media.rs`, `dining.rs` |

Regression tests must verify actual need changes, including negative cases,
interruption and save/load. A score or pose alone does not prove delivery.
Follow [the testing protocol](testing-protocol.md) to delete each important
guard, observe its test fail, restore it and check the original bytes.
