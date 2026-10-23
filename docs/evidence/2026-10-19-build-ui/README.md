# Build UI integration verification, October 19, 2026

The application at `ce0637d7185be4dab9b148ded60d8ccf5f03dce2` combines the Build/status/dock changes with main `a15d543d6f3077c9760e16b5b695514550c781e7`, including automatic beds, weather and changelog presentation. The later executor commit changes only CI helper code. [verification.json](verification.json) records both revisions and the release WebAssembly digest.

The normal release WebAssembly build, type checking, all 3,843 web tests in 279 files, and the production build passed. The 12 changelog tests, changelog generation and document-ID check also passed after integration. A fresh [source integration review](integration-review.md) found no defects in the combined code. The adjacent logs retain the actual commands and results; production build warnings remain visible.

The text logs use LF line endings and omit trailing whitespace and blank final lines. The receipt records both original and retained byte digests. The original local logs remain unchanged.

This is historical version-18 source and automated-test evidence. The [subsequent version-19 record](v19/README.md) contains the rebuilt application checks, actual Chrome captures of the 390px dialog, 390px dock, 434px dock and Back-returned Walls state, and fresh independent visual acceptance. The earlier in-app browser captures with distorted geometry remain rejected. Physical touch and operating-system key repeat remain unverified. No PR 300 merge, deployment or live-game verification is claimed here.

The [version-20 record](v20/README.md) covers the later current-main merge, complete web suite, refreshed played pass and fresh independent visual review. It preserves the preceding records at their original source boundaries.

The [background-play integration record](d59d/README.md) covers the subsequent web-only main contribution, refreshed complete web checks, played pass and matching compositor captures. Earlier evidence retains its original source and execution boundary.

[annotation-closeout.md](annotation-closeout.md) answers the five earlier room-review questions from current source and retained room-feature evidence. It is a read-only audit with explicit historical-save and test-maintenance limits, not a new historical-save test run.
