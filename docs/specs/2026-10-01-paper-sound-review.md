# Paper sound review

Status: implementation, local tests, browser checks and independent code review passed. Publication is pending. No game sound is replaced or added by this work.

## Purpose and boundary

Make four paper recordings available for listening through a stable GitHub Pages URL, without requiring a local preview server. These are unedited candidates for future reading sounds, not accepted page-turn recordings. The review must distinguish a useful page rustle from tearing, crumpling, background noise or an unsuitable transient. A filename and clean numerical measurements cannot make that judgment.

This branch starts from main at `c3ba226b`, excluding the held toilet-audio PR 178. Publishing this page must not release that feature, change game playback, replace an accepted cue or relax any game performance requirement.

## Source and screening

Author: rubberduck. Pack: [100 CC0 SFX](https://opengameart.org/content/100-cc0-sfx), CC0 1.0, rechecked on 2026-10-01. The already-downloaded archive matched SHA-256 `a5c135878c132f1c59cca54e60061c296cd0ac27ad031ca2c41b8cd5cab3c706`. Only the four exact entries below were extracted, without overwriting files. Durable unmodified originals are in `assets/audio/review/paper/`, outside the game's runtime audio catalog.

Chromium decoded each original at 48 kHz. All four produced finite stereo samples, with no sample at or above absolute amplitude 1. No trim, normalization, filtering, resampling export or gain change was applied to the retained originals. Playback volume in the review is a separate control.

| Entry | Original bytes | Frames at 48 kHz | Seconds | Peak | RMS |
| --- | ---: | ---: | ---: | ---: | ---: |
| `paper_01.ogg` | 25,529 | 20,206 | 0.420958 | 0.393837 | 0.026963 |
| `paper_02.ogg` | 27,205 | 26,294 | 0.547792 | 0.345693 | 0.032824 |
| `paper_03.ogg` | 29,838 | 26,381 | 0.549604 | 0.135143 | 0.014660 |
| `paper_04.ogg` | 32,322 | 29,208 | 0.608500 | 0.291687 | 0.026463 |

RMS describes average sample amplitude, not perceived loudness. These results do not establish suitable timbre, lack of recorded distortion, loop quality or absence of voices. The first screening report read byte length after decoding had detached its input buffer; the corrected report captures byte length before decode. Hashes and decoded measurements were unchanged.

## Review contract

1. Reuse the existing self-contained audition player. Render accurate paper-specific title, introduction and listening instructions as escaped text.
2. Start silent at 25% review volume. Play one recording at a time. Stop all, page exit and document hiding invalidate pending playback and stop active playback. Repetition remains bounded to 15 seconds by the audio clock.
3. Embed the exact original bytes and provenance. The downloaded page can work offline; no external audio request or game save access is needed.
4. Keep each decision and notes in the page until explicitly downloaded as JSON. Closing without export loses notes. Playback completion does not imply hearing or approval. Keep for editing is not permission to replace the game's current sound.
5. Preserve the generic intake builder's outside-repository, hash, direct-child and exclusive-write guards. A separate constrained publisher selects only this fixed four-entry manifest and the exact `web/public/audio-review.html` destination. It must reject path escapes and changed existing output, and reproduce the checked-in artifact byte-for-byte.
6. Keep gameplay modules, dependencies and Pages workflow unchanged. The standard site build copies the review page as a standalone asset; the game does not import or preload it.

## Verification and delivery

Existing audition-generator baseline: four tests passed, exit 0. Browser decode screening passed for all four originals. Screening browser and server were closed. Source hashes are recorded in `ASSETS.md` and must be checked by the publisher before rendering.

Local verification on 2026-10-01:

| Check | Command or procedure | Result |
| --- | --- | --- |
| Full web suite | `npm test -- --maxWorkers=1` in `web/` | PASS, 112 files and 1,576 tests, exit 0 |
| Types | `npm run typecheck` in `web/` | PASS, exit 0 |
| Release WASM | `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS, exit 0; unchanged main gameplay |
| Production site | `npm run build` in `web/` | PASS, exit 0 |
| Focused generator tests | `npm test -- --maxWorkers=1 tests/audio-audition.test.ts tests/paper-audio-review.test.ts` | PASS, 16 tests, no skips, exit 0 |
| Guard mutations | Remove hash, size, directory confinement, differing-output refusal, order, title escaping, generic exclusive-write or repository-output guard, one at a time | All eight failed with exit 1; all mutations restored byte-identically |
| Artifact copying | Compare SHA-256 of `web/public/audio-review.html` and `web/dist/audio-review.html` | Both `8ca9d5bfd73abc05550b77917eb7a79a54b535e03594defe401448ef74c98fb9` |
| Independent review | Read source, tests, provenance and regenerated artifact | No required fixes; all four embedded buffers match originals |

The production page started silent at 25% volume. A real Chromium session played all four originals while offline, switched between two repeating clips, stopped explicitly, and completed one repeat after 15,047 ms of wall time. Interrupted repeats remained incomplete. Export succeeded offline and retained source hashes, decisions, notes and completion flags. The synthetic `keep` decision in the [export fixture](../assets/review-evidence/audio/paper-review/synthetic-export.json) tests serialization only; it is not a listening judgment. [Browser result and executed procedure](../assets/review-evidence/audio/paper-review/browser.txt).

The [desktop](../assets/review-evidence/audio/paper-review/desktop.png), [mobile top](../assets/review-evidence/audio/paper-review/mobile.png) and [mobile controls](../assets/review-evidence/audio/paper-review/mobile-controls.png) screenshots were visually inspected. At 390 px viewport width, document width was 375 px with no horizontal overflow. No page exception occurred; console resource errors were only the existing missing favicon. Native background-tab suspension was not retested in this round. The player lifecycle is unchanged. The task-owned browser and preview server were closed after verification.

Source merge, Pages deployment and owner listening remain separate results. The intended public URL is [audio-review.html](https://thisnameissoclever.github.io/terrilives/audio-review.html); this document does not claim that deployment has completed.

The existing public game was opened in a task-owned fresh browser session, paused and visually inspected. The household scene, people, furniture and compact controls rendered. The only console errors were requests for the missing site favicon, not game or audio exceptions. [Observed scene](../assets/review-evidence/audio/paper-review/game.png). That browser was closed immediately after capture. This checks the existing deployed game, not the unpublished candidate page.

## Regeneration

Run `node scripts/publish-paper-audio-review.cjs` from the repository root. It accepts no path or candidate arguments. An identical checked-in page is a no-op; different existing content is an error, not permission to overwrite it. For an intentional future template or manifest change, preserve the old generated page outside the fixed destination, generate the replacement, inspect the diff and update the artifact regression test as needed. Never bypass source identity or path checks to make regeneration pass.

The standard Vite build copies this standalone page. It is not loaded by the game. No Pages workflow or dependency change is needed. Candidate selection and any later runtime adaptation still need their own listening and in-game mix checks.
