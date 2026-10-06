# Cleaning poses

`render.py` builds chore actions on the unchanged approved Sim rig. `poses.py`
owns the hand targets, joint poses and mop, cloth and bag geometry. The saved
`cleaning.blend` contains editable actions and tool visibility drivers.

Mopping uses eight samples, counter and table wiping use six each, and bin
emptying uses eight. Every action supports SE, NW, SW and NE and the household's
green, blue and red shirts. Counter cloth contact is at 0.86 metres; table
contact is at 0.79 metres. The bin retains its original exterior dimensions
with a recessed liner beneath the hinged lid.

The mop uses uneven, open-ended cotton strands gathered beneath a narrow binding.
Its closed hands replace the relaxed palms and thumbs only during mopping.
They use the approved skin material and the existing hand bones. A radial
cross-section checks shaft enclosure and contact against the bare handle and
rubber sleeve; saved poses also check the wrist connection. Preserve the
approved face and hair outline selections. The original rig's four-pixel lines
are authored at density sixteen; this bake uses one-pixel lines at density four
to keep the same logical width. The export receipt records that ratio and the
hair selection. Front-facing mopping frames also record eye regions so tests
can detect outlines that erase the eye whites.

Run `render.py` with background Blender into a fresh `raw` directory. Run
`render_contacts.py` for the hand/tool contribution masks. Run `export.py`
with Python and Pillow to publish two-pixel-density frames. Export validates
the complete render receipt, source hashes, canvas bounds and mask provenance.
Run `assets/sprites/gen/build.py` to append the extension and generate runtime
tables. Do not edit the generated atlas or approved source rig.

Animation selection comes from chore progress, not elapsed browser time.
The bin clip runs once; wiping repeats three times and mopping completes one
stroke cycle per patch. Reduced motion holds the middle sample. These choices
change presentation only; the simulation owns durations and grime removal.

Run `validate_grips.py` with background Blender after export. It reopens the
saved model, evaluates skinned hands at both stroke extremes and center passes
in every facing, and checks enclosure against the rendered shaft. The resulting
`grip-validation.json` is tied to the model hash. This physical check supplements
native-size and played visual review; it does not establish anatomical realism.
