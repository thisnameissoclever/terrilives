# Armchair candidate 03

Status: source art, occupied geometry and runtime visuals accepted by primary
and independent review. Publication is reported separately.
Correctness: 95/100, a subjective source-art score rather than a test result.

Provider: local installed Blender, using the accepted toon materials, light,
camera and unchanged Sim rig. No image-generation model, prompt or paid request.
Exact generating input hashes, model bytes and four original empty images are
bound by `proof.json`. The sixteen green occupied originals are separately
bound by `occupied-review/proof.json`; their board only arranges and resamples
the original pixels.

The seat top is now 0.404; the back cushion extends down to 0.38 and still ends
at 1.01. The recessed base, lower arms and closer front feet retain the compact
red armchair's identity. Both reviews found intact hands, cuffs, knees and
shoes in the occupied views, plausible rear occlusion, and no clipped images.
Small outline endings at upholstery joins are nonblocking source-art polish.

`contact-check-02.json` reports all four evaluated poses. Each has zero detected
body/chair triangle crossings or containment, minimum hip gap 0.00029913,
49 near-support vertices and XY hull area 0.01785954. Twelve structural
contacts connect ten chair parts to four grounded feet. Eight deliberate bad
copies fail their intended checks; four synthetic query tests separately
exercise crossings, containment and separation. The saved model is unchanged.

`contact-check-01.json` is retained as a validator-design failure. It proved
only the first pose's clearance before requiring too many vertices within
0.003 of the cushion. Independent review distinguished the closest gap from
the broader 0.01 near-support neighborhood of a rounded rigid hip. This did
not relax penetration checks. A hull-area check was also added because width
and depth extents alone can accept collinear diagonal points.

The hands rest near the thighs, not on the arm tops. Shoe soles retain the
approved rig's roughly 0.01915 floor clearance, not exact zero-height contact.
All 196 production originals and 48 occupied reconstructions passed. The
65-scene GPU board covers four empty views, all 48 occupied samples, five
colourways both empty and seated, midnight and Build preview. Production play shows Tim actively
sitting, and all four Build rotations commit without changing the final save.
See `docs/assets/review-evidence/living/armchair.md` from the repository root
for the full runtime record and proof limits.
