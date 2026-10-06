# Toilet pose source task

Work only in `D:/VIBES/.worktrees/terrilives/bike-chair-four-facings`, branch
`twcx/bathroom-action-poses`, based on merged media revision
`1a138df6438d5e984f6190956b46aaf9a69f4dc9`.

The user requests fitted bathroom animations and authorized autonomous
implementation, review and publication. Root owns publication and runtime.
Do not modify the canonical checkout, existing producers, accepted `.blend`
inputs, published source pins, seating exports, dependencies, Git or other
workers' files. You are not alone; preserve concurrent root work.

## Ownership

Create only these new source files:

1. `assets/models/bathroom/actions/toilet_pose_geometry.py`
2. `assets/models/bathroom/actions/toilet_pose.py`
3. `assets/models/bathroom/actions/toilet_contact.py`
4. `assets/models/bathroom/actions/render_toilet_use.py`
5. `assets/models/bathroom/actions/test_toilet_pose_geometry.py`

Own new generated directories under
`assets/models/bathroom/actions/review/toilet/`. Preserve all failed trials.
Write your report to `output/toilet-source-report.md`. No subagents or large
unrelated suites. If three similar fit attempts fail, report exact attempts
and evidence to root before a fourth; root dispatches fresh-context rethink.

## Required references

Read `docs/superpowers/plans/2026-10-05-bathroom-action-poses.md`, bathroom README,
`toilet_geometry.py`, `toilet_model.py`, `check_toilet_scene.py`, the general
shared rig and existing source rendering/contact helpers. Do not extend pinned
seating helpers through global monkeypatching. New pose math may call stable
general rig interfaces; keep fixture-specific behavior in the owned files.

Exact immutable toilet input:
`assets/models/bathroom/owner-review-pending/toilet/candidate-03/toilet-authoring.blend`,
SHA256 `7eac6444f15d540cfc025c3d5c650ba694c2f30c6cdaebb119853b08f7651859`.
Shared standing rig input SHA256:
`919e8994cbf7510a4d9947f173abec8b41ac77d61f6e829bcf5981c8d2fcddce`.
The scene already contains hidden shared rig `SIM_01_SHARED_RIG` and fixture
root `TOILET_MODEL_ROOT`. Repartition meshes by root membership, not by hiding
the complete existing hidden-reference collection indiscriminately.

## Mechanical and visual acceptance

1. Face local negative Y. The open seat ring top is Z=.45, center Y=-.10,
   outer oval radii .218/.293 and inner radii .163/.228.
2. Fit hips using actual evaluated ring hits and separate finite support
   patches on both sides. A convex hull across the central hole is not proof.
3. Evaluate complete body geometry against every fixture solid. Preserve lid,
   cistern, neck, bowl, pedestal, hinges, seat and fittings. Water is not a solid.
4. Preserve all seventeen anatomical bone lengths within `1e-5`; no body or
   furniture scaling. Use reachable two-link limb geometry and plausible knees.
5. Keep actual shoes near the floor and report complete sole heights/clearance,
   not ankle heights alone. Preserve the approved face, curl, materials and body.
6. Keep clothing, remove book/food props and avoid explicit anatomy. Use a
   restrained neutral toilet idle pose, not a chair reading action with a book.
7. Preserve the accepted camera/world scale and register the projected origin.
8. Require finite evidence, sorted complete inventories, exact input hashes,
   original render dimensions and immutable source byte checks before/after.

Write pure tests first for annular support membership and anatomical solver
lengths. Use negative controls for fake central support and unreachable limbs.
Use fixture-specific saved-scene validation without altering the prior checker.

Start with a mechanically valid green prototype rendered in all four source
facings. Root and an adversarial reviewer inspect it before the full matrix.
Then bake a four-sample closed idle loop, preserve editable output, and render
all three shirts/four facings/four samples/full reciprocal owner passes when
root sends the source-acceptance continuation. Do not claim animation support
from static fixture checks or a single pelvis point.

## Tools and bounds

Use the installed background launcher:
`C:/Users/myema/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe`.
Use `Start-Process -WindowStyle Hidden`, two Blender threads, Python exit code
one, absolute script and new output paths. The launcher may detach; observe
only the owned job and complete receipt before declaring completion. Never
take over the desktop, close user tabs or stop another task's process.

Reuse `furniture/animation_export.py` for reciprocal owner rendering and the
existing evaluated-body collision interfaces where appropriate. Keep all
transitive input hashes in the new receipt. No paid service or dependency work.

Report exact commands, red/green results, measured support and clearance,
prototype paths, source hashes, remaining limits and any failed alternatives.
