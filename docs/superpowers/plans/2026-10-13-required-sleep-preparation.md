# Required sleeping support preparation

The approved change moves fitted sleeping poses, dense posed surfaces and blanket support queries into the existing bounded preparation worker. Production drawing requires ready artifacts. The pure implementation owns `sleep-contact-*`, `sleep-cover.ts`, independent old fixtures and focused tests; the integration implementation owns admission, transport, rendering and retained GPU resources.

1. Preserve the old `sleep-fit.ts` and `sleep-cover.ts` implementations in isolated fixtures. Preserve the old Float32 skin/subdivision order and actual `PreparedBody` selection.
2. Define versioned inputs with geometric appearance and source revisions, and immutable outputs with fitted matrices and per-person cover grids. Exclude only uniform appearance fields. Reject nonstatic clips, mismatched sources, incomplete arrays and nonfinite values.
3. Compile both one-sample sleeping clips with the unchanged CPU proof path. Prepare bed offsets 0 and -0.77 and bunk offset 0, matching current scene placement. Keep these contributions separate from occupancy.
4. Compose draped grids with the existing maximum rule. Retain fixed cover topology and rewrite only its positions and normals, preserving double arithmetic order and Float32 storage.
5. Verify all body corners, representative head/style selectors, fractional/static phases, both bed slots and mixed occupants against independent old results. Compare complete matrices and geometry arrays exactly. Verify changed dependencies invalidate keys and uniform edits do not.
6. Run focused tests only in the coordinated single-worker, 4 GiB lane. Record commands, exit codes, measurements and source hashes. Runtime scene parity, graphics recovery and desktop frame verification remain owned by the coordinating task.

The static contract is checked against actual clip metadata rather than inferred from repeated draws. Both published sleep clips currently have static playback and one authored sample. The implementation must reject a future animated source until its preparation contract is updated. Generic interpolation, source art, body ranges, support tolerances and accepted overlaps remain unchanged.
