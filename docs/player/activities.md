# Activities

## All actions at a glance {#all-actions}

Select a person, then click or tap an object for its default action. Right-click or long-press for a particular action. The [object menu](ui-elements/#object-menu) shows the available choices; More actions opens another page when needed.

:::illustration object-menu

This table lists direct need effects. [Baseline values](activities/#baseline-values) gives the current model-specific reference numbers. A blank benefit is meaningful: the action may change the home, mood, skills or long-term satisfaction while refilling no need. Ordinary need loss continues throughout.

On a narrow screen, scroll a table sideways to read its remaining columns. With a keyboard, focus the table and use the arrow keys.

| Object or action | Direct benefit | Cost or limit | Company |
| --- | --- | --- | --- |
| Fridge: Grab a snack | Hunger after completed eating | Preparation supplies no food; standing eating costs some Comfort | No communal Social |
| Fridge: Cook breakfast, Cook lunch or Cook dinner | Hunger after completed eating | Preparation takes time; failure and food quality matter | Social only during eligible seated eating |
| Dining table: Eat prepared food | Hunger after completed eating | Requires an available real portion | Eligible seated eating supplies Social; completing another person's portion also gives appreciation |
| Bunk bed: Sleep | Energy and Comfort | Uses an available sleeping place | No Social |
| Bed: Go to bed | Energy and Comfort | Uses an available sleeping place | No Social |
| Shower: Take a shower | Hygiene | Costs Energy | No Social; private use |
| Bathtub: Take a bath | Hygiene and Comfort | Small Energy cost | No Social; private use |
| Toilet: Use the toilet | Bladder | No automatic hand wash | No Social; private use |
| Bathroom sink: Wash hands | Partial Hygiene | Cannot clean beyond the hand-washing ceiling | No Social |
| Kitchen sink: Wash hands | Partial Hygiene | Lower cleaning rate; same ceiling | No Social |
| Television: Watch TV | Fun; occupied-seat Comfort when seated | Standing gives no chair benefit | Social only with another active user of the same television |
| Radio: Listen to the radio | Fun; occupied-seat Comfort when seated | Standing gives no chair benefit | Social only with another active user of the same radio |
| Ottoman: Sit | Comfort | No Energy or Fun | No Social |
| Long sofa: Lie down | Comfort and a little Energy | Does not replace sleep; no Fun | No Social |
| Long sofa: Sit | Comfort | Sitting differs from Lie down | No Social |
| Armchair: Sit | Comfort | No Energy or Fun | No Social |
| Dining chair: Sit | Comfort | No food benefit | No Social |
| Desk chair: Sit | Comfort | No correspondence benefit | No Social |
| Pool lounger: Sit | Comfort | Sitting provides no swimming or sun-related need reward | No Social |
| Dining table: Sit | Comfort through a real chair | No Hunger; requires a usable chair | No Social |
| Bookcase: Read book | Fun, with actual reading-seat effects | Requires an available reachable copy; taste and familiarity matter | Conditional shared reading |
| Ottoman, sofa, armchair, dining chair or desk chair: Read a book | Fun and the reading action's Comfort | Real book and usable seat required; models differ | Conditional shared reading |
| Reading armchair: Sit and read | Fun and Comfort | Real book required; differs from its plain Sit action | Conditional shared reading |
| Exercise bike: Use the exercise bike | Fun | Costs Energy and Hygiene | Conditional shared exercise on separate bikes |
| Desk: Handle correspondence | Social and Fun | Costs Energy | Works alone; does not require a housemate |
| Aquarium: Watch the fish | Fun and Comfort | Watching another person is not participation | Conditional shared watching at separate aquariums |
| Person: Chat | Social and Fun for both | Actual talking time counts; friendship outcome depends on topic and circumstances | Conversation itself supplies company |
| Person: Fight | No need benefit | Completed fights harm both people's feelings and mood | No Social |
| Clean dishes | No direct need benefit | Must collect and wash actual dishes | Completed washing earns appreciation toward the cleaner |
| Clean floor | No direct need benefit | Cleans reachable dirty patches | Completed cleaning earns appreciation toward the cleaner |
| Wipe surface | No direct need benefit | Cleans grime rather than dishes or the person | Completed cleaning earns appreciation toward the cleaner |
| Empty bin | No direct need benefit | Removes accumulated waste | Completed emptying earns appreciation toward the cleaner |
| Work | No direct need benefit | Scheduled Energy cost and time away | No household company while away |
| Walk, wait, carry or prepare | No direct need benefit | Time passes before relief | No Social from these stages |
| Buy, sell, move, rotate, recolor, recover a book or edit the home | No direct need benefit | Funds, space and placement rules apply | No direct relationship reward |
| Stove and counter without a recipe running | No standalone need benefit | They are stations within food preparation, not separate eating actions | No Social |
| Washer-dryer and pool | No direct need benefit | They currently offer no washing or swimming action | No Social |
| Patio umbrella, potted plant, floor lamp, coat rack, nightstand and dresser | No direct need benefit | Furniture, decoration or lighting does not itself refill needs | No Social |

## Food: preparation and eating {#food}

Grab a snack uses the fridge and counter, then eats at the counter. It is a standing snack. The full-meal action is labeled Cook breakfast, Cook lunch or Cook dinner according to the game time. All three labels start the same meal-preparation process: take ingredients through the kitchen stations, then eat. A cooking attempt can prepare extra portions for hungry friends. Eat prepared food on a dining table collects an available portion and runs its own eating step.

Hunger relief arrives only after consumption finishes. Travelling, cooking, collecting a plate and gathering diners provide none. Interrupting the eating step delays the food reward. Burnt meals feed nobody and send the cook back to the fridge. Food quality and cooking failure affect the food benefit, while a chair's Comfort and company remain separate.

A real dining chair must face the table. Occupied, dirty, missing or inaccessible seats can make a diner stand instead. Standing food still feeds them, but costs a little Comfort and gives no communal meal Social. The same is true at a counter without a table.

Seated diners gain Social only during their overlapping eating minutes at the same table. The food can come from different batches. Completing someone else's cooked portion also improves the eater's opinion of its cook, even when eating alone or standing. See [meal appreciation](relationships/#meal-appreciation).

Cooking and eating leave dishes. These are separate from surface grime. Clean dishes removes the dishes; Wipe surface removes grime. A dinner does not clean up after itself.

## Sleep and rest {#sleep-and-rest}

Sleep and Go to bed restore Energy and some Comfort. The bunk and double bed have different durations and comfort. A bed's permanent owner and the person currently occupying it are separate facts. People claim reachable free sleeping places automatically as the simulation advances.

Lie down on the long sofa gives Comfort and a small Energy benefit. Sit gives Comfort without that reclining Energy reward. Plain sitting and reclining provide no Fun or Social. Watching TV from a sofa uses the TV action with the seat's Comfort; it does not also run Lie down.

## Bathing, hands and the toilet {#washing}

Take a shower restores Hygiene at an Energy cost. Take a bath restores Hygiene and Comfort with a smaller Energy cost. Both are whole-body cleaning. Use the toilet restores Bladder and does not wash hands afterward.

Wash hands is partial cleaning. Either sink stops adding Hygiene at the same ceiling, so washing repeatedly cannot replace bathing or remove body odor. The kitchen sink's rate differs from the bathroom sink's. Neither action has an extra Comfort cost. Cleaning household dishes at the kitchen sink is a different action and supplies no personal Hygiene.

Toilets, showers and baths are [private activities](relationships/#privacy). Entering an occupied bathroom, or starting private use with somebody already inside, can harm feelings in different directions.

:::numbers Numbers and limits
Hand washing cannot raise Hygiene above {{number:tuning.need_interactions.handwashing_hygiene_ceiling}}. Washing when already above that ceiling leaves existing Hygiene alone apart from ordinary decay. Body-odor consequences clear only above that level, so bathing is necessary.
:::

## Chairs and secondary seats {#chairs}

A seat can supply Comfort during a meal, TV or radio activity. The person must actually occupy the valid place. Reserving it, approaching it or standing beside it supplies no chair benefit.

Different seats have different rates. Seats with their own rest action use that action's Comfort rate; other seats have a separate seating rate. Only Comfort transfers into media and dining use. A sofa's reclining Energy and a reading chair's reading Fun do not transfer. Ordinary Sit receives its own reward once.

Multiple seats on one sofa are distinct places. Sitting, reading, media and dining compete for the same physical seats. A person may hold a place while walking toward it, so an empty-looking chair can already be reserved.

## TV, radio and shared company {#company}

TV and radio supply Fun alone. For Social, another person must actively use the same device with a valid chair or standing destination. Someone walking toward it is not yet company. A person nearby using another device does not count. Same-device participation does not require an extra room or generic friendship-distance check.

Reading, exercise and fish watching use another rule. Two people must actively use separate objects for the matching activity, in the same room and close enough together. Both must accept that pastime through their personality, traits and hobbies. Failed use, travel and interruptions do not count.

Eligible group company uses the strongest relevant feeling, with one family bonus if a participating relative is present. It does not pay once per extra participant. Social ends when eligible overlap ends. [Friendship from shared time](relationships/#shared-time) has its own proximity, hygiene and need requirements.

:::numbers Numbers and limits
Shared reading, exercise and aquarium watching require the same room within {{number:tuning.relationships.contact_radius}} tiles, with a baseline {{number:tuning.need_interactions.shared_social_per_tick}} Social points per overlapping game minute before company and personality modifiers. Meals require separate chairs facing the same table. More participants do not multiply the rate.
:::

## Books and reading {#reading}

Read book on a bookcase or a reading action on a seat chooses an available book automatically. The person resumes their most recently read unfinished title first. Otherwise they prefer unread titles, then the title read longest ago. There is no title picker. The preview shows a title when the eligible priority group has only one.

Reading requires a reachable unclaimed physical copy and a valid reading plan. It may involve fetching the book, reading, returning it and shelving it. Only actual reading earns the reading benefit. Sessions are limited in length; a long book can take several sessions. Interruption keeps the bookmark and familiarity, but gives no completed practice attempt.

Personal genre and title tastes, the person's reading preference and reading-related disposition traits change the Fun and life satisfaction earned from reading. Less enjoyable reading provides less Fun; it does not create a separate Fun cost, though normal need loss can still outweigh the benefit. Faster reading changes how quickly book progress and its Fun reward arrive.

Repeated reading makes a title familiar and reduces its novelty, lowering its Fun and satisfaction rewards. Switching to another copy of the same title does not make it new again. These taste and familiarity effects do not reduce the chair's Comfort, which applies during actual reading time. A failed reading attempt can separately reduce the positive benefits.

Buy book on a bookcase chooses automatically, preferring affordable unowned titles. Copies go to the least-filled case with usable space; a borrowed book still reserves its home slot. With no free shelf space, buying is disabled. Sell book chooses an unborrowed copy on that case, preferring duplicates and then titles without unfinished progress. The exact price appears before purchase or sale. Title progress survives selling a copy. Recover book returns a dropped copy when shelf capacity is available.

## Correspondence, exercise and fish {#other-pastimes}

Handle correspondence at a desk supplies Social and Fun while the person works alone, with an Energy cost. It is an option for a one-person household. It does not directly change their opinion of another named housemate.

Exercise supplies Fun and practice in Fitness while costing Energy and Hygiene. Watching fish supplies Fun and Comfort. Two eligible people can gain company from matching use on separate bikes or aquariums; one person standing nearby is not a participant.

## Chat and Fight {#talk-and-fight}

Select the speaker, then open another person's menu and choose Chat or Fight. A chat request waits for the recipient's existing activity, including its travel and longer meal or reading goal. Private bathroom use makes the initiator wait outside. The recipient does not become reserved merely because a request exists.

Chat supplies Social and Fun during actual talking. Each participant's own feeling affects their reward. Completion can improve feelings, but a disliked topic can instead make the listener think less of the initiator. Starting at an inconvenient moment can also leave an unmet-need penalty. See [conversations](relationships/#conversations).

Fight supplies no need benefit, hobby satisfaction or skill practice. A completed fight harms both people's feelings and gives both a temporary Had a fight moodlet. An interrupted fight earns neither the completion penalty nor the moodlet. You can direct a fight without a current grievance; [autonomous arguments](relationships/#fights) need an actual incident. A relevant chore argument may prompt the assigned person to do the work, but the argument itself does not clean anything or change a missed chore's outcome.

## Housework and commitments {#housework}

Clean dishes collects actual piles and washes them. The chore board calls its dishes duty Do dishes. Clean floor removes reachable grime in the target room or Outside. Wipe surface removes furniture grime; it does not remove dishes. Empty bin removes waste. These actions supply no direct need refill or additional physical need cost; ordinary need loss accounts for the time spent.

Completed physical cleaning improves every other living housemate's opinion of the actual cleaner, even without an assignment or with the chore board off. Housemates with a higher cleanliness preference appreciate it more. Each completed dish-washing batch earns appreciation once. Starting, carrying, partially cleaning or canceling before completion earns none; dirt already removed stays removed. Cleaning can also improve mood by removing a dirty environment, while doing a liked or disliked chore can add its own mood effect.

Open [Chores](ui-elements/#chores) to see assignments, actual dirt, outcomes and Do now. The person selected performs Do now. Responsibilities and preferences affect future autonomous decisions; they do not guarantee every duty will be done.

After a completed argument about an assigned duty, its owner may choose to start that work. Completing the same duty within four game hours can [repair feelings](relationships/#chore-repair) with the initiator and housemates who complained. The owner must earn the completion credit: for floors, surfaces and bins, they must complete the task themselves. For dishes, they must be the largest contributor to that unfinished duty and wash some dishes during the repair window. A helper washing the final plate does not prevent an eligible owner's repair; a helper doing most of the washing does. Each cleaner still earns ordinary appreciation for their own completed work. Urgent needs, work and your orders take priority over the owner's automatic response.

:::illustration chores-board

## Timing, failure and interruption {#delivery}

Ordinary actions deliver a rate while actively used, based on their reference duration. Actual lengths vary. Interruption stops the rate; already delivered benefits and costs remain. Food is different: Hunger arrives after completed eating. Skill practice and many satisfaction rewards require completion.

Personality scales positive need delivery separately for each need. Negative action costs arrive in full. Capability failures reduce ordinary positive benefits, and food quality reduces food benefits. The seat and actual company retain their own effects. A failed activity does not qualify for shared reading, exercise or fish-watching company.

Meters remain bounded. Hand washing has an extra ceiling. Need decay continues, so the change you see includes both the action and the time passing. Preferences and repetition influence selection; they do not add an extra need payment. [Mood and personality](mood-and-personality/#personality) explains the other outcomes.

:::numbers Numbers and limits
All need meters range from 0 to 100. Ordinary action durations can vary up to 40 percent around their reference duration, biased toward shorter actions. Reference totals describe the baseline before personality, failure, need loss and caps. A completed-action food total and a per-minute company rate are different kinds of number.
:::
