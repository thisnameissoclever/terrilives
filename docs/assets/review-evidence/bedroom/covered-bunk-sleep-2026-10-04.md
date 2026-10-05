# Covered lower-bunk source checks

Inspected on 2026-10-04 in `twcx/covered-bunk-sleep`, based on
`c83e32d70db6ef664e8829e85f8195bfa74e8bff`. This record covers authoring geometry
and source previews. It does not establish production contribution export,
runtime picking, recoloring, save compatibility or publication.

## Sources and intended presentation

The immutable near-ladder bunk source has SHA-256
`10b507a6dfcbbec05457cf7c9c857ee1f3fc08b80915967b743cace15b9fa9fa`.
The approved double-bed pose recipe has SHA-256
`53bd65cc4c42ee60a3e68e5710e8da827e160f19c026da64237d58720eb31058`.

The object-local replay preserves the approved 0.88 sleeping-only scale and
relaxed legs. It centers the entire posed rig at X=0 and lowers it to the
bunk's support surfaces. Standing art, the source rig and the source model
remain unchanged. The head end stays at local +Y; the ladder stays at local
-X. The single lower sleeping place and 2x1 gameplay footprint are unchanged.

One continuous sage duvet covers the feet. Occupied rendering exposes a linen
mattress underneath instead of showing a second flat green cover. Empty
occupancy removes the generated duvet and restores the source's green bedding
material. The upper bunk is unchanged.

## Measured fit and rejected cloth forms

The complete evaluated body spans X=-0.30859029 to +0.30859026,
Y=-0.91272557 to +0.81781512 and Z=0.46052766 to 1.11233473. The mattress is
0.76 wide and 1.86 long; the upper platform begins at Z=1.28. No body/frame
bounding overlap was found. These values include the concealed feet and hair.

Sampled support uses the existing soft-bedding gap tolerance, -0.025 to +0.01.
Torso minimum gap is +0.00824547 with 16 contact samples. Each foot has 132
samples and a minimum gap near -0.0068667. The full head/pillow query finds
24 contact samples across about 0.10084 by 0.01907, with minimum gap +0.00327212.
The old folded pose's restricted head sampling region is not reused.

The first source preview passed primary and independent appearance review but
failed physical clearance: its inset side hems crossed the mattress in 946
triangle pairs. Raising the side hems left 332 pairs at the foot wrap. The
crossing bounds identified the foot skirt, where inward thickness reached back
into the mattress. Extending the foot wrap outside the mattress removed all
evaluated cloth/body and cloth/furniture triangle crossings.

The rejected source images, original cloth script and diagnostic JSON records
are retained under the bunk's `covered-sleep/rejected/preview-01` directory.
Do not use the first preview as production
clearance evidence. The final source probe uses an immutable image journal and
terminal receipt; the actual worker exit must be observed before that receipt
is accepted.

## Causal checks

`test_bunk_sleep_cloth.py` failed before the new cloth generator existed.
The side-hem regression failed with a lower-bound result of 0.422, below the
0.46739448 mattress top. The inward-foot regression failed with -0.927, inside
the mattress end at -0.93. All seven cloth tests passed after correction.

The Blender scene exercise passed centered fit, unchanged geometry across four
legacy frame keys, rigid facing reset, clothing-palette isolation, empty to
occupied to empty transitions, invalid occupancy rejection and unchanged source
bytes. The action remains static; scene frame changes do not reactivate the
old folded `sleep` action.

`check_covered_bunk_scene.py` passed the evaluated positive scene. Four
deliberate displacements failed: raised mattress, raised pillow, lowered upper
platform and lowered occupied duvet. Restoring the objects reproduced the
positive measurement exactly. Empty-to-occupied replay also reproduced it.

After the final foot correction, the bedroom Python suite passed 35 tests.
Existing Pillow deprecation warnings appeared in double-bed layer helpers.
That result is not a claim that the final production integration is tested.

## Proof boundaries

Independent review opened all four covered views and the uncovered SW
diagnostic. It accepted the relaxed pose, covered feet, single duvet and frame
occlusion. Uncovered diagnostics intentionally hide upper objects so the whole
body can be inspected; they are not game artwork.

The fresh `source-probe-02` completed six source images and its immutable
terminal journal under pinned Blender. The actual worker, PID 102100, exited.
Primary review inspected the corrected contour. Independent review opened all
four updated covered views and accepted the corrected source appearance.
Its code review found no source-stage blocker. This proves zero measured cloth
triangle crossings, sampled support and conservative body/frame bounds; it is
not exhaustive volumetric collision certification.

A future production batch must bind its final scripts and source hashes, preserve
existing decoded sprites, validate visible body ownership, and pass actual
game and publication checks. No source-probe result substitutes for those gates.

This source-authoring checkpoint changes no released game behavior. It has no
public changelog note. The player-visible bunk change requires a note with its
later runtime integration.
