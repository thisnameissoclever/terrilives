# Front door, then furniture builder

Status: front door and furniture builder deployed and visually verified through
`097a849` on 2026-09-21. The selection handoff refinement below is a follow-up
change and requires its own checks and deployment verification.

## Front-door release

The existing career exit becomes a visible doorway. Its frame stays planted;
the leaf opens as a worker approaches, remains open during crossing, and closes
after departure. At the end of a shift it opens again, and the worker walks one
tile to the authored entry point before resuming ordinary actions. Work pay
and duration remain unchanged.

The lot's existing `front_door` coordinate remains its route identity. An
optional nested visual table supplies facing, hinge, four sprite references and
an optional adjacent entry point. The shipped door uses a side approach at
`(15,3)` to avoid the existing floor lamp at `(14,2)` without moving furniture.
Legacy lots without that table retain their existing behavior. The compiler
validates a unique boundary edge, matching outward facing, a clear cardinally
adjacent entry tile reachable without crossing a solid wall edge, and all
sprite references. Facing determines the physical
crossing normal independently of that entry tile. Compiled portal records
append to the pack.

Rust derives door state from saved work countdowns, commuter paths and positions.
The existing commuting marker and path distinguish departure from return;
there is no new save field or wall-clock timer. A separate portal buffer carries
position, frame, normal leaf, reduced-motion leaf and state. The shell draws
the two layers in its existing instanced draw. Portals have no entity identity,
interaction menu, reservation or collision footprint.

Only an authored scene activates portal drawing. Blank simulation constructors
remain blank, including after Load. This presentation marker does not control
career routing: the fingerprinted content does, so the same save replays
identically through either constructor. Hidden work samples are already at the
physical threshold before a returning worker becomes visible.

Portal identity and return landing participate in the compatibility digest.
The rotated-bathtub pre-door public digest has an exact bridge to this landing.
Earlier public households first pass the bathtub migration's frozen-layout
validation. Neither path changes Save V1's bytes or accidentally applies older
household-name/action-row rewrites. Moving a landing in a later content revision
closes the exact bridge.
Facing, hinge and sprite changes remain presentation-only.

Main's Save V2 envelope owns the saved architecture. Door restoration retains
that architecture and the caller's portal drawing activation; it does not
replace saved walls with the current authored lot. A real pre-door V2 browser
fixture covers the existing public content fingerprint and wire format.

Pause freezes the state. Reduced motion uses a fully open leaf for every active
crossing. Concurrent workers keep the door open when either needs it. The art
must match current furniture and the approved Sim at normal and close zoom.

Verification includes validation failures, departure and return without a second
payment, all door states, multiple workers, save/load during crossing, WASM
memory growth, layer ordering, lighting and reduced motion. The played pass
must inspect the real career route in the production build and again after
the merge deploys to Pages.

## Following release: furniture builder

The owner requested movement and rotation where supported. Begin by reconciling
existing facing work with current main. Use one authoritative Rust placement
validator for both preview and commit. The interface needs an explicit editing
mode, selection, a visible placement preview, confirm/cancel, clear rejection
reasons, and controls usable with pointer, keyboard and touch.

Selecting a different item commits the current valid, changed preview through
the same command path as Confirm, then selects the new item after the result.
An invalid preview is cancelled when another item is selected. Unchanged items
switch immediately without a command; selecting the same item keeps its preview.
If validation rejects an automatic commit during the command drain, the new item
is selected and the previous move's cancellation reason is shown. Explicit Cancel
and Exit build keep their existing behavior. Confirm and Cancel also float over
the lifted piece in the game view, with the panel's enablement ([PA-show] in
`docs/specs/2026-09-22-placement-buttons.md`).

Placement must preserve object identity and interactions, reject collisions and
blocked routes, and survive Save and Load. Rebuild candidate occupancy from
walls and live furniture rather than clearing individual blocked tiles. If an
object is in use, explain why it cannot move. Unsupported rotation must be
disabled with an explanation. Purchasing furniture, building walls and roofs,
and changing room shapes remain later parts of the broader builder backlog.

The implementation units and acceptance tests are recorded in
`docs/superpowers/plans/2026-09-20-furniture-builder.md`.

## Delivery

Fetch main at the start of each round and before publishing. Integrate new main
commits in the feature branch and rerun affected checks. Leave other worktrees'
uncommitted work intact. Each feature gets its own reviewed commit and PR;
wait for every applicable check before merging, then verify the merge commit's
CI, Pages deployment and running game.
