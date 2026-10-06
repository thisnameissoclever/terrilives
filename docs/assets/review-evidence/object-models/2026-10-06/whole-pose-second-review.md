## Real goal
Three normal-sized actors must be able to sit or read on the existing three-cushion sofa in every occupancy and action combination, with the same rig and sofa sources, full-scale actors, no hidden clipping, and no weaker acceptance check.

## Diagnosis check
[D1] The remaining thigh-to-seat rows in candidate 03 are real unwanted intersections, not a mislabeled support constraint. The proof marks `acceptance: false`, then records six `furniture` contacts between `Tailored trouser leg` variants and the matching `Seat cushion` with 16 or 18 surface pairs and no unresolved classification gaps in [.tmp/object-models/pose-complete-whole-mixed-03/raw/proof.json](D:/VIBES/.worktrees/f24d/terrilives/.tmp/object-models/pose-complete-whole-mixed-03/raw/proof.json:291). The author script treats any furniture contact as a failure input to `valid`, not as support, in [.tmp/object-models/pose_complete_whole_author_v3.py](D:/VIBES/.worktrees/f24d/terrilives/.tmp/object-models/pose_complete_whole_author_v3.py:99) and [line 141](D:/VIBES/.worktrees/f24d/terrilives/.tmp/object-models/pose_complete_whole_author_v3.py:141).

[D2] The remaining neighbor rows are also real cloth intersections. Candidate 03 records sleeve-to-sleeve and cuff-to-sleeve contacts between adjacent actors at [proof.json line 395](D:/VIBES/.worktrees/f24d/terrilives/.tmp/object-models/pose-complete-whole-mixed-03/raw/proof.json:395), [line 412](D:/VIBES/.worktrees/f24d/terrilives/.tmp/object-models/pose-complete-whole-mixed-03/raw/proof.json:412), [line 430](D:/VIBES/.worktrees/f24d/terrilives/.tmp/object-models/pose-complete-whole-mixed-03/raw/proof.json:430), and [line 446](D:/VIBES/.worktrees/f24d/terrilives/.tmp/object-models/pose-complete-whole-mixed-03/raw/proof.json:446). The checker explicitly iterates neighbor mesh pairs in [.tmp/object-models/pose_complete_whole_author_v3.py](D:/VIBES/.worktrees/f24d/terrilives/.tmp/object-models/pose_complete_whole_author_v3.py:118).

[D3] Hip support is a narrower proof than whole-body non-intersection. Candidate 03 has finite pelvis and foot support at [proof.json line 736](D:/VIBES/.worktrees/f24d/terrilives/.tmp/object-models/pose-complete-whole-mixed-03/raw/proof.json:736), plus book grip that explicitly says it is not a force or visual-grip proof at [line 1185](D:/VIBES/.worktrees/f24d/terrilives/.tmp/object-models/pose-complete-whole-mixed-03/raw/proof.json:1185). The support routine only certifies projected overlap within a gap band, not complete surface separation, in [.tmp/object-models/continuous_support_patch.py](D:/VIBES/.worktrees/f24d/terrilives/.tmp/object-models/continuous_support_patch.py:63).

[D4] The original neutral sofa posture is not an acceptance source for this target. It defines a single neutral sofa profile with `hip_y=-.36`, `z_offset=-.1738`, and `foot_pitch=8.2023` in [assets/models/seating/pose_profiles.py](D:/VIBES/.worktrees/f24d/terrilives/assets/models/seating/pose_profiles.py:16), then applies one rig pose in [assets/models/seating/neutral_pose.py](D:/VIBES/.worktrees/f24d/terrilives/assets/models/seating/neutral_pose.py:14). It does not prove three occupied cushions, reading props, neighbor cloth, or full-surface intersections. The prior fresh review already warned that positive sampled support does not certify the evaluated surface in [docs/assets/review-evidence/object-models/2026-10-06/pose-fresh-review.md](D:/VIBES/.worktrees/f24d/terrilives/docs/assets/review-evidence/object-models/2026-10-06/pose-fresh-review.md:12).

## What Was Taken As Fixed
[F1] The rigid cushion edge was treated as fixed. The remaining thigh witnesses in `.tmp/object-models/pose-complete-whole-mixed-03/raw/geometry-witnesses.npz` sit at the cushion top/front lip, around z 0.54 to 0.56, while the pelvis support patch is separate. A real correction needs either thigh clearance or cushion compression, not an allow-list.

[F2] The rigid sleeve volume was treated as fixed. Candidate 03 improved the posture but still leaves hundreds of sleeve neighbor pairs, so another small yaw or foot tweak is unlikely to be the clean fourth attempt.

[F3] The neutral sitting source was treated as evidence of feasibility. It is only a pose source, not a 27-case physical proof.

## Alternative routes
[ALT1] Posture-only clearance
Mechanism: move pelvis, knee, ankle, torso yaw, and arm targets inside the same rig until all contacts clear.
Cost: lowest source churn, but this is the failed track with smaller adjustments.
Decisive proof: zero full-surface contacts, finite support, book grip, unchanged rig scale, all 27 cases.

[ALT2] Contact-aware cushion and garment deformation
Mechanism: keep actor scale and sofa width, but add reviewed cushion compression and garment corrective deformation for seated/read poses.
Cost: more authoring and more proof plumbing.
Decisive proof: the same whole-surface checker passes without exemptions, source-rest hashes stay pinned, cushion centers stay pinned, raised-seat and raised-arm controls still fail.

[ALT3] Seating layout reframe
Mechanism: change per-seat posture semantics so adjacent actors use staggered shoulders, lap hands, and tighter elbows before any geometry deformation.
Cost: may look choreographed and still fail the thigh/cushion rows.
Decisive proof: same as ALT1, with additional visual review because the pose can become readable as avoidance rather than sitting.

## Recommendation
Use [ALT2], contact-aware cushion and garment deformation, before another render. The remaining thigh rows are at the rigid cushion lip, and the neighbor rows are cloth volume conflicts; both are physical deformation problems more than frame-preservation problems now. The next proof should be a non-rendered geometry pass over one complete three-person mixed scene first, then all 27 combinations, using the existing checker unchanged and failing on any intersection, lost support, changed scale, moved cushion centers, or weakened negative control.

## What I Could Not Determine
1. I did not run Blender, start a renderer, or launch a fourth candidate, per the read-only instruction.
2. I could not prove whether a posture-only solution is impossible. The evidence says it is the wrong next default because three whole-posture candidates have already reduced but not eliminated real surface contacts.
3. Visual naturalness still needs a later render after the geometry proof passes. The current proof can reject clipping; it cannot approve the final look.

**Next step**: The implementer should build one geometry-only [ALT2] proof candidate, not a render, and require candidate 03’s exact full-surface checker to pass before expanding or showing images.

