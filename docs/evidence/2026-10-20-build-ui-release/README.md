# Build UI release verification, October 20

The owner authorized relevant local CI checks and a fresh adversarial review in place of remote GitHub checks, followed by merge, deployment and live verification. This record covers the final local corrections and guide acceptance. Deployment and served-asset evidence is recorded separately after publication.

The reviewed base is `1cb7b7a3dcbbac856001eac1cbd888676cfcd6fc`. The source hashes and diffs in the repair reports identify the subsequent changes. Final public notes remain in `docs/player/changelog/2026-10-20-build-controls.md`; the six unpublished bullets cover the UI behavior. The fixture clock correction is internal and needs no player-facing note.

## Corrections and checks

1. Fresh adversarial review found that correcting an invalid room-review name could commit the changes but cancel an ordinary Build exit. The regression reproduced both footer and exit-dialog failures. The repair cancels only pending tool destinations after a refusal. All 114 affected web tests, type checking, production build and compiled guide-reference verification passed. Scoped independent review approved the repair. Raw web test output was tool-only; its report identifies the commands, results, sessions and source hashes without claiming a saved raw log.
2. The complete local Python script run executed 267 tests in 1512.788 seconds: 264 passed and three process fixtures failed. Its raw local log remains unchanged; a normalized published copy is retained. A controlled startup delay reproduced all three fixture failures. A bounded readiness handshake and fixture-only observation clock repair passed the same delayed cases. All 39 affected runner tests then passed in 104.813 seconds, including cleanup controls and a separate unpatched production-controller deadline regression. Independent review approved the exact fixture source. Production code, deadlines, limits and result assertions were not relaxed. The full suite was not rerun or relabeled green.
3. All 31 guide, reference and changelog tests passed. Documentation IDs and scoped whitespace checks passed. Before the later main integration, rebuilt guide HTML matched the accepted capture bytes: SHA-256 `acf475ca444217343dd84d2a4e3bce68f1cc0d46835a7ebb6b049918b027a4ca`.
4. The remaining desktop light and 390-pixel phone light/dark captures passed direct pixel inspection and fresh independent visual review. Reading and native numerical disclosures worked with JavaScript disabled. The earlier desktop dark capture retains its original dimensions and attribution. Capture receipts distinguish these static-guide checks from prior game acceptance.

## Integration with current main

Main advanced to `834227d882e60885654646742951976d91928880` during delivery. The integration preserves its Walls, Windows and Floors changes and published October 19 notes. Native/content files match that incoming main exactly. The guide combines wall-height, range and area instructions with this release's footer exits, Land decisions and review Back behavior. Source review approved the integration before source fingerprints were refreshed.

The normal Wasm rebuild passed in 3 minutes 27 seconds; its SHA-256 is `6d2056436f29254f22ce4dbea82721e71078daae2207c288792c10bbba3e0234`. Type checking, all 413 overlapping web tests, all 31 guide/changelog tests, compiled-reference refresh and the production build passed. The production build took 38.89 seconds. The earlier Python repair evidence remains valid because incoming main did not change those helpers.

Eight current game/guide PNGs were inspected directly and accepted by an independent reviewer. The actual game ran in a displayed Chrome 155 window through the provided Playwright tool. Its clock advanced from 00:03 to 00:04, then remained paused through the checks. Footer Confirm committed a room name and exited; Keep building retained the pending room draft; footer Cancel discarded that draft and exited. The successful receipt records no page errors. Its browser and context closed in `finally`.

An earlier verification attempt used a button locator for speed controls that are radios; its failure receipt is retained separately. Cua's page attachment failed independently. The task-owned Cua tab was closed through documented tab management, and an exact-origin tab query returned no matches. The working Playwright route does not establish that Cua was repaired. The static guide remained readable without JavaScript, including the combined wall-height, floor-area and exit instructions. All task pages and the task preview server were closed afterward.

The public guide's Walls image pair now shows the integrated Low/Full height controls and footer. Historical returned-Walls images remain unchanged, with their original source attribution. Other screenshot groups that incoming main marked for refresh retain that explicit status; these checks do not claim to refresh every unrelated upstream guide image. The `main-834/` records identify the current integration's captures, reviews and checks.

## Evidence limits

The original failing fixture transcript is retained. Its initial JSON trace was overwritten during diagnosis; the retained JSON is explicitly post-repair. The controlled delay demonstrates the fixture race; exact startup durations from the uninstrumented full run are unknown. These timings are not native mutation-capacity measurements.

Actual hosted Linux interruption/recovery qualification, native admission and exhaustive production mutation coverage remain unproved. Earlier hosted planning correctly refused different runner images. The owner's later local-check authorization removed that remote campaign as a merge gate; it did not convert local tests into hosted coverage. Existing runtime identity checks and mutation policies remain intact. No container redesign was implemented.

This evidence does not establish physical touch, operating-system held-repeat, an actual naturally clipped activity popup, arbitrary malformed private-save compatibility or a completed land purchase. No videos, trace archives or private saves are included. `retained-files.json` records original and published hashes. PNG copies are byte-identical; published text converts CRLF to LF. Raw local logs remain unchanged.
