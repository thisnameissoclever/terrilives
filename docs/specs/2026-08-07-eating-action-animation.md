# Eating action animation contract

Status: **shipped mechanical contract, amended 2026-08-08 for generic
object-use semantics and 2026-08-09 for owner review and hand-prop repair.**
The repair branch now gives snacks a visible sandwich and keeps dinner in the
active eating hand; played WebGPU acceptance and publication remain open. The
authored action, projection, and tests already ship. This extends the shipped
conversation visual contract without
making the shared `Eating` storage component choose art or player-facing text.
The amendment shipped in PR 47 at merge `38a03c151036430c798502ca4252c925c98789db`;
the public session observed immediately after that deployment is recorded in
[A-object-use-activity-semantics]. The SHA query label is not an immutable
GitHub Pages route.

The restart point is `docs/FEATURES.md` under **Next engineering slices**. A
current-run desktop and phone audit on 2026-08-07 reached the ordinary fridge
menu, issued **Grab a snack**, and paused Bill while the HUD read **Eating**.
The fork bubble explained the action, but the body remained the ordinary
standing figure. A nearby sleeper had the same silhouette problem. Eating goes
first because it is frequent, already has a complete snack and dinner story,
and can be represented honestly without the position sockets that sitting,
sleeping, bathing, and toilet use require.

## [EA1] One semantic category covers snacks and the terminal dinner step

The authored vocabulary gains one action:

```toml
visual = { action = "eat", anchor = "object", facing = "toward_anchor" }
visual = { action = "eat", anchor = "station", facing = "toward_anchor" }
```

The first form belongs only to an ordinary object interaction. The shipped
`fridge.grab_snack` interaction authors it.

The second form belongs only to a chain step. The terminal `cook_dinner` step
authors it because that step was resolved through the `eating_surface` station
role rather than through one interaction on the table or desk.

Both forms resolve their live anchor from the exact `Target.object`. The two
authored anchor names remain distinct because their ownership and validation
paths are distinct. Content must not describe a chain station as an ordinary
object interaction merely because both happen to end at an object entity.

The legal combinations are exact:

1. `talk / partner / toward_anchor` on a social interaction.
2. `eat / object / toward_anchor` on an object interaction.
3. `eat / station / toward_anchor` on a chain step.

Missing fields, unknown values, and every cross-owner or mixed combination are
content errors. A broad gameplay tag, need advert, activity code, or station
role never implies a visual action.

## [EA2] The exact target and its footprint centre determine facing

Render sync already owns authoritative gameplay state. While an agent is in an
ordinary object interaction it has `Eating` and `Target`. During a running
chain step it also has `ChainState` and, while work is actually happening,
`StepWork`. Presentation reads those components and the exact target's
`SmartObject` and `Position`.

The anchor point is the centre of the target object's footprint, not the
placement origin. This distinction is visible at the 2 by 1 dining table and
desk. Facing toward the origin would turn some approach tiles toward the wrong
half of the furniture.

The result stays in the two existing render-buffer columns:

- visual action `0` means none, `1` remains talk, and appended code `2` means
  eat;
- facing `0` means none, followed by positive x, negative x, positive y, and
  negative y.

No anchor-position column is needed. No gameplay component, command, save
field, WebAssembly pointer, JavaScript bridge accessor, GPU instance field,
shader input, draw call, or submit is added.

Conversation retains precedence if malformed test state contains both a real
social pair and object-use components. For eating, every required component
and identity match is load-bearing. An unauthored action or malformed near miss
emits `none / none` rather than inventing art.

The fail-closed identity matrix is explicit. Ordinary object eating requires
`Eating.object` to equal the exact target entity's `SmartObject` definition,
`Eating.interaction` to equal `Target.interaction`, and that exact target to
carry both `SmartObject` and `Position`. Chain eating requires `StepWork`,
in-range `ChainState` chain and step indices, `Target.interaction` to be
`CHAIN_STEP`, the exact target object to carry the current step's station role,
and the current step itself to own the authored visual. Each missing or
mismatched condition independently emits `none / none`.

## [EA3] The art is two fixed-envelope hand-to-mouth frames

Each of the three shipped looks gets two eating frames for each of four lot-axis
facings: 24 appended sprites in total.

Every frame is exactly 38 by 88 pixels, bottom-centred on the existing body
anchor. Feet, contact shadow, maximum bounds, indicator position, selection
ring, picking envelope, wall depth, and planted world anchor remain unchanged.

Frame zero is a quiet directional eating pose with the anchor-side arm bent at
the chest. Frame one raises that hand toward the mouth. Eyes follow the anchor
in both frames. The gesture must read at native sprite size; an enlarged crop
is useful for defects but cannot approve the shipping silhouette
([L-check-glyphs-at-the-size-they-ship]).

The 24 sprites append after the current 74 entries. Existing indices do not
move: the ordinary bodies remain at 1, 48, and 49, and conversation remains at
50 through 73. Eating occupies 74 through 97.

Exact snack eating draws the appended `heldSnack` sandwich. Exact terminal
dinner eating keeps the separate existing `carried_dinner` sprite. Each prop
follows the same facing, hand side, and sixteen-tick frame height as the eating
arm. A valid eater draws exactly one food prop. Ingredients, unrelated carrying,
generic object use, and malformed visual state retain their previous behavior.
This remains one direct renderer transform rather than new simulation state.

## [EA4] Simulation ticks own the phase

Eating alternates every sixteen simulation ticks. Stable entity-id phase keeps
two simultaneous eaters from moving in lockstep. Wall time and render-frame
count are never inputs.

Pause therefore freezes the exact pose. Speed controls scale it with the
simulation. Save and Load reconstruct it from the saved simulation tick and
active gameplay components. Reduced motion pins frame zero while preserving
the directional action pose rather than falling back to idle.

The HUD text and fork bubble remain redundant non-motion explanations. An
ordinary interaction with an exact authored eat visual and a chain step with a
valid authored eat visual therefore project the existing `EATING` activity
code while work is active. A valid sleep-tagged interaction remains
`SLEEPING`. Every other use of the shared `Eating` storage component projects
the appended `USING_OBJECT` activity code 7 instead. That generic state is
text-only because one small glyph cannot truthfully represent reading,
washing, television, bathing, and toilet use. No meaning is available only
through animation.

## [EA5] Chain-step visual metadata is presentation-only

`ChainStepDef` and `CompiledChainStep` gain an optional visual field appended
last. The compiled-pack postcard golden changes because its byte shape grows.
Save V1 does not: it already stores the active interaction, exact target,
`ChainState`, `StepWork`, carried item, and simulation tick.

Object-interaction and chain-step visual metadata stay outside the Save V1
compatibility digest. Tests change each independently and prove an otherwise
compatible save still loads. World-hash goldens must not move. A world-hash
change would mean presentation leaked into simulation state.

## [EA6] Performance stays linear and allocation-bounded

Render sync may use direct component and entity lookups for the current row. It
must not scan all stations, all interactions, or all active users per row. The
existing conversation set and map remain the only tick-local collections added
for presentation.

The web renderer resolves all 24 eating sprite names once at module load. It
does not search `SPRITES`, allocate per entity, add a second instance buffer, or
split the draw. The reused instance array and its live-prefix contract remain
unchanged.

## [EA7] Acceptance proves the complete category

Automated coverage must prove:

1. The exact three legal visual contracts compile and every mixed owner,
   action, anchor, missing field, and unknown value fails.
2. Object and chain visual changes independently leave the Save V1 digest
   unchanged while compiled-pack bytes remain pinned.
3. A real snack and a terminal dinner step emit action code `2` with all four
   facings, and both emit the existing fork bubble through their `EATING`
   activity code.
4. A 2 by 1 target uses its footprint centre, the exact resolved station wins
   when two eating surfaces exist, and every required component has a malformed
   near-miss test.
5. Walking between chain stations, the shipped unauthored non-terminal steps,
   unauthored object use, target mismatches, missing `SmartObject`, and the
   shared `Eating` component alone emit no authored body action. Shipped
   `shower`, `toilet`, `television`, `sink`, and `kitchen_sink` interactions
   report `USING_OBJECT`, never `EATING`. The later exact
   `bookshelf.read` and `reading_chair.settle_in` contracts report `READING`;
   they likewise never acquire eating action `2` or the fork indicator.
6. The WebAssembly memory-growth seam preserves action `2` and its facing.
7. All three looks, four facings, two frames, reduced motion, invalid-code
   fallback, ring, bubble, carried badge, zoom, picking, and live instance count
   are pinned in web tests. Activity code 3 keeps the fork while code 7 adds no
   generic bubble. Eating phase boundaries include ticks 15, 16, 31, and 32 plus
   the staggered neighbouring boundaries for multiple sequential entity ids.
   Pause and speed tests prove that only simulation ticks advance the phase,
   and sequential sims do not transition in lockstep.
8. Atlas output has 98 entries; talk remains at 50 through 73; eating is the
   appended 74 through 97; every new body is 38 by 88; decoded pixels are
   reproducible; no vague generic-use indicator is appended.
9. Targeted mutation checks kill each owner guard, component guard, identity
   match, action-code collapse, footprint-centre substitution, directional sign
   reversal, and statement deletion that ordinary `cargo mutants` cannot
   generate.

A displayed browser pass must then use normal controls to watch both a snack
and the terminal dinner step. It must capture both frames, prove Pause is
byte-stable, interrupt and resume dinner, and inspect native and close zoom,
the phone breakpoint, night lighting, the active reduced-motion preference,
console output, and the production WebGPU surface. A mid-terminal-dinner Save
and Load must preserve the action, facing, carried dinner, and resolved sprite
phase. A carried dinner must be visible in the live terminal step before any
plate-to-hand alignment is called accepted.

The proof boundary must stay honest. If the chosen browser cannot switch its
media preference or expose the live `GPUDevice`, deterministic frame tests own
the reduced-motion claim. Zero runtime warnings and errors, a visibly rendered
production canvas, and the unchanged bridge, instance, shader, draw, and submit
contracts own this slice's WebGPU claim. A temporary device hook and scoped
validation are required only when this slice changes one of those GPU
contracts; this one does not. Do not claim an emulated preference or scoped
validation that was not observed.

## [EA8] Explicitly outside this slice

This work does not animate generic object use, food preparation, cooking,
sitting, reading, television, sleeping, bathing, toilet use, or sink use. It
does not move a sim onto furniture or add seat, bed, shower, or toilet sockets.
Those actions need their own semantic category and, where the body changes
location, an authored position and occlusion contract rather than a better arm
pose beside the object.

One future content-validation concern remains nonblocking. The compiler does
not yet reject an interaction that combines the sleep tag with an authored eat
visual. No shipped interaction does that, but such content would currently
project an eating body with a sleeping activity label because sleep owns the
activity precedence. If either vocabulary expands, compile validation should
reject that mixed semantic contract explicitly.
