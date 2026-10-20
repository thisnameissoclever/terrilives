# Player-visible string inventory

This inventory distinguishes functional controls from authored copy. The writing direction is defined in [.agents/skills/natural-causes-writing-style/SKILL.md](../.agents/skills/natural-causes-writing-style/SKILL.md): clear object types, secondary model names, and useful descriptions with optional humor. Existing strings are rewrite targets, not style examples. The owner reviews replacement names and descriptions beside a running build before publication, as recorded in [L58].

## Functional text that stays plain

Targeted dish menus use Dishes, Do dishes and Clean up in
`web/src/ui/object-menu.ts`. Dirty tables offer Clean up until their visible dishes have
been collected; clean tables retain their authored interactions. The existing
Nothing control remains available.
Keyboard targeting identifies each pile with Dishes: {object}, pile {n}.

These strings are controls, state, instructions, confirmations, or failures.
They should remain literal even after the voice pass. A joke in a destructive
confirmation is how somebody loses a save while the interface congratulates
itself on having personality.

Routine interface copy must add information the player cannot already see. Omit generic ready/selection narration and messages that merely announce that a panel remains open. Keep errors, restrictions, prices, progress, nonobvious consequences and optional Help or Shortcuts. Full clipped activity text is available on hover, keyboard focus or tap; it does not need a visible explanation beside the status.

| Surface | Current strings | Source |
| --- | --- | --- |
| Household status | Time; Funds; Day {n}, {Weekday}; {hh}:{mm}; {Season}: {condition}, on three lines; mild; hot; breezy; snowing; Monday; Tuesday; Wednesday; Thursday; Friday; Saturday; Sunday; Spring; Summer; Autumn; Winter; Day and time unavailable | `web/index.html`, `web/src/ui/game-hud.ts` |
| Compact HUD | Sim details; Overview; Queue; Queue mode; Clear orders; People; Traits; Collapse; Expand; Close; Edit; Critical: {needs}; complete household death warnings | `web/index.html`, `web/src/ui/compact-hud.ts`, `web/src/main.ts` |
| Contextual Build actions | Confirm; Buy with price; Sell with payout; Cancel; Wall; Doorway; Window; Remove; Clear; Build room; Corners; covering names; Rotate clockwise; Rotate counterclockwise | `web/src/ui/placement-actions.ts` |
| Options flyout | Version {n}, the first line, with the number from `web/package.json`; Options; Close Options; holds Light, Death, Sound, Effects, Voices and game actions in the world controls; compact Build places Options beside zoom; Allow sims to change careers autonomously | `web/index.html`, `web/src/ui/options-menu.ts`, `web/src/ui/game-version.ts`, `web/src/ui/career-autonomy-controls.ts` |
| Build sidebar controls | Build; Build mode; Exit build, in the desktop heading or compact bottom panel | `web/index.html`, `web/src/ui/builder-controls.ts` |
| Build changes | Cancel restores and leaves; Confirm keeps changes and leaves after any room review; useful refusal messages; the shared decision when leaving or entering Land with pending edits: Leave Build mode?; a warning about discarding edits, purchases and sales; neutral Keep building, red Discard changes, green Confirm changes, stacked in that order; contextual Cancel clears only the selection; optional Shortcuts | `web/index.html`, `web/src/main.ts`, `web/src/ui/build-exit.ts`, `web/src/ui/shortcuts.ts` |
| Land tool | Land; Behind the house; Left side; Right side; Buy land; {Side}: {length} by {depth} tiles, {area} squares, for ${price}. ${remaining} would remain.; ... You have ${funds}.; Buy this land?; {area} squares {place} for ${price}. ...; ... so this land cannot be bought yet.; Cancel; Buy; Buying land…; Bought {area} squares {place} for ${price}.; The purchase could not be sent.; That side of the lot is not known.; This house's walls cannot be changed, so its land cannot grow.; The lot cannot grow any further on that side.; There is not enough money for this land. | `web/index.html`, `web/src/ui/land-tool.ts`, `web/src/ui/land-tool-controls.ts`, `web/src/bridge.ts` |
| Household roster | Household; one authored sim name per selection button | `web/index.html`, `web/src/ui/household-roster.ts` |
| Character creator | Create a housemate; Edit housemate; Identity; Appearance; Personality; Needs & habits; Interests & skills; Household; Review; Gender; Male; Female; Randomize; Randomize section; Random; Lock; Unlock; Undo; Reset section; Reset character; Continue; Apply changes; Move in; Cancel; Animation; Standing; Walking; Reading; Cleaning; Play; Pause; Turn; Game-size preview; Show preview; Hide preview; {n} of {limit} traits selected; one group-level explanation at the trait limit; validation and command refusal messages | `web/src/ui/character-creator/`, `web/src/character/fields.ts`, `web/src/character/presentation.ts`, `web/src/bridge.ts`; behavior and descriptions: [creator contract](specs/2026-10-12-character-creator-runtime.md) |
| Selected person | Life satisfaction; Very dissatisfied; Dissatisfied; Content; Satisfied; Fulfilled; Unavailable; Career; {job}, {working days}, {hh}:{mm} to {hh}:{mm}, where the working days read {first} to {last} for two or more days in one unbroken run, every day for all seven, a single day's name for one day, or the day names separated by commas; Doing; Orders waiting; Select a person; Nothing selected | `web/index.html`, `web/src/ui/game-hud.ts`, `web/src/ui/satisfaction-meter.ts` |
| Personality, habits and bed | Shyness; Personality factors; Need; Drain; Refill; 100% is the normal personality factor. Sleep, work and traits also affect needs.; Sleep rhythm: Usual schedule / {n} game min earlier / later; Sleep timing depends on needs and available beds.; Repeated activities; Recent repetition reduces an activity's appeal. It fades with time and is shared across objects of the same type.; No repeated activities recorded.; Select a person to see their personality and habits.; Personal details unavailable. | `web/index.html`, `web/src/ui/personal-details.ts` |
| Skills | Skills; Select a person to see their skills.; Skills unavailable; Level {n} of {m}, {p}% to the next level; Level {m} of {m}; each skill's label and description | `web/index.html`, `web/src/ui/skills-panel.ts`, `content/skills.toml` |
| Sleeping place, implementation in progress | Sleeping place; Choose a place; Assign; Clear assignment; Bed at ({x}, {y}), place {n}: {name}; Assigned: {place}; No assigned sleeping place.; No beds on this lot.; In use or reserved by {name}.; Not currently in use.; Applying assignment…; Sleeping place assigned.; Assignment cleared.; Select a Sim to assign a place.; Sleeping places unavailable.; That assignment is no longer available. Check the current places.; That assignment could not be sent.; Another assignment was handled. Check the current assignment.; That Sim is no longer here.; That bed is no longer here.; That sleeping place is not available.; That place is assigned to another Sim. | `web/src/ui/bed-assignment.ts`, `web/src/bridge.ts` |
| Selected activity | Idle; Walking; Waiting; Eating; Talking; Sleeping; At work; Using object; Reading; Exercising; Watching fish; Sitting; Showering; Using the toilet; Watching TV; Lying down; Washing hands; Washing dishes; Listening to the radio; Handling correspondence; Bathing; Getting ingredients; Preparing food; Cooking; Waiting: {reason}; Activity {code}; Walking to talk to {name}; Waiting to talk to {name}; Waiting for {name} to return from work; Waiting outside to talk to {name}; No route to {name}; No available relief for {needs}; Pausing between walks | `web/src/ui/game-hud.ts`, `web/src/activity-status.ts` |
| Need warnings | critical; low; steady; {value}% full | `web/src/ui/needs-panel.ts` |
| Mood | Mood; Select a person to see their mood.; Mood unavailable; No active moodlets.; Overall mood; Miserable; Low; Okay; Good; Great; {label}: {signed score}; Grieving {name}; Waiting for an item; Overdoing {activity}; Feeling sick; Likes the {kind} here; Bothered by the {kind} here; Bothered by {name} using the {kind}, where {kind} is an affinity kind's lower-case label | `web/index.html`, `web/src/ui/mood-panel.ts`, `crates/terri-sim/src/mood.rs`, `crates/terri-sim/src/affinity.rs` |
| Likes and dislikes | Likes and dislikes; Select a person to see their likes and dislikes.; Likes and dislikes unavailable; {Kind}: {word}, one row per kind with the label's first letter upper-cased; Loves; Likes; Indifferent; Dislikes; Hates, each chosen by the simulation from the edges `affinity_band_loves` and `affinity_band_likes` in `content/tuning.toml`; the kind labels plants, aquarium, television and radio, proposed for the owner's review | `web/index.html`, `web/src/ui/affinities-panel.ts`, `crates/terri-sim/src/affinity.rs`, `content/objects.toml` |
| Domestic actions and mood | Cook breakfast; Cook lunch; Cook dinner; Get ingredients; Prepare food; Cook; Simmer and stir; Plate meal; Eat meal; Grab a snack; Get snack; Prepare snack; Eat snack; Wash hands; Clean dishes; Collect dishes; Wash dishes; Get prepared plate; Eat together; Dirty dishes | `content/chains.toml`, `crates/terri-sim/src/domestic.rs`, `crates/terri-sim/src/mood.rs` |
| Cleanliness | Cleanliness; {value}%; Cleanliness affects tolerance for mess and willingness to clean. Urgent needs can take priority. | `web/src/ui/traits-panel.ts`; [cleanliness mechanics](specs/2026-10-13-cleanliness.md) |
| Need moodlets | Hungry; Starving; Tired; Exhausted; Needs a wash; Very dirty; Needs the toilet; Desperate for the toilet; Lonely; Very lonely; Bored; Very bored; Uncomfortable; Very uncomfortable; Needs met | `crates/terri-sim/src/mood.rs` |
| Traits panel | Traits; No traits.; Traits unavailable; Skill {n}%; Severity {n}% | `web/index.html`, `web/src/ui/traits-panel.ts` |
| Trait and environment moodlets | authored condition-trait label; Comforted by {name}; Uneasy around {name} | `content/traits.toml`, `crates/terri-sim/src/mood.rs` |
| Career moodlets | Enjoys the job; Hates the job; Warned at work; Promoted; Got a raise; Demoted; Fired | `crates/terri-sim/src/mood.rs`; [careers](specs/2026-10-17-careers.md) |
| Career tab | Career; Select a person to see their career.; Career unavailable.; Unemployed. Choose a path below to assign one.; Path: {label}; Level {n} of {m}; ${pay} per shift, from ${min} to ${max} at this level; the Career row's schedule line; No shifts completed this week.; {n} shift(s) this week, scoring {x} on average.; No review yet.; Last review: {x} of 100.; What the score reads; Fit {x} (from -1 to 1); Trait fit {x}; Social capacity {x}% against the job's {y}%; Skill mastery {x}%; Mood on the last shift {x}; Good weeks in a row: {n}.; Poor weeks in a row: {n}.; No streak running.; The next promotion needs {n} good week(s) in a row.; At the top of this path.; Warned at work: dismissal becomes possible from the third poor week in a row.; Reviews; No reviews yet.; Week {n}; Week {n}: Promoted, Got a raise, Demoted, Fired or Changed path; Reviewed weeks; Show the review graph; Assign a career; Career path; Choose a career path; Choose a path; Assign; Quit; Assigning the career…; Leaving the job…; Career assigned.; Job left.; This person has no job to leave.; The career change could not be sent.; Another career change was handled. Check the current job.; Look for work automatically when unemployed, proposed for the owner's review ([job search for each housemate](specs/2026-10-18-job-search-per-person.md)); The setting could not be sent.; That person is no longer here.; Not while they are at work or on the way.; That career path is not known. | `web/index.html`, `web/src/ui/career-panel.ts`, `web/src/ui/career-graph.ts`, `web/src/bridge.ts` |
| Career paths and titles | Office; Cafe; Night watch; Office clerk; Senior clerk; Office manager; Director of paperwork; Lowly barista; Barista; Shift lead; Senior espresso sorcerer; Night watch; Senior night watch; Night supervisor; Keeper of the keys, provisional per [L58] | `content/careers.toml` |
| People | People; How {name} feels; Select a person to see how they feel about the household.; There is nobody else in the household.; Hostile; Dislikes; Wary; Stranger; Warm; Friendly; Close | `web/index.html`, `web/src/ui/people-panel.ts` |
| Speed | Pause; 1x; 2x; 3x | `web/src/ui/time-controls.ts` |
| Walls tool | Furniture; Walls; Wall; Doorway; Remove; Choose a line between two floor tiles.; No wall on this line.; A wall stands on this line.; This line is a doorway.; Wall built.; Doorway made.; Wall removed.; That change could not be sent.; the collapsed Shortcuts reference; Tap near the line between two tiles. Drag to pan; pinch to zoom. | `web/index.html`, `web/src/ui/wall-tool.ts` |
| Walls tool refusals | Choose a line between two floor tiles.; This house's walls cannot be changed.; The outside wall cannot be changed here.; A wall there would cut through furniture.; Someone is using something across that line.; Someone is standing on that line.; A wall there would block someone's way.; A wall there would leave furniture out of reach.; A wall there would cut off the front door.; A wall there would cut off the front-door landing.; That change is not possible. | `web/src/bridge.ts` |
| Room tool | Rooms; Select rooms; Build room; Cancel; Choose a corner tile of the room.; Choose the opposite corner.; This room is already built.; Try the doorway on another line.; Building the room…; Room built.; The room could not be sent.; That room is not possible.; the collapsed Shortcuts reference; Tap one corner tile, then the opposite one; tap a line of the outline for a doorway. Drag to pan; pinch to zoom. | `web/index.html`, `web/src/ui/room-tool.ts` |
| Room selection and review | Room; Room name; Room boundaries update when you Confirm.; Outside counts as one room, including disconnected outdoor areas.; Use 1 to 48 characters for the room name.; Review room changes; Change; Keep identity and floor owner; New room; Resulting room name; Show opening; Outside destination; No floor duty in this review.; Back to build; Update review; Confirm changes; Updated room layout; Remove unavailable choices. Player names remain literal text; duplicate choices include native area/location context. | `web/src/ui/room-selection.ts`, `web/src/ui/room-review.ts`, `web/index.html` |
| Room selection and review | Room; Room name; Room boundaries update when you Confirm.; Outside counts as one room, including disconnected outdoor areas.; Use 1 to 48 characters for the room name.; Review room changes; Change; Keep identity and floor owner; New room; Resulting room name; Show opening; Outside destination; No floor duty in this review.; Back to build; Update review; Confirm changes; Updated room layout; Remove unavailable choices. Player names remain literal text; duplicate choices include native area/location context. | `web/src/ui/room-selection.ts`, `web/src/ui/room-review.ts`, `web/index.html` |
| Room tool refusals | Choose the doorway on the room's outline.; This house's walls cannot be changed.; Keep the room inside the lot.; The room would cut through furniture.; Someone is using something across the room's outline.; Someone is standing on the room's outline.; The room would block someone's way.; The room would leave furniture out of reach.; The room would cut off the front door.; The room would cut off the front-door landing.; That room is not possible.; after the refusals for someone's way, furniture and the front-door landing, Choose a doorway. or Try the doorway on another line. | `web/src/bridge.ts`, `web/src/ui/room-tool.ts` |
| Buy tool | Room; Every room; {room}, a room id's words capitalized; Show; Everything; {need}, a need's name from `NeedId::as_str` with its first letter capitalized; Clear filters; Buy; one card per item with its picture, {type}, {model} and {price}, named {type}: {model} ({price}) or {type} ({price}); Choose something to buy.; Price: {price}; Good for: {needs}; Good for: no need on its own; Facing: {direction}; Buying…; {name} bought.; The purchase could not be sent.; This position is unavailable.; the collapsed Shortcuts reference; Choose an item, then its destination tile. Use the nearby buttons to turn or buy it. | `web/index.html`, `web/src/ui/buy-tool.ts`, `web/src/ui/buy-tool-controls.ts`; [store catalogue](specs/2026-10-17-store-catalogue.md) |
| Furniture buying facts | Room; Footprint; Useful as; Shelf space; Collect or return; {n} user or users at once; {n} standing at once, plus one for each free seat in view; Requires; Optional seating; Preparation counter; Fridge; Stove; Dining table; Reachable dining chairs; Kitchen sink; available shelved copy; base action benefits and duration; standard or multiplied reading speed | `web/src/ui/buy-tool-controls.ts`, `web/src/books/codec.ts`, `crates/terri-wasm/src/browser_books.rs` |
| Bookcase commerce | Books: {count}; Buy book; Sell book; Recover book; exact price beneath Buy and Sell; Book bought.; Book sold.; Book recovered.; That book action could not be added. | `web/src/ui/book-commerce.ts`, `web/src/ui/object-menu.ts` |
| Book refusals | unavailable title, copy, person or shelf; insufficient Funds; borrowed copy; full shelf; no room for another book; no available book to sell; changed book selection; current book must be returned; no readable shelved copy; unavailable reading action; full order queue; refused command | `web/src/books/results.ts` |
| Radial object actions | Enter build mode; Read book; {title} and {progress}%; More actions; Back; Close menu; exact price beneath Buy and Sell | `web/src/ui/object-menu.ts`, `web/src/ui/placement-actions.ts` |
| Reading journey | Fetching: {title}; Going to read: {title}; Reading: {title}; Returning: {title}; Waiting to return: {title}; Picking up: {title}; Shelving: {title} | `crates/terri-sim/src/reading.rs` |
| Buy tool refusals | every furniture refusal, and The household cannot afford that. | `web/src/bridge.ts` |
| Outdoor furniture, proposed for the owner's review | the category Outdoor; the room Yard, shown as a Room filter button; the types Pool, Pool lounger and Patio umbrella; the model names Backyard Square, Sunstrip and Shady Eight with their descriptions; the lounger's action Sit, shared with the other seats | `content/objects.toml`; [outdoor furniture](specs/2026-10-17-outdoor-furniture.md) |
| Selling | Sell; Sell for {amount}; Selling…; {name} sold.; The sale could not be sent.; Cannot sell: {refusal}, under Sell while the chosen furniture would not sell; Sell, with separate keycaps in Shortcuts | `web/index.html`, `web/src/ui/builder.ts`, `web/src/ui/builder-controls.ts` |
| Sale refusals | That furniture is no longer available.; This lot layout does not support furniture editing.; Wait until nobody is using or approaching this object.; That furniture is not for sale. | `web/src/bridge.ts` |
| Colourways | Colour, the Furniture tool's and the Buy tool's list label; Recolouring…; {name} recoloured.; The colour change could not be sent.; That colour is not available.; the colourway names As drawn, Colour 2, Colour 3, Muted and Rich, placeholders | `web/index.html`, `web/src/ui/builder.ts`, `web/src/bridge.ts`, `content/objects.toml` |
| Game actions | Save; Load; New game; New housemate; Help; Player guide and Changelog (each opens in a new tab), in Options. Clear orders and Queue mode, in Sim details / Queue; No actions queued.; upcoming-action preview explanation | `web/index.html`; short Help from `docs/player/quick-help.md` |
| Public changelog | Changelog; New features, improvements and fixes.; Play the game; Expand all; Collapse all; Latest; New; Improved; Fixed; Art; Sound; Link to this update; Use light theme; Use dark theme; Back to the game. Dark is the fresh default; the saved theme overrides it. | `web/changelog/`, `scripts/build-changelog.mjs`, `docs/player/changelog/` |
| Startup loading screen | Loading Natural Causes; Step {n} of {total}: {step}, where the steps are Downloading the game, Downloading the simulation, Starting the simulation, Loading the household, Starting graphics, Loading walls and floors, Loading furniture and people, Preparing graphics, Setting up the game and Drawing the house; {n} of {total} files; {x} MB loaded; Loading floor materials, unnumbered; Files loaded, the progress bar's accessible name | `web/index.html`, `web/src/main.ts`, `web/src/ui/startup-loading.ts` |
| Desktop site notice | This page is in desktop mode, so everything is drawn small. For a phone-sized layout, open your browser menu and turn off Desktop site.; Close | `web/src/ui/desktop-site-notice.ts` |
| Graphics failures | The browser did not provide a graphics device, with its three hints naming chrome://restart and chrome://gpu; The graphics device stopped working; The graphics device was lost.; Your household was saved just now.; Saving is paused to protect your saved game, so nothing new was saved.; The household could not be saved. Progress since the last save may be lost.; Reload the page to keep playing. If this keeps happening, restart the browser. In Chrome, open chrome://restart. | `web/src/ui/startup-failure.ts` |
| Save state | Starting; No save yet; Saving; Game saved; Autosaved; Loading; Saved game loaded; No saved game found; Starting new game | `web/index.html`, `web/src/ui/persistence-controller.ts` |
| Save failures | Saved game is invalid. Starting a new game.; Saving is unavailable. Starting a new game.; Save failed. The game is still running.; Load failed. Current game kept.; Could not remove the saved game. | `web/src/ui/persistence-controller.ts` |
| Order and selection feedback | Select a person first; Orders cleared; Could not clear orders; That order could not be added; That person's order queue is full; That person's order queue was full, so the order last in line was dropped; That person could not be selected; Selection could not be changed | dedicated `#command-feedback` live region in `web/index.html`; `web/src/main.ts`; `web/src/ui/command-feedback.ts`; `web/src/ui/keyboard-target.ts` |
| Confirmation | Start a new game?; This replaces the saved household and cannot be undone.; Load the saved game?; Progress since the last save will be replaced.; Keep playing; Start over; Load game | `web/index.html` |
| Help | How to play; Game time is paused while this guide is open.; Got it; Build & place; People & actions; Camera; Options & saves; grouped Shortcuts reference | `web/index.html` |
| Keyboard targeting | Target: {name}.; Selected {name}; Choose a target first.; Select a person before choosing an object | `web/src/ui/keyboard-target.ts`, `web/src/main.ts` |
| Startup failure | This address cannot render the game; This browser cannot render the game; The game failed to start; recovery hints | `web/src/ui/startup-failure.ts` |

## Approved build controls copy

The approved functional revision adds Shortcuts; Rotate clockwise; Rotate counterclockwise; Clear; Choose item; Corners; Buy · {price}; Select a tile first.; and Choose an edge of the room outline for its doorway. Rotation labels name the local SVG icons for assistive technology. Short pointer instructions stay outside the disclosures. Existing covering names, prices, object identities and refusal messages remain authoritative. Help now groups topics and reads the same shortcut definitions as the tool panels. Sources: `web/src/ui/placement-actions.ts`, `web/src/ui/shortcuts.ts`, tool controllers and `web/index.html`. This approval does not cover the broader voice rewrite under L58.

## Authored content where voice may live

The current text is deliberately plain or inherited from the content pack.
The owner decides which rows should become dark comedy and approves every
replacement before it ships.

| Content family | Current authority | Voice-pass decision |
| --- | --- | --- |
| Game title | `docs/TIM-TODO.md` [T1]; shown in the `<title>` of `web/index.html` | Decided 2026-09-21: **Natural Causes**. The repository name `terrilives` is the internal codename, not the title. |
| Object identity | `content/objects.toml` category/type/model definitions, authored model `name` and `description`, with compiled presentation from the canonical type | Object types are primary, with separate model names and descriptions. Describe product construction, relative quality and useful distinctions. Keep usable capacity and other buying facts in functional details. See [object identity](specs/2026-09-22-object-identity.md). Owner approval is required before publication. |
| Object action labels | Resolved actions from `content/objects.toml` templates and category/type/model layers | Keep verbs understandable; humor cannot obscure the action. A label change does not change the stable action ID. |
| Book titles and descriptions | `content/books.toml` | Descriptions introduce the book's subject or story. Genre, length, price and estimated personal interest are functional purchase details. Proposed launch copy requires owner review before publication. |
| Sim names and personality labels | `content/household.toml`, `content/personalities.toml` | Owner approval required. Each personality's description follows the trait verbs of [TL-affinity]. |
| Career labels | `content/careers.toml` | Prime voice surface, but must remain legible in the HUD. |
| Skill labels and descriptions | `content/skills.toml` | Shown with each skill's level in Sim details. A description must not promise an effect that skills do not have yet. |
| Trait labels and descriptions | `content/traits.toml` | Review with the mechanics visible so fiction does not misstate behavior. A disposition's sentence opens with Likes, Loves, Dislikes or Hates, and the compiler holds that verb to the trait's number ([TL-affinity]). |
| Chain labels, steps, and carried items | `content/chains.toml` | One coherent miniature story per chain. |
| Social action labels | compiled content social vocabulary | Keep intent obvious at the moment of choice. |

## Voice-session acceptance

1. Review this inventory beside a running build, not as a prose exercise.
2. Agree on the voice examples and rejection examples before editing content.
3. Keep functional text plain and reserve comedy for authored fiction.
4. Re-run the string inventory after edits so no new visible text bypasses the
   session.
5. Record the owner's approval and a watched play session in
   `docs/alpha-feel-notes.md` before marking criterion 11 complete.

## Gameplay UI additions (2026-09-30)

Functional labels: Now, Next, Queued, Going to work, Unavailable action, and
No assigned bed. Action cards combine existing interaction labels with object
or person names. Build and Exit build now live in the upper-left world group.

## Commute label added on 2026-10-06

The queue reads Heading home while a housemate walks back from work, and
Going to work only for the walk out. The owner chose the wording on
2026-10-06. Source is `crates/terri-sim/src/action_queue.rs`.

## Self-preservation controls (2026-09-30)

The new Traits row and housemate control use `Self-preservation instinct`,
`Random`, `Choose a whole instinct value from 0 to 100.`, and a numeric `{value}/100`. Their explanation is: "Higher values favor
meeting low needs. Very low values can lead to dangerous neglect." These strings
are functional descriptions of implemented mechanics. The owner authorized
deployment after fresh-context review on 2026-09-30. The broader voice-session
acceptance above remains separate.

The creator's Self-preservation field explains: "Influences urgent-need
priorities and survival risks. Random creation uses weighted values from 11 to
95." Manual values still span 0 through 100. The pending-conversation design
also authorizes the literal waiting explanations in Selected activity above;
it does not approve unrelated flavor text.

## Architecture controls added on 2026-10-01

The functional Windows chooser contains Sash, Cottage, Arched, Sliding, Steel-grid, Twin casement, Picture, Craftsman and Clerestory, their wall-unit widths, Place Window, Replace window and Remove window. N opens the chooser from Build; the selected model persists when returning. New refusal messages explain a missing straight wall, a junction or a partial-window Room edit. Sources are `web/src/ui/window-tool.ts`, `web/src/ui/window-tool-controls.ts`, `web/src/bridge.ts` and the Rust window catalogue.

These labels describe implemented controls. The wider object-name/flavor review boundary remains unchanged; this entry does not approve unrelated copy or establish final owner visual acceptance.

## Household chores controls

Literal actions are Do dishes, Clean up, Clean floor, Wipe surface and Empty
bin. Clean tables offer Sit and, when a portion is available, Eat prepared food.
The main bottom bar includes Chores. Grouped board rows use Wipe counter surfaces
and Wipe table surfaces with room names. Its panel uses Automatic weekly assignments,
Do now, Recent daily outcomes, Performed by, Responsibility, Commitment history
score, Dishes preference, Floor cleaning preference, Surface wiping preference,
Bin emptying preference, Apply preferences and Close. Preferences use whole
numbers from -100 to 100; responsibility uses 0 to 100. Positive preferences mean
enjoyment and negative preferences mean dislike. History starts at 50 and records
outcomes as a score, rather than a completion percentage.

Duty outcomes are Pending, No work needed, Plans to do it, Skipped today, Done,
Covered by a housemate, Missed and Unavailable. Missing identities display
Unassigned or Former housemate. Progress uses Week, Day, Grime, Bin fill and
Dirty dishes with the relevant values. Profile feedback reads Use whole numbers
within the displayed ranges., Preference changes queued., or Those changes
could not be sent. Mood reasons are Enjoying a chore, Dislikes this chore,
Enjoyed a chore, Chore frustration and Grimy floor.

Sources are `web/src/ui/chores-board.ts`, `web/src/ui/object-menu.ts`,
`web/src/ui/traits-panel.ts` and `crates/terri-sim/src/chores/consequences.rs`.
The approved scope is functional chore copy; unrelated object-name and flavor
review remains separate.

Grime mood labels are Grimy floor and Grimy surfaces. Both scale with the
remaining grime amount during cleaning.

Active cleaning labels are Mopping floor, Wiping surface and Emptying bin in
`web/src/ui/game-hud.ts`. They describe the current work stage; queued orders
retain their existing action labels.

Condition number help describes additions or subtractions of points from overall mood, the -100 to +100 bounds, and the gradual connection to life satisfaction. The zero explanation states that the current rounded change is zero. Only each number is the hover and keyboard-focus target.
