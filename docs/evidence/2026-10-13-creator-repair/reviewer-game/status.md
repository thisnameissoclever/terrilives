# Independent gameplay review checkpoint

The bunk-bed render freeze is repaired in the reviewed revision. A new visual defect remains: broken dark arcs cross the shared-bed cover. The review does not accept those arcs or approve the complete repair.

1. Bunk-first reproduction and the subsequent broad sweep completed without page errors. The broad sweep contains 36 occupied cases: armchair, reading chair, bookcase, fridge, exercise bike, double bed, bunk, shared sofa, and counter wiping, each with all four fixture rotations. Every case first reached its intended active simulation state through normal commands.
2. Inspected short/wide bodies at normal scale and tall bodies at closer scale. Tall/wide reading has valid images in all four facings in the partial `v4` run. The `v5` run adds 16 complete cases across fridge, bike, shared bed, and counter wiping at scale 2. The severe preview-only reading-chair displacement was not observed in actual gameplay.
3. Fixture-wide color replacement was not observed in these comparisons. The original cabinet, chair, toilet, bed frame, sofa, and bike artwork remained recognizable across use. Fridge doors visibly open. Activity bubbles cleared the corresponding visible hair in inspected samples. This is visual evidence, not pixel-exact color certification or owner approval.
4. The normal kitchen sequence completed preparation, cooking, seated eating, pickup, dish carrying, waiting for the sink, and washing. The selected tall/wide person finished the ordered meal and cleanup. Sixty-four captures record the sequence; plates remained visible above the table and counters in inspected frames. No new wall clipping was identified in that kitchen sequence.
5. A newly created person used the reading chair at 01:05 and 13:05 under automatic lighting, at fractional zoom 1.37. Both captures rendered and matched their lighting conditions without page errors.

## Remaining visual finding

The shared-bed cover has thin, broken dark arcs across its fabric. See `v5-bed-0-t060.png`, `v5-bed-1-t060.png`, and the dedicated `owner-bed-0-t060.png`. The finding remains open.

The dedicated GPU readback identifies the arcs as fixture-owned pixels. In logical region x450..524, y518..554, all 85 dark subpixels have identity 20, the bed fixture token. The sleepers have tokens 36 and 37. At logical (502,527), subpixel (1,1), scene texel (1005,1055), the observed linear RGBA is [0.04498291, 0.02899170, 0.01998901, 1], surface depth 0.7083998919, owner 20. Neighboring green fabric pixels above and below also have owner 20, with depths 0.7166500688 and 0.7067723870. These observations support fixture or cover outline attribution, rather than underlying-person ownership; they do not independently identify the specific triangle.

`bed-arc.sav` preserves the actual simulation state. `bed-arc-textures.json` contains raw 2x scene identity, surface, and color bytes, row strides, and scene diagnostics. Readback origin is [780,870], size [440,360] in scene texels. `bed-arc-samples.json` contains the decoded samples. The screenshot crop is x180, y242.00044, width600, height550; view scale is approximately 2, origin [992.00002,184.00043].

## Commands and results

1. `$env:CASES='bunk'; $env:FACINGS='0'; node .scratch/game-review/capture-v3.cjs`: exit 0; bunk active at tick 40 and 200 ticks captured; zero page errors. PASS for the previous freeze reproduction.
2. `$env:CASES='armchair,reading,shelf,fridge,bike,bed,bunk,sofa,wipe'; Remove-Item Env:FACINGS -ErrorAction SilentlyContinue; node .scratch/game-review/capture-v3.cjs`: exit 0; 36 occupied cases, zero page errors. PASS for capture coverage and runtime assertions; visual cover finding remains.
3. `$env:CASES='fridge,bike,bed,wipe'; $env:FACINGS='0,1,2,3'; node .scratch/game-review/capture-v5.cjs`: exit 0; 16 occupied cases, zero page errors. PASS for capture coverage and runtime assertions; visual cover finding remains.
4. `node .scratch/game-review/kitchen.cjs`: exit 0; ate=true, cleanOrdered=true, washed=true, captures=64, errors=[]. PASS for observed kitchen sequence.
5. `node .scratch/game-review/lighting.cjs`: exit 0; two cases, zero page errors. PASS for the observed day/night scenarios.
6. `$env:CASES='bed'; $env:FACINGS='0'; node .scratch/game-review/bed-owner.cjs`: exit 0; one shared-bed case and GPU readback saved. PASS for evidence collection; the captured arcs remain a FAIL for visual acceptance.

## Coverage limits and excluded evidence

The first broad `v1` and all `v2` captures are excluded from visual acceptance because the then-unfixed bunk error stopped rendering. The initial harness also had camera-drag and rotated-placement reachability gaps. Those gaps were corrected with visible-target assertions and actual-occupation preflight. The first toilet-only run remains valid for its observed revision.

The `v4` close-view run stopped when the next target was offscreen. Its four completed reading cases are valid bounded observations, but the run itself is incomplete. `v5` resets the camera by reloading between cases and completes all requested cases.

Four counter rotations do not establish all four worker approach directions. The existing `fixtures/cleaning/cleaning-counter-1.sav` through `-4.sav` should supply those targeted follow-up cases. The kitchen sequence uses the standard table and sink arrangement, rather than every rotated dining setting. Bunk captures show unused, entry, and active use; the sampled window does not reach every bunk exit. No performance claim is made, and no visual sweep is treated as exhaustive coverage of all body combinations.

All task-owned browser contexts are closed. No production source was edited. Root can repair the cover and the separately identified technical findings, then request a targeted re-review.
