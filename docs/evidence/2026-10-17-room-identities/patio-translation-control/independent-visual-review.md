# Patio west-translation visual review

Image-based verdict: pass for the supplied controlled-renderer comparison. Both captures show a gray paved patch with a regular rectangular paver pattern. I see no movement of the patch, change to its outline, displaced grout, or material change between the captures.

I inspected the two original-size images before reading fixture reports, source assertions, or neighboring documentation. This verdict was recorded before checking fixture metadata.

1. `docs/evidence/2026-10-17-room-identities/patio-translation-control/before-west.png`: a single gray patch sits near the center of the 640 by 560 capture. Its four sides form a clean diamond in the isometric view. Thin, darker joints divide the surface into regular pavers. The muted gray has a slight green cast against the pale surrounding ground; the patch reads as paving at this size.
2. `docs/evidence/2026-10-17-room-identities/patio-translation-control/after-west.png`: the patch occupies the same visible screen position and retains the same four corners, boundary edges, joint placement, and gray material appearance. I see no added or missing pavers, detached edge strip, grout jump, or changed patch shape. The pale surrounding ground and its black frame-edge gaps change, most visibly across the top of the image. Those background differences do not visibly enter or displace the paving.
3. Readability: the gray surface is easy to distinguish from the surrounding ground, and its joints remain visible at the captured size. The joints are fine and low contrast, so this pair establishes a readable paving grid at this scale; it does not establish readability at smaller display sizes or under other lighting.

The images support visual stability of this one paved patch in this comparison. They cannot establish exact pixel equality by eye. They do not visibly show a house, the translation command, camera motion, or an intermediate frame, so the claimed west translation and camera-follow settings require separate fixture evidence.

This is a controlled production-renderer fixture. It supplies no proof of actual gameplay, native land purchase, cancellation, reload, or cleaning. No known defective reference was supplied, so this review has not demonstrated rejection of a known failure. I have not reviewed or approved any other covering comparison.

After recording the visual verdict, I read `render-report.json` and `source-receipt.json` in the capture directory. They record a 10-tile west translation, house origin changing from `[0, 0]` to `[10, 0]`, camera changing from `[320.37, 35.19]` to `[-159.63, -279.81]`, scale `1.5`, and a 640 by 560 canvas. The render report records 784 interior paving samples, zero changed samples, maximum channel difference zero, and no reported page errors. These are supplied measurements, not measurements I recomputed. The receipt names source revision `391a4d426` and file hashes; I did not independently verify those hashes or the capture program. Those metadata claims agree with the visible stability but do not broaden the image-based verdict.

**Next steps**: Keep this verdict scoped to the two named captures and assess any broader gameplay claims with their own evidence. Nothing is needed from the owner for this review.
