# Atlas storage visual review

The supplied captures pass visual preservation review for the recorded household and views. I found no visible regression from the packed storage change. Recovery on the affected physical iPhone remains unobserved.

## Failed-device evidence

I inspected both original user-provided iOS screenshots before inspecting the comparison captures. The Safari screenshot shows a repeated page failure, and the Chrome screenshot shows "Can't open this page." Both fail the usable-gameplay check: neither displays the game. The private attachments remain outside this repository.

## Inspected images

1. `phone-dense-reference.png`: the full furnished household is visible, including the three characters, kitchen, beds, aquarium, bathroom fixtures, seating and plants. Floor tiles and wall edges are continuous. The top controls and bottom person panel remain legible.
2. `phone-packed-budget.png`: the household, character positions, object silhouettes, colors, floor grid, wall cuts and interface placement match the phone reference. I inspected the original-resolution image. I found no missing art, block seams, incorrect crops, changed sharpness or new overlap.
3. `desktop-dense-reference.png`: the larger scene exposes the furniture edges, thin chair legs, kitchen fixtures, bunk frame, bathroom fittings and character outlines clearly. Their layering is readable at the captured phase.
4. `desktop-packed-budget.png`: I inspected the original-resolution image and found the same scene and interface placement as the desktop reference. The fine edges and transparent boundaries remain intact. I found no changed depth ordering, misplaced sprite pieces or visible filtering degradation.
5. `.scratch/ios-resident-memory/played-0.png`: characters appear in walking and reclining poses; the sofa sitter's body and legs remain intact, and the moving character is readable beside the doorway. The room and furniture remain fully drawn.
6. `.scratch/ios-resident-memory/played-3.png`: the cooking character and seated diner retain complete bodies and readable contact with the stove and chair. The table, chair and character layers show no visible new crop or obstruction.
7. `.scratch/ios-resident-memory/played-8.png`: three walking characters occupy different rooms, including the shower area. Their outlines and clothing remain intact against the furniture and floor. The scene still contains the same furnishings and continuous floor grid.

## Measurements and limits

`verification.json` binds the comparison to revision `2bd4d4c42986be695f1bfa7788f88fc1fb48e495`. Its phone viewport is 402 by 874 CSS pixels at device scale 3; desktop is 1440 by 900 at device scale 1. These are Windows Chrome captures. They do not reproduce Safari or the affected iPhone 17 Pro running iOS 27.0.1.

The recorded color, surface and identity hashes match between reference and packed captures at each viewport. The packed build completes two frames within the injected one-GiB requested graphics limit. The dense negative control completes zero frames under that limit. The sampler report records zero differences over 9,524 probes and detects 56 mismatches with a deliberately corrupt border. Those measurements support the visual comparison; they do not establish the physical iPhone's failure cause or recovery.

`played-report.json` records nine samples advancing from tick 134 to 1,103 and from 260 to 2,191 completed frames, with changing positions and activities, no reported errors, and browser cleanup. I reviewed the three selected stills, not the live animation. They establish the appearance of those phases, not every animation transition, facing or catalogue item. The phone comparison captures cover the recorded startup scene only.

No concrete visual defect requires correction in the inspected evidence. Physical iPhone startup and sustained play remain a separate acceptance check.
