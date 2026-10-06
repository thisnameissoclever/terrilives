# Bathroom Action Poses Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` task by task. Root owns source acceptance and
> publication under the user's standing autonomous authorization.

**Goal:** Add physically fitted toilet, shower and bath loops with correct
four-facing rendering, visible picking and unchanged gameplay/save contracts.

**Architecture:** Author each fixture's pose separately against immutable
accepted models. Export reciprocal visible contributions through the existing
generic layer renderer. Keep fixture actions distinct from media seating leases.

**Tech stack:** Blender, Python/Pillow, Rust and TypeScript browser graphics.

**Spec:** `docs/specs/2026-10-05-interaction-animation-expansion.md`.

## Global constraints

1. Work only in the assigned linked worktree; preserve untracked diagnostics.
2. Do not change dependencies, use paid providers or mutate accepted inputs.
3. Preserve seventeen anatomical bone lengths and the standing Sim appearance.
4. Preserve furniture identities, footprints, save fields and previous sprites.
5. Use hidden background source jobs and close task-owned browser contexts.
6. Publish validated batches without waiting for duplicate remote checks.

## Review focus

1. Mechanical acceptance must not conceal a visually wrong edge-perch pose.
2. Open surfaces need actual finite support, not a hull spanning an empty hole.
3. Complete clothing and shoe geometry can fail despite correct joint lengths.
4. Water and steam must provide coverage without becoming false support solids.
5. Body picking and source registration must agree in every facing after Load.

Implement fitted toilet, shower and bath loops using the approved shared Sim
and accepted fixture models. Preserve existing furniture identities, footprints,
save data, standing appearance and all published sprites. Use local Blender
authoring and rendering; no paid provider or new dependency is required.

The media batch is independent of these poses. Do not modify its pinned source
modules to extend their profiles; those files remain dependencies of immutable
published receipts. Use the existing general rig and rendering interfaces,
with new fixture-specific pose and contact modules.

## Toilet source task

**Files:** Create `assets/models/bathroom/actions/toilet_pose_geometry.py`,
`toilet_pose.py`, `toilet_contact.py`, `render_toilet_use.py` and
`test_toilet_pose_geometry.py`.

**Interfaces:** Consume the existing `build_rig.pose`, `direct_bone`, evaluated
surface/collision helpers and `animation_export.render_pass`. Produce
`on_ring(x, y) -> bool`, `validate_patches(patches) -> list`,
`two_link(start, end, upper, lower, pole) -> tuple`,
`apply(rig, hip_z, hip_y, phase) -> None`, `measure(root, rig, body) -> dict`
and `run(output, render=True) -> None`. The receipt owns measured source
geometry; callers must not treat unmeasured proposed pose values as certified.

- [ ] Write and run the pure geometry tests before implementing their helpers.

```python
assert on_ring(.193, -.10)
assert not on_ring(0, -.10)
assert not on_ring(float('nan'), -.10)
```

- [ ] Check two-link reachability and lengths independently of the pose writer.

```python
start, end = (0, 0, .55), (0, -.46, .15)
joint = two_link(start, end, .37, .36, (0, -1, .50))
assert abs(math.dist(start, joint) - .37) < 1e-10
assert abs(math.dist(joint, end) - .36) < 1e-10
```

- [ ] Run `python -B -m unittest discover -s assets/models/bathroom/actions -p 'test_toilet_pose_geometry.py'`.
- [ ] Implement the fixture pose and full evaluated support/collision checks.
- [ ] Run a new mechanically checked four-facing prototype through hidden Blender.
- [ ] Review every prototype with root and an independent visual reviewer.
- [ ] Bake and validate the closed-loop matrix only after source acceptance.
- [ ] Include the reviewed source in the coherent runtime delivery; workers do not commit shared work independently.

1. Read the accepted toilet scene, ring geometry and saved-scene checker.
2. Write pure geometric tests for the annular support domain and limb lengths.
3. Fit a supported seated pose facing the toilet's local negative-Y front.
4. Check every evaluated body mesh against every fixture solid.
5. Prove actual contact with both sides of the seat ring using finite patches.
6. Reject support measurements that span the empty opening as if it were solid.
7. Keep both shoes near the floor without stretching anatomical bones.
8. Preserve the upright lid, cistern clearance, fixture camera and materials.
9. Render a four-facing green prototype after mechanical checks pass.
10. Obtain primary and fresh-context adversarial visual review.
11. Bake a closed idle loop and render all shirts, facings and samples.

Use the immutable source
`assets/models/bathroom/owner-review-pending/toilet/candidate-03/toilet-authoring.blend`.
Retain original renders, editable output, exact input hashes and measured
contact evidence in new directories. The prototype is not approval for runtime
integration. Preserve all earlier producers and batches.

Solve support and clearance together before rendering another toilet pose.
Use the measured ring grid to intersect the allowed support-height intervals
for complete mirrored patches and global nonpenetration. Search every minimal
grid rectangle meeting the unchanged width, depth and area requirements as a
sufficient initial construction. For curved contacts, use an independently
reviewed certificate of actual connected surface area rather than a bounding
rectangle. Partition complete cell interiors by evaluated body and fixture
triangles. Require complete, unambiguous surface coverage and bound each
piecewise-affine gap at its partition vertices. Count only certified area;
retain mirrored ownership, full-edge connectivity and the same gap, area and
span limits. Keep the complete body/fixture collision gate separate. A failed
sampled rectangle search does not prove continuous geometric impossibility.

If deformation remains suspect, inspect original vertex indices immediately
after the armature and before subdivision. Compare the measured deformation
with the explicit weighted bone transforms. Keep the full subdivided surface
as the final collision authority. Do not change skinning modes or move isolated
collision vertices without identifying the deformation defect.

## Shower source task

Fit feet within the rounded tray interior at its actual floor height. Check
complete soles and evaluated head, curl and arms against the tray, panels,
trims, curved arm and nozzle. The existing nozzle is lower than the shared
standing head; an assumed centred upright pose is not an acceptable fit.
Use a plausible offset or lean that clears the hardware. Preserve the fixture
geometry rather than silently changing its height.

Add modeled opaque steam for modest coverage in the two open views. Preserve
the opaque panels. Keep enough visible head or arm coverage for body picking.
Use restrained washing gestures and separately test spray/coverage containment.
Do not claim control contact unless the hand actually meets the control.

Use a declared shower-only bathing appearance. Assign the existing warm skin
material to the torso and upper-arm meshes; retain their topology and weights.
Omit collar, pocket, placket, cuff, hem and button details only in this output.
Record the exact visibility inventory and preserve the standing source bytes.
Check every retained body surface, and keep the original clothed-body collision
diagnostic as additional evidence. Clothing omissions must not hide penetration.

Use one continuous asymmetric cloud exterior over the protected opaque
enclosure. Give the cloud its own opaque graphic material rather than the
shirt's solid-object shading. Do not arrange its outline into a collar, waist
roll or lower hem. Exclude cloud surfaces from dark outline selection while
preserving body, fixture and water outlines. Conceal trousers and shoes while
retaining readable head and washing arms. Attach visible water to the actual
nozzle and measure impact on the shoulder or upper back; the low nozzle does
not require the head to stand directly beneath it.

## Bath source task

Recline within the actual sloping basin. Require independent finite hip and
back support neighborhoods, not a bounding-box match. Preserve bone lengths;
fit bent knees where the basin requires them. Keep head, hands and feet clear
of the shell and fittings. Use the accepted centred candidate-02 source and
the current SW runtime orientation; do not apply another half-tile offset or
quarter-turn migration.

Create opaque water below the rim from the basin contour at the chosen height.
Treat water as an occluder, not a structural support solid. Hide lower-body
clothing/anatomy consistently while retaining readable head and arm motion.

## Export and runtime task

Toilet presentation uses render action 18 and appends `UseToilet` to the
compiled action vocabulary. Codes 14 to 17 belong to the cleaning chores
that reached main first, so the earlier draft code 15 is not available. Its authored contract is `use_toilet`,
`object_socket`, `socket`, with a declared socket. The shipped toilet's
`seat` stays at its fixture origin and rotates with the object. Preserve
the exact use target, flush sound, privacy, duration, path position and
save fingerprint. Keep the ordinary activity code distinct from the body
animation code.

Bath presentation appends `CompiledVisualAction::Bathe` after `UseToilet` and
uses render action 19; its authored contract is `bathe`, `object_socket`,
`socket`, with the tub's declared `basin` socket at the fixture origin. Shower
presentation appends `CompiledVisualAction::Shower` after that and uses render
action 20, the next code after the bath. Its only legal authored contract
is `shower`, `object_socket`, `socket`, with an existing declared socket.
The shipped shower's `tray` socket stays at the fixture origin and rotates
with its facing. The live target and active interaction must agree before
projection. Keep the path
position, duration, needs, privacy tags, sound and save fingerprint unchanged.

Keep bathroom action tables separate from historical seating and bed tables.
Append their sprite records and compose their visible layers through the
shared renderer. Preserve each existing table and decoded sprite exactly.

Render full-scene beauty and reciprocal visible body, fixture/coverage and ink
contributions. Capture body-owned ink independently. Bind complete dependency
inventories, exact original render dimensions and all evaluated contact checks.
Reject non-finite or shortened evidence and mismatched geometry/palettes.

Compare source reconstruction with independently filtered original beauty.
Append new records after the complete released atlas. Keep fixture profiles
separate from gameplay seating leases; only their generic visible-layer
composition is shared. Preserve device sounds, needs, duration, privacy and
actual interaction ownership. Explicit authored visuals retain precedence.

Test actual production entry, use, exit, Pause, reduced motion, save/load,
visible picking and all facings. Verify shader fidelity with full-frame copied
buffer readback, preserving its separate proof boundary from source beauty.
Obtain adversarial code and visual reviews, then publish each usable batch
under the standing authorization. Update the delivery date's changelog and
verify public deployment separately without waiting for duplicate local checks.
