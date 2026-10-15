# Main integration source and visual review, 2026-10-14

The source review found no additional confirmed functional regression beyond the integration faults already identified. The three supplied startup and creator captures show usable layouts and a rendered household. This is a bounded review of those captures, not acceptance of every character interaction or animation.

## Source review

Reviewed `web/src/main.ts`, `web/src/frame.ts`, sprite rendering, architecture loading, gzip and coverage loading, the startup cover, build-session persistence, creator callbacks, and graphics recovery. The current source contains these corrections:

1. Indicator coverage includes both activity and conversation sprites.
2. Configured-character conversation indicators receive the same preference tint as the historical sprite path.
3. Prepared character loads adopt through `BuildSession`, updating an active build session's cancellation baseline.
4. Atlas layer validation includes the appended fixture companion pages that allocation actually requests.

`integration-red.log` records four failing regression assertions before the corrections; `integration-tint-red.log` records the isolated tint failure after the other assertions passed. These receipts establish detected source behavior, not visible acceptance. This reviewer did not rerun tests.

The possible stale-fixture-cache issue after Build cancellation was rejected: native `adopt_current` advances the previous live lot revision, so `CharacterWorld.prepareFixtures` and `CharacterScenePlan.sync` refresh after restoration.

## Images inspected at original size

1. `startup-02/01-before-game-script.png`: the dark cover fills the viewport. The spinner, game title, and readable first numbered loading step are centered, with no exposed HUD or blank game canvas competing with them. A still cannot demonstrate spinner motion or later progress updates.
2. `startup-02/02-loaded-game.png`: the cover is absent and the house, furniture, people, lighting, upper-left controls, and bottom household panel are visible. Text and controls are contained within the viewport. The image includes people close together at a doorway; it does not establish their motion or collision behavior. No new layout defect is evident in this capture.
3. `startup-02/03-reset-defaults.png`: the Needs & habits page shows aligned category sliders and numeric inputs, with visible reset values of 1 and sleep timing of 0 hours. The editor has its own scrollbar, while navigation, preview, and footer remain available. Walking is selected and the control reads Pause. Both preview sizes show the character within their bounds. Lower categories extend below the captured editor area, so the image alone cannot prove every category value. The image retains the outdated heading `Activity inclinations`; current source has changed that heading and its help-text selector to `Activity preferences`. A later capture is needed to verify the renamed heading as rendered.

Image SHA-256 values:

| Image | SHA-256 |
| --- | --- |
| `01-before-game-script.png` | `c3f05688ec76bb5e0961d6da144c77917ce6f7c4ff36c5817dd6cb600afc2cc8` |
| `02-loaded-game.png` | `41929cfb1538103662de05bb81c013c68b455bc9d0952499cedd4dea568fbf91` |
| `03-reset-defaults.png` | `6e64da3c1cc52911759ee09f8af9887b0609e8a6a28e940f04c2f4f74787e2b6` |

## Browser evidence and limits

`startup-02/report.json` reports PASS for 14 checks, no browser or graphics diagnostics, and browser cleanup. It records ten reset category values, all equal to 1. The checks cover loading before the blocked game module, cover removal after a drawable scene, Walking selection and changing preview pixels, randomized supported traits, reset randomness preservation, exact Undo, whole-character defaults, unchanged household bytes during draft editing and cancellation, and exact existing-character preload. These are reported harness observations. This review independently inspected the saved pixels but did not operate the browser or watch a recording.

The coordinator identified the preserved `startup-01` failure as a harness click on a hidden radio input rather than its visible label. It is not counted as a passing run.

The supplied images do not establish all facings, animation continuity, phone layout, keyboard operation, graphics recovery, saved-game reload, conversation tint as drawn, or sleeve-band repair. No blinded defective/corrected sleeve pair was supplied for this review, so it cannot satisfy that repair's requirement to reject a known defective result. The source was live during integration; these image hashes identify the inspected artifacts, not an immutable source revision for their capture.
