# Character creator release verification, 2026-10-15

This record covers local release checks against main revision `e999fdf8f496756b16ddd1670e77b922c924cc0b`, including the fresh reviews before publication. The owner authorized local checks and independent review in place of duplicate GitHub checks. Publication still requires the existing GitHub Pages build and deployment.

## Independent findings and repairs

1. Sparse relationship patches cleared relatives omitted from the patch. Native application now visits submitted pairs only. Explicit removal still clears the submitted pair. The regression tests cover inverse relationships, absent relatives, rejected transactions, and unchanged simulation randomness. See [native evidence](native/sparse-relationship-patches.md).
2. Removing and reselecting a condition within an unapplied draft lost its severity and position. The draft now retains the latest selected condition value and ordering. Reset discards retained values only within its scope; Undo restores them. Removed conditions are not retained after committing and reopening. See [creator evidence](creator/condition-toggle.md).
3. Git text conversion could change hash-bound authoring inputs and a golden fixture. Explicit byte-preserving attributes protect those files. Working files, staged blobs, and an exported Git tree were compared. The exported tree passed the asset verifier. See [byte checks](staged-byte-check.json), [golden checks](golden-byte-check.json), and [fresh-checkout verification](fresh-checkout-assets.json).
4. Final release-note review found the dish-position correction missing from the player changelog. The dated entry now explains that dishes stay where the meal was eaten.

The field-level Reset suggestion was checked against the approved control layout. The interface provides section and whole-character Reset; the draft API also supports field Reset. The specification now distinguishes those scopes explicitly. No additional control was added to each row.

## Completed local checks

| Command | Result | Receipt |
| --- | --- | --- |
| `cargo fmt --all -- --check` | PASS, exit 0 | [format](native-format.log) |
| `cargo clippy --workspace --all-targets --locked -j1 -- -D warnings` | PASS, exit 0 | [lint](native-clippy.log) |
| `cargo test --workspace --locked -j1 -- --test-threads=1` | PASS, exit 0; 2,170 tests passed; one optional private-path example ignored | [native tests](native-workspace.log) |
| `npm --prefix web test -- --maxWorkers=1` | PASS, exit 0; 247 files and 3,265 tests | [web tests](web-full.log) |
| Ten `python -B -m unittest discover -s <asset directory> -p 'test_*.py'` suites | PASS, exit 0; 533 tests | Individual `assets-*-tests.log` files in this directory |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm -- --locked -j1` | PASS, exit 0 | [WASM build](wasm-build.log) |
| `python assets/sprites/gen/build.py --check` | PASS, exit 0 | [atlas reproducibility](atlas-reproducibility.log) |
| `npm --prefix web run typecheck` | PASS, exit 0 | [type check](typecheck.log) |
| `npm --prefix web run build -- --outDir ../.local-build/merge-20261015/web` | PASS, exit 0 | [site build](web-build.log) |
| `node --test --test-concurrency=1 scripts/build-changelog.test.mjs` and `node scripts/build-changelog.mjs .local-build/merge-20261015/changelog/index.html` | PASS, both exit 0; 12 tests | [tests](changelog-tests.log), [notes build](changelog-build.log) |
| `python -B check-doc-ids.py` | PASS, exit 0 | [documentation identifiers](doc-ids.log) |
| `python -B -m unittest discover -s .github/scripts -p 'test_*.py'` | PASS, exit 0 | [workflow guards](workflow-guards.log) |
| Six `cargo tree --locked` queries for core, data, and simulation on native and WebAssembly targets | PASS, exit 0; no browser dependencies | [dependency results](architecture-dependencies.json) |

The web suite used one worker and a 4 GiB JavaScript heap limit. Native tests used one test thread. Asset suites, tests, and builds ran sequentially in one heavy local verification lane. No dependency versions changed.

The site build reports existing large-chunk, ineffective dynamic-import, and asset-plugin timing warnings. No warning limit was raised to obtain a passing result.

The final [source snapshot](source-freeze.json) passed Git's whitespace check without changing the live index. It records Git blob identities for the changed native and web source files; those identities can be checked against the delivered commit independently of later receipt additions. A [credential-pattern scan](final-secret-pattern-scan.json) inspected 1,350 changed text files in that Git tree and found no matching credential patterns. This is a bounded pattern check, not a comprehensive security audit.

## Mutation and restoration

The installed mutation tool deliberately changed the cleanliness response in an isolated exported checkout. All 18 mutations were caught; none survived or timed out. This targeted check is not a claim that the exhaustive remote mutation sweep ran.

Command: `cargo mutants --in-place --file crates/terri-core/src/cleanliness.rs --test-package terri-core --baseline skip --timeout-multiplier 4 --minimum-test-timeout 120 --build-timeout 600 --cargo-arg=--locked --cargo-arg=-j1 --cargo-test-arg=--test-threads=1 --output <evidence>/cleanliness-mutations`.

The full native suite established the unchanged baseline before this run. [Mutation outcomes](cleanliness-mutation-outcomes.json) preserve the individual cases. [Restoration hashes](cleanliness-mutation-restoration.json) prove the working source, isolated source, and staged source match after the run.

## Visual evidence scope

The [main-integration evidence](../2026-10-14-main-integration/README.md) and [long-sleeve evidence](../2026-10-14-long-sleeves/README.md) contain actual browser captures, four-facing garment comparisons, known-defect rejection, and the prior desktop measurement. The owner accepted the visual direction before authorizing this delivery. The shipping review changed relationship application and condition draft retention; it did not change model geometry, shading, or rendering behavior.

The earlier measurement covered six visible people and two animated previews on the recorded desktop. It does not establish phone performance. Sampled garment frames establish their recorded settings and phases, not continuous video coverage of every possible combination. Previously accepted minor chair contact overlap remains accepted.

The release build also passed [13 desktop browser checks](built-browser/desktop-02/report.json) and [14 independent creator checks](creator-final/pass-01/report.json), including actual player Save and browser reload. The independent [visual record](creator-final/visual-review.md) identifies each inspected image. The coordinating reviewer inspected the loading cover, activity defaults, trait limit, reading registration, created household, condition editor, saved Review, narrow Review, and six-person scene directly.

The first desktop script attempted a selected condition while its disclosure was closed. That harness failure remains in `built-browser/desktop-01/`; the corrected script opens Conditions before visiting its controls. The rerun passed without an application change.

The [release-candidate performance measurement](performance/README.md) records the workload, allocations, cold initialization, and every frame above the desktop target. Its renderer and simulation are unchanged by the subsequent input-layout repair.

## Numeric-field review and final build

Direct inspection found saved percentage text clipped by the number input. A wider input initially crowded a tablet layout, and the first wrapping repair still failed in the actual 320-pixel dialog. Stronger checks then caught button text escaping its border at intermediate widths. These failures remain preserved rather than relabeled as passing evidence.

A fresh adversarial architecture review identified two constraints: the numeric group needs intrinsic wrapping, and the complete field must respond to its editor's available width. The final stylesheet uses an editor container query and intrinsic button widths. It preserves complete numeric text and saved precision. The [repair record](creator-final/percentage-layout-fix.md) distinguishes the standalone fixture from actual-game verification.

The final build passed the four focused creator suites, 27 tests, with one worker, and its production build exited 0. See [focused checks](container-focused-tests.log) and [build](container-build.log). Its JavaScript and WebAssembly payloads are byte-identical to the measured candidate; the entry filename changes with the stylesheet dependency.

The [actual final creator run](creator-final/pass-container/report.json) passed 30 checks with no diagnostics. It exercises seven viewport widths in both lock states, complete percentage and button text, containment, editor overflow, exact condition bits and ordering, Apply, player Save and browser reload, hidden-preview creation, and Reset/Undo. The [visual inspection](creator-final/container-acceptance.md) records every captured image. The coordinating reviewer also inspected the 320, 761, 1051, and 1440-pixel locked views directly. The [independent cross-review](width-cross-review.md) preserves rejection of the original defect alongside the repaired judgments.

The requested local server remains on [port 5190](http://127.0.0.1:5190/). [Final installation checks](local-delivery-container.json) verify every incoming build file and the served entry assets, retain previous hashed assets, and confirm that no owner page or browser storage was accessed.

The independent reviewer also operated the final built game directly in a separate, displayed, muted browser. That run passed 25 checks with no diagnostics, including all seven narrow-screen sections, both lock states at 1440, 761, and 320 pixels, and a Review/Apply/reopen edit preserving exact native condition state. The reviewer inspected its ten captures. See [independent actual play](width-cross-review.md). Both that browser and its task-owned preview server closed afterward.

The [built changelog check](changelog-browser/report.json) verifies fresh-storage dark mode, both themes at 1440 and 390 pixels, the new dated entry, and the dish-position note. Both reviewers inspected all four captures. Text, headings, save consequences, and update links remain readable without clipping or horizontal overflow. Its browser and separate preview server also closed.

## Evidence publication

The owner excluded every review video from delivery. Five WebM files, totaling 47,342,401 bytes at their paths, were removed from the candidate; two paths contained the same bicycle recording. Four newly added animated GIF review loops were also removed. No inspected ZIP archive under `docs/` contained a video. Screenshots, measurements, and written findings remain available. The routine sleeve capture no longer requests video recording. Repository instructions, ignore rules, and the testing protocol prohibit committing recordings, including converted animation loops and recordings hidden inside archives.

The three new sleeve video objects had already been uploaded before this correction, without any branch reference. Two older bicycle paths existed on the feature branch and are deleted in the final candidate. Delivery uses a squash merge of the video-free candidate; the rejected artifact history is not merged into main. This evidence cleanup changes no game behavior and requires no player changelog entry.
