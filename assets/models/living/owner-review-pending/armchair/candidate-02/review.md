# Armchair candidate 02

Status: rejected before runtime integration. Correctness: 88/100; subjective review score, not a test result.

This candidate uses the existing local Blender authoring pipeline, not an image-generation provider. There is no image prompt or paid generation request.

The four empty renders and sixteen unchanged green Sit samples are complete. Their original hashes are in `proof.json` and `occupied-review/proof.json`; the review sheet only arranges and resamples those originals. Source files at generation time are retained in `source/`.

The shorter base and lower arms resolve the original trouser-leg, forearm and cuff collisions. However, `fit-observations.json` records an actual hip-bridge/seat-cushion intersection in all four samples. Minimum surface gap is -0.00370085 model units. Independent evaluated-solid review reproduced it; this is not rounding noise or acceptable cloth contact.

Next candidate: lower the seat top from 0.408 to 0.404, extend the back cushion down to 0.38 while retaining its top at 1.01, and recheck construction, body clearance and a two-dimensional hip support patch. Do not change the shared Sim, offset the body or exempt the hip from collision checks. The inherited shoe-sole floor gap near 0.01915 must remain accurately described, not reported as exact floor contact.
