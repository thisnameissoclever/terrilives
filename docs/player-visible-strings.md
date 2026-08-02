# Player-visible string inventory

Status: the functional inventory is current through the normal-play People
panel slice. The dark-comedy voice
column is intentionally unfilled until the owner authors or approves it, per
[L58]. This file is the handoff for playable-alpha criterion 11, not permission
to invent the game's voice unattended.

## Functional text that stays plain

These strings are controls, state, instructions, confirmations, or failures.
They should remain literal even after the voice pass. A joke in a destructive
confirmation is how somebody loses a save while the interface congratulates
itself on having personality.

| Surface | Current strings | Source |
| --- | --- | --- |
| Household status | Time; Funds; Day {n}, {hh}:{mm} | `web/index.html`, `web/src/ui/game-hud.ts` |
| Household roster | Household; one authored sim name per selection button | `web/index.html`, `web/src/ui/household-roster.ts` |
| Selected person | Life satisfaction; Career; Doing; Orders waiting; Select a person; Nothing selected | `web/index.html`, `web/src/ui/game-hud.ts` |
| Need warnings | critical; low; steady; {value}% full | `web/src/ui/needs-panel.ts` |
| People | People; How {name} feels; Select a person to see how they feel about the household.; There is nobody else in the household.; Hostile; Dislikes; Wary; Stranger; Warm; Friendly; Close | `web/index.html`, `web/src/ui/people-panel.ts` |
| Speed | Pause; 1x; 2x; 3x | `web/src/ui/time-controls.ts` |
| Game actions | Save; Load; Clear orders; Queue; New game; Help | `web/index.html` |
| Save state | Starting; No save yet; Saving; Game saved; Autosaved; Loading; Saved game loaded; No saved game found; Starting new game | `web/index.html`, `web/src/ui/persistence-controller.ts` |
| Save failures | Saved game is invalid. Starting a new game.; Saving is unavailable. Starting a new game.; Save failed. The game is still running.; Load failed. Current game kept.; Could not remove the saved game. | `web/src/ui/persistence-controller.ts` |
| Order feedback | Select a person first; Orders cleared; Could not clear orders; That order could not be added; That person could not be selected | `web/src/main.ts` |
| Confirmation | Start a new game?; This replaces the saved household and cannot be undone.; Load the saved game?; Progress since the last save will be replaced.; Keep playing; Start over; Load game | `web/index.html` |
| Help | How to play; Got it; the nine ordered control instructions | `web/index.html` |
| Keyboard targeting | Target: {object}. Enter opens actions.; Target: {person}. Space selects this person; Enter selects or opens social actions.; Selected {name}; Use an arrow key to choose a target first; Select a person before choosing an object | `web/src/ui/keyboard-target.ts`, `web/src/main.ts` |
| Startup failure | This address cannot render the game; This browser cannot render the game; The game failed to start; recovery hints | `web/src/ui/startup-failure.ts` |

## Authored content where voice may live

The current text is deliberately plain or inherited from the content pack.
The owner decides which rows should become dark comedy and approves every
replacement before it ships.

| Content family | Current authority | Voice-pass decision |
| --- | --- | --- |
| Game title | `docs/TIM-TODO.md` [T1] | Owner decision required. Do not treat the repository name as approval. |
| Object display names | `content/objects.toml` `name` | Review all names together for one register. |
| Object action labels | `content/objects.toml` interaction `label` | Keep verbs understandable; humor cannot obscure the action. |
| Sim names and personality labels | `content/household.toml`, `content/personalities.toml` | Owner approval required. |
| Career labels | `content/careers.toml` | Prime voice surface, but must remain legible in the HUD. |
| Trait labels and descriptions | `content/traits.toml` | Review with the mechanics visible so fiction does not misstate behavior. |
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
