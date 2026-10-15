# Creator browser recheck, October 13

The severe Reading preview obstruction and narrow navigation failure are repaired in the cases played and inspected here. The trait warning and preview spacing now behave as requested. Height still needs a plain explanation of its normalized 0 to 100 scale and a meaningful Review value; root has accepted that final copy repair. This report does not grant owner approval or establish untested geometry coverage.

## Reading and preview judgment

1. Reproduced the prior body controls: Height 90, Build 3, Shoulder width 63, Hip width 71, Torso proportions 65. These are UI control values, not physical percentages. Inspected Male and Female in all four Reading facings, with the large and game-size previews in each screenshot.
2. Inspected both genders at the true maximum of all five body controls, 100, in all four facings. `maximum-body-proof.json` records the read-back values. The initial attempt to enter 115 was outside the UI range; it retained 90. The maximum screenshots were replaced after correcting the input to 100 and checking the actual values. `reading-cases.json` records that correction.
3. In all 16 final screenshots, the chair no longer cuts through the upper torso or shoulder as it did in the rejected image. The body is visibly seated; the arms, hands and book remain coherent. The rear views show ordinary chair occlusion instead of a chair surface crossing the chest. The miniature agrees with the large preview. This conclusion comes from inspecting every final image, not from the reported registration tests.
4. Animation now has a separate label above the selector, with visible space between the select and Play/Pause, and between that row and the miniature. The desktop and scrolled mobile screenshots show readable controls without the prior crowding.
5. Walking, Reading and Cleaning changed visibly during 400-millisecond samples and stayed identical across 200-millisecond paused samples. Standing stayed static with both Play and Pause. `playback-proof.json` preserves these observations. This was a timing sample, not inspection of every frame in each cycle.

## Interaction checks

1. At 390 by 844, clicked all seven navigation buttons after opening every Review disclosure. Then enabled Show preview and clicked all seven again. All 14 clicks selected the correct page. The navigation remained 76 pixels high and the controls remained 44 pixels high. It scrolls horizontally without overlapping labels. `mobile-navigation-proof.json` contains the measured rectangles and resulting headings.
2. Scrolled to the mobile preview controls, selected Walking, played it, and paused it through the controls. Then returned to Personality using the visible navigation. `05-mobile-preview-controls-scrolled.png` and `06-mobile-personality-controls.png` capture those reachable states.
3. Manually tested zero, one, two, three and four traits. Zero through three displayed only the selected count. Four displayed exactly one removal instruction, and all 11 remaining unchecked options were disabled. Removing Keen cyclist restored three selections and removed the warning. No trait repeated the warning in its description. See `trait-count-proof.json`, `07-trait-limit-single-warning.png` and `08-trait-room-no-warning.png`.
4. Identity, Household and Sleep timing no longer repeat their headings. Needs & habits now explains the activity multiplier once, and hobbies have one ordinary-language explanation. The previous routes, weight and tag wording was absent from the inspected pages.
5. Cleanliness and need-rate controls show percent units and ranges. Sleep timing shows hours. Activity controls show multiplier units and ranges. Review shows values such as 83%, -0.5 hours and 1.6x (rendered with the multiplication symbol in the UI). Skill levels and progress remain readable. `review-units.txt` preserves the complete inspected Review.

## Remaining clarity repair

1. **P2: Height needs its scale explained.** It currently says “Relative to the selected gender preset,” displays 0 to 100, and repeats the raw control value in Review. A reader cannot infer that 50 is ordinary height and the endpoints mean 15% shorter and taller. A raw control value of 90 is not 90% height. Root's accepted follow-up is to retain the control range, explain its center and endpoints, and map Review to the actual percentage of average height. This follow-up was not implemented or captured in this frozen revision.

No additional blocking visual or interaction defects were found in the stated recheck. Other surfaces and configurations were not exhaustively tested. In particular, this pass does not repeat the earlier Save/Load/Cancel journey, historical-save tests, complete keyboard or screen-reader testing, all body corners, fixture interactions outside the creator, or performance measurements.

## Environment and cleanup

The page was opened in a new visible Chrome process and a fresh non-persistent Playwright context at `http://127.0.0.1:5187/?stress=0`. The reviewer used no owner profile, draft or save. The desktop viewport was 1440 by 1000; the narrow viewport was 390 by 844. These are resized desktop captures, not real-phone performance evidence.

The console recorded only the missing favicon requests. There were no page exceptions, graphics warnings or graphics errors. The source remained frozen during this pass. The isolated context and browser process were closed in a finally block after writing evidence; the root-owned preview server remains running.
