# Visibility and the talk command - A-11 PR 2 design record

Decisions behind the activity indicators, the debug overlay, and the
player-directed talk, with the alternatives that lost. The designs were
approved in the A-11 plan; this file is the durable record. IDs continue
the project convention: [V*] for this document's decisions.

## [V1] Activity indicators are a render-buffer column, not animations

The render buffer gains a u32 `activities` column (0 none, 1 walking,
2 waiting, 3 eating, 4 talking, 5 sleeping), classified in the one
place rows are written and drawn as generated glyph bubbles above sim
rows. **Rejected: per-action sprite animations.** The Kenney kit has no
animation frames for the sim figure, so animations need art the project
does not own; that is an art-direction call, which belongs to Tim.
Indicators are the honest first step and the column is what animations
would read anyway, so nothing here is thrown away later.

Sleeping is told apart from eating by the interaction's own data - the
dominant STRICTLY positive advertised delta being energy - not by the
object's name. **Rejected: name-matching on "bed"**, which silently
misses the next nap-capable object. Strictly positive matters: a
zero-delta energy rider must not read as a nap (pinned by test after a
`>` vs `>=` mutant survived).

## [V2] The debug overlay is three read-only exports and a `<pre>`

`sim_id_of`, `personality_of` (fourteen floats, drain first), and
`relationships_of` (interleaved id/feeling f32 pairs, lossless below
2^24) cross the boundary read-only; the panel is DOM on the needs-panel
structural pattern, installed only under `?debug=1`, backquote-toggled.
**Rejected: a JSON blob export** (one allocation-heavy call, no schema
the shell does not have to parse) and **rendering into the canvas**
(the overlay is developer tooling, not game UI, and DOM text is free).
Nothing on a frame path calls any of the three.

## [V3] TalkTo is a new wire variant, not a UseObject reuse

Appended as variant 4 so every existing command byte is untouched.
**Rejected: reusing UseObject with a sim index.** Two reasons, each
sufficient: UseObject's drain resolves its object against
`With<SmartObject>` and a test pins that sims are rejected there, so
reinterpreting the field changes the meaning of already-logged bytes;
and TalkTo's `interaction` indexes the pack's SOCIAL vocabulary rather
than an object's own list, so one variant carrying both index spaces
would need a discriminant anyway.

The drain drops self-talk (an intent for oneself waits forever on
"partner busy: me") and stale or object-shaped targets; the
out-of-range social index is data at the drain and `serve_intents`'
problem, the exact division UseObject uses.

## [V4] One busy rule for ordered talks: wait, never steal, never drop

`serve_intents` treats a person like a contested object: busy in any
[H10] sense (Target, Path, Eating, Socialising) or reserved or claimed
this tick means the intent WAITS at the front with `Blocked`; gone or
unreachable means it pops. Both parties enter the claimed list - the
partner so a later order this tick cannot grab it, the initiator so two
sims each ordered to talk to the other form exactly one conversation
(deferred commands hide the first Target from the second serve).
**Rejected: dropping the order on a busy partner** - a click that
silently dies because the partner was mid-bite is indistinguishable
from a broken button.

A served talk releases whatever the sim was previously walking toward,
and completion POPS the matching front intent exactly as a finished
meal does - without that pop, one right-click is a conversation loop
escapable only by cancel (found by writing the completion test, fixed
in `tick_social`). A DISTURBED conversation deliberately does not pop:
the talk never completed, so the order stands and retries, the same
rule as waiting on a reserved object. `CancelIntents` removes
`Socialising` in the same batch so a cancel mid-conversation is whole
on its own tick.

## [V5] The flyout's third branch: the social vocabulary

Right-click resolution over sims splits three ways: the selected sim
itself offers only "Never mind"; a DIFFERENT sim offers one row per
social-vocabulary entry (row order IS `TalkTo::interaction`, the same
order-is-the-index contract object rows carry); objects keep their
interaction rows. Labels come from the pack via `social_labels`, so the
vocabulary can grow without touching the shell. **Rejected: per-target
menus** - the vocabulary is what a sim advertises; per-sim variation
enters through relationships, not menus.
