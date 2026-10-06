# Player-visible string inventory

Status: the inventory includes the first object-identity slice. The broader voice pass still requires the owner's review under [L58]. This file is the handoff for playable-alpha criterion 11; local implementation does not establish release approval for all game copy.

The project writing direction is defined in [.agents/skills/natural-causes-writing-style/SKILL.md](../.agents/skills/natural-causes-writing-style/SKILL.md). It requires clear object types as primary identification, secondary model names, and descriptions with optional humor. The first implementation covers the washing machine, armchair, and dining table in [object identity](specs/2026-09-22-object-identity.md). Existing strings are material to review, not examples of the desired voice. The broader voice-review gate remains open.

## Functional text that stays plain

These strings are controls, state, instructions, confirmations, or failures.
They should remain literal even after the voice pass. A joke in a destructive
confirmation is how somebody loses a save while the interface congratulates
itself on having personality.

| Surface | Current strings | Source |
| --- | --- | --- |
| Household status | Time; Funds; Day {n}, {Weekday}, {hh}:{mm}; Monday; Tuesday; Wednesday; Thursday; Friday; Saturday; Sunday; Day and time unavailable | `web/index.html`, `web/src/ui/game-hud.ts` |
| Compact HUD | Sim details; Overview; Queue; Queue mode; Clear orders; People; Traits; Collapse; Expand; Close; Edit; Critical: {needs}; complete household death warnings | `web/index.html`, `web/src/ui/compact-hud.ts`, `web/src/main.ts` |
| Contextual Build actions | Confirm; Buy with price; Sell with payout; Cancel; Wall; Doorway; Window; Remove; Clear; Build room; Corners; covering names; Rotate clockwise; Rotate counterclockwise | `web/src/ui/placement-actions.ts` |
| Options flyout | Options; Close Options; holds Light, Death, Sound, Effects, Voices and game actions in the world controls; compact Build places Options beside zoom | `web/index.html`, `web/src/ui/options-menu.ts` |
| Build sidebar controls | Build; Build mode; Exit build, in the desktop heading or compact bottom panel | `web/index.html`, `web/src/ui/builder-controls.ts` |
| Household roster | Household; one authored sim name per selection button | `web/index.html`, `web/src/ui/household-roster.ts` |
| New housemate form | New housemate; {n} of {most} live here.; Name; Personality; Traits, up to {n}; Cancel; Next; Back; Move in; Give them a name.; The household is full.; Moving in…; That could not be sent.; the eight refusal lines in `housemateReason`; Edit housemate; Keep current personality; {label}, current; They are the {relation} of {name}; Nobody; Removing a condition forgets its severity. Skills are kept.; Confirm changes; Making the changes…; That person is no longer here.; That relative is no longer here.; Each relative once.; They cannot be their own relative.; The changes could not be made.; the other five refusal lines in `editReason`, shared with `housemateReason` | `web/index.html`, `web/src/ui/housemate-form.ts`, `web/src/bridge.ts` |
| Selected person | Life satisfaction; Very dissatisfied; Dissatisfied; Content; Satisfied; Fulfilled; Unavailable; Career; {job}, {working days}, {hh}:{mm} to {hh}:{mm}, where the working days read {first} to {last} for one unbroken run, every day for all seven, or the day names separated by commas; Doing; Orders waiting; Select a person; Nothing selected | `web/index.html`, `web/src/ui/game-hud.ts`, `web/src/ui/satisfaction-meter.ts` |
| Personality, habits and bed | Shyness; Personality factors; Need; Drain; Refill; 100% is the normal personality factor. Sleep, work and traits also affect needs.; Sleep rhythm: Usual schedule / {n} game min earlier / later; Sleep timing depends on needs and available beds.; Repeated activities; Recent repetition reduces an activity's appeal. It fades with time and is shared across objects of the same type.; No repeated activities recorded.; Select a person to see their personality and habits.; Personal details unavailable. | `web/index.html`, `web/src/ui/personal-details.ts` |
| Skills | Skills; Select a person to see their skills.; Skills unavailable; Level {n} of {m}, {p}% to the next level; Level {m} of {m}; each skill's label and description | `web/index.html`, `web/src/ui/skills-panel.ts`, `content/skills.toml` |
| Sleeping place, implementation in progress | Sleeping place; Choose a place; Assign; Clear assignment; Bed at ({x}, {y}), place {n}: {name}; Assigned: {place}; No assigned sleeping place.; No beds on this lot.; In use or reserved by {name}.; Not currently in use.; Applying assignment…; Sleeping place assigned.; Assignment cleared.; Select a Sim to assign a place.; Sleeping places unavailable.; That assignment is no longer available. Check the current places.; That assignment could not be sent.; Another assignment was handled. Check the current assignment.; That Sim is no longer here.; That bed is no longer here.; That sleeping place is not available.; That place is assigned to another Sim. | `web/src/ui/bed-assignment.ts`, `web/src/bridge.ts` |
| Selected activity | Deciding what to do; Walking; Waiting; Eating; Talking; Sleeping; At work; Using object; Reading; Exercising; Watching fish; Sitting; Showering; Using the toilet; Watching TV; Lying down; Washing hands; Washing dishes; Listening to the radio; Handling correspondence; Bathing; Getting ingredients; Preparing food; Cooking; Waiting: {reason}; Activity {code} | `web/src/ui/game-hud.ts` |
| Need warnings | critical; low; steady; {value}% full | `web/src/ui/needs-panel.ts` |
| Mood | Mood; Select a person to see their mood.; Mood unavailable; No active moodlets.; Overall mood; Miserable; Low; Okay; Good; Great; {label}: {signed score}; Grieving {name}; Waiting for an item; Overdoing {activity}; Feeling sick | `web/index.html`, `web/src/ui/mood-panel.ts`, `crates/terri-sim/src/mood.rs` |
| Domestic actions and mood | Cook breakfast; Cook lunch; Cook dinner; Get ingredients; Prepare food; Cook; Simmer and stir; Plate meal; Eat meal; Grab a snack; Get snack; Prepare snack; Eat snack; Wash hands; Clean dishes; Collect dishes; Wash dishes; Get prepared plate; Eat together; Dirty dishes | `content/chains.toml`, `crates/terri-sim/src/domestic.rs`, `crates/terri-sim/src/mood.rs` |
| Cleanliness | Cleanliness; {value}%; Tidier Sims usually clean up and mind other people leaving dirty dishes. Urgent needs can take priority. | `web/src/ui/traits-panel.ts` |
| Need moodlets | Hungry; Starving; Tired; Exhausted; Needs a wash; Very dirty; Needs the toilet; Desperate for the toilet; Lonely; Very lonely; Bored; Very bored; Uncomfortable; Very uncomfortable; Needs met | `crates/terri-sim/src/mood.rs` |
| Traits panel | Traits; No traits.; Traits unavailable; Skill {n}%; Severity {n}% | `web/index.html`, `web/src/ui/traits-panel.ts` |
| Trait and environment moodlets | authored condition-trait label; Comforted by {name}; Uneasy around {name} | `content/traits.toml`, `crates/terri-sim/src/mood.rs` |
| People | People; How {name} feels; Select a person to see how they feel about the household.; There is nobody else in the household.; Hostile; Dislikes; Wary; Stranger; Warm; Friendly; Close | `web/index.html`, `web/src/ui/people-panel.ts` |
| Speed | Pause; 1x; 2x; 3x | `web/src/ui/time-controls.ts` |
| Walls tool | Furniture; Walls; Wall; Doorway; Remove; Choose a line between two floor tiles.; No wall on this line.; A wall stands on this line.; This line is a doorway.; Wall built.; Doorway made.; Wall removed.; That change could not be sent.; the collapsed Shortcuts reference; Tap near the line between two tiles. Drag to pan; pinch to zoom. | `web/index.html`, `web/src/ui/wall-tool.ts` |
| Walls tool refusals | Choose a line between two floor tiles.; This house's walls cannot be changed.; The outside wall cannot be changed here.; A wall there would cut through furniture.; Someone is using something across that line.; Someone is standing on that line.; A wall there would block someone's way.; A wall there would leave furniture out of reach.; A wall there would cut off the front door.; A wall there would cut off the front-door landing.; That change is not possible. | `web/src/bridge.ts` |
| Room tool | Room; Build room; Cancel; Choose a corner tile of the room.; Choose the opposite corner.; Ready to build. Choose a line of the outline for a doorway.; Ready to build, with a doorway.; This room is already built.; Try the doorway on another line.; Building the room…; Room built.; The room could not be sent.; That room is not possible.; the collapsed Shortcuts reference; Tap one corner tile, then the opposite one; tap a line of the outline for a doorway. Drag to pan; pinch to zoom. | `web/index.html`, `web/src/ui/room-tool.ts` |
| Room tool refusals | Choose the doorway on the room's outline.; This house's walls cannot be changed.; Keep the room inside the lot.; The room would cut through furniture.; Someone is using something across the room's outline.; Someone is standing on the room's outline.; The room would block someone's way.; The room would leave furniture out of reach.; The room would cut off the front door.; The room would cut off the front-door landing.; That room is not possible.; after the refusals for someone's way, furniture and the front-door landing, Choose a doorway. or Try the doorway on another line. | `web/src/bridge.ts`, `web/src/ui/room-tool.ts` |
| Buy tool | Show; Everything; {need}, a need's name from `NeedId::as_str` with its first letter capitalised; Buy; Choose something to buy; Choose something to buy.; {name} ({price}); Price: {price}; Good for: {needs}; Good for: no need on its own; Facing: {direction}; Rotate; Cancel; Ready to buy.; Buying…; {name} bought.; The purchase could not be sent.; This position is unavailable.; the collapsed Shortcuts reference; Choose something, then tap a tile. Drag to pan; pinch to zoom. | `web/index.html`, `web/src/ui/buy-tool.ts`, `web/src/ui/buy-tool-controls.ts` |
| Buy tool refusals | every furniture refusal, and The household cannot afford that. | `web/src/bridge.ts` |
| Selling | Sell; Sell for {amount}; Selling…; {name} sold.; The sale could not be sent.; Cannot sell: {refusal}, under Sell while the chosen furniture would not sell; Sell, with separate keycaps in Shortcuts | `web/index.html`, `web/src/ui/builder.ts`, `web/src/ui/builder-controls.ts` |
| Sale refusals | That furniture is no longer available.; This lot layout does not support furniture editing.; Wait until nobody is using or approaching this object.; That furniture is not for sale. | `web/src/bridge.ts` |
| Colourways | Colour, the Furniture tool's and the Buy tool's list label; Recolouring…; {name} recoloured.; The colour change could not be sent.; That colour is not available.; the colourway names As drawn, Colour 2, Colour 3, Muted and Rich, placeholders | `web/index.html`, `web/src/ui/builder.ts`, `web/src/bridge.ts`, `content/objects.toml` |
| Game actions | Save; Load; New game; New housemate; Help; Changelog (opens in a new tab), in Options. Clear orders and Queue mode, in Sim details / Queue; No actions queued.; upcoming-action preview explanation | `web/index.html` |
| Public changelog | Changelog; New features, improvements and fixes.; Play the game; Expand all; Collapse all; Latest; New; Improved; Fixed; Art; Sound; Link to this update; Use light theme; Use dark theme; Back to the game. Dark is the fresh default; the saved theme overrides it. | `web/changelog/`, `scripts/build-changelog.mjs`, `docs/changelog/` |
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

The two names selected with the 2026-08-12 object mockups are narrow,
feature-local approvals: `Aquarium of Managed Expectations` and `Wellness
Initiative, Indoor`. Both were visible in the mockups the owner selected for
implementation. That approval does not close the whole-pack voice session or
authorize unrelated replacement copy.

| Content family | Current authority | Voice-pass decision |
| --- | --- | --- |
| Game title | `docs/TIM-TODO.md` [T1]; shown in the `<title>` of `web/index.html` | Decided 2026-09-21: **Natural Causes**. The repository name `terrilives` is the internal codename, not the title. |
| Object identity | `content/objects.toml` `name`, optional `presentation.object_type` and `presentation.description` | Washing machine / Perpetual Cycle, Armchair / Staying In, and Dining table / Visiting Hours have separate type, model, and description text. Other objects retain their existing names. See the object-identity spec for the copy and local verification. |
| Object action labels | `content/objects.toml` interaction `label` | Keep verbs understandable; humor cannot obscure the action. |
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
Not enough beds. Action cards combine existing interaction labels with object
or person names. Build and Exit build now live in the upper-left world group.


## Self-preservation controls (2026-09-30)

The new Traits row and housemate control use `Self-preservation instinct`,
`Random`, `Choose a whole instinct value from 0 to 100.`, and a numeric `{value}/100`. Their explanation is: "Higher values favor
meeting low needs. Very low values can lead to dangerous neglect." These strings
are functional descriptions of implemented mechanics. The owner authorized
deployment after fresh-context review on 2026-09-30. The broader voice-session
acceptance above remains separate.

## Architecture controls added on 2026-10-01

The functional Windows chooser contains Sash, Cottage, Arched, Sliding, Steel-grid, Twin casement, Picture, Craftsman and Clerestory, their wall-unit widths, Fit window, Replace window and Remove window. N opens the chooser from Build; the selected model persists when returning. New refusal messages explain a missing straight wall, a junction or a partial-window Room edit. Sources are `web/src/ui/window-tool.ts`, `web/src/ui/window-tool-controls.ts`, `web/src/bridge.ts` and the Rust window catalogue.

These labels describe implemented controls. The wider object-name/flavor review boundary remains unchanged; this entry does not approve unrelated copy or establish final owner visual acceptance.
