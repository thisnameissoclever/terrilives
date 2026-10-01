# Offline double-bed fit and compositing pilot

Current owner direction: keep the 2x2 bed, use a modest bed-only uniform Sim
scale reduction, and cover the relaxed sleeper with a shaped blanket. This
supersedes the proposed larger bed and the earlier no-scale-change constraint
for this sleeping presentation only. Standing/walking art, source meshes,
weights, rest bones and shared actions remain unchanged. The occupied blanket
must be new candidate geometry, not a way to conceal failed body containment.

The owner approved candidate 04's static appearance and authorized live delivery
on 2026-10-01. The studies below retain their original approval boundaries;
that approval does not retrospectively certify their mechanical checks. This
work is separate from the pending aquarium and ottoman played checks. The pilot
implements no navigation, save fields, content
contract or renderer format. Runtime/UI/content ownership stays with the bed
assignment task. The governing acceptance requirements are in
`docs/specs/2026-10-01-bed-assignment.md`.

## Questions and boundaries

1. Can two natural sleeping poses fit the accepted 1.50 by 1.86 mattress using
   the owner-authorized bed-only uniform scale, while preserving source body
   meshes, rest bones, weights, shared actions and the bed footprint?
2. Can separate body colours and joint visibility/outline contributions
   reconstruct independent two-occupant renders at antialiased edges?
3. Can the accepted images, after transparent-margin cropping and safe reuse,
   fit the atlas alongside the current aquarium and ottoman additions?

The proposed correspondence is place 0 at model-local positive X, with base-SE
approaches `(0,-1)` and `(1,-1)`, and place 1 at negative X, with `(0,2)` and
`(1,2)`. The model's head remains positive Y. These are side identities, not
proven body offsets. Base-SE X edges are the head and foot, not sleeping sides.

## Bounded sequence

1. Establish a natural static pose with the bed-only scale and one occupied
   duvet. Measure the entire body without that cover first. Record rejected
   studies without overwriting them; do not restore the rejected folded legs.
2. Test disjoint lanes, mattress-length bounds, head and torso support, frame
   penetration and selected body/body intersections. Bounds are screening
   evidence only; collision and support require evaluated surfaces.
3. Review a small source render with an independent adversarial reviewer.
   Only if fit is viable, render the maximum-overlap facing with both samples
   drawn from 0 and 3, contrasting shirts, either single occupant and no occupant.
4. Compare reconstruction region by region, reject incorrect lane masks and
   missing outlines, then measure the cropped atlas cost. Do not change the
   renderer until this pilot establishes a viable format.

Use the authorized installed Store launcher in hidden background mode with two
threads. Verify the actual job receipt and PID, not launcher exit. Preserve
approved models and shared action data byte-for-byte; save new candidates only
under a new output directory. Browser access remains separately pending. No
source-art result establishes played acceptance. The owner's subsequent
publication request authorizes export, integration, review and release.

## Rejected studies and current stopping point

All measurements below are offline and unapproved. No runtime, approved source
model, shared rig or renderer was changed.

1. `output/double-bed-fit-study-01/status.json` completed all four samples of
   the original pose and two inward-arm variants. Both variants still reached
   width 0.7918553, outside the 0.69-wide lane. Head pitches 0 and 12 degrees
   penetrated the pillow. Reducing the pole's X coordinate did not reduce the
   solved elbow's X coordinate: its projection around the shoulder/wrist axis
   determines the bend.
2. `output/double-bed-fit-study-02/status.json` rejected the chest-hands
   variant. Sample zero reached width 0.6911868 and a minimum head-to-bedding
   vertical gap of -0.0017589. Sample one stopped at the unchanged bone
   scale/length assertion. The other proposed head pitches were not evaluated.
3. `output/double-bed-bone-diagnostic-01/status.json` replayed that rejected
   pose without declaring fit. Sample one's hand scale-channel error was
   0.0000107288 against the existing 0.00001 limit. The largest recorded bone
   length error was below 0.0000003. This distinguishes the failure's measured
   channels; it does not prove its cause or permit relaxing the limit.

The diagnostic and first completed study verify unchanged approved data and
source bytes. The second study aborted before its final preservation assertions;
its source file hashes were checked separately after failure.

After three rejected variants, parameter retries stopped. The first fresh
`better-way` review request failed with `agent thread limit reached`. When
the existing fit reviewer finished, a slot became available and a fresh-context
review completed. It rejected further pole-coordinate guesses and recommended
an explicit elbow-circle constraint with rotation-only pose authoring.

## Reviewed change of approach

`output/double-bed-matrix-trace-01/status.json` locates the first transform
distortion in stored arm rest matrices: their Gram-matrix error is about
0.000017. The direction rotation contributes about 0.0000001. Conversion to
parent-relative channels then produces the failed hand scale. The saved rest
data and shared authoring helper remain untouched.

The additive adapter authors unit local quaternion rotations rather than
assigning absolute pose matrices that decompose into scale. Its unchanged-pose
control, `output/double-bed-adapter-control-01/status.json`, passes all four
samples with zero scale-channel error, zero linked-joint gap, maximum bone-length
error below 0.00000024, and maximum vertex displacement about 0.00000146 from
the rejected control. This validates the transform route, not the control's fit.

`output/double-bed-constrained-study-01/status.json` then solves the elbow-circle
intersection at X=0.22, and uses a bracketed search for a 0.0012 head/hair gap
above the actual bedding. The resulting head angle is 19.443359375 degrees.
All four samples pass the declared 0.69-wide lane and 1.80 length screens;
maximum body width is 0.6794071. The same original geometry, materials, rest
data and action curves remain unchanged.

Connected support measurements distinguish hair from bare head. Hair has two
near-pillow patches, the largest with projected hull area 0.0051853 and closest
gap 0.0012082. Bare head has no near patch; the rigid hairstyle contacts the
pillow first. Torso has one projected hull of area 0.0500006, each heel about
0.0019827. A hull is not measured filled contact area.
These are measured neighborhoods, not a retrospective head-support threshold
or cloth simulation. Five focused support-patch tests pass, including separated
islands, an outside-vertex bridge and zero-area collinear points.

## Collision and visual findings

`output/double-bed-collision-study-03/status.json` completed the strict inventory
for all four samples without observed body/furniture crossings. It did not
establish acceptance: hair is an open surface, pocket faces include degenerate
triangles, and changed forearm, sleeve and neck attachments need bounded seam
evidence. An unsupported volume test is unresolved, not a pass. Two earlier
launches failed before geometry inspection because automatic input discovery
mistook a Blender extension namespace for a file; the third uses an explicit
required-input manifest. Approved source bytes and data remain unchanged.

The first rendered constrained pose passed its bounds screen but failed primary
and independent visual review. Both hands beside the face looked guarded rather
than relaxed. `output/double-bed-resting-hands-01/` retains a hand-rotation-only
comparison; it still looked guarded, so it is also rejected. Neither image is an
approval candidate.

`output/double-bed-lowered-arms-01/` lowered the elbows using fixed-length limb
geometry but failed its lane assertion before saving the offending measurements.
An unchanged-target diagnostic in `output/double-bed-lowered-diagnostic-01/`
retains all four samples and a rejected render. Its width is 0.7068577 against
the unchanged 0.69 limit. Each sleeve exceeds its lane by 0.0084288; cuffs also
slightly exceed it. Length passes at 1.6007544. Source bytes and approved data
remain unchanged. The image lowers the hands but does not prove relaxed contact
with the shirt. After these three rejected arm revisions, a new fresh-context
adversarial review was requested before another pose attempt.

The support helper now distinguishes projected hulls from fully near-surface
triangles. Eight focused tests pass, including a ring whose hull encloses an
unsupported centre. That triangle-coverage helper has not yet been run against
the candidate meshes; its unit tests do not establish actual support coverage.

No joint render, factorization result, atlas-budget acceptance or browser
acceptance is claimed. The next pose must clear the mechanical and source-image
checks before work moves to two-occupant compositing.

## Surface-constrained search

The fresh review found that the lowered pose's palm minimum was 0.0198991 above
the entire shirt's maximum. Its remedy was to solve using evaluated garment
surfaces rather than treating wrist coordinates as contact evidence.

`output/double-bed-contact-search-01/status.json` completed 63 grid points and
nine local support-bracket refinements per sample, across all four samples.
Twelve refined records passed the bounds and palm-neighborhood screens, but
every one had forearm/shirt crossings. None advances. The historical receipt
calls these records `candidates`; that means support-screen records, not
collision-cleared survivors. Its overall `accepted` field remains false.
Source bytes and approved data are unchanged.

`output/double-bed-contact-witnesses-01/` independently replays one rejected
record and retains its image, triangle pairs and analytic contact points.
Every reported overlap was confirmed: 182 left-arm pairs and 201 right-arm
pairs. The contact witnesses extend beyond the sleeve attachment. Their
recorded nearest/farthest elbow distances are Euclidean distances, not distance
along the bone.

The next search records rejections separately, checks a declared contact-root
residual of 0.00005, and requires both palms within 0.003 of their support.
Nine focused gate tests pass after eight deliberate bad records first failed:
crossing, unconverged or nonfinite root, bounds, point-only support, thumb
penetration, opposite-palm hover and bone-scale failure. Four parameterization
tests cover the reachable domain and unchanged-target equivalence; the Blender
control separately reproduces all four prior samples with zero vertex movement.

`output/double-bed-supported-elbows-01/status.json` completes the bounded
phase-zero search over 135 grid targets and 15 refined branches. All 15 are
rejected. Raising the elbow clears the torso in several branches, but the left
forearm and palm then intersect the breast pocket. The shirt-body support
surface omits that raised garment detail. A next study must use the actual
visible garment surfaces and may need different left/right contact targets;
it must not exempt the pocket intersection or claim all clothing is one flat
surface. Both searches are finite-domain results, not proofs that sleeping fit
is impossible. Approved source bytes and data remain unchanged.

## Garment-aware result and wrist control

`output/double-bed-garment-support-01/status.json` includes all nine visible
shirt details in its support surface and solves each palm separately. Its nine
refined branches all reject. The closest result has width 0.6890791 and palm
gaps about 0.0015, but retains 37 left-forearm/breast-pocket triangle pairs.
The three bounded searches therefore produced no collision-cleared pose.
Parameter retries stopped and a fresh-context adversarial reviewer examined
the arm construction.

`output/double-bed-wrist-deformation-01/status.json` confirms that the forced
hand direction folds the hands roughly 146 degrees against the forearms;
the approved rest relation is about 9 degrees. Evaluated forearm vertices
carry some hand-bone weight, so this is also a deformation concern. Subdivision
changes topology; these evaluated vertices are not claimed to have original
mesh indices.

`output/double-bed-neutral-wrist-control-01/status.json` changes only the local
hand rotations to identity. All other joint positions remain identical. The
wrist relation returns to 9.0901 degrees, but pocket crossings fall only from
37 to 35 and palm gaps become negative. Its source image still puts the hands
near the collar and chin. The wrist fold is a real defect, but it is not the
sole cause of the collision. This control is rejected, not an approval image.

The control inventories all 1,035 body pairs and 690 body/furniture pairs.
Earlier searches omitted same-side hands against their own cuffs and sleeves;
their declared inventories were not complete self-collision proofs. Raw
crossings also include inherited seams and require bounded classification.
Likewise, triangles whose vertices are near a garment do not prove continuous
support across the triangle interior or a stepped pocket edge.

The next approach must define complete palm contact frames and solve reachable
arm joints with explicit wrist posture and forearm clearance. It must not
retain the forced hand reversal while widening the same scalar search.

## Open-hair separation evidence

`output/double-bed-hair-separation-01/status.json` provides a strict separating
plane between the evaluated hair and pillow at all four sampled constrained
poses. Each certificate binds all 101,802 hair vertices and 191,914 triangles,
and all 152 pillow vertices and 300 triangles. The measured interval gap is
0.0008874171. The independent verifier recomputes geometry identities,
intervals, side and margin, then checks exact rational projections of the
stored floating-point coordinates. Twelve focused certificate tests pass.

This proves sampled spatial separation without declaring the open hair a
closed volume. It does not establish continuous-time separation, a valid arm
pose, or overall sleeping acceptance. Independent implementation review accepted
the plane proof and rejected five additional corrupted receipts. It found that
three indirect imports are missing from the input manifest: `armchair_layout.py`,
`check_toilet_scene.py` and `check_stove_scene.py`. Complete dependency binding
is therefore not claimed for this historical run; a future replay must include
them. The 21 recorded input hashes and approved rig data remain unchanged.

## Contact-frame measurement and adapter correction

The fresh review proposed staggered transverse hands across the abdomen.
`output/double-bed-hand-frames-01/status.json` records the actual evaluated palm
and thumb coordinates relative to each wrist, their principal axes, and nearby
garment triangles. A contact-side choice is identified as authoring intent,
not inferred semantic anatomy. A centre ray alone is not support proof.

The first contact-frame run used a surface-normal-first frame for a forearm.
That preserves its chosen roll reference but does not preserve its bone
direction when the two are oblique. The authored wrists consequently missed
their targets by 0.09774 and 0.13206. The run is invalid as a test of the planned
pose, regardless of its passing lane screen. Its receipt and image remain
unapproved in `output/double-bed-contact-frames-01/`.

A direction-first bone frame separates that requirement from the hand's
surface-first frame. A regression test fails on the previous implementation;
all three orientation tests pass after correction. The next receipt asserts
actual wrist-target error below 0.00001 before proceeding to collision or
image evaluation. Nine separate contact-frame geometry tests also pass.

`output/double-bed-contact-frames-02/` reaches the measured wrist targets within
0.000003 and the rigid hand-surface predictions within 0.000004. Both palms
have minimum garment gaps about 0.0015. Width is 0.6589414, inside the lane.
The complete raw inventory contains no body/furniture crossings, but both
forearms intersect shirt details, each other, and the left hand contacts the
opposite cuff/sleeve. These are not excused as inherited seams. The primary
source-image review finds the hand placement calmer but does not override the
collision rejection. No part of this result advances to two-Sim compositing.

The proposed hand centres are too crowded for the chosen elbow paths. The
independent review found that simply raising the right elbow brings it into
the fixed left palm's bounds. This does not prove every reachable elbow fails,
but it does not justify another preferred-point guess.

## Re-centred hand preflight

`output/double-bed-recentered-hand-diagnostic-01/` recomputes the complete hands
at contact centres `(0.385,-0.13)` and `(0.415,-0.28)`, with actual garment
normals, without authoring elbows or rendering another pose. Whole-hand ray
clearance requires vertical corrections of 0.0123511 and 0.0068527; the centre
rays alone were insufficient. Both final palm minima are about 0.0015.
The right elbow's reachable maximum height increases to 0.9403224, but this
is reach evidence, not shaft clearance.

`output/double-bed-recentered-hand-proof-01/` retains the predicted rigid hand
geometry and finds no raw hand/environment or opposite-hand crossings. Strict
separating-plane certificates cover 206 of 208 declared pairs. The left palm
and thumb against the shirt placket remain unverified by that method; absence
of a separating plane is neither collision nor clearance evidence. Existing
arm meshes are explicitly excluded because no new elbow pose exists yet.

A new finite-patch test proves a complete downward hand triangle lies above
one upward garment triangle with every point in a 0.01 gap band. It uses exact
projected containment and affine height differences, not just vertex-near flags.
Seven focused tests pass. This sufficient witness found no complete qualifying
triangles in either palm. That may reflect incompatible triangulation sizes;
it is not proof that no finite support patch exists. Independent review is
checking the source and verifier before the contact preflight can advance.

That review accepted the complete-triangle helper's mathematics. The left palm
has no downward triangle with all three vertices near support. The right palm
has six such triangles, but their vertex hits span different garment faces.
The follow-up therefore clips exact projected hand/garment triangle overlaps
against the unchanged gap band. Eight new focused tests cover an overlap with
no contained input vertex, varying gaps, exact and just-outside boundaries,
zero-area shared edges, winding and invalid inputs.

`output/double-bed-hand-portions-01/` replays all environment identities and the
206 separation certificates. It records 314 left and 555 right supported
portions, with summed projected areas 0.00062496 and 0.00142065. These sums are
not union areas or approved physiological support thresholds. Each witness
retains exact rational polygon coordinates and its source triangles. The two
left-hand/placket pairs remain unverified by closed-volume checks because the
placket is open. It must not be declared a solid merely to make the checker
accept it. Independent review of the extension and an appropriate open-surface
exclusion argument were reviewed separately. Independent review checked all
869 supported polygons and all 38 bound inputs successfully. Common-sloped-plane
invariance and the frozen runner's bucket boundaries are now durable tests.

`output/double-bed-placket-partition-01/` resolves the remaining two pairs with
three strict separating-plane pieces per hand. Every original placket triangle
is covered exactly once; piece geometry is derived from those original indices,
and each piece is separated from the entire corresponding hand. The evaluated
placket has no loose edges or isolated vertices omitted by this proof.
Independent replay accepted both complete partitions. The open trim is never
assigned a fictitious solid or thickness.

This completes only the declared hand/environment surface preflight. It does
not establish an arm pose. The next bounded diagnostic must derive a clearance
plane using shaft thickness and garment height along the complete elbow/wrist
segment, including blended ends. Solve the two reachable circle/plane branches,
then inspect the complete evaluated shafts, cuffs, opposite arms and hands.
An elbow-height number alone is not a clearance proof, and another sequence of
preferred-point guesses is not authorized by this result.

All new receipts remain unapproved and preserve source bytes and approved data.
No two-occupant rendering, renderer change or publication has occurred.

## Evaluated arm-height diagnostic

`output/diagnose-double-bed-arm-clearance.py` and its retained receipt at
`output/double-bed-arm-clearance-01/status.json` evaluate the actual Blender
Armature-then-Subdivision stack. No rigid shaft-radius approximation or
interpolated evaluated weights substitute for that stack. Viewport and render
subdivision levels match for all ten arm parts.

The finite domain runs from wrist height to just below the highest reachable
elbow, with both circle/plane branches retained. All four branches pass the
forearm vertex-ray gap screen at their lower endpoints, so the bounded root
helper performs no refinements. This is neither a derived minimum elbow height
nor continuous surface clearance. Full arm bounds, cuff and sleeve ray minima,
hand-target reproduction, and all four left/right branch combinations are
recorded separately.

Every combination checks all 1,035 body pairs and 690 body/furniture pairs.
There are no observed furniture crossings. None is accepted:

1. Left branch 0 puts the sleeve and cuff through collar or pocket geometry.
2. Right branch 1 intersects the opposite palm and thumb.
3. The outward pair, left branch 1 and right branch 0, avoids those new
   cross-body contacts but exceeds the lane by 0.0038403 on the left and
   0.0120658 on the right. Raw same-arm attachment crossings remain unclassified.

The upper endpoint measurements pass the individual lane screens, but their
combined collision inventory has not been evaluated. That observation does
not establish a viable pose or authorize choosing another arbitrary height.
A fresh adversarial review is checking whether shaft clearance, cuff clearance
and full-arm lane margins belong in one bounded constraint rather than using
shaft clearance alone to select an endpoint. The script retains all rejected
measurements and writes no images. Source bytes and approved data are unchanged.
Seven new root-helper tests pass, including discontinuous sign changes that
must not pass solely because the height interval became small; all 85 focused
`test_bed_*.py` tests pass.

The fresh review identified an incomplete selector, not a broken root helper.
`output/diagnose-double-bed-arm-clearance-02.py` therefore runs one corrected
bounded screen whose residual is the minimum of forearm gap, cuff gap and all
four X/Y bounds of the five complete arm parts. It retains the same reachable
domains and both branches; no preferred-height guesses or limits were added.
Five new tests distinguish a clear shaft from a failed cuff or lane.

The corrected run retains 42 measurements and four converged nonnegative roots
within the unchanged 0.00005 residual limit. The outward `L1-R0` pair measures
X `[0.0300462842,0.7199951410]` and Y `[-0.7973672748,0.8033871651]`. Its complete
inventory records no furniture, collar, pocket or opposite-arm crossings.
Thirteen arm-related crossing pairs remain within same-arm connection families;
they are not blanket-exempted or accepted. Independent review verified every
residual, all pair inventories, the retained geometry hash and all 42 inputs.

That reviewer supports one unapproved source inspection image before spending
more effort on seam classification. The right wrist's direction angle is about
48 degrees, which is not itself a comfort verdict. The right lane margin is
only 0.000004859, so this phase-zero screen establishes no animation tolerance.
Exact hand certificates also require rechecking against actual posed surfaces;
their small prediction error does not automatically transfer an earlier proof.
The new inspection runner replays the saved pose without tuning. No full-pose,
animation, two-occupant or publication acceptance is claimed.

Review also found a non-triggered diagnostic failure-path defect in run 02:
missing cuff or forearm ray hits would assert before saving that measurement.
Every recorded run-02 hit was present, so its completed evidence is retained
unchanged. Any future runner must save raw bounds and hit counts before that
assertion. All 90 focused `test_bed_*.py` tests pass.

## Source-image rejection of the outward arm candidate

`output/inspect-double-bed-outer-arm-pose.py` reproduces the retained geometry
exactly and records its result in `output/double-bed-outer-arm-inspection-01/`.
It recomputes all 206 strict hand separation certificates and both complete
placket partitions against the actual posed hands. All pass. Recomputed support
portions remain 314 on the left and 555 on the right; their projected area sums
are not union areas or physiological support thresholds. Approved model bytes
and data remain unchanged.

The diagnostic image is `unapproved-outer-arms-SE.png`. Primary and independent
visual review reject it as a relaxed sleeping pose: the elbows look held up,
the image-right forearm is conspicuously upright, and the wrists read as tense.
The reviewer sees no obvious detached joints or cuff holes and finds the head,
torso, legs and established art style coherent. The earlier crossed-arm image
looks calmer, but its known intersections still disqualify it.

This candidate must not advance to two-occupant compositing. Another elbow-height
or wrist-angle variation is not the next step. A fresh-context strategy review
is challenging the fixed abdomen-contact assumption and considering whether
hands resting beside the hips on the bedding offer a different feasible arm
arrangement. That possibility is unmeasured; it is not an approved replacement.
The next action is a small feasibility measurement of the recommended contact
family, not another full proof exercise before inspecting its silhouette.

Read-only handoff identifiers:

1. Bed source SHA-256:
   `3ad570674e768e07bbd6e2d9cac6dfd58a9b59e3202f2be4d5d782dd7f973d9f`.
2. Approved Sim source SHA-256:
   `919e8994cbf7510a4d9947f173abec8b41ac77d61f6e829bcf5981c8d2fcddce`.
3. Inspection receipt SHA-256:
   `71789f7800afc7fbbb71ce8d95c89c711eaaa33faa87fde211b0e9a36fcb991b`.
4. Diagnostic image SHA-256:
   `b2f86a30920d7342150a6278a51fe1d1d35038e5c8c12cd924d1a0e050131313`.

No candidate `.blend` replaces the approved model; the pose is retained as
quaternions in the arm diagnostic receipt and replayed by the inspection script.
No runtime/export integration or publication is authorized by these diagnostics.

## Contact-family reframe and bedside profile measurement

The fresh review identifies two authoring assumptions behind the raised arms:
fixed high abdomen hand transforms, and an elbow domain that starts above both
the wrist and shoulder. Neither is a requirement for sleeping. The next family
keeps the rest wrist relationship and considers lengthwise bedding-supported
arms. Sampled garment sections suggest room for the hands, but not necessarily
the broader cuffs; hand fit alone is not a sufficient feasibility screen.

The coordinating spec branch now records the physical-fit distinction at
commit `ca08034d55de60766ab6620fc60ecbb48e705c8f`. Its visual-acceptance section
was read from `twcx/bed-place-runtime` without merging into this checkout.
The 0.69-wide strips remain recorded diagnostics and a sufficient construction
for simple drawing order, not the complete physical requirement. Actual body,
bed and walking-space separation, support, all samples, natural appearance and
individual visible ownership remain required. This does not revive any rejected
pose by widening its previous acceptance threshold. Renderer/grouping/picking
ownership stays with that task; this task owns pose/export experiments only.

`output/double-bed-rest-arm-profiles-01/` confirms that each cuff is wholly
attached to its upper-arm bone and each hand part to its hand bone. Forearms
blend three arm bones; sleeves also blend with the spine. It records exact
rest calibration geometry and weights without authoring a new sleeping pose.

`output/double-bed-bedside-screen-01/` tests a common arm rotation that preserves
the rest joint relationships. Its completed left profile puts the wrist at
`(0.1073860,-0.4543377,0.6253703)` and the hand inside the original diagnostic
strip, with a minimum bedding gap about 0.001509 at the thumb. The hand clears
the sampled garment corridor, but the cuff and forearm do not: recorded minimum
side gaps are -0.0374920 and -0.0136926, with cuff/shirt, forearm/shirt and
forearm/hem triangle crossings. Cuff minimum bedding gap is still +0.0330663.
The common rotation couples a suitable hand position to an unsuitable cuff.

The right profile did not complete. Its declared outward trial endpoint put
some hand vertices beyond the bedding projection and triggered an explicit
failure. That is an invalid solver-domain endpoint, not proof that the right
arm family cannot fit. The failed trial's local raw gap list was not saved
before the exception, another evidence-retention defect to correct in the next
runner. Completed left measurements and source preservation remain recorded.
No image or actual arm pose was created from this screen.

The next reviewed question is whether a separately articulated upper arm can
settle its rigid cuff in the actual bedding/body corridor before solving the
forearm and hand with their rest wrist relationship. It must not fix the failed
common rotation by guessing another height or suppressing missing support.

## Articulated left-arm probe and retained failure evidence

The fresh reviewer recommends independently articulating the upper arm and
lower arm, preserving only the local forearm/hand rest relationship. Keeping
the former world wrist would leave the elbow almost straight: the rest elbow
deflection is about 4.609 degrees and the remaining elbow-circle radius about
0.009835. Hands must be free to slide along the bedding. Cuff support is one
proposed contact family, not a general requirement for sleeping.

`output/bed_trial_evidence.py` attaches trial records and every named XYZ sample
before evaluating support. It retains hits, misses, unfinished points, bounds,
parameters and tracebacks before propagating failures. Four deliberate controls
pass: missing support, a mid-callback exception, rejected bounds and completed
support. Independent review accepts this exception-retention scope. The
`not_evaluated` count means unfinished, including the current evaluating point;
it is not the count of rows bearing that exact state string. Persistence errors
still propagate and process-termination durability is not proved.

`output/screen-double-bed-articulated-left-arm.py` integrates that helper and
stores separate numbered trial files with hashes in
`output/double-bed-articulated-left-screen-01/`. It tests shoulder-anchored cuff
support and garment clearance before lower-arm/sliding-hand support. It does
not use the old lane edge as a hand-position target. All 94 focused helper
tests pass; the runner parses successfully.

The run stopped on Windows `PermissionError: [WinError 5] Access is denied`
while atomically replacing `status.pending` with `status.json`. Its final
failure receipt succeeded, preserving 82 numbered trials and both unchanged
source/data checks. The process has exited. No retry, permission change or
alternate launch was attempted. A concurrent status-file read is a possible
sharing conflict, not an established cause; the error must not be relabeled
as geometric infeasibility.

Before that interruption, cuff-support roots completed for outward components
0, 0.6, 0.3, 0.15 and 0.225. Their sampled garment-clearance residuals were
approximately -0.041250, +0.118260, +0.035490, -0.003966 and +0.015479. The
outward 0.1875 trial was incomplete. No coupled hand solution, actual articulated
modifier evaluation or image was reached, so none of these cuff results is a
pose witness. Raw measurements and the failed runner remain immutable.

The failed receipt SHA-256 is
`3250953179b707b0ccddcb4d26047c6a43b47f5e0846c9c58240e70b635dcaf7`.
A source inspection after the failure also found an unexecuted inventory-call
error: `double_bed_layout.parts()` returns dictionaries, not objects with a
`.name` attribute. A future separately named runner must use `part['name']`;
do not edit the hashed failed runner. The next execution is paused at the
file-access failure. No approved asset, runtime file or publication changed.

## Receipt ownership repair before the next probe

A disposable Windows sharing control reproduced a denied replacement with its
own reader open. Replacement without that reader, and after closing it, worked.
The control unexpectedly rejected replacement even with delete sharing enabled;
its assertion preceded receipt publication, so the exact latter error was lost.
That flawed control remains preserved in `output/receipt-file-sharing-01/`.
Neither it nor the original final successful write identifies the original
denying handle or establishes a security-policy restriction.

A fresh reviewer traced the remaining design issue to a mutable status pathname
shared by writer and observers. The selected repair uses exclusive creation of
numbered immutable revisions and checkpoints, followed by one terminal
`status.json`. Consumers must observe the actual Blender process exit before
reading the terminal receipt, then require valid JSON and matching hashes for
every listed evidence file. File existence alone does not establish completion.
Access failures still propagate; no permissions, security settings, launch path
or geometric threshold changes are part of this repair.

`output/bed_snapshot_writer.py` has seven passing controls for previous revisions
held open, retained rejection observations, propagated publication errors,
terminal overwrite rejection, missing/partial/running terminal rejection,
hash/process-exit requirements, and final synchronization failure.
`output/bed_named_evidence.py` adds two controls
for mid-sequence side-ray and actual-surface failures. These extend retention
to the previously all-or-nothing helper loops. All 103 focused helper tests pass.
They do not establish crash-proof durability or geometric acceptance.

`output/screen-double-bed-articulated-left-arm-02.py` applies these changes in a
separate output directory. It also corrects the unexecuted dictionary inventory
call. The contact family and numeric constraints are unchanged from run 01.
Readers must not poll its active receipt files. Previous failed evidence and
hashed source scripts remain unchanged.

Independent review caught one terminal-publication defect before the new run:
a synchronization error after writing complete JSON could leave an apparently
valid final receipt. Its negative test failed as expected. The corrected
Windows-only publisher writes and synchronizes an exclusive `status.pending`,
closes it, then performs a non-replacing rename to a never-existing
`status.json`. A synchronization failure leaves no published terminal receipt.
Existing destinations are rejected. This does not restore mutable replacement
of a path readers already hold open, and no error retry is added.

## Completed articulated left-arm measurement

The revised probe completed and its actual Blender process exited. Terminal
validation verified all 1,325 immutable evidence files for 211 measurement
trials. Both source-byte and approved-data preservation checks pass. No
permission, security or launch-route change was needed.

The first coupled candidate has upper-arm outward component `0.16552734375`,
elbow `(0.0979096,-0.2333186,0.6214713)` and wrist
`(0.0979096,-0.4478248,0.6212356)`. The lower-arm vertical component is
`-0.0010986328125`, keeping the forearm nearly horizontal. Actual evaluated
bone-length error is below 0.000000284 and scale-channel error is zero. The
complete five-part left arm fits the mattress-bounds screen. The thumb reaches
X `0.0260332`, outside the historical 0.03 strip; that diagnostic is not relabeled
as passed and does not establish two-occupant ordering.

The 290-pair inventory records seven remaining crossing pairs, all within
connected left-arm or sleeve/body families. They still require attachment
classification. No cuff, forearm or hand garment crossings remain, and the
inventory reports no bed-furniture crossing. Actual cuff and thumb minima are
about Z `0.551516` and `0.551529`; the palm minimum is `0.563085`, about 0.0131
above the duvet. Those points are not finite-support certificates. A render
must distinguish a plausible hand resting on its side from a hovering palm.

Independent review verified the terminal and geometry hashes and supports one
unapproved source image before additional certification or right-arm solving.
It did not independently verify every manifest entry. The right arm in that
image remains the old baseline and must not be mistaken for a proposed result.

1. Measurement receipt: `output/double-bed-articulated-left-screen-02/status.json`.
   SHA-256 `d79b6c6a7bd30a7d340580479c03fe351972d41f5fcc9877bbc854cbf56df3db`.
2. Actual geometry: `output/double-bed-articulated-left-screen-02/001323-actual-geometry.json`.
   SHA-256 `07571bdfda671facc4fef34dcae0a8a8b25932b17ac69772f98708c994a43b5d`.
3. Inspection runner: `output/inspect-double-bed-articulated-left.py`.
   Its separate output directory is `output/double-bed-articulated-left-inspection-01/`.

No final pose, four-facing animation, support proof, two-occupant compositing
format or runtime integration has been accepted by this measurement.

The left-arm source inspection completed, replaying all 61 retained surfaces
exactly with unchanged approved data and bytes. Primary and independent visual
review find the foreground arm relaxed enough to continue: low elbow, nearly
lengthwise forearm and no visibly forced wrist. They do not confirm finite palm
support. The hand's shadow and small shoulder contour/interrupted sleeve seam
remain review items. The opposite raised arm is the unchanged baseline, not a
proposed result. No left-arm tuning follows this review.

1. Image: `output/double-bed-articulated-left-inspection-01/unapproved-left-arm-SE.png`.
   SHA-256 `66430f0a9c2f5ce3a117662dcd1b9e33787a041be143ff37541f3598a20cdbec`.
2. Receipt: `output/double-bed-articulated-left-inspection-01/status.json`.
   SHA-256 `e89763e17a6f5d282227d71b08c23bde9bb81dd33223e7c74e9099be195691ea`.
3. Review: `output/double-bed-articulated-left-inspection-01/visual-review.md`.

The analogous right-arm probe uses actual right-side rest geometry and keeps
the measured left pose in its collision environment. Its initial outward
search domain is 0 to 0.25 because this arm is beside the outer mattress edge;
that finite domain is not a proof about every possible right-arm pose. All
support misses remain explicit failures, not numeric clearance values. The
runner is `output/screen-double-bed-articulated-right-arm.py`; output is
`output/double-bed-articulated-right-screen-01/`. Do not read active receipts.

## Completed right-arm and static-pair visual screen

The right probe completed 180 trials with 1,131 verified immutable evidence files.
It independently converged on upper outward component `0.16552734375`, elbow
`(0.6520904,-0.2333186,0.6214713)` and wrist
`(0.6520904,-0.4478248,0.6212094)`. The right five-part arm passes mattress bounds
and has no declared cuff/forearm/hand garment crossings. Its 290-pair inventory
contains seven connected-part crossing families, still unclassified, and no
crossings with the fixed left arm or bed furniture. Bone-length error is below
0.000000299, scale error is zero, and both preservation checks pass.

1. Right receipt: `output/double-bed-articulated-right-screen-01/status.json`.
   SHA-256 `f1c85111b4eb9cd4fd3cf38ce28b8cf0c17f964c4dcb8cf46670b556437f70bf`.
2. Combined evaluated geometry:
   `output/double-bed-articulated-right-screen-01/001129-actual-geometry.json`.
   SHA-256 `0aabe833413c06e21bfcb22b0efcbb35be56e8cff1c3a2bbfd7bc321d191ac58`.

`output/inspect-double-bed-articulated-pair.py` replays all 61 surfaces exactly
and renders SE and SW. Both views passed primary and independent early visual
review: the pose reads as resting on the back, with low arms and no conspicuous
hovering, forced wrists, detached shoulders or cuff holes. The small shoulder
contours and seam marks remain mechanical review items. No pose tuning is
warranted solely because the full checks remain incomplete.

1. SE image: `output/double-bed-articulated-pair-inspection-01/unapproved-both-arms-SE.png`.
   SHA-256 `6d981d6fc1c25e6965860fa6f0d4b4c18788e5357e1da1d3ae211fa6f80f6394`.
2. SW image: `output/double-bed-articulated-pair-inspection-01/unapproved-both-arms-SW.png`.
   SHA-256 `0cc549e3509ca3f179d554786774f97cfb2ecf049dc2d932a5f38b7350474e06`.
3. Inspection receipt: `output/double-bed-articulated-pair-inspection-01/status.json`.
   SHA-256 `c031d811b1c0ef0f478e56a716db617890f51a93480dd16c0b750fa5ac9fa783`.
4. Review: `output/double-bed-articulated-pair-inspection-01/visual-review.md`.

This candidate is static. Its stored arm rotations replace the only parts
changed by the earlier phase parameter. Four repeated samples must not be
described as an animation. Independent review recommends completing static
support work before testing neutral and two small forearm-roll extremes as a
possible hand fidget, with rendered cadence and support stability checked.
That would not be torso breathing. No motion has been authored or approved.

The current numerical follow-up is
`output/prove-double-bed-articulated-support.py`, writing to
`output/double-bed-articulated-support-01/`. It measures finite proximity
portions and separation from an exact translated copy of the evaluated body.
An exact translated mesh is not an independently evaluated second armature;
that distinction must survive every handoff and later acceptance report.

## Completed static support and translated-copy screen

The numerical follow-up completed with 17 verified immutable evidence files
and unchanged source bytes. Its terminal receipt SHA-256 is
`291449266d8b48fcfe7bd4b4bbbcdda05d6acd7a53bd3dfd8dfae8983628bebd4`.
This remains an unaccepted static candidate.

All 46 visible body parts contribute 144,286 vertices and 276,390 triangles.
Their combined X bounds are `[0.0260332, 0.7239667]`; translating that exact
evaluated geometry by -0.75 X produces `[-0.7239668, -0.0260333]`.
An exact-arithmetic plane certificate verifies a separation gap of
`0.0520665`, exceeding its approximately `0.000001` numerical margin.
This proves separation of these two retained triangle sets, not preservation
or fit of an independently evaluated second rig or moving samples.

Finite triangle portions within a 0.01 vertical bedding gap were found under
the overshirt body, hip bridge, hair, both cuffs, both thumbs and both soles.
No such portions were found for the bare head, either forearm or either palm.
Hair portions are near both the pillow and folded duvet edge, not solely the
pillow; cuffs and thumbs, rather than palms and forearms, are the measured arm
support regions. The relaxed rendered appearance must not erase those
distinctions.

The recorded projected-area sums are approximately 0.04495 for the torso,
0.003494 for the hip bridge, 0.009292 for the hair, 0.002156/0.002158 for the
cuffs, 0.001612/0.001617 for the thumbs, and 0.002183 for each sole. These sum
clipped triangle portions. They are not union areas, entire supported triangles,
contact-force measurements or a physiological adequacy test. Full self/furniture
separation and bounded attachment classification remain open, as do the actual
second rig, motion, all facings and the compositing/atlas pilot.

## Separately evaluated static second occupant

`output/inspect-double-bed-two-rigs-static.py` completed using two distinct
armature data blocks and separately targeted mesh modifiers. It first replayed
all 61 original surfaces exactly. The second body's 46 evaluated parts agree
with the translated first body within 0.00000003 model units. Its own complete
geometry, rather than a calculated translation, yields a verified interbody
separation of `0.0520664752`. The run preserved approved data and source bytes.

1. Receipt: `output/double-bed-two-rigs-static-01/status.json`, SHA-256
   `a9acd574be92cb90c4b12a41f839bdee8fb6c268c7998df34115648a2b89ebda`.
2. Geometry: `output/double-bed-two-rigs-static-01/000003-evaluated-geometry.json`,
   SHA-256 `96bc6b76696471302ee4e28e3cdba27eca6dd753d655bb608b5ae60aed2917f0`.
3. SE image: `output/double-bed-two-rigs-static-01/unapproved-static-two-sims-SE.png`.
4. SW image: `output/double-bed-two-rigs-static-01/unapproved-static-two-sims-SW.png`.

Each body has a complete 1,035 self-pair and 690 furniture-pair inventory.
Of the furniture pairs, 688 have strict axis separation; head/pillow and
hair/pillow have no surface crossings but still need a separation or containment
check. Self-pair results are 949 axis-separated, 21 without crossings but with
containment unresolved, and 65 surface-overlap pairs awaiting classification.
These include intentionally assembled face and clothing pieces. None is
silently exempted, and their presence alone is not a defect verdict.

This is still static. Mesh data is shared read-only, source visibility drivers
may remain shared, and shirt materials have not been made independently
recolourable. The run does not prove independent animation, contribution
factorization, atlas cost, picking or runtime behavior. Primary visual review
finds the two source views plausible; independent review also passed this early
static screen and found no blocker in the executed clone path. The small
shoulder contour and interrupted seam marks remain attachment-review items.

A retained-snapshot follow-up, `output/check-double-bed-static-separated-pairs.py`,
tries sufficient whole-surface separating planes only for the 46 unresolved
noncrossing pairs across both occupants. A missing plane remains unresolved,
not a proved intersection. It cannot classify intentional overlap joins.

The separating-plane follow-up completed: 26 of those 46 pairs have verified
whole-surface certificates. All four head/hair-versus-pillow pairs passed,
including the negative occupant against its actual pillow. That matters because
the pillows are centred at +/-0.385, while the bodies are offset by +/-0.375;
translated positive-side support measurements cannot substitute for negative-side
support measurements. All remaining furniture pairs were already axis-separated.
Finite negative-side support coverage remains unmeasured.

`output/check-double-bed-static-inherited-joins.py` completed a separate source
replay. All 39 wholly single-bone parts match their full transformed rest surfaces
within 0.00000181, with unchanged triangle topology. This supplies common-transform
inheritance for 39 pair relationships, including palm/thumb, facial features and
several garment details. The declared replay tolerance is 0.00001. This is
inherited geometry, not a claim that the assembled meshes never overlap.

The same run found no internal self contacts in either forearm, but reported
360 left-sleeve and 378 right-sleeve triangle contacts away from shared edges.
The sleeves therefore have not passed their internal check. The successful early
visual screen must not be promoted to full physical acceptance.

A source comparison, `output/localize-double-bed-sleeve-folds.py`, failed before
contact localization because stored rest and posed triangle lists differ. Its
terminal failure is retained under `output/double-bed-sleeve-fold-localization-01/`.
This may be pose-dependent quad tessellation, but that cause is not yet verified.
Do not compare triangle IDs across these snapshots without polygon/vertex
provenance. A fresh-context review is investigating the smallest sound diagnostic
and whether the pose family or its deformation assumptions need reconsideration.
No pose tweak, mesh/weight edit or acceptance-threshold change follows from this
failed comparison.

The fresh reviewer independently replayed the intersections using exact rational
segment/triangle calculations. It confirmed the 360/378 reported contacts;
329/345 pairs also have unchanged triangle IDs, and those pairs do not intersect
in the retained rest geometry. The affected vertices lie in the sleeve's
spine/upper-arm blend band. The rest and posed meshes have equal vertex counts
and equal paired-triangle vertex unions, but 30/32 triangle entries change.
The failed whole-list equality was a provenance check, not evidence that the
reported folds were harmless.

The rotation construction is the root-cause candidate: both upper arms are
about 179.74 degrees from their parent-inherited rest orientation, although a
shortest swing to the same elbow direction is only about 15.74 degrees. The
world-down roll convention opposes the torso-inherited direction. Changing only
the upper arm would transfer a roughly 178-degree twist to the elbow, so roll
must be carried through the forearm and hand as well.

`output/screen-double-bed-parent-roll-left.py` is a separately named replacement
probe. It uses the parent-inherited orientation, shortest swing to each solved
bone direction, and the lower arm's rotation for the hand. It re-solves cuff
height/side clearance and hand support, then includes actual sleeve and forearm
internal checks in candidate selection. Existing geometry, weights, bone lengths,
contact limits and frozen failed evidence remain unchanged. This new probe has
not yet established a corrected pose.

The parent-relative left-arm probe subsequently completed 189 trials and 1,192
verified immutable evidence files. Explicit survivor index 0 passed its screens:
no cuff/forearm/hand garment crossings, mattress bounds satisfied, and zero
internal sleeve or forearm candidate contacts. Upper rotation relative to the
parent is about 18.03 degrees; forearm rotation relative to the new upper arm is
about 7.45 degrees. Both approved-data and source-byte checks pass.

Its outward component is `0.1142578125`, elbow
`(0.1124951,-0.2332888,0.6134700)` and wrist
`(0.1124951,-0.4463418,0.5885420)`. The actual palm now reaches Z `0.5515255`;
this is a pointwise support screen, not finite-support certification. Raw geometry
is `output/double-bed-parent-roll-left-screen-01/001188-actual-geometry.json`,
SHA-256 `b4bff343bbd2f0cf3713f6e53ab0c32228bdc3f6068c8b91ec6e2a44b5185203`.

Future consumers use the explicit selected index and verified survivor flag,
not `coupled_candidates[0]`. Four focused selector tests pass, including a later
survivor following a rejected first record; a boolean-as-index negative control
failed before strict type checking was added. Source inspection is running in
`output/double-bed-parent-roll-left-inspection-01/`. The opposite arm is the
unmodified baseline, not an accepted part of this proposal.

The left source inspection completed with exact replay of all 61 surfaces and
unchanged approved data/bytes. Both reviewers passed its early visual screen:
the shoulder contour is smooth, the interrupted seam is gone, and cuff/hand
placement looks relaxed. Actual modifier inspection confirms volume preservation
is off and subdivision follows the armature, with equal viewport/render levels.
No modifier setting was changed. The image and review are retained in that
inspection directory; no further left-arm tuning is indicated by this review.

The right-arm probe is `output/screen-double-bed-parent-roll-right.py`, writing
to `output/double-bed-parent-roll-right-screen-01/`. It restores the explicitly
selected corrected left pose before right-side evaluation, includes that arm in
the collision environment, and retains the same internal-surface checks and
explicit survivor selection. No completed right-side result is claimed yet.

The right-arm probe subsequently completed 161 trials and 1,016 verified
evidence files. Survivor zero passes its declared arm screens, including zero
internal sleeve and forearm contacts. Approved data and source bytes are
unchanged. Receipt SHA-256:
`712d657da7a9d143ada7a6960e51d90661e89cd19a2c37e965d440b2868bc9fc`.
This preserves the corrected arm result without accepting the whole pose.

## Owner rejection: cramped sleeping legs

The owner rejected the full pose because the legs are visibly bunched up.
Earlier visual reviews missed this whole-body problem while concentrating on
arm contact and separation. All folded-leg full-body candidates are rejected
as the default sleeping pose, regardless of their numerical screens.

`output/inspect-double-bed-relaxed-legs.py` compares the unchanged folded pose,
straight legs, and a slight 16-degree knee bend. It retains both corrected arms
and measures complete evaluated body length against the actual mattress before
any new contact certification. It renders the slight-bend proposal from SE and
SW for an early silhouette review. The run is an unaccepted static diagnostic;
it changes no source geometry, rig data, actions, scale or furniture footprint.
If a natural pose does not fit, report that body-to-bed proportion conflict
instead of treating a tighter curl as the solution.

The diagnostic completed and preserved approved data and source bytes. The
old pose bends each knee about 133.46 degrees. Straight legs produce an overall
body length of 2.04575; a 16-degree knee bend produces 2.03865, against the actual
1.86 mattress. With the existing pillow alignment, the slight-bend feet extend
0.30526 beyond the foot end. There is only 0.12661 of unused head-end space;
translation alone therefore cannot contain the pose. The total length excess
is 0.17865, about 9.6 percent of mattress length. Neither measurement includes
an added comfort margin.

The slight-bend SE/SW renders look substantially more relaxed, but are failed-fit
diagnostics, not approval candidates. They are retained as
`output/double-bed-relaxed-legs-inspection-01/unapproved-relaxed-legs-SE.png`
and `unapproved-relaxed-legs-SW.png`. Their SHA-256 values are respectively
`9f3414bd1710353b8dffcceea53d8d40d0ba898213c2334e05a198c5369beb46`
and `7316a3cce9e26b2ac2c3e73177011c1b7813b2854a732be96b97f9c423fb3bcf`.

This confirms the length warning already recorded in `[L-bed-body-envelope]`;
it does not establish that every possible natural pose is mathematically
impossible. A relaxed, nearly straight baseline cannot fit this mattress under
translation alone. Changing the bed length and reserved footprint, or changing
approved Sim proportions, requires a separate owner decision. Do not disguise
overhang with bedding, call this pose supported, or extend art into unreserved
walking tiles. No source model or runtime changes follow from this diagnostic.

Independent review inspected both new facings and concurs: the relaxed pose
direction is credible, the foot overhang fails fit, and the previous curled-leg
visual pass was mistaken. Its recommendation is owner-authorized lengthening
of the bed with appropriate reserved floor space, potentially a 2x3 footprint,
while retaining the approved Sim. See the diagnostic directory's
`visual-review.md`. Final dimensions and any side-sleeping alternative remain
unproved. Further certification of the rejected curled family is stopped.

## Owner-selected bed-only scale and occupied blanket

The owner chose a slightly smaller sleeping presentation under a blanket instead
of footprint expansion. Start around 0.90 uniform scale, measure the full
underlying body before covering it, and keep the reduction confined to this
bed's sleeping render. Preserve the relaxed low-knee silhouette. Fit and support
must be remeasured after scaling and placement; none of the old contact results
transfer automatically.

Keep the approved 2x2 frame, mattress, source Sim and gameplay untouched. Author
a new occupied blanket in memory using the existing bedding palette, with its
surface above the actual posed body. Review its top edge, face visibility,
foot coverage and drape from both useful camera directions. This remains an
offline static candidate, not accepted animation, compositing or publication.

The first blanket draft wrongly retained the existing flat green duvet beneath
the new occupied surface. The owner identified the duplicate blanket and
exposed feet. The occupied view must replace both `Sage duvet` and `Folded duvet
edge`, not overlay them. Keep the actual mattress and pillows. Lower and re-fit
the sleeper against those surfaces, then shape a single duvet over the body
and down the sides and foot of the bed. Do not leave unsupported body geometry
at the former duvet height after hiding it.

Probes are immutable: `double-bed-covered-sleeper-01` records the rejected open
foot edge; `-02` records a diagnostic-call signature failure; `-03` covers the
feet and passes its headboard crossing screen, but retains the duplicate duvet
and is superseded. `inspect-double-bed-covered-sleeper-04.py` applies the
single-duvet correction. These remain static visual studies, not accepted art.

Candidate 04 completed with unchanged source bytes and approved source data.
The whole sleeping rig uses 0.88 uniform scale; normal Sim presentation is
unchanged. Both knees use a gentle 10-degree bend. The original flat duvet and
fold are hidden only in this occupied render. One replacement duvet covers the
body and continues down the foot and side edges, above the retained mattress.
The primary reviewer inspected `covered-SE.png` and `covered-SW.png`: neither
exposes the feet or reads as a second blanket over the original green surface.

After removing the flat duvet, the sleeper was lowered onto the mattress and
the head placement re-solved against the pillow. All head/hair versus headboard
surface-crossing counts are zero. The full body stays within the mattress's
plan-view bounds. The blanket's 27,166 sampled body vertices have no ray misses
and a minimum top-surface gap of 0.02900, compared with a nominal 0.008 shell
thickness. These are limited geometric screens, not full cloth-clearance or
finite-support certification. The static source run still says `accepted: false`.

The current visual candidate is exclusively
`output/double-bed-covered-sleeper-04/`; earlier covered candidates are superseded.
Its SW image SHA-256 is
`9b93fd4941f0f5dbc70e39c60cd062bc4dca80b99ad871d32b9843e445849061`;
the SE image is
`1a64b74e4544f341dcc3df0aacadd8536a11616bf69aabbacb9e8880bfdca86a`.
This establishes a corrected static presentation for review, not animation,
two-occupant compositing, all-facing acceptance, runtime integration or release.

Independent inspection of all three candidate 04 images concurs that this is
suitable to show as the current static proposal. It flags the elevated head
posture and stiff-looking duvet creases as remaining visual reservations, not
the earlier duplicate blanket or exposed-feet failures. The retained
`visual-review.md` records both reviews and the unresolved proof boundaries.

## Approved delivery and integration ownership

The owner called candidate 04 fantastic and requested the live version. They
also explicitly authorized routine replies to the runtime chat. The approved
appearance is the one continuous duvet, covered feet and 0.88 sleeping scale;
the rejected larger footprint proposal is superseded.

The visual task owns source art and export in this worktree. The bed assignment
task owns runtime, renderer, navigation, UI and save integration in
`D:/VIBES/.worktrees/2301/terrilives`. It has requested registered furniture/duvet
and two separate Sim contributions, one shared outline, and genuine owner
coverage for picking. Scene-specific colour remains until measured reuse is
proved. The first pilot must report cropped bounds, anchors, independent
reconstruction errors and atlas cost before the renderer interface is fixed.

Prepare the bed release on a branch based on current main so the unrelated,
pending aquarium and ottoman changes cannot enter this release accidentally.
The older pilot branch and immutable experiments remain available for replay.

## Full covered export accepted for integration

The full static batch finished: 288 original passes, 64 scene combinations and
all four facings. The owner-approved pose is unchanged. Primary and independent
visual review accepted the complete representative sheet, covered feet and one
continuous duvet. The source receipts, final export, reconstruction comparisons,
palette independence and atlas budget are recorded in
`docs/assets/review-evidence/bed-assignment/covered-double-bed.md`.

The encoding is scene-linear premultiplied visible-additive contributions, not
display-space ink-over layers. Runtime integration must preserve furniture-only
post-sampling recolour and use the separate raw visible-owner alpha for picking.
The runtime task owns that integration and its played/live verification. Export
acceptance is not proof that the changed sleeping presentation is already live.
