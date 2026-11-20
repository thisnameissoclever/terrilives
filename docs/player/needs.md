# Needs

## Read the meters {#overview}

Every housemate has Hunger, Energy, Hygiene, Bladder, Social, Fun and Comfort. A fuller meter means that need is better met. All seven gradually fall as game time passes, including during travel, preparation, waiting and most activities.

Select a person under Household. Desktop shows needs in the bottom dock; on a phone open [Sim details](ui-elements/#sim-details), then Overview. A need warning tells you what is low, while the activity row tells you what the person is actually doing.

:::illustration sim-needs

An activity can help one meter while another falls. Benefits also have requirements: a television needs another active viewer to supply Social, and hand washing stops at partial cleanliness. Check the [activity reference](activities/#all-actions) before repeating an action that is not solving the problem.

## Hunger {#hunger}

Use the fridge's Grab a snack or Cook breakfast, Cook lunch or Cook dinner action. The cooking label follows the time of day; each starts the same meal process. When cooked portions are available, Eat prepared food on a dining table lets another person collect one. A snack is quicker; a full meal takes preparation and supplies more food.

Getting ingredients, cooking, plating, carrying food and gathering diners do not refill Hunger. The food reward arrives once the eating step completes. Interrupting before then leaves the person hungry. Burnt food provides no meal; the cook returns to the fridge to start again. A capability failure or lower food quality can reduce what a completed meal supplies.

A chair adds Comfort while eating, and eligible seated company adds Social. Those are separate from the food benefit. Standing eating has a small Comfort cost. See [food and meals](activities/#food).

## Energy {#energy}

Use a bed for substantial Energy recovery. Long-sofa Lie down supplies a little Energy alongside Comfort, but upright sitting, TV and company do not replace sleep. Showers, exercise and correspondence cost Energy while they run. Swimming also costs Energy during actual paddling; see [swimming](activities/#swimming).

People automatically claim reachable, unassigned sleeping places. A No assigned bed condition means the person lacks permanent ownership of a place, even if someone is currently using an available bed. Add or make a suitable place reachable, then let game time advance. Ownership and current occupancy are different. Find the assignment under [Personality, habits and bed](ui-elements/#schedule).

Sleep rhythm influences when a person wants bed. Your orders can still keep them awake. With death enabled, prolonged empty Energy is dangerous. See [sleep and beds](activities/#sleep-and-rest).

## Hygiene {#hygiene}

Take a shower or Take a bath for whole-body cleaning. Either one runs until Hygiene is full, so a quick top-up is short and a shower from a very dirty start lasts longer. A person who gets very little from it can reach the time limit first and leave with Hygiene not full. A shower costs more Energy; a bath also supplies Comfort. They cost or give that for every minute you stay, so a longer use costs or gives more. Stopping early, for example by giving another order, keeps only the Hygiene gained in the minutes already spent. Exercise reduces Hygiene.

Wash hands at either sink provides partial cleaning only. Repeated washing cannot raise Hygiene beyond its ceiling. It also cannot remove the body-odor consequences of low Hygiene; bathe to get above that threshold. Washing when already cleaner than the ceiling does not lower the existing meter.

Cleaning dishes, floors, furniture or a bin cleans the home. It does not wash the person. Their cleanliness preference also does not measure current Hygiene. See [bathing and hand washing](activities/#washing).

## Bladder {#bladder}

Use the toilet. It supplies direct Bladder relief during actual use and runs until Bladder is full, unless the person gets very little from it and reaches the time limit first. Stopping early keeps only the Bladder gained in the minutes already spent. The person does not wash their hands automatically afterward, and showers, baths and sinks provide no Bladder benefit. At work, Bladder refills halfway before it becomes Critical. Arriving with Low or Critical Bladder also provides relief.

Toilet, shower and bath use establish [privacy boundaries](relationships/#privacy). A route or fixture may be available physically while someone would prefer to wait out of respect.

## Social {#social}

Chat restores Social for both participants while they talk. Their own feeling toward the other person changes how much each receives, and family adds a bonus. Even disliked company provides some Social. Handle correspondence at a desk also supplies Social while the writer is alone.

Other activities require actual shared participation:

| Activity | What counts as company | What does not count |
| --- | --- | --- |
| TV or radio | Another person actively using the same device | A nearby person, another device, or someone still travelling |
| Meal | Two people actively eating real food in separate chairs facing the same table | Standing eating, carrying a plate, empty-table sitting or different tables |
| Reading, exercise or fish watching | Two people actively using separate matching activity objects, close together in the same room, with both accepting the pastime | One person watching, failed use, travel, or an activity one person rejects |

More participants do not multiply the Social rate. Shared minutes count while the eligibility holds; the bonus ends when the other person stops. Passive proximity can affect feelings and mood but supplies no Social. Fights supply none either. See [company](activities/#company) and [relationships](relationships/#shared-time).

## Fun {#fun}

TV, radio, reading, exercise, correspondence, fish watching, swimming and Chat provide Fun. Hobbies and personal preferences help determine what someone chooses and enjoys. Books also have personal taste and familiarity effects.

Plain sitting or lying down supplies rest rather than entertainment. A chair's own reading Fun is not added again when someone watches TV from it. Repetition makes an activity less appealing and excessive repetition can harm mood, without reducing ordinary need-delivery rates. See [repetition](mood-and-personality/#repetition).

## Comfort {#comfort}

Sitting, reclining, sleeping, bathing, watching fish and swimming can restore Comfort. Models differ; compare the offered action and the seat actually used. TV, radio and meals can add the occupied chair's Comfort while the person actively uses it.

Walking toward a chair or reserving it gives no seat benefit. A sofa used as a TV seat supplies its seating Comfort, without the Energy reward from Lie down. Standing eating has a small Comfort cost; hand washing has no extra Comfort cost. See [chairs](activities/#chairs).

## Why a meter keeps falling {#timing-and-decay}

Ordinary actions deliver benefits and costs over their active minutes. Walking and waiting do not collect them. Most action lengths vary, so a longer use supplies more of a continuous benefit and cost; an interruption stops delivery immediately. Swimming has fixed phases and delivers its action effects only during paddling. Meals pay their food benefit at eating completion, while chair Comfort and dining company accrue only during actual eating.

Personality changes each need's ordinary loss and positive refill. Negative action costs still apply in full. Failed ordinary attempts reduce positive benefits, while cooking quality affects food. A weak benefit may be smaller than ongoing need loss, leaving a falling meter even during the action.

Sleep and work slow ordinary need loss. While someone is at work, meals, toilet breaks and company automatically restore Hunger, Bladder and Social to about halfway before those needs become Critical. Arriving at work with those needs Low or Critical also restores them. The other four needs continue falling. Commuting and waiting to return home receive no automatic refill.

All meters have a floor and ceiling, so excess benefit cannot be saved for later.

:::numbers Numbers and limits
Need meters run from 0 to 100. One game minute is one simulation tick. Positive activity figures describe baseline delivery before personality, ordinary decay, ceilings, failure and conditional company; they are not guaranteed final changes to the meter.

Hand washing stops adding Hygiene at {{number:tuning.need_interactions.handwashing_hygiene_ceiling}}. Body-odor consequences require Hygiene above {{number:tuning.mood_low_need_level}} to disappear. Sleep uses {{number:tuning.asleep_decay_scale}} times ordinary decay and work {{number:tuning.at_work_decay_scale}} times; commuting uses ordinary decay.

| Need | Baseline points lost per game minute |
| --- | --- |
| Hunger | {{number:needs.hunger.decay_per_tick}} |
| Energy | {{number:needs.energy.decay_per_tick}} |
| Hygiene | {{number:needs.hygiene.decay_per_tick}} |
| Bladder | {{number:needs.bladder.decay_per_tick}} |
| Social | {{number:needs.social.decay_per_tick}} |
| Fun | {{number:needs.fun.decay_per_tick}} |
| Comfort | {{number:needs.comfort.decay_per_tick}} |
:::
