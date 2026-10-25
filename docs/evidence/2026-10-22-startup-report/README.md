# Bounded failure cleanup and retrievable startup reports

The original iPhone browser failures and the producer of the supplied 503 remain unidentified. This change fixes a separately reproduced loader hang and retains evidence for a subsequent affected-browser failure. No physical iPhone execution or recovery is established here.

## Reproduced defect and bounded repair

An unresolved `ReadableStream` cancellation held the old character reader open indefinitely. The new regression test fails against that implementation. The reader now requests discarded-body cleanup without awaiting it. A final unsuccessful response retains selected delivery headers and at most 1,024 body bytes; body reading waits at most one second. Existing three-attempt recovery, server-delay limits and successful-file hash checks remain enforced.

The local report records the last loading step before the game starts allocating its resources. The standalone report page reads the same browser storage without starting the game. An unfinished attempt is explicitly distinct from a confirmed crash. The failure card keeps its short status/path message and links to the report; full bounded delivery details remain in the saved error.

## Checked source and local checks

The final application source is `bd897f7bbf4bd7b82f5a0704c18a3ce86164718a`. The compiled entry is `assets/index-K5DO9-q4.js`, SHA-256 `19c79ef6a958cdcc0cf221877edc0c369b453c055e0257b82b0c9bbdb5821941`.

1. `npm --prefix web test -- --maxWorkers=1 tests/character-asset-download.test.ts tests/startup-diagnostics.test.ts tests/startup-failure.test.ts tests/startup-loading.test.ts` passes 48 tests. The tests cover unresolved cleanup, bounded body reading, truncation, retained delivery metadata, excluded credential headers and query strings, limited local history, storage denial, standalone retrieval and short failure-card text.
2. TypeScript checking and the production build pass. Both standalone scripts pass Node syntax checking. Documentation IDs and the player-reference source review pass. Thirty-three public-documentation tests pass, including the changelog tests; changelog and guide generation pass. Readiness recording runs immediately after the actual scene draw and waits for queue completion. It remains independent of the existing cover and recovery controls. This placement was independently checked by source inspection and followed by a fresh type check, build and browser run.
3. At implementation revision `7b9a7fbd61079e2659dc878c63eeb4aaa9293cdc`, the existing compiled download-recovery proof passes. Both deliberately failed resources recover, the binary is requested twice, and the later manifest consumer makes three reads. The complete paused-household screenshot matches the previously accepted image exactly: SHA-256 `4f7f7c2fd7a18f3501c425a6e80e1985809aa36d1f409cd225aafc3fc0ac08a6`. The final revision moves readiness recording into the actual draw block and refreshes its reviewed-source fingerprint; it changes no rendering inputs.

No native simulation, artwork, dependencies or hosted test workflows change. Relevant testing runs locally. The player changelog describes the cleanup repair and report access. Existing player-guide articles, controls, gameplay values and screenshots remain accurate; the new diagnostic page provides its own instructions and does not alter normal play. Source review fingerprints were refreshed after inspecting these changes.

## Compiled browser verification

`node scripts/verify-startup-diagnostics.cjs` runs the final release build in headed, muted Windows Chrome from a static server under `/terrilives/`. The phone viewport is 402 by 874 CSS pixels at device scale three. Report screenshots also use a 1440 by 900 CSS viewport at that scale. The [verification record](verification.json) identifies the artifact and each controlled case.

1. A controlled persistent 503 for the exact named binary includes a long server-requested delay, a fixture server identity, a fixture request ID and a response body. The loader makes one request, retains those details, and shows the short failure card. The standalone report and downloaded JSON equal the retained data.
2. A separate case holds the binary request open, waits for the loading step to be saved, and deliberately terminates only the task-owned renderer through Chrome's debugging interface. A new page in the same isolated browser context retrieves the unfinished attempt and its last step. This verifies persistence through an intentional renderer termination; it does not reproduce the iPhone termination's cause.
3. Ordinary loading records readiness after completed graphics work, advances the simulation clock, shows no startup failure and records no page error. All report-page observations request only the report HTML and recorder script. Download contents match the recorded attempt. Every owned browser context and browser closes in `finally`; the local preview server was stopped afterward.

## Visual inspection and independent review

The main review inspected the actual failure card, report pages and running game. Selected images retain the readable status/path, report link, download control, unfinished-load explanation and normal house view. Long report text wraps and the page scrolls vertically.

An independent source review passed, including the final readiness placement. A separate reviewer inspected all six selected PNGs and found no blocking layout or wording issue. The source review independently reran the focused tests before the later short-message test was added; the final 48-case result is the main run. The screenshot review covers visible layout and wording. It does not independently establish keyboard behavior, screen-reader behavior, download bytes or physical-device recovery; downloaded bytes and request isolation are separate browser assertions.

The controlled HTTP failure and renderer termination are diagnostic regression tests. The original affected-browser response or termination remains the next causal observation needed for the iPhone investigation.
