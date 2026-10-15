# Main integration and creator repairs

The locally served build incorporates main at `e999fdf8f496756b16ddd1670e77b922c924cc0b` and preserves the worktree's creator and rendering changes. A final fetch found no newer main commits. The running review URL is [http://127.0.0.1:5190/](http://127.0.0.1:5190/). Nothing was pushed or published remotely.

## Behavior delivered

1. The loading cover appears with the first HTML before game scripts arrive and remains until the game is ready.
2. Reset uses fixed defaults, including activity preferences of 1.0x. New characters still begin randomized; existing people preload stored values. Undo preserves the exact prior draft and its random-generator state. The runtime specification documents reset scope and hidden legacy values.
3. Walking is the initial preview animation and plays automatically unless reduced motion is requested.
4. Long sleeves use continuous shoulder-to-wrist geometry and authored coverage for the skin beneath them. Unaffected rolled, short, and bare-arm comparisons remain identical. The accepted rig is unchanged.
5. Narrow-screen creation and editing work while the optional preview remains closed. Required preparation is separate from drawing, and stale preparation/draw errors cannot replace the current draft's readiness.

## Preservation and integration

Before the fast-forward, `.scratch/main-integration-20261014/working-files.zip` preserved 7,227 working files, including untracked assets and proposals. Its verified SHA-256 is `5d0dc312c4828eba9f2a9d9c49edb6552cefd19e03344c6b6758f4334e02d0b0`. The tracked patch, per-file hashes, collision copies, and original state remain beside it. The backup stash is retained at `refs/backup/character-main-integration-20261014`, pointing to `0fcbe5c52d4e98e774f870f080893f820b50027d`. The integration preservation audit checked 7,143 untracked files without errors.

All seven textual conflicts were resolved. Semantic integration checks also repaired conversation-indicator coverage and tint, prepared Load adoption through BuildSession, and appended depth-page allocation validation. Their original failing assertions remain in `integration-red.log` and `integration-tint-red.log`.

Published social saves and unpublished creator saves had independently used version 9 for different layouts. The combined writer uses version 10 and retains both frozen historical readers. Complete decoding and validation must identify exactly one valid historical layout before adoption. Browser storage retains exact original version-9 recovery bytes. See [save integration receipts](../2026-10-14-visual-review/save-integration/verification.json) and [independent migration review](../2026-10-14-visual-review/save-integration/independent-review.md).

Main also repacked sprite sheets. [Exact source-region revalidation](atlas-revalidation/comparison.json) covers all 184 dependent sprites and proves the existing depth coverage remains valid. [The provenance refresh](atlas-revalidation/refresh.json) changes only two manifests' recorded atlas/source hashes. All 11 generated companion pages remain byte-identical. Old manifests and their hashes are retained beside the receipt; obsolete sheets were not restored to suppress failures.

## Verification

All commands used one local test worker. Failed receipts remain available.

| Check | Result and evidence |
| --- | --- |
| Native library suites | 2,129 unique tests covered successfully. The initial run had one stale version assertion; its corrected targeted rerun passed. [Receipts](../2026-10-14-visual-review/save-integration/verification.json). |
| Four native data integration targets | PASS, exit 0, 34 tests. `cargo test -p terri-data --test bathroom_layout --test book_content --test content_hierarchy --test inherited_runtime --locked -j 1 -- --test-threads=1`. [Log](native-integration.log). |
| Migration example | PASS, exit 0, four tests. One existing optional test requires a private save path and was skipped. `cargo test -p terri-wasm --example migrate_chores_preview --locked -j 1 -- --test-threads=1`. [Log](native-example.log). |
| Documentation tests and native lint | Both commands exited 0: `cargo test --workspace --doc --locked -j 1 -- --test-threads=1` and `cargo clippy --workspace --all-targets --locked -j 1 -- -D warnings`. No documentation test cases were defined. [Docs log](native-doctests.log), [lint log](native-clippy.log). |
| Full web suite | Initial run: 245 files passed; two failed on three stale save-version expectations and two missing atlas provenance paths. [Full receipt](web-full.log). After correction and a new provenance assertion, both affected files passed all 121 tests. [Rerun](web-repaired.log). |
| Narrow-preview repair | The original gate and stale Undo error were rejected by regression tests. Final focused run: five files, 42 tests, exit 0. [Accepted log](narrow-readiness-accepted.log), [repair review](narrow-readiness-review.md). Across the full run and relevant reruns, all 247 current files and 3,257 current tests are covered; passing unrelated suites were not repeated. |
| Python geometry and complete asset verification | Six unittest cases passed, and `python assets/models/sims/character-repair/verify_assets.py --output docs/evidence/2026-10-14-main-integration/atlas-revalidation/asset-verification.json` exited 0. [Unit log](python-tests.log), [asset receipt](atlas-revalidation/asset-verification.json). |
| Final type check and build | `npm --prefix web run typecheck` and `npm --prefix web run build -- --outDir ../.local-build/main-integration-20261014/accepted-web` exited 0. [Type check](typecheck-accepted.log), [build](build-accepted.log). The build retains large-chunk and ineffective-dynamic-import warnings; no dependency or warning-threshold changes were made. |
| Browser persistence | Four independent scenarios passed 89 checks, covering both historical formats, exact backups, creation/editing through Save/reload, nonzero skill progress, and active Build Load/Cancel/Exit. [Report](creator-save/report.md). |
| Final built desktop and narrow flows | 13 desktop and 11 narrow checks passed. A fresh reviewer inspected all ten images and completed creation/editing with the preview hidden. [Final review](built-review/review-final-2026-10-14.md). |
| Sleeve visual review | Both known defective variants were rejected blind. All four facings, representative tops/body extremes, and sampled walking, reading, and cleaning cycles were inspected. [Evidence and limits](../2026-10-14-long-sleeves/README.md). |
| Desktop performance | The 95th and 99th percentiles meet the 16.6 ms target; two of 1,798 combined frames exceed it, with a 27.50 ms maximum. Initialization costs and every slow frame remain recorded. [Measurements](performance/README.md). |

The save-browser harness initially failed on zero-practice normalization and a hidden exit selector. A fresh adversarial review changed it to independently reported scenarios with explicit UI-state assertions. [Harness findings](browser-harness-review.md) distinguish those failures from application defects. The later narrow-screen submission blocker was a real application defect and was repaired before local delivery.

The coordinating review independently inspected the repaired female standing sleeves in all four facings, male reading and broad-short cleaning views, sampled walking/reading/cleaning frames, the reset page, loaded gameplay, final loading cover, final reading preview, enabled hidden-preview Review, and the six-person performance scene. Independent visual records identify each additional inspected image. Sleeve motion evidence establishes sampled frames, not continuous video or every possible parameter combination. Narrow-layout evidence is desktop Chrome resized to phone dimensions; it does not establish phone performance.

## Local delivery

[The local installation receipt](local-delivery.json) verifies all 284 files from the accepted build, preserves the existing hashed assets, and checks the served HTML and entry assets over HTTP. The served main bundle is `index-c70F80k8.js`, SHA-256 `f42d226a5b797282059fe30a7166dfd68de67fb6b15f3431acad1424d9b98775`, matching the final browser review. The existing tab was not navigated or reloaded, and browser storage was not accessed during installation.

Task-owned verification browsers and temporary servers were closed. The requested review server remains on port 5190. The index was returned to its original unstaged state without discarding working changes; the backup reference remains intact. The maintained creator specification, edit specification, architecture notes, testing protocol, and lessons were updated. The owner's visual decision remains separate from the technical evidence.
