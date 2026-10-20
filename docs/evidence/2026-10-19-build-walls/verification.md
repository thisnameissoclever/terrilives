# Walls, windows and floors in Build mode: verification, 2026-10-19

This records the played visual pass and executed checks for [WB-height], [WB-pick] and [WB-mark] in `docs/specs/2026-09-22-walls-in-build.md`, [WT-run] and [WT-rules] in `docs/specs/2026-09-21-wall-tool.md`, [WN-fit] in `docs/specs/2026-09-22-windows.md`, and [FL-area] in `docs/specs/2026-09-22-floors.md`. The played check is [A-build-walls-ux] in `docs/alpha-feel-notes.md`.

## Reproduction settings

- Branch `twcx/build-walls-windows-ux`, on `main` at `d59d004d7`, served by the Vite development server in the default mode on localhost.
- The "before" captures ran main's `web/src` at `8465a69d8` against the same release wasm, from an ignored scratch copy. Only the browser renderer and tools differ between the two; the lot-edge rules are not exercised by the "before" captures.
- Cursor's browser pane, 1186 by 916 CSS pixels at device pixel ratio 1. The default camera after loading, with no pan or zoom. The shipped household on a new game, except the run, window and floor captures, which loaded the session's autosave on Day 4.
- Clicks and hovers were dispatched as DOM `click` and `pointermove` events at fixed canvas points, so the before and after captures share their click point exactly.

## Captures and what each shows

| File | Visible findings |
| --- | --- |
| `before-walls-tool-full-height.png` | The previous Walls tool: every front wall at full height, hiding the bathroom, laundry and the south rooms' floors. |
| `before-click-front-wall-face.png` | The previous renderer after a click high on the bottom-left front wall's face: status "No wall on this line.", and per-tile rings on an empty line behind the wall, half hidden by it. This is the reported defect. |
| `after-walls-tool-low.png` | The Walls tool opens in the low view: front and interior walls one third high, the rear walls tall, every room's floor visible. Low is pressed in the panel. |
| `after-click-front-wall-face-full.png` | The same click in Full height: status "A wall stands on this line.", the clicked wall section tinted blue with a bar at its foot, and the buttons above the wall. |
| `after-selected-wall-raised-in-low-view.png` | The same selection in Low: only the chosen section stands full height, tinted; the rooms behind the other front walls stay visible. |
| `after-hover-lot-south-edge.png` | With no click, the fainter hover bar on the lot's south edge in the yard. |
| `after-run-along-lot-south-edge.png` | After two clicks along the south edge: status "5 lines selected.", one continuous blue bar along the edge, and every button stacked above it because the run reaches the screen's edge. |
| `after-window-on-lot-south-edge.png` | After Wall built the run ("5 walls built.") and a 3-unit Picture window was fitted on the lot's edge ("Window fitted."): the window stands full height and tinted as the selection, the rest of the run low, the buttons above. |
| `after-floor-area-four-by-four.png` | Floors after two corner clicks: status "4 by 4 tiles selected.", each tile ringed and previewed in Boards, the buttons above and below the area. |

An earlier session at 1920 by 1080 confirmed the same behavior and the 16-tile Boards result ("Floor laid on 16 tiles."); those captures were not retained.

## Independent review

A fresh reviewer received captures A and B, the same click in the two renderers, without being told which was which. It identified B (`before-click-front-wall-face.png`) as failing: the click selected an empty line behind the wall. It accepted A (`after-click-front-wall-face-full.png`): the clicked wall is selected and unmistakably marked. The same review accepted the low view and found that the floating buttons covered the floor area and the near end of the run.

Both findings were fixed: the buttons now clear every corner of an area and both ends of a run, and stack above a selection that reaches the screen's bottom. A second fresh reviewer, given the recaptured run, window and floor images, passed all three for whole-selection marking and buttons kept clear.

Findings recorded but not changed here, because they predate this work: the Floors panel's material swatches overlap their labels; an unselected window in the low view reads as a pale strip; disabled buttons have faint text. The zoom-out button's broken glyph, visible in both renderers in these captures, was fixed separately on `main` before this branch was rebased. The reviewers also noted that a chosen window stands full height among low walls; this is deliberate under [WB-height], and Full height shows the whole wall.

## Played findings fixed during the pass

1. The first click of a run near tile corners in the last row chose the crossing line, so the second click started a new choice. Runs now follow the direction the clicks travel ([WT-run]); `wall-tool.test.ts` pins the case.
2. The floating buttons covered the selection described above.
3. A large area would have sent more edits than the simulation's 64-command queue holds in one drain. Both tools now stage at most 32 per frame and tally the whole edit at the end; `floor-tool.test.ts` pins a 60-tile area.

## Executed checks

Run locally on the branch after it was brought up to `main` at `d59d004d7`. After the final rebase onto `97c2879d8`, which added the player guide, the guide's source review record was refreshed and the guide, changelog and branding script tests (36 of 36), the type check and clippy passed again, and the full web suite passed 3873 of 3873.

The player guide's affected screenshots (`build-walls`, `build-windows`, `window-models`, `build-floors`, `floor-actions`, `build-room-outline`, `help` and `help-shortcuts`) predate this change and are listed under `pendingRefresh` in `docs/player/screenshots.json`; their text was updated.

- `cargo fmt --all -- --check` and `cargo clippy --workspace --all-targets -- -D warnings`: clean.
- `cargo test --workspace`: every suite passed, including 1836 `terri-sim` and 328 `terri-wasm` tests.
- `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`: built; the web tests ran against it.
- `npx tsc --noEmit` and `npm run build`: clean.
- `npx vitest run`: 3869 of 3872 passed in the full parallel run. The three others, `architecture-resources`, `coverage-payload` and `character-head-visible-parts`, hit the 20-second limit under that load and passed when run on their own (29 of 29). None touches this work.
- `python check-doc-ids.py`, `node --test scripts/build-changelog.test.mjs scripts/branding.test.mjs` and `node scripts/build-changelog.mjs`: passed.

## Limits

The pass used a desktop layout and a mouse. Touch input, the phone dock and the Room tool's low view were not played. Daylight through lot-edge glass is covered by `window-daylight.test.ts`, not by a played daytime capture. The pass does not inspect every wall junction at both heights.
