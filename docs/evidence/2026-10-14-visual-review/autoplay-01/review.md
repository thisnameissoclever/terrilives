# Reading autoplay review, 2026-10-14

Real Reading autoplay completed a full cycle for male and female presets in all four facings. The 24 representative images inspected show no severe chair/upper-torso intersection or clear new visual defect. This review extends the paused-image evidence in `../visual-01/independent-review.md`; it does not claim inspection of every interpolated frame.

## Method and observed playback

Command: `node .scratch/chair-autoplay-review.cjs`, exit 0. The harness used an isolated, visible Chrome window with muted audio, the actual creator controls, and the existing development server. It selected Reading, pressed Play, captured representative images during playback, waited for a complete loop, and pressed Pause. It did not seek frames or modify the preview clock.

A transparent wrapper around the observed application's `CreatorPreview.draw` recorded the actual frame consumed by successful draws. The preview's metadata declares four authored samples over 4.8 seconds. Each of the eight runs recorded 330 or 331 active draws across 5.48 to 5.50 seconds, included authored sample bins 0, 1, 2, and 3, and crossed the loop boundary once. Both presentation presets used height, build, shoulders, hips, and torso values of 50. The male preset was bald; the female preset retained its preset hairstyle.

Each screenshot records the enlarged preview and game-size thumbnail. Three images were captured per run around frame values 0.8, 2.1, and 3.4. The exact observations immediately before and after each screenshot are in `report.json`. These are representative playback samples, not a frame-by-frame video review.

## Images inspected

All listed files were opened individually at their original resolution.

| Files | Visible findings |
| --- | --- |
| `male-0-sample-0.png`, `male-0-sample-1.png`, `male-0-sample-2.png` | Front-left view: head and shirt remain above the chair arms; book and hands remain over the lap. No severe torso obstruction. |
| `male-1-sample-0.png`, `male-1-sample-1.png`, `male-1-sample-2.png` | Front-right view: chest remains visible, feet remain below the knees, and the chair stays behind the seated body. No severe torso obstruction. |
| `male-2-sample-0.png`, `male-2-sample-1.png`, `male-2-sample-2.png` | Back-left view: chair back conceals the lower back and hips while the upper torso, head, arm, and book remain readable. |
| `male-3-sample-0.png`, `male-3-sample-1.png`, `male-3-sample-2.png` | Back-right view: upper torso remains above the chair back; book and arms remain in front of the body. Ordinary lower-body occlusion remains. |
| `female-0-sample-0.png`, `female-0-sample-1.png`, `female-0-sample-2.png` | Front-left view: head, chest, arms, and book retain plausible placement; hair does not conceal a chair/torso crossing. |
| `female-1-sample-0.png`, `female-1-sample-1.png`, `female-1-sample-2.png` | Front-right view: shirt and lap remain readable; the chair arms stay below the upper torso. |
| `female-2-sample-0.png`, `female-2-sample-1.png`, `female-2-sample-2.png` | Back-left view: upper torso clears the chair back, with the book and forearm visible beyond the shoulder. |
| `female-3-sample-0.png`, `female-3-sample-1.png`, `female-3-sample-2.png` | Back-right view: the chair conceals lower back and hips without crossing the shoulders or upper chest. |

The game-size thumbnail agrees with the enlarged preview in every capture. No inspected capture changes the prior acceptance of minor furniture contact overlap.

## Verification and limits

All 24 image hashes match the receipt, and the three captures within each run have distinct hashes. The watched production source hashes and paused household save hash are unchanged. No browser warning/error event was recorded. The harness closed its isolated browser in `finally`. It reused the root task's server and did not stop that server.

This establishes actual playback through the complete loop and visual inspection of selected frames in eight presentation/facing combinations. It does not establish the quality of every interpolated frame, entering or leaving a household chair, unrelated actions, arbitrary body-control combinations, or every hairstyle and accessory. The recorded `PASS` means the harness assertions passed; the visible findings above are the visual judgment.

The new requirements in `AGENTS.md` and `docs/testing-protocol.md` were reviewed. No blocking gap was found. They require source and scene identity, direct image inspection, separate animation evidence, independent blind review against the known defect, restoration evidence, and the coordinating reviewer to inspect the affected views. Keep the capture status distinct from the written visual verdict when reporting completion.
