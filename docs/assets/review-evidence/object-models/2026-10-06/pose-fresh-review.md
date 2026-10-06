# Fresh review of failed pose construction

The fresh, read-only reviewer inspected the preserved failed sources after the
owner resumed completion. No new pose was executed by the reviewer.

The frame constructor in
`pose-blockers/scratch/pose_complete_supported_author_frames_v1.py` copies the
previous bone frames and changes only selected outer lap arms. Its
`reader_pitch` input is unused. Torso-pitch adjustments therefore cannot change
the torso in this construction path.

The clothed-lap correction removes local hand and torso contacts but retains
four neighboring sleeve and cuff contact rows. Moving the reader forward
clears those neighbors, but the support refit creates eighteen actual hip and
seat intersections. A positive sampled support gap does not certify the whole
evaluated surface. The lower shelf poses reach their targets but deform
trousers and sleeves into self-intersections.

## Selected approach

Replace frame preservation with coherent whole-posture authoring on the
existing rig. Author pelvis, spine, torso yaw, knees, ankles, shoulders, arms
and prop together. Preserve source meshes, material definitions, skin weights,
scale and bone lengths.

For the sofa, evaluate a supported shallow perch or torso yaw with upper arms
closer to the body. Preserve finite pelvis support and both feet. For lower
shelves, evaluate a staggered hinge or supported kneel rather than a symmetric
deep squat. This is a different construction approach, not another translation
or support-normal correction.

Certify one demanding complete mixed scene and each shelf-row posture before
expanding exports. Require coherent joint endpoints, finite support and grips,
and no unintended evaluated self, neighbor or furniture intersections. Keep
all failed evidence. The reviewer did not certify feasibility without that
actual evaluation; garment deformation may still require a separately reviewed
rig correction.
