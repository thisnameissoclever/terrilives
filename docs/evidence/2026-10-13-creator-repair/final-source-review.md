# Shared annotation and recline source review

No actionable correctness defect was found in the reviewed annotation, picking, head-envelope, or recline paths. This is a read-only source review of the current local repair, not a claim that every appearance or graphics device has been exercised. No production files were edited. No test suite, browser, build, process change, or publishing command ran during this review.

## Scope and conclusions

1. **Annotation membership and draw offsets.** `web/src/frame.ts:1362` starts a contiguous range before the existing eligible-person loop; `:1420` closes it before carried props. Every emitted annotation receives its person's row token. `web/src/main.ts:1981` passes both owners and range to the renderer. `web/src/render/sprites.ts:671` and `:673` exclude precisely that range from the physical pass, including when static instances precede it and props follow it. `:694` supplies the corresponding owner slice, and `:697` uses the static-instance offset for the annotation draw.
2. **Coverage and physical attachment isolation.** `web/src/render/sprite-pipelines.ts` gives annotations their own fragment output and no depth attachment. `web/src/render/sprites.wgsl:644` reuses the production shading and ordered coverage calculation while returning only color and annotation identity. `web/src/render/scene-target.ts:36` loads scene color and clears a separate integer owner texture. Physical surface depth, physical identity, and the world depth buffer are absent from this pass. This follows the explicitly approved UI-overlay contract; walls obscuring a person do not independently disqualify that person's activity symbol.
3. **Picking, frame changes, and disposal.** `web/src/render/scene-target.ts:53` captures the annotation texture and draw order before submitting readback. `web/src/render/scene-sampling.ts:25` chooses the last displayed annotation represented by a covered sample, then physical picking handles transparent padding. `web/src/render/character/world.ts:109` snapshots semantic owners before awaiting; generation, lot revision, and render-target replacement invalidate stale results. Starting a new scene frame clears annotation readiness. Resize destroys the previous scene target, and renderer disposal owns its annotation texture through the target. The current callers do not expose the empty-scene early return because the game supplies the dynamic-scene callback and its static world.
4. **Recline cache and selector coverage.** `web/src/render/character/recline-fit.ts:32` keys fitted body matrices by selected geometry identity, shape, and anatomical height. `selectGeometry` distinguishes selected part sets and preserves independent contact geometry at `web/src/render/character/variants.ts:108`. Changing clothes or hair therefore cannot reuse a fit for a different selected surface. The current `sofa_recline` asset has `playback: static` and exactly one sample; `CharacterRenderer.preparePose` also normalizes static clips to frame zero. Omitting frame and source pose from this particular fit cache is valid for the current asset. If that clip becomes animated, the cache contract must change with it.
5. **Recline support and containment.** The solver reads the actual selected head and hair surfaces, shifts the torso against the retained seat geometry, turns at the existing head joint, and solves the legs to sole placements on the foot arm. The independent triangle-contact tests cover body corners, top/bottom/footwear selectors, and visible-versus-hidden fixture selection. Hairstyle tests cover all currently offered styles and Bald, both presentations, face shapes, and low/high facial values at the documented large-body case. No narrowed appearance range, substituted fixture, depth offset, or changed wall visibility rule was found in this fitter.
6. **Head-envelope parity.** `web/src/render/character/head-envelope.ts` accumulates all cage skin weights before subdivision, applies selected hair and hidden-bone visibility, evaluates projected height in the same camera convention as `mesh.wgsl`, and includes authored outline extrusion. Its direct-normal and adjacent-triangle normal paths agree with the production compute shaders for the head/hair bones used here. `CharacterRenderer` clears pose/envelope state when shape changes; new selected geometry receives a new renderer. Current callers replace matrix arrays when the pose changes, so the envelope's matrix-identity cache does not retain an old pose.

## Evidence boundaries

1. Read the current repair plan, activity-bubble contract, relevant architecture and lessons-learned entries, annotation contract receipt, recline receipt, final actual-game review, and focused test bodies. Existing receipts were used to understand established contracts and observed cases; they were not counted as tests executed by this reviewer.
2. No exhaustive continuous-parameter proof, new graphics-device check, visual acceptance, or performance measurement was performed. Those require the separate coordinated lanes. This review does not broaden their recorded coverage.
3. Native completion/command changes, creator UI behavior, cleanliness mechanics, the earlier full creator diff, and accepted minor chair overlaps were outside this review. The registered fixture-color provenance was taken as the task's established boundary.

## Reviewed source fingerprints

SHA-256 values captured after reading the source:

| File | SHA-256 |
| --- | --- |
| `web/src/frame.ts` | `795588346AB2C411B964FB7684705B1C1284C6C1AF3F221AB6DF4D3EA232D227` |
| `web/src/main.ts` | `97FA323FAE94FA8780DE58DA590BDB782368A5DB245FDCB073D1546AFB7270DA` |
| `web/src/render/sprites.ts` | `4BD8F4F0C68ECE3D09EF92F7C110812B3098592DB9AC73777A31F4F4BC7566C7` |
| `web/src/render/sprite-pipelines.ts` | `1FB7FB083249D93248CFF2853B901C86EB2C88D080C618D51A14F63D845827B5` |
| `web/src/render/sprites.wgsl` | `EE003BAAA136E4F65A6D163E7D71C2E50A2789DBF43AD83EDD1FD6522FF063D6` |
| `web/src/render/scene-target.ts` | `5B1153498326F8494E61B90495944F033F96C2550D8DA1CB39BC16FA0CC1AD8C` |
| `web/src/render/scene-sampling.ts` | `C953DF5C8D2A603847CCB7DABF6EF9AA13BC1D5C87EBDE9210905CB6EBE97066` |
| `web/src/render/scene-picks.ts` | `69FBEF4F8576649808D8A062993C5E7D88F9484186610E4F0E7B2A7DFF515EC5` |
| `web/src/render/character/recline-fit.ts` | `1B2473F855995EC8F504A7BBC7273EECFC1677D566A32511B6EED5F9BB9B3801` |
| `web/src/render/character/head-envelope.ts` | `7FA11F798A1D15260A3DA51B4E992AE8C3B0A99AA2079213AF9426AE3797D3B2` |
| `web/src/render/character/variants.ts` | `4EA9897DF300EA987E489B023D8319B2C50EB73E34EA4650FE2BE590057DFC4C` |
| `web/src/render/character/world.ts` | `635951F67DF9BF5247693359ED4CDAF32FCD0648D5FB2348BB3C93981825CBDD` |
| `web/src/render/character/renderer.ts` | `D00B5BB1500E983E91C08847CA4E97DEA53BACD6F4C4CDA2550B1A6FF176C660` |
