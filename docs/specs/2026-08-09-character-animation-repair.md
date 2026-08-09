# Character animation repair

Status: shipped in PR 50 at merge `7348bba5986e6b2df99aad009f655489c643db32`.
Pages run 31330444994 built and deployed that exact SHA. The
2026-08-09 visual review accepted conversation, rejected transform-only walking
as a walk cycle, rejected eating without visible food in the hand, and rejected
seated reading with its distorted neck. [A-animation-owner-review] records that
verdict; [A-character-animation-repair] records the corrected local production
replay and the merged public Pages replay. Operating-system reduced motion, a
physical-phone check, and final owner approval of the repaired art remain open.

This repair changes presentation only. It adds no motive, interaction, save
field, simulation outcome, object contract, draw call, shader, dependency, or
new player command.

## [CAR-scope] Repair three rejected motions without reopening Chat

The slice contains exactly three player-visible repairs:

1. Replace the walking body lift with directional limb animation.
2. Put a visible snack or dinner in the eating hand.
3. Redraw seated reading with believable head, neck, and shoulders.

The accepted Chat pixels and its eight-tick hold are invariants. Eating keeps
its sixteen-tick hold. Seated and standing reading keep their twenty-four-tick
holds. These category-specific values are the minimum readable cadence accepted
for this pass, not a rule that later actions must share one duration.

## [CAR-walk] Walking requires a real directional limb cycle

Render-buffer visual action codes remain append-only:

1. `0` remains no presentation action.
2. `1` remains talk.
3. `2` remains eat.
4. `3` remains seated read.
5. `4` remains standing read.
6. `5` means walk.

The simulation emits action `5` only when the final player-facing activity is
`WALKING`. The accompanying facing comes from the next path step. Existing
talk, eating, seated-reading, and standing-reading precedence remains stronger.
No new bridge column is allowed; action and facing reuse the existing typed
views. Save V1 and the world hash ignore this presentation projection.

During interpolation, the Web renderer derives facing from the actual previous
to current segment because that is the direction currently drawn. At a corner,
it must not face the next leg early. When both position samples are equal, such
as Pause or the first frame after Load, it falls back to the emitted facing.

Each of the three looks gains two frames for every lot-axis facing. The names
are `simWalkSE0` through `simWalkNE1`, plus the established `sim2` and `sim3`
prefixes. All 24 bodies are 38 by 88, bottom-centred, and visibly change both
lower-body and arm silhouettes. They append at atlas indices 147 through 170.
Existing indices 0 through 146 and all accepted Chat pixels remain fixed.

Travel distance owns the two-step phase. Wall time and render-frame count are
forbidden inputs. Pause freezes the body; speed changes scale it with simulation
movement; replay and Load agree. Reduced motion pins directional frame zero but
keeps position interpolation, so accessibility never turns smooth travel back
into ten-hertz tile jumps.

The old transform-only body lift and its carried-prop lift are removed. Body,
indicator, carried item, selection ring, depth, lighting sample, and picking
remain anchored to the same interpolated world position. The ordinary 38 by 88
envelope owns picking; obsolete invisible headroom is removed.

## [CAR-eat] Eating shows the thing being eaten

Exact authored eating remains action `2`; broad `EATING` activity never chooses
art by itself. Terminal dinner already carries item kind `dinner` and continues
to use `carried_dinner`. A snack has no carrying component, so exact action `2`
with no dinner uses the appended `heldSnack` sprite at atlas index 171.

The food prop follows the same facing, hand side, and sixteen-tick frame as the
eating arm. It must be visibly held in both poses at native size, including the
mouth pose. Invalid facing, invalid action, generic object use, unrelated
carrying, and non-eating activity must not invent food. A valid dinner draws one
dinner prop, never dinner plus snack. The existing scratch buffer, instance
count bound, one draw, and one submit remain sufficient.

## [CAR-seat] Seated reading keeps the socket and loses the giraffe neck

Seated-reading names and indices 98 through 121 remain unchanged. The redraw
must preserve the 38 by 88 envelope, bottom anchor, bent legs, open book, hands,
gaze, look identity, four facings, two frames, action `3`, activity `8`, socket
projection, Pause, Load, picking, ring, indicator, depth, and lighting.

The head is lowered to meet the shoulders. Any exposed skin between the head
and torso is limited to a short natural overlap rather than the previous long
vertical bridge. A generator geometry check pins that maximum, but native-size
played inspection remains mandatory because a perfectly reproducible bad neck
is still a bad neck.

## [CAR-proof] Causal gates and played acceptance are both required

Automated coverage must prove:

1. Rust projects walk action `5` and all four facings from real paths, falls
   back safely for exhausted paths, and preserves stronger action precedence.
2. Save, Load, paused sync, world hashes, and WASM memory growth preserve or
   reconstruct the existing action and facing columns without a schema change.
3. Web frame selection covers all segment directions, equal-sample fallback,
   corners, both distance phases, negative coordinates, reduced motion, Pause,
   speed, and fixed interpolation.
4. The transform-only lift is gone while ring, indicator, carried item, depth,
   lighting, zoom, picking, and live instance count remain aligned.
5. Snack and dinner props follow every eating hand side and both frame heights;
   malformed and generic siblings draw neither.
6. Atlas generation preserves names and decoded pixels 0 through 146 except the
   intentional seated-reading redraw at 98 through 121. Accepted Chat crops are
   byte-identical. Walk occupies 147 through 170 and `heldSnack` is 171.
7. Each repair has a deliberate production-seam mutation that fails the causal
   test and restores byte-identically.

Played production WebGPU acceptance must issue each action through its ordinary
player route at 1x before using 2x or 3x. The walk must show changing arms and
legs rather than only whole-body movement. Snack and dinner must remain visible
in the active hand. Seated reading must show a normal neck at native, default,
and close zoom. Chat must remain visually unchanged. Pause, completion, and at
least one Load transition must not glide or jump. Browser warnings and errors
must remain zero.

Source tests and atlas checks do not satisfy this played gate. Public Pages and
physical-phone evidence remain separate from local production acceptance; the
current public evidence and its remaining boundaries are recorded in
[A-character-animation-repair].
