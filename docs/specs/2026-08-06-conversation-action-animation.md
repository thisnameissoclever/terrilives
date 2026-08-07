# Conversation action animation

Status: approved implementation record for the first action-specific body animation.

This slice makes a conversation readable in the bodies of both participants,
not only in the activity bubble. It also establishes the semantic contract that
later eating, reading, bathing, fighting, and other action art must use.

## [CA1] Presentation is authored on the interaction

An interaction may declare a `visual` table with three fields:

```toml
visual = { action = "talk", anchor = "partner", facing = "toward_anchor" }
```

The compile step accepts only complete, known combinations. Omitting `visual`
means no action pose. It does not mean that the renderer should guess from need
deltas, labels, object ids, or the broad activity bubble code.

The first vocabulary contains one action, `talk`, one anchor, `partner`, and one
facing rule, `toward_anchor`. Separate enums are intentional. A future fight can
share the partner anchor and facing rule without pretending its body pose is a
conversation, while a future seated action can add a different anchor without
renaming the action.

Rejected: mapping activity code 3 to eating. That code covers showers, toilets,
television, reading, washing, bathing, sitting, and every other object use.

Rejected: treating the existing gameplay tags as presentation categories.
Tags already drive hobbies, traits, sleeping, and satisfaction. Reusing them for
art would make a visual rename change gameplay identity and would recreate the
vocabulary collapse that the object and chain role systems already avoid.

## [CA2] The render buffer carries the action and its real anchor

Two `u32` columns are appended to `RenderBuffer`:

1. `visual_actions`, where 0 is none and 1 is talk.
2. `facings`, where 0 is none and 1 through 4 are the four lot-axis directions.

The initiator's `Socialising.partner` is its anchor. The receiving participant
normally carries only `Reserved`, so the render sync's existing partner pass
also records the initiator as the receiver's anchor. The simulation resolves
each participant's lot-axis facing toward that exact entity. Both participants
therefore face each other even when two conversations happen nearby.

The web renderer must never infer pairs from distance, row order, or activity
code. Those shortcuts all fail when two talks occupy the same room.

Object interactions need their own explicit anchor vocabulary later. This slice
emits no object action until an interaction explicitly authors a supported
visual contract. Existing object use therefore keeps the current body and
indicator.

## [CA3] Muted Line gets directional, fixed-envelope talk poses

Each of the three stable character palettes gains eight appended atlas sprites:

1. Two talk frames for positive lot x.
2. Two talk frames for negative lot x.
3. Two talk frames for positive lot y.
4. Two talk frames for negative lot y.

All twenty-four sprites keep the current 38 by 88 bottom-centred envelope. The feet,
contact shadow, torso, head, palette, and outline remain planted. Only the arm
toward the partner changes, with the raised frame ending at chest height. The
fixed envelope keeps current picking, depth, indicators, selection rings, and
carried badges aligned.

Atlas entries are appended, never inserted. Existing compiled sprite indices
must not move.

## [CA4] Simulation time owns the pose phase

The shell passes the current simulation tick into `buildInstances`. A talk pose
holds for four simulation ticks before changing. Stable entity id supplies the
participant offset so the household does not gesture in lockstep.

Wall time is forbidden. Simulation time gives the required behavior for free:

1. Pause freezes the pose.
2. Speed changes accelerate or slow the pose with the game.
3. Load reconstructs the same phase from the restored tick.
4. Replay and deterministic tests see the same frame.

Reduced motion keeps the directional quiet talk pose fixed. It does not fall
back to idle, because the action still has to be readable without ornamental
movement. The activity bubble and HUD remain redundant non-motion signals.

## [CA5] Save compatibility and performance stay explicit

The visual fields are presentation-only and are deliberately excluded from the
Save V1 structural compatibility digest, like labels, tags, durations, and
sprites. A save resumed after this patch keeps its numeric interaction meaning.

The render loop still allocates no per-entity objects. Typed-array views are
recreated on each call and the shared instance buffer remains reused. Facing is
already a flat value, so the frame builds no target map and performs no pair
search.

## [CA6] Acceptance

Automated coverage must prove:

1. Content rejects unknown or incomplete visual contracts and compiles `chat`
   to the exact talk/partner/toward-anchor combination.
2. Both sides of one `Socialising` record receive talk actions and point at each
   other, while an unrelated waiter remains unanimated.
3. The WASM pointers and web bridge address the new columns after memory growth.
4. Two nearby conversations keep their own pairs.
5. All four anchor directions choose their matching directional sprites.
6. Normal motion changes frame with simulation ticks; pause and Load do not
   invent a wall-clock phase.
7. Reduced motion holds the directional quiet pose.
8. Idle, walking, object-use, carried-badge, selection, zoom, and picking
   behavior remain unchanged.
9. Save V1's compatibility digest is unchanged by presentation-only edits.

A watched in-app-browser pass must show one real conversation at native scale,
paused twice at the same pose, resumed through both frames, restored through
Save/Load, and viewed at 0.5x and 2.5x. It must also exercise reduced motion,
night lighting, a carried item if one is available during talk, and report no
console or WebGPU validation errors. Hidden-tab or DOM-only evidence is not a
claim about rendered animation.
