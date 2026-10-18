# R7 room interface checkpoint

R7 now uses the native Build transaction for room selection, names, grouped review and deferred exit. The implementation is ready for the parent's fresh code review and R8 integration. It is not final branch acceptance: the last complete web run found one stale test assertion, subsequently repaired and checked in the bounded suite; final broad gates must include the documented post-run changes. Natural browser hide/save/return remains unverified, with no demonstrated product defect.

Work started on 2026-10-17 and finished on 2026-10-18 Pacific time, from base `567736449842f60c562fd459e35a927a01a6138d`. No Rust, native content, generated Wasm, dependencies or target configuration changed. The module remains SHA256 `6c0562aca59fe17b20000845ebeddb71337859b2b39bd8e212a10ec5ab3154c1`.

## Behavior and ownership

1. `BuildSession` delegates Begin, semantic dirtiness, preparation, adoption, Cancel, End and public save bytes to native code. The browser byte baseline is removed. Existing command settlement remains bounded and consumes the native error channel. Successful Load clears local selection, raw names, review and exit continuation; rejected Load retains them.
2. Rooms defaults to Select rooms and retains Build room as the original rectangle controller. All six destinations remain. Floor selection precedes furniture/books only in selection mode; deferred GPU picks reject a changed tool mode. Native summaries, membership and exact bigint revisions drive selection, highlights and literal name markers. Dropdown labels include native area and anchor context, including Outside ID 0.
3. Raw per-room text survives selection/tool/mode changes. Validation rejects raw controls and lone surrogates, uses Rust Unicode whitespace and counts 1-48 scalars after trimming. Enter and composition remain inside the field. Invalid local text blocks Confirm and contributes to exit dirtiness.
4. Review keeps explicit names and native eligible inheritance choices separate from proposed names. Changed choices require a new native preparation and a second confirmation after displaying its results. Back retains choices but discards the token. Reopening obtains a fresh token, even when a wall reversal leaves no native groups. Choices without a new authoritative target remain visible for explicit removal. No browser matching or provisional identity allocation was added.
5. The existing `BuildExit` owns deferred exit. Footer Confirm and Cancel keep paused Build open. Explicit Exit Confirm leaves once only after native adoption. Back, refusal, Load and graphics dismissal cancel exit intent. Review blocks editing while preserving camera input. Lost-enclosure review shows native former tiles/openings, Outside membership area and the actual receiving floor duty, including unchanged owner 0, unassigned and absent-duty cases.
6. Rename-only confirmation refreshes existing chore labels without changing their assignments. The valid-target furniture-sale regression now keeps its refusal after the generic lot refresh; placement and recoloring feedback remain intact. Its test retains one joined drain, no tick, native receipt/no-error and strict V16 load/resave controls.
7. Room scroll bodies reserve 6px for the 4px painted focus outline, using the same clearance as the existing scroll margin. The narrow visual-viewport sizing and focus-preserving viewport callback were verified in desktop browser simulations. The final clearance repair changes CSS only.

Help, shortcut labels, string inventory and the two affected specs were updated. The pending-wall guidance is now the approved unconditional sentence. No object descriptions, model names or unrelated copy were rewritten. Parent owns the combined public changelog and delivery.

## Tests and boundaries

The command logs remain in ignored `.local-build/`; [receipts](command-receipts.json) retain their hashes, exact reported summaries and cleanup. Tests used one worker and `NODE_OPTIONS=--max-old-space-size=4096`. Source manifests hash the actual working-file bytes used for execution; Git normalizes text line endings. Retained textual evidence is normalized to LF, while raw ignored logs keep their original byte hashes.

| Check | Recorded result |
| --- | --- |
| Initial test-first controls | Native Begin assertion failed, valid interactive object 22 sale status failed, and absent selection/review modules failed import. Later focused red controls caught stale async picks, paused chore labels, empty-group retained-review bypass and missing Outside destination text. These distinct failures are not relabeled as successful runs. |
| First full web command | `npm --prefix web test -- --maxWorkers=1 --reporter=default --reporter=../.local-build/web-progress-reporter.mjs`: exit 1 after 584.16s; 269 files, 3691 passed, 9 failed across 6 files. Source stayed fixed. The during-run manifest is explicitly not a pre-run capture. |
| First full-run failures | Buy/Room/Wall source assertions expected old composition; floor-scene 4 and instance-batch 1 lacked new review bindings; game-version expected Options attribute order already changed in the base. Existing functional assertions were retained, and active selection/review highlight controls were added. |
| Second full web command | Same command, exit 1 after 574.35s; 270 files, 3721 passed, 1 failed. Before/after fingerprint is exactly `85653bd5d78e1554067327d71a2e3118fdfbb9fdbab8171cb04fa46d868d657d`. The sole failure was the Options source regex requiring Close immediately before focus, omitting the necessary visibility render. |
| Page-binding replacement | Existing TypeScript AST tooling executes complete actual Rooms/tool-array/BuildExit/canvas bindings and contiguous frame blocking. Six isolated in-memory faults are rejected by behavioral assertions, with [exact receipts](wiring-faults.jsonl). No live source mutation or new production test API. |
| Final bounded suite | `npm --prefix web test -- --maxWorkers=1 tests/room-review.test.ts tests/options-menu.test.ts tests/main-build-wiring.test.ts tests/build-exit.test.ts tests/build-session.test.ts tests/room-selection.test.ts`: exit 0, 134 tests across 6 files. This follows the Outside repair and complete exit-hook test replacement, and precedes only the final CSS clearance repair. |
| Type/build | Typecheck passed after the Outside repair. Web build exited 0 in 15.10s before the CSS-only clearance repair; existing large-chunk, ineffective dynamic-import and asset-plugin timing notices remain. These are not claimed as final-source broad gates. |
| Final CSS verification | Actual browser clipping measurements, screenshots and isolated style faults passed on CSS SHA256 `897f6c872f289145f2addad3d857dfae55b4568b4d9a72381518313b308c6038`. R8 owns the final suite/type/build covering it. |

The [post-run delta](post-full-run-delta.json) is exactly `build-controls.css`, `room-review.ts`, `options-menu.test.ts` and `room-review.test.ts`. [Checkpoint source](checkpoint-source.json) fingerprint is `b2403f54660a19a51252f86a3516d49aaf5ea372401c508ce0adc2c4a6b1cbe4`. Final broad web/type/build gates remain with R8; neither complete red run is called green.

## Actual game and visual evidence

Headed Chrome 155.0.8059.85 ran only task-owned sessions on port 5193. The expansive V16 setup came from the unchanged `.local-build/r6-room-play-current16.sav` and its authoritative R6 receipt. Its artificial funds are play setup, not a compatibility fixture. Original historical saves were untouched.

Actual controls exercised literal rename, Enter isolation, tool switches, invalid text, repeated Confirm, Cancel after a confirmed batch, split review, retained Back/reopen text, duplicate names, merge name selection independent of identity, enclosure loss/Show opening, manual Save/Load, west expansion/Cancel, north expansion/Confirm and later name cancellation. West and north purchases were tested separately because the funded setup could not afford both in one batch. Combined native translation coverage remains in accepted R6 evidence and R8 integration.

The browser pointer helper imports production projection/client/inverse/nearest-edge functions. Its old half-height 16 calculation fails the negative control; six matching native receipts and the resulting 24+24 Split establish the repaired real-input route. The first three failed coordinate attempts remain described in the [fresh review](wall-probe-review.md). No renderer correction was made. A later harness replay missing cached setup failed separately; the retained self-contained split sequence removes that dependency.

Manual Save during a name draft produced committed V16 bytes that a separate native handle strictly loaded. Actual Load retained native Build and cleared local selection. Graphics recovery retained the same bridge and draft. A task-only adapter refusal exposed the actual Retry graphics control; after restoring the adapter, Retry preserved the review. Confirm afterward stayed in Build because recovery had cancelled the earlier exit intent. A subsequent clean Exit focused `build-toggle`.

| Selected image | Inspection and identity |
| --- | --- |
| `landscape-before.png` | First frozen-source 740x390 defect: only 9px remained for the tool body. |
| `landscape-after.png` | Intermediate vertical repair, before the final inline-gutter correction. Retained history, not final all-edge proof. |
| `review-desktop.png`, `review-phone.png`, `review-landscape.png` | Inspected actual split review at 1280x900, 390x844 and 740x390. Literal field text, native area/owner rows, scrolling and fixed actions are visible. These precede the last CSS gutter adjustment. |
| `lost-before.png`, `lost-after.png` | Same native opening/camera request at 1280x900. The corrected image shows Outside 500 -> 548 membership tiles and Casey's retained floor duty alongside Bill's retiring duty. Lighting/time differ; the finding concerns review text. |
| `enlarged-text.png`, `forced-colors.png` | Desktop simulations at 390x844. Text was increased to 24px for the former. The latter has verified forced-colors active, black text on white system backgrounds, and a visible system focus outline. |
| `selection-gutter-before.png`, `review-first-gutter-before.png` | Current-source measurement before the last CSS change confirms 1px inline/top outline clipping. |
| `selection-clearance-v3.png`, `review-first-clearance-v3.png`, `review-last-clearance-v3.png` | Unique 390x480 captures on the final CSS. Focused painted bounds fit all four client clipping edges, with identical measurements before and after each screenshot. Independently inspected and accepted for these visible states. |
| `selection-restoration-v4.png` | Fresh-session causal replay on unchanged final CSS. Three clean frames fit, three zero-margin fault frames fail, and three restored normal-focus/observed-viewport frames fit. The final image's pre/post geometry is identical. |

I inspected the retained images myself. The parent's fresh [visual review](independent-visual-review.md) rejected the known defective state, accepted the current visible states and accepted the final restoration followup. Physical phone keyboards were not tested; reduced viewport and pinch/text checks are browser simulations.

The original v3 receipt records `restored.fits=false`. My earlier claim that restoration passed was wrong: I trusted a preceding wait instead of the returned measurement. It remains unchanged in [focus/visibility results](focus-and-visibility-results.json). The fault changed scrollTop 97 to 91. The fresh v4 replay records actual viewport events and normal keyboard focus, returning to 97 with three stable contained frames. It does not prove the earlier resize-coalescing hypothesis. Lessons learned records this reporting correction.

## Remaining proof and cleanup

Natural visibility saving remains unverified. Tab selection/activation and one fresh reviewed minimize/restore control emitted no visibility event or saving status. The latter issued commands to disable focus emulation on the task target and minimize its verified task-only window once, used a 10-second failure boundary, and issued bounds/emulation restoration commands in finally. No minimized-state readback or effective-emulation measurement was obtained. A later window-state readback confirmed the original normal bounds. No synthetic event or unchanged-file equality is labeled proof. This is an open browser-trigger acceptance gate, not evidence of a product defect. See the [fresh visibility review](visibility-review.md) and retained result.

Both task-owned Chrome sessions were closed. Their verified Vite servers on 5193 were stopped in finally; zero listeners remained. Parent server 5189 and other tasks' resources were untouched. No videos, trace archives, dependency changes, push or merge were made.

Self-review checked native authority, exact tokens/revisions, ID 0/person 0 handling, literal text, review/exit continuation, old-name versus explicit-name choices, namespace-specific duties, wrapper construction predicates, keyboard isolation, paused chore redraw and save/load boundaries. Parent's fresh code review, R8 complete integration, outdoor physical cleaning and final broad gates remain separate.

**Next steps**: Parent reviews the committed R7 checkpoint and runs R8 on the resulting source. No user action is needed for this checkpoint; a later natural hide/save/return observation remains an explicit acceptance item.
