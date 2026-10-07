# Fresh review of garment fitting

The read-only reviewer inspected all three rejected fitting sources and their
indexed geometry witnesses. Their self-contact totals are 1,645, 1,526 and
1,076; cloth/skin totals are 1,534, 1,584 and 5,148. External contact checks
and basis restoration do not make these sources valid.

The common defect is choosing anatomical correspondence from posed proximity.
Nearest triangle normals do not establish global containment. Correcting that
with winding classification still leaves independent projections discontinuous.
A whole-forearm radial ray can select the folded wrist instead of proximal skin.

The source cuff surrounds the upper arm. Its four rest rings are at local z
1.032358, 1.042824, 1.088495 and 1.097058, with weight 1 on `upper_arm.L`.
Proximal skin rings at 1.003813 and 1.056145 have different bone ownership from
distal skin. Treating this as a wrist cuff is wrong. The source bindings are in
`assets/models/sims/sim-01/build_rig.py` and the preserved binding archive.

The current keyed offsets operate after Armature and subdivision modifiers.
Converting their world displacement through the inverse object transform does
not double-skin rest vertices. A new rest-vertex implementation would need to
account for the actual deformation operator rather than just that object matrix.

## Selected route

Build a coupled sleeve and cuff sweep with permanent rest-space identities:
garment part, ring position, circumferential angle and inner/outer wall.
Establish proximal skin correspondence from rest anatomy and source triangle
coordinates; do not choose it again from posed proximity. Transport ring centers
and frames through the actual bindings.

Solve a smooth midsurface, then construct both walls from that same surface and
its normals with actual thickness. Preserve shoulder anchors and sleeve/cuff
junction compatibility. A 52mm radius is an experimental fit choice, not a
source requirement. Skin, furniture and neighbor constraints must hold together;
compressing first and projecting afterward cannot establish feasibility.

Before another fit, prove stable correspondence and ring ordering, positive
wall orientation, thickness and clearance over faces, no global self/skin
crossings, and enough neighbor clearance. Establish the mapping from material
coordinates to subdivided evaluated points. Keep the post-deformation correction
stage unless a different stage has a verified forward deformation and Jacobian.

The reviewer did not prove available cloth space or run a new acceptance test.
Anatomical correspondence prevents false attraction to the wrist; it does not
remove a real distal obstruction. Rebuilding one continuous garment shell is a
larger alternative. Changing pose and cloth together is justified only after
measuring that the established pose leaves insufficient room. Do not expand
states until the complete mixed scene passes.
