# Recliner wall and support repair

The configured recliner kept the source pose's orientations without fitting the longer body to the fixed sofa. The tall regression extended its hair to sofa-local y=1.296557; the room-facing wall surface is y=.93 when the two-tile sofa meets a wall with the shared .14 thickness. Its torso and heels also floated above their supports.

1. The repair fits the visible head and hair inside the actual end arm, including the renderer's existing .004 outline and .002 clearance. It places the outer clothed torso on the measured seat cushions, keeps the heels on the end arm, and bends the knees using the configured leg lengths.
2. A separate side measurement found the bob at x=-.521822 before outline. A turn at the existing neck joint brings the complete head inside the fixed sofa side without pushing the torso through the back cushions. Across the 64 body corners, this turn is 22.1 to 25.4 degrees. The neck attachment retains the source skeleton's authored offset. The bounded search allows up to 60 degrees and chooses the smallest fitting turn. The wave hairstyle with an angular face and all face sliders at 100 selects 44.70061 degrees; the initial 35-degree search cap could not fit it.
3. The neutral source-derived runtime pose already had a small longitudinal hair overhang: y=1.001859. Its separate correction moves the body .077859 tiles toward the foot end. This is recorded separately from the tall regression's .372557 correction. The neutral head was neck-supported; the source does not establish a head-on-arm contact requirement.
4. The source clip has no visible book. Resting arm articulation follows the supported torso. The repair changes no body parameter range, body scale, fixture placement, accepted asset, depth bias, or visibility rule.

## Geometry evidence

`before.json` retains the initial neutral and exact tall regression. `after.json` retains their fitted surfaces. `corners.json` records both presentations at every independent body corner. The clothing files cover 3 tops, 2 bottoms and 3 footwear choices for each presentation.

The regression tests independently clip actual posed body triangles against the exported fixture's flat top triangles. They do not reuse the fitter's sampled height grid or accept its own target coordinates as contact evidence.

| Measurement | Result across 64 body corners |
| --- | --- |
| Head and hair fill x range | -.414000 to .157647 |
| Head and hair greatest y | .924000 |
| Greatest limb-length error | 0.0000000289 |
| Greatest joint attachment error | 0.0000002581 |
| Smallest torso support patch | .011052 square tiles |
| Smallest left heel support patch | .000248 square tiles |
| Smallest right heel support patch | .001725 square tiles |
| Smallest support clearance | .001362 tiles |

The outline stays inside the room-facing planes derived from `assets/models/architecture-depth.json`. All 36 clothing/footwear combinations retain measurable torso and heel support. Omitting fixture pixels gives the same pose because the fitter retains its independent contact geometry. The hairstyle files cover 72 cases: five hairstyles plus Bald, both presentations, all three face shapes, and low/high facial slider values with glasses enabled.

## Verification

1. `npx vitest run tests/character-recline-fit.test.ts --maxWorkers=1`, with `NODE_OPTIONS=--max-old-space-size=4096`: PASS, 10 tests, exit 0, 31.89 seconds. The later measurement-only hairstyle receipt update also passed its six filtered tests in 8.94 seconds. `npx tsc --noEmit --pretty false` passed with exit 0. Existing recline/head/outline tests passed 8 filtered tests, with 46 deliberately skipped, in 10.46 seconds.
2. `node docs/evidence/2026-10-13-creator-repair/recline-wall/mutations.cjs`: five mutations in `.scratch/creator-repair-validation`. Removing the complete fit, neck turn, torso support or heel placement, or restoring the insufficient 35-degree search cap, makes the focused regression fail. The runner restores exact bytes and verifies that the live source remained unchanged. See `mutations.json` and the individual logs.
3. The [final actual-game review](../final-game-review/recline-final/visual-review.md) inspected the lateral correction and separate activity-bubble repair. It covers 12 cases, including both genders with maximum body and facial settings, glasses, and wave hair in all four facings. The full bubble and person remain separately pickable.

## Prevention

Configured bodies need support and containment checks against actual fixture surfaces after their rest geometry changes. Preserving the neutral pose angles does not preserve its contacts. Measure both horizontal axes, include the visible outline and wall thickness, and keep a billboard visibility error separate from a physical body intersection.
