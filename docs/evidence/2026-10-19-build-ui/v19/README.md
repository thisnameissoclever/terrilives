# Current application and Chrome verification

This record covers application source `ac25b9b2f40aa2d48d97f02afbaa4e1223ca200d`, including main `8465a69d89c497155dc1957ba36de18bf463e970` and its version-19 save format. Concurrent workflow edits affect only continuous-integration helpers and documentation. [verification.json](verification.json) binds the inspected application files, WebAssembly binary, logs and selected captures to their SHA-256 digests.

The normal release WebAssembly build, type checking, 479 affected web tests in 16 files with one worker, and the production build passed. The production build retained its bundle-size and plugin-time warnings. The fresh [source integration review](integration-review.md) found no actionable defect. Earlier complete version-18 suite results remain in the parent directory; they are not represented as a complete version-19 rerun.

The text log copies use LF line endings and remove trailing whitespace and blank final lines. Retained measurement and review text uses LF line endings to match Git's published representation. The receipt records original and retained hashes. The raw local files were not edited. Selected JPEG captures are copied without conversion or resizing. No video or trace archive is included.

## Actual browser observations

Chrome used a task-owned tab at `http://127.0.0.1:5391/`, a fresh local origin with no owner save. The game rendered from the current release WebAssembly package. The simulation stayed paused at Day 1, Monday 00:05 throughout these checks.

1. [dock-390.jpg](dock-390.jpg) and [dock-434.jpg](dock-434.jpg) show the actual dock at 390x844 and 434x683, respectively. Header and roster controls measure 36px tall. Chores has a complete keyboard focus ring, labels fit and neither dock scrolls horizontally.
2. [exit-dialog-390-keyboard.jpg](exit-dialog-390-keyboard.jpg) shows the Leave Build mode dialog at 390x844. Neutral Keep building has initial focus and a complete keyboard focus ring. Red Discard changes follows it; green Confirm changes is immediately below. Each action measures 44px tall. Keyboard Keep preserved the exact room-name draft.
3. A real pointer selected the visible Kitchen/Living doorway at its floor edge. Remove followed by footer Confirm opened the native Merge review. Back retained the draft in Walls. Land followed by Confirm opened that review again; another Back returned to Walls without a false confirmation-failure message. [walls-land-review-back-390.jpg](walls-land-review-back-390.jpg) shows the resulting editing state and useful Wall removed feedback. Footer Cancel then restored the original Kitchen and exited.
4. Footer Confirm adopted Kitchen confirmed and exited. A later pending rename followed by Land/Discard restored that confirmed name and opened a fresh Land batch. Selecting Land again opened no dialog. Land/Confirm adopted Kitchen Land confirmed and opened a fresh paused Land batch. The later Leave Build dialog's Discard restored that last confirmed name.
5. Actual Save reported Game saved. Load, followed by its confirmation, reported Saved game loaded. Selecting the kitchen then showed Kitchen Land confirmed with its original 48 tiles. [loaded-room-state.txt](loaded-room-state.txt) retains that observed state; [final-loaded-game.jpg](final-loaded-game.jpg) records the paused loaded game. Chrome reported no warnings or errors during this pass.

The root reviewer inspected the four required captures at their original sizes. A fresh independent reviewer also [accepted all four visible states](independent-visual-review.md), naming each image and its findings. That verdict concerns recorded pixels and measurements. Actual interactions supply separate evidence for draft retention, adoption and cancellation. The earlier blind review rejected the known corrupt minus and accepted the identical restored SVG; the present screenshots show the clean horizontal minus.

The tab closed in a finally block after the temporary viewport override was reset. The task-owned preview server stopped. [cleanup.json](cleanup.json) records the tab and final paused clock. No owner browser tab or existing save was changed.

Physical touch and operating-system held-key repeat remain unverified. These stills do not establish every gameplay state or accessibility mode. No Linux mutation recovery, production campaign, PR merge, deployment or live-game success is claimed by this record.
