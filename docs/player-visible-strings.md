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
| Household status | Time; Funds; Day {n}, {hh}:{mm} | `web/index.html`, `web/src/ui/game-hud.ts` |
| Compact HUD | Menu; Close; Open game menu; Close game menu | `web/index.html`, `web/src/ui/mobile-hud.ts` |
| Placement buttons | Confirm; Buy; Cancel, over the piece being placed | `web/index.html`, `web/src/ui/placement-actions.ts` |
| Options flyout | Options, the gear's accessible name; it holds Light, Build, Sound, Effects and the game actions | `web/index.html`, `web/src/ui/options-menu.ts` |
| Household roster | Household; one authored sim name per selection button | `web/index.html`, `web/src/ui/household-roster.ts` |
| New housemate form | New housemate; {n} of {most} live here.; Name; Personality; Traits, up to {n}; Cancel; Next; Back; Move in; Give them a name.; The household is full.; Moving in…; That could not be sent.; the seven refusal lines in `housemateReason` | `web/index.html`, `web/src/ui/housemate-form.ts`, `web/src/bridge.ts` |
| Selected person | Life satisfaction; Career; Doing; Orders waiting; Select a person; Nothing selected | `web/index.html`, `web/src/ui/game-hud.ts` |
| Selected activity | Deciding what to do; Walking; Waiting; Eating; Talking; Sleeping; At work; Using object; Reading; Exercising; Watching fish; Sitting; Waiting: {reason}; Activity {code} | `web/src/ui/game-hud.ts` |
| Need warnings | critical; low; steady; {value}% full | `web/src/ui/needs-panel.ts` |
| Mood | Mood; Select a person to see their mood.; Mood unavailable; No active moodlets.; Overall mood; Miserable; Low; Okay; Good; Great; {label}: {signed score} | `web/index.html`, `web/src/ui/mood-panel.ts` |
| Need moodlets | Hungry; Starving; Tired; Exhausted; Needs a wash; Very dirty; Needs the toilet; Desperate for the toilet; Lonely; Very lonely; Bored; Very bored; Uncomfortable; Very uncomfortable; Needs met | `crates/terri-sim/src/mood.rs` |
| Traits panel | Traits; No traits.; Traits unavailable; Skill {n}%; Severity {n}% | `web/index.html`, `web/src/ui/traits-panel.ts` |
| Trait and environment moodlets | authored condition-trait label; Comforted by {name}; Uneasy around {name} | `content/traits.toml`, `crates/terri-sim/src/mood.rs` |
| People | People; How {name} feels; Select a person to see how they feel about the household.; There is nobody else in the household.; Hostile; Dislikes; Wary; Stranger; Warm; Friendly; Close | `web/index.html`, `web/src/ui/people-panel.ts` |
| Speed | Pause; 1x; 2x; 3x | `web/src/ui/time-controls.ts` |
| Walls tool | Furniture; Walls; Wall; Doorway; Remove; Choose a line between two floor tiles.; No wall on this line.; A wall stands on this line.; This line is a doorway.; Wall built.; Doorway made.; Wall removed.; That change could not be sent.; the keyboard help line; Tap near the line between two tiles. Drag to pan; pinch to zoom. | `web/index.html`, `web/src/ui/wall-tool.ts` |
| Walls tool refusals | Choose a line between two floor tiles.; This house's walls cannot be changed.; The outside wall cannot be changed here.; A wall there would cut through furniture.; Someone is using something across that line.; Someone is standing on that line.; A wall there would block someone's way.; A wall there would leave furniture out of reach.; A wall there would cut off the front door.; A wall there would cut off the front-door landing.; That change is not possible. | `web/src/bridge.ts` |
| Room tool | Room; Build room; Cancel; Choose a corner tile of the room.; Choose the opposite corner.; Ready to build. Choose a line of the outline for a doorway.; Ready to build, with a doorway.; This room is already built.; Try the doorway on another line.; Building the room…; Room built.; The room could not be sent.; That room is not possible.; the keyboard help line; Tap one corner tile, then the opposite one; tap a line of the outline for a doorway. Drag to pan; pinch to zoom. | `web/index.html`, `web/src/ui/room-tool.ts` |
| Room tool refusals | Choose the doorway on the room's outline.; This house's walls cannot be changed.; Keep the room inside the lot.; The room would cut through furniture.; Someone is using something across the room's outline.; Someone is standing on the room's outline.; The room would block someone's way.; The room would leave furniture out of reach.; The room would cut off the front door.; The room would cut off the front-door landing.; That room is not possible.; after the refusals for someone's way, furniture and the front-door landing, Choose a doorway. or Try the doorway on another line. | `web/src/bridge.ts`, `web/src/ui/room-tool.ts` |
| Buy tool | Show; Everything; {need}, a need's name from `NeedId::as_str` with its first letter capitalised; Buy; Choose something to buy; Choose something to buy.; {name} ({price}); Price: {price}; Good for: {needs}; Good for: no need on its own; Facing: {direction}; Rotate; Cancel; Ready to buy.; Buying…; {name} bought.; The purchase could not be sent.; This position is unavailable.; the keyboard help line; Choose something, then tap a tile. Drag to pan; pinch to zoom. | `web/index.html`, `web/src/ui/buy-tool.ts`, `web/src/ui/buy-tool-controls.ts` |
| Buy tool refusals | every furniture refusal, and The household cannot afford that. | `web/src/bridge.ts` |
| Selling | Sell; Sell for {amount}; Selling…; {name} sold.; The sale could not be sent.; Cannot sell: {refusal}, under Sell while the chosen furniture would not sell; Delete or Backspace sells, in the Furniture tool's keyboard help line | `web/index.html`, `web/src/ui/builder.ts`, `web/src/ui/builder-controls.ts` |
| Sale refusals | That furniture is no longer available.; This lot layout does not support furniture editing.; Wait until nobody is using or approaching this object.; That furniture is not for sale.; Nothing else in the house can do its job. | `web/src/bridge.ts` |
| Colourways | Colour, the Furniture tool's and the Buy tool's list label; Recolouring…; {name} recoloured.; The colour change could not be sent.; That colour is not available.; the colourway names As drawn, Colour 2, Colour 3, Muted and Rich, placeholders | `web/index.html`, `web/src/ui/builder.ts`, `web/src/bridge.ts`, `content/objects.toml` |
| Game actions | Save; Load; Clear orders; Queue; New game; Help, in the Options flyout | `web/index.html` |
| Save state | Starting; No save yet; Saving; Game saved; Autosaved; Loading; Saved game loaded; No saved game found; Starting new game | `web/index.html`, `web/src/ui/persistence-controller.ts` |
| Save failures | Saved game is invalid. Starting a new game.; Saving is unavailable. Starting a new game.; Save failed. The game is still running.; Load failed. Current game kept.; Could not remove the saved game. | `web/src/ui/persistence-controller.ts` |
| Order and selection feedback | Select a person first; Orders cleared; Could not clear orders; That order could not be added; That person's order queue is full; That person's order queue was full, so the order last in line was dropped; That person could not be selected; Selection could not be changed | dedicated `#command-feedback` live region in `web/index.html`; `web/src/main.ts`; `web/src/ui/command-feedback.ts`; `web/src/ui/keyboard-target.ts` |
| Confirmation | Start a new game?; This replaces the saved household and cannot be undone.; Load the saved game?; Progress since the last save will be replaced.; Keep playing; Start over; Load game | `web/index.html` |
| Help | How to play; Game time is paused while this guide is open.; Got it; the fourteen ordered control instructions | `web/index.html` |
| Keyboard targeting | Target: {object}. Enter opens actions.; Target: {person}. Space selects this person; Enter selects or opens social actions.; Selected {name}; Use an arrow key to choose a target first; Select a person before choosing an object | `web/src/ui/keyboard-target.ts`, `web/src/main.ts` |
| Startup failure | This address cannot render the game; This browser cannot render the game; The game failed to start; recovery hints | `web/src/ui/startup-failure.ts` |

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
