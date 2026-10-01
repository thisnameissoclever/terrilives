# Wall bookcase candidate 01

Method: authored Blender geometry through `render_bookcase.py`, using the
accepted Sim's camera, lights and toon material family. No image-model prompt
or paid request. Exact source inputs, model and PNG hashes are in `proof.json`.

Design brief: retain the shipped shallow wall-aligned cabinet, four rows of
books, warm wood, muted spines and 1.54 height. The body is 0.28 deep; its crown
is 0.30 deep with a 0.02 front overhang. The rear stays at authoring Y=0.5.
Quarter turns rotate about the tile origin, not the cabinet centre.

Primary and independent visual review accepted all four original 768x960 RGBA
images and the reduced board. Independent subjective score: 93/100, not a
calibrated measurement. Books reduce to simple coloured spines at game size;
the opaque rear correctly hides them. No source revision was requested, so
there are no rejected outputs in this batch.

`surface-contact-proof.json` records 32 closed connected parts, four grounded
frame pieces and 41 evaluated contacts. Nine damaged copies and five deleted
guards are detected without changing the saved model bytes. Independent review
prompted an explicit overhead-clearance check: support alone does not prove
that a book fits beneath the next shelf. Minimum measured clearance is 0.002.

This source decision permits runtime review. It does not establish owner
approval, an animation change or public deployment. The ordinary adjacent
standing-read animation remains unchanged.
