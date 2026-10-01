# Office chair candidate 02: rejected at runtime review

Source appearance was accepted on 2026-09-30 at subjective 92/100, but independent
runtime review rejected this candidate for SAVED-FACING-MISMATCH. Its NW art
points sideways to the desk. It must not ship. `rejected-room.png` retains the
failed runtime view, with the original layout/model scripts alongside it.

Method: local Blender 4.5.14 LTS, procedural editable model. No image model,
generation prompt or paid request. Brief: an armless slate upholstered desk
chair, charcoal shell, five-spoke paired-caster base, smooth outlines, same
world scale and toon materials as the accepted desk, bike and Sim. One model
supplies all four registered rotations. `proof.json` hashes the exact source,
camera, materials, editable scene and each original 768x960 RGBA image.

Candidate 01 is retained and rejected for REAR-SHELL-BREAKTHROUGH. Its back
support protruded through the rear face. This candidate recesses the support
endpoint from Y=0.26 to 0.245 without changing the shell, seat or camera.
Both reviewers inspected all four original images and the review sheet.
The NE mark is gone; both rear faces are clean. Silhouette, caster attachments,
palette and actual rotation remain consistent.

`scene-check.json` passes 34 parts, 33 solid-overlap contacts, ten grounded
wheels, seat height 0.5675 and rear-shell clearance 0.010059. It catches six
deliberate corruptions: raised wheel, detached gas lift, detached seat,
detached back cushion, rear support breakthrough and missing base spoke.
The saved file is unchanged after the mutation checks.

This remains static artwork. The caster geometry does not implement rolling
or swiveling. Seat height alone does not prove knee clearance, body contact
or a seated Work animation. The current Work interaction remains standing.

The original chair's SE front points game +Y. This model's SE front points +X,
so keeping the numeric NW facing turns the chair sideways. A new physical-front
test fails on this source with SE X=1 rather than 0. Candidate 03 bakes a -90
degree authoring turn into all parts, preserving the shared export rotations,
lot facing and every saved facing value. Labels and unchanged world hashes
were insufficient evidence of physical direction.
