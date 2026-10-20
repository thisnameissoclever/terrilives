# Build UI release verification, October 20

The owner authorized relevant local CI checks and a fresh adversarial review in place of remote GitHub checks, followed by merge, deployment and live verification. This record covers the final local corrections and guide acceptance. Deployment and served-asset evidence is recorded separately after publication.

The reviewed base is `1cb7b7a3dcbbac856001eac1cbd888676cfcd6fc`. The source hashes and diffs in the repair reports identify the subsequent changes. Final public notes remain in `docs/player/changelog/2026-10-20-build-controls.md`; the six unpublished bullets cover the UI behavior. The fixture clock correction is internal and needs no player-facing note.

## Corrections and checks

1. Fresh adversarial review found that correcting an invalid room-review name could commit the changes but cancel an ordinary Build exit. The regression reproduced both footer and exit-dialog failures. The repair cancels only pending tool destinations after a refusal. All 114 affected web tests, type checking, production build and compiled guide-reference verification passed. Scoped independent review approved the repair. Raw web test output was tool-only; its report identifies the commands, results, sessions and source hashes without claiming a saved raw log.
2. The complete local Python script run executed 267 tests in 1512.788 seconds: 264 passed and three process fixtures failed. Its unchanged raw log is retained. A controlled startup delay reproduced all three fixture failures. A bounded readiness handshake and fixture-only observation clock repair passed the same delayed cases. All 39 affected runner tests then passed in 104.813 seconds, including cleanup controls and a separate unpatched production-controller deadline regression. Independent review approved the exact fixture source. Production code, deadlines, limits and result assertions were not relaxed. The full suite was not rerun or relabeled green.
3. All 31 guide, reference and changelog tests passed. Documentation IDs and scoped whitespace checks passed. The final guide HTML matches the accepted capture bytes: SHA-256 `acf475ca444217343dd84d2a4e3bce68f1cc0d46835a7ebb6b049918b027a4ca`.
4. The remaining desktop light and 390-pixel phone light/dark captures passed direct pixel inspection and fresh independent visual review. Reading and native numerical disclosures worked with JavaScript disabled. The earlier desktop dark capture retains its original dimensions and attribution. Capture receipts distinguish these static-guide checks from prior game acceptance.

## Evidence limits

The original failing fixture transcript is retained. Its initial JSON trace was overwritten during diagnosis; the retained JSON is explicitly post-repair. The controlled delay demonstrates the fixture race; exact startup durations from the uninstrumented full run are unknown. These timings are not native mutation-capacity measurements.

Actual hosted Linux interruption/recovery qualification, native admission and exhaustive production mutation coverage remain unproved. Earlier hosted planning correctly refused different runner images. The owner's later local-check authorization removed that remote campaign as a merge gate; it did not convert local tests into hosted coverage. Existing runtime identity checks and mutation policies remain intact. No container redesign was implemented.

This evidence does not establish physical touch, operating-system held-repeat, an actual naturally clipped activity popup, arbitrary malformed private-save compatibility or a completed land purchase. No videos, trace archives or private saves are included. `retained-files.json` records original and published hashes. PNG copies are byte-identical; published text converts CRLF to LF. Raw local logs remain unchanged.
