# Toilet source prototype

Prototype 04 passes the bounded mechanical checks and contains all four
green-shirt beauty views, but root rejected its front-perch visual fit. It is
mechanical-only green and VISUALLY REJECTED, not an accepted source gate. No
full animation matrix, runtime change, paid call, dependency
change, Git mutation or canonical-checkout change was made.

## Evidence

The complete receipt is
`assets/models/bathroom/actions/review/toilet/prototype-04/proof.json`.
The editable scene is `prototype-04/toilet-pose-authoring.blend`, SHA256
`cfbfeab3ad33164750f24224705a8bc91959140883e3e8ed5e147901e7631639`.
Imported producer files are copied under `prototype-04/source/` and their
transitive hashes are bound by the receipt.

1. All 54 visible body meshes are checked against all 14 fixture solids: 756
   evaluated pairs, zero surface crossings or containment detections. The lid,
   cistern, neck, bowl, pedestal, hinges, seat and fittings remain present.
   Only the still bowl water is excluded from structural collision checks.
2. Hips face local negative Y and are placed at Y=-0.32, Z=0.573361624240875.
   The lowest actual hip-to-ring ray gap is 0.000999629497528076 m. Support is
   proved through two disjoint rectangular neighborhoods, each 0.00081 m2,
   using 112 evaluated hip/ring witnesses per neighborhood. Left X is
   [-0.120,-0.102], right X is [0.102,0.120], and both Y ranges are
   [-0.328,-0.283]. Each entire rectangle remains in the analytic annulus;
   no convex hull spans the opening. Patch gaps are approximately 0.00541
   through 0.009715 m. These are finite proximity patches on a rigid body,
   not a claim of simulated soft-tissue compression or continuous contact.
3. All seventeen anatomical bone lengths are preserved. The largest evaluated
   length error is 1.71501670087615e-7 m, below the required 1e-5 m. Limb
   targets use a reachable two-link solve and no body or furniture scaling.
4. Both actual shoe soles contain 1,346 evaluated vertices. Their minimum
   heights are 0.019148096442222595 and 0.019148115068674088 m. Their complete
   evaluated Z ranges end at 0.06815111637115479 and 0.06815114617347717 m.
   These are inherited near-floor clearances, not sole-to-floor contact.
5. The original camera matrix and orthographic scale 2.6516504287719727 are
   retained. All images are 768x960. The projected origin is
   [384.0000915527344,760.0034952163696] pixels. Alpha bounds are SE
   [211,303,606,895], SW [162,294,557,895], NW [162,163,557,819] and NE
   [211,190,606,819]; none reaches a canvas edge.
6. Saved-scene reload passes both the fixture's original checker and the new
   full-body/ring checker, without changing the saved scene bytes. Deliberately
   raising the ring, raising the hips and hiding the upright lid all fail their
   intended checks, followed by a clean remeasurement.
7. The accepted toilet source remains SHA256
   `7eac6444f15d540cfc025c3d5c650ba694c2f30c6cdaebb119853b08f7651859`.
   The standing rig remains SHA256
   `919e8994cbf7510a4d9947f173abec8b41ac77d61f6e829bcf5981c8d2fcddce`.
   Every bound source input is byte-identical before and after prototype 04.

## Commands and outcomes

1. `python -B -m unittest discover -s assets/models/bathroom/actions -p test_toilet_pose_geometry.py -v`
   initially exited 1 with four expected assertion failures because the pose
   geometry implementation did not yet exist. After implementation it exited
   0: four tests passed. Negative cases cover empty central support,
   centre-adjacent front-only support, duplicated side patches, zero-area
   support, non-finite input and unreachable limbs.
2. `python -B -m unittest discover -s assets/models/bathroom -p test_*.py`
   exited 0: eight existing bathroom geometry tests passed. This scoped command
   does not include the separate actions test command and is not the repository's
   full suite.
3. The final hidden launch was:

   ```powershell
   $toiletScript = 'D:/VIBES/.worktrees/terrilives/bike-chair-four-facings/assets/models/bathroom/actions/render_toilet_use.py'
   $toiletOut = 'D:/VIBES/.worktrees/terrilives/bike-chair-four-facings/assets/models/bathroom/actions/review/toilet/prototype-04'
   $toiletJob = Start-Process -FilePath 'C:/Users/myema/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe' -WindowStyle Hidden -PassThru -ArgumentList @('--background','--threads','2','--python-exit-code','1','--python',$toiletScript,'--',$toiletOut)
   $toiletJob | Select-Object Id,ProcessName
   ```

   The launch shell exited 0 and returned launcher PID 84256. The detached
   Blender worker's process exit code was not independently observed. The
   receipt reached `state: complete`, all four image hashes were verified,
   and no process with this task's `render_toilet_use.py` command remained.
   Blender was 4.5.14 LTS with two fixed render threads.
4. Pillow image inspection verified dimensions and complete alpha bounds for
   every final beauty image. Live source hashes and receipt-bound source
   hashes were rechecked. No large or unrelated test suite was run.

## Retained alternatives and review limits

1. Prototype 01 used Y=-0.12. The actual ring-height fit preserved bone lengths
   and soles but both trouser legs crossed the seat ring: 168 and 172 triangle
   pairs. Its failed receipt remains in place.
2. Prototype 02 used Y=-0.25. The front underside of each thigh still crossed
   the ring: 94 and 100 triangle pairs. Its receipt retains the evaluated
   ring-band vertices. This was a second failed fit, not acceptance.
3. Prototype 03 used Y=-0.32 and passed the complete collision checks, then
   rendered all four views. Its first rectangle search chose unequal side
   patches, including a centre-adjacent right front-arc patch. Prototype 04
   tightens both patches to |X| >= 0.08, searches symmetrically, and adds
   saved-scene and negative-control evidence without changing the pose.
   Root rejected the shared prototype 03/04 pose because it perches too far
   forward, leaving most of the opening behind the hips. This is three related
   overall-fit failures, despite mechanically passing the third placement.
   A fresh-context better-way reviewer supplied a knee-first alternative before
   further fit work. Prototype 04 remains immutable rejected evidence.
4. Primary inspection found all four source silhouettes readable, with the
   approved clothed character and no book or food. The hip placement is toward
   the front of the seat. Rear views expose the bowl opening behind the hips.
   Root's primary review rejected that front-perch placement. No full closed
   idle loop was authored from it.
5. Four-frame closed-loop baking, three shirt variants, reciprocal owner/ink
   passes, production graphics, picking and interaction lifecycle remain
   unperformed. Static pose and fixture checks do not certify animation.

## Prototype 04 producer hashes

1. `render_toilet_use.py`: `cca634127f6720850a4af5acdfed2a81b3db99858aab032f8eef09265bc1470a`
2. `toilet_contact.py`: `e42c94d326bf550a2a37f460cd1d55b745a293148a866b9718c4d43fcf424062`
3. `toilet_pose.py`: `a7e44d9784d41d9784ee7c14ad90ab9572535a6f1c6840274171e1b1104ea971`
4. `toilet_pose_geometry.py`: `3589fbabe6a91896b9c5818f79191dd7d542e2aec1a1ae7b86697ee735e5c565`
5. `test_toilet_pose_geometry.py`: `425aa7f0e604dacb8a949b6f454f8f6512fcd312f799f49db7b3694f9bd507e0`

## Knee-first alternative, prototype 05

After root's rejection, the fresh reviewer proposed solving knees before ankles
at the original hip Y=-0.12, with ankle Z=0.15 and toe-down articulation
8.2023 degrees. No further hip-forward variation was attempted. Two new pure
tests first failed as intended: the knee-first planner was missing and the
patch validator accepted unmatched planar bounds. After implementation all
six pure tests passed with exit 0.

Prototype 05 uses the same hidden launch command with output directory
`assets/models/bathroom/actions/review/toilet/prototype-05`; launcher PID was
66860 and the launch shell exited 0. Its retained receipt is `state: failed`.
No beauty frame or editable scene was rendered/saved because the mechanical
gate failed before rendering. Its whole imported Python source inventory is
retained under `prototype-05/source/`, and every bound input remains unchanged.

1. Hip Z is 0.547968734264374. The evaluated knee is Y=-0.4879421889781952,
   Z=0.5090000629425049; ankle is Y=-0.46112796664237976,
   Z=0.1499999463558197. Both thighs and shins preserve their original lengths.
   The largest error across all seventeen bones is 1.94008289267078e-7 m.
2. Actual sole minima are 0.019148118793964386 and 0.019148128107190132 m,
   with maxima 0.09564783424139023 and 0.09564784914255142 m. There are still
   1,346 evaluated vertices per sole. The forefoot articulation preserves the
   inherited near-floor clearance without scaling.
3. Actual hip/ring minimum gap remains 0.000999987125396729 m, but both trouser
   legs cross the ring: 134 and 136 triangle pairs. Witnesses include front-band
   Y=-0.3213303, Z=0.4392014 and side-band X=+/-0.1642576, Y=-0.2813261,
   Z=0.4481029. All 756 body/fixture pairs remain checked; nothing is ignored.
4. Mirrored support is now enforced by a paired search over the same absolute
   X and Y coordinates and by independent planar-bound reflection assertions.
   The new negative unit test rejects individually valid but unmirrored patches.
   Actual mirrored support acceptance was not reached because fixture collision
   rejected prototype 05 first.
5. Wrists at (+/-0.18,-0.32,0.66) direct the hands toward the thighs. Evaluated
   palm-to-ipsilateral-trouser minimum distances are 0.019273530691862106 and
   0.019308030605316162 m. Palms/thumbs do not intersect either trouser leg or
   the hip bridge. These hands hover; physical resting contact is not claimed.

## Specified outward route, prototype 06

Root authorized the reviewer's ALT2 with hip Y=-0.16, knee X=+/-0.159,
fixed hip X=+/-0.124, knee Z=0.509, ankle Z=0.15 and toe-down articulation
8.2023 degrees. The thigh's forward distance reserves the exact 0.035 m
lateral displacement before solving knee Y. Ankle X matches knee X. No spread
or ankle-height increase was attempted.

The new three-dimensional thigh-length test first failed as intended because
the planner did not support the lateral route. After implementation all seven
pure tests passed with exit 0. The same hidden command launched output
`assets/models/bathroom/actions/review/toilet/prototype-06`, launcher PID 87168,
with launch-shell exit 0. The retained receipt is `state: failed`; no beauty
frame or editable scene was produced because fixture collision failed first.

1. Actual ring hits fit hip Z=0.550120056629181. Evaluated knee X=0.1589999944,
   Y=-0.526038408279419, Z=0.5090000033378601; ankle X=0.1589999795,
   Y=-0.49922430515289307, Z=0.1499999463558197. The opposite side is mirrored.
2. Both trouser legs still cross the open ring: 128 triangle pairs per side.
   Front-band witnesses include X=+/-0.1345750, Y=-0.3177326,
   Z=0.4368667. Side-band witnesses include X=+/-0.1714298, Y=-0.2702647,
   Z=0.4486063. Complete crossing vertices and all 756 body/solid-pair coverage
   remain in the retained receipt.
3. Maximum error across seventeen bone lengths is 2.10581346360428e-7 m.
   Actual sole minima are 0.01914813742041588 and 0.019148118793964386 m;
   maxima are 0.09564784914255142 and 0.09564783424139023 m. The sole count
   remains 1,346 vertices per shoe.
4. Actual hip/ring minimum gap is 0.000999927520751953 m. Complete mirrored
   patch acceptance was not reached because collision rejected the candidate.
   Evaluated palms are 0.00574794877320528 and 0.0057486542500555515 m from
   their ipsilateral trousers with no hand/trouser crossings. This is measured
   proximity, not claimed resting contact.
5. All bound source hashes remain unchanged. Complete imported Python source
   snapshots are preserved in `prototype-06/source/`. The failed candidate
   does not weaken any collision, sole, support, bone-length or visibility gate.

## Same-pose diagnostics, prototype 07

Root authorized diagnostic evidence only, using the exact prototype 06 pose.
No new fit, shoe pitch, pelvis transform or render was applied. The directory is
`assets/models/bathroom/actions/review/toilet/prototype-07-diagnostics`.
Its receipt is `state: complete` for diagnostic collection, with explicit
`pose_acceptance: failed-collisions`. Complete does not mean an accepted pose.
All joint endpoints match prototype 06 within 1e-7 m; original inputs remain
byte-identical, and prior receipts/source snapshots were preserved.

The launch used the prior hidden command with the new diagnostic directory and
additional `--diagnostic` argument. Launch-shell exit was 0, launcher PID 95104.
No beauty images, editable scene or full matrix were produced. Two new pure
tests first failed because rigid-sole pitch planning was missing; after
implementation all nine pure tests passed with exit 0. The new tests reject
empty/non-finite sole data and anatomically unreachable sole-derived leg targets.

1. Exact evaluated triangle-pair IDs remain 128 per trouser leg. The receipt
   stores each intersecting triangle ID, evaluated vertex IDs and world
   coordinates. Diagnostics assert BVH triangle IDs are within the evaluated
   triangle inventory and that evaluated vertex counts match the collision
   surface inventory.
2. Each trouser leg has 168 original vertices and 2,498 evaluated vertices,
   forming 4,992 evaluated triangles. Its modifier stack is the shared ARMATURE
   with `use_deform_preserve_volume: false`, `use_vertex_groups: true`,
   `use_bone_envelopes: false`, followed by SUBSURF with both viewport/render
   levels 2. This identifies linear-blend skinning followed by subdivision.
   It does not independently prove whether skinning distortion or actual
   trouser thickness is the dominant collision cause.
3. The receipt marks final-to-original correspondence
   `unproven-topology-change`. It assigns no original vertex to a final vertex.
   Complete original coordinates and bone-group weights for all 168 original
   vertices remain separate from the evaluated triangle evidence. A final
   vertex ID must not be used to index that original array.
4. Hip support is now measured independently even when trousers collide.
   There are 115 left and 117 right near-ring witnesses at the unchanged 10 mm
   proximity bound, but the producer's mirrored 7x16 grid patch search finds
   no passing pair. That search checks 18x45 mm rectangles. This is failure of
   the current finite-support search, not proof that all shapes or smaller
   rectangles allowed by the unchanged 15 mm width, 35 mm depth and 0.0007 m2
   validator limits are impossible. The complete actual ring-hit grid is
   retained so root can assess that distinction without another pose guess.
5. Every original shoe-sole vertex is verified to have unit weight on its
   corresponding foot bone. All 1,346 evaluated sole vertices are transformed
   back through that rigid foot transform. Pitch analysis derives ankle Z from
   the minimum rotated relative-sole Z, retaining 0.019148 m clearance. Both
   feet produce the same results within floating-point tolerance:

   | Toe-down pitch | Derived ankle Z | Exact vertical knee ceiling | Reserved knee Z |
   | --- | --- | --- | --- |
   | 0 degrees | 0.12999991 m | 0.48999992 m | 0.48899992 m |
   | 8.2023 degrees | 0.14999990 m | 0.50999991 m | 0.50899991 m |
   | 16.4 degrees | 0.17025822 m | 0.53025824 m | 0.52925824 m |
   | 24 degrees | 0.18639295 m | 0.54639296 m | 0.54539296 m |

   Each candidate uses the actual thigh/shin lengths and existing 35 mm
   outward route. All four are mathematically reachable. Their full hip,
   knee and ankle coordinates are in the receipt with `fit_evaluated: false`.
   Higher reachable knee ceilings do not establish ring clearance, finite hip
   support, body self-clearance or visual acceptance. None was applied.

**Next steps**: Root reads the same-pose triangle, skinning and support evidence
before choosing a new fit or source architecture. No further pose or render
job is running.
