# Visibility, the talk command, and the camera - A-11 PR 2 and PR 3 design record

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

## [V6] The camera is one scale; the origin is always derived

PR 3. The zoom is the only camera state a gesture owns; `cameraOrigin`
re-derives the origin from the canvas, the lot and the scale on every
change, gated by a dirty flag that also rebuilds the static
floor-and-walls block (the one legitimate rebuild). Instance POSITIONS
bake the scale on the CPU through `screenX`/`screenY`'s trailing
`scale = 1` parameter - every pre-camera call site kept its meaning -
while the shader scales sprite SIZE and anchor from a uniform grown 16
to 32 bytes (scale at offset 16). Depth never scales: zoom changes how
big things are drawn, never what covers what.

**v1 zoom is LOT-CENTRED, flagged as a deviation from the "cursor
centred" option text**: cursor-centred zoom is mathematically a pan
(the origin becomes free state needing clamping), so it ships when pan
does. At 0.5x-2.5x on a centred lot the difference is small; if it
feels wrong in play, pan-plus-cursor-zoom is the recorded follow-up.
**Rejected: shader-side position scaling** (scale positions around the
canvas centre in the vertex shader, statics never rebuilt) - it leaves
picking and rendering computing the projection in two different
places, which is the drift `pickSprite` already documents accepting
once for the hit box.

## [V7] Two zoom routes, one clamped scale

The wheel (smooth exponential steps, ~12% per notch, wheel-up in) and
a two-finger pinch (spread ratio anchored to the gesture's start) both
end in the same `clampZoom`ed scale - Tim's "make sure the zoom works
on mobile as well", as one state with two doors. Pinch is built on
Pointer Events, not iOS's `gesturechange`, so Android Chrome and iOS
Safari take one code path; `touch-action: none` on the canvas keeps
the browser from claiming the gesture, and any multi-touch contact
poisons the next `click` so a pinch cannot end by selecting whatever
was under a finger. **Rejected: per-move compounding** for the pinch
(event-rate jitter becomes zoom jitter) and **stepped zoom presets**
for the wheel (Tim chose smooth).

The reflow half: the canvas fills the window (CSS), the drawing buffer
tracks `clientWidth x devicePixelRatio` per change, and index.html
gained the viewport meta tag without which a phone lays the page out
at a ~980px virtual width and renders the lot as a thumbnail - found
the moment the canvas learned to fill the window.
