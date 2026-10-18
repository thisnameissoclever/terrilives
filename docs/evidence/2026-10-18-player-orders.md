# Player-order integration verification, October 18, 2026

This record supersedes the October 17 verification for delivery. The earlier record describes the isolated implementation before published conversation and room saves were integrated. The [approved specification](../specs/2026-10-17-player-orders.md) defines the behavior.

The current save format is V17. It contains the published V16 room envelope and V15 conversation envelope, followed by player-order ownership and attendance. Frozen older readers keep their original reference interpretation. Current bare-actor snapshots explicitly identify their saved-agent reference space; the loader does not guess from coincident numeric IDs.

## Integration checks

The native workspace was compiled once, then its test executables were run sequentially with four test threads. Cargo used two build jobs and disabled test debug information. Browser tests used one worker and a 4 GiB JavaScript heap limit on the shared Windows desktop.

Final results and source/artifact hashes are in the [delivery manifest](2026-10-18-player-orders/delivery-manifest.json). The final source revision is `135c97017`; earlier comparison measurements identify their original revision in the manifest. Earlier failed integration runs are retained as diagnostic evidence and are not counted as passing commands. Published V15/V16 fixtures, current V17 round trips, Build freezing, whole-activity handoffs, strict invalid-save rejection, and the published golden simulation hash were checked.

The full browser suite and its targeted retakes exercised every repository case. The final rebuilt-WebAssembly subset covers player orders, confirmations, queue rows, diagnostics, persistence, Build, and current startup. Type checking, Clippy, formatting, production compilation, changelog tests and documentation identifier checks passed. Five targeted native mutations were detected, then their original source bytes were restored before the final checks. The mutation run is narrower than the repository's remote mutation sweep.

| Final check | Observed result |
| --- | --- |
| Native workspace, all 23 compiled test executables | 2,579 passed; one existing private-save example ignored |
| Simulation library | 1,724 passed |
| WebAssembly wrapper library | 321 passed |
| Current rebuilt browser subset, 80 files | 1,060 passed |
| Initial full browser run, before fixture repairs | 3,755 passed; 14 failed. All failures passed their corrected focused retakes; the final current subset includes the affected files. |
| Rust Clippy and formatting | Passed |
| Browser type checking and production build | Passed; existing bundle-size/import warnings remain |
| Changelog and branding | All 17 tests and changelog build passed |
| Documentation identifiers and Rust documentation tests | Passed |
| Targeted mutations | All five caught; original source restored before final gates |

## Played review

Displayed Chrome used the Windows desktop's NVIDIA adapter, not a fallback adapter. Desktop was 1440 by 1000 pixels. Phone was a 390 by 844 pixel touch-emulated viewport; this is not physical-device evidence. Phone zoom and conversation menus used actual two-finger and long-press input. Screenshots were inspected by the implementer and a fresh independent reviewer.

1. Bill's queue shows a distinct Incoming caption, direction, Casey as counterpart, and the initiating order's phase. It retains Bill's current exercise activity.
2. A single work dialog lists Tim and Bill, their remaining and total shift hours, pay and performance consequences, and Proceed/Cancel. Cancel preserved gameplay bytes and restored focus. Proceed submitted once, recalled the workers through normal travel, and completed the conversation while the original shift remained open.
3. Invalid object action 9999 produced one terminal failure for that new order, retained the earlier conversation, printed one console warning, and displayed Casey's readable failure reason. The paused simulation tick remained unchanged while the squiggle expired after approximately three real seconds. Waiting and intentional cancellations did not cause this effect.
4. Copy matched the displayed selected-person history. The check used a browser-local clipboard sink; it did not overwrite the operating-system clipboard.
5. Actual Options Save and Load restored byte-identical V17 gameplay at tick 360 after play had advanced to tick 363. Five subsequent startup reloads of an explicitly completed save also succeeded.
6. Tim's older exercise orders delayed departure without retrospective confirmation. After cancellation, he resumed the original shift. The career panel showed 197 of 480 minutes worked, 283 missed, base performance 30.4, attendance deduction 27.17, final score 3.23, and $49.25 earned. Commute time accounts for the difference between the 190-minute delayed departure and 283 total missed minutes.
7. Entering Build, canceling the provisional batch, and leaving Build preserved the tick, queue identities and diagnostic history exactly.

The independent review explicitly rejected a matched missing-squiggle image before accepting visible feedback. It also caught phone feedback overlapping the Build controls and full history extending past the viewport. Those findings were repaired and reviewed again; the final review receipt identifies the accepted captures.

## Diagnostic cost and determinism

The native workload measured admission of 32, 256 and 1,024 orders, capture/cancellation of 2,048 orders, incremental reads, and full-history copying. Five capture-enabled and five capture-disabled admission trials retained identical gameplay hashes for each paired workload. A separate 300-tick comparison also retained identical gameplay hashes. The measured capture/cancellation time was 302.954 ms; empty and full incremental tail reads averaged 0.194 and 8.913 microseconds, and copying the full retained history averaged 422.037 microseconds on this shared desktop.

The browser filled the native ring through 1,025 public order/cancel pairs, rendered 2,048 retained events plus the explicit expiration notice, and alternated three displayed/hidden trials of 45 frame intervals after warmup. Gameplay bytes remained unchanged. Raw samples are retained. Shared-host frame intervals include ordinary game rendering and other workloads; neither set of timings isolates diagnostic overhead or establishes a frame-rate guarantee.

## Separate storage observation

Reloading a fresh page before its first background save had committed exposed an existing zero-byte OPFS slot. OPFS is the browser's origin-private file storage. The current live V17 snapshot validated, and a delayed or explicitly completed save loaded successfully. The writer and visibility-save handler were unchanged from main. The existing persistence design documents visibility saving as best effort because unloading can interrupt an asynchronous write. The likely interruption window is between creating the first file entry and committing its bytes; the exact scheduling point was not observed. No previously committed valid slot was observed being corrupted. This task preserves strict rejection and recovery behavior rather than changing the storage protocol.

All task-owned game pages close in finally blocks. The task-owned preview server is stopped after local review. Review videos are not retained.
