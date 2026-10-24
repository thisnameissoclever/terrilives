# Log captures for the player guide: verification, 2026-10-23

This records the captures behind the player guide's [Log section](../../player/ui-elements.md#log) and what each shows. They are also played evidence for four states of the activity log panel in `docs/specs/2026-10-18-activity-log.md`: the panel open with the whole household ([AL-selected]), Only ticked for the selected housemate, a bathroom privacy line ([AL-compose]), and Show earlier entries ([AL-panel] item 6).

## Reproduction settings

- Branch `twcl/275-activity-log` at `33ee7a4ac`, with main at `6d92fc561` merged. A release wasm and production bundle (`index-BAhtCSe1.js`, `terri_wasm_bg-DFgWgfcg.wasm`) served by `vite preview` at `http://127.0.0.1:5174/?stress=0&audio=0`. The build hashes and source file hashes are in the `activity-log` snapshot of `docs/player/screenshots.json`.
- Playwright driving displayed Chrome 155.0.8059.85 started with `--mute-audio`; sound also off through `audio=0`. One browser; the desktop layout at 1440 by 960 and the phone layout at 390 by 844 (touch, mobile) each ran in their own context at device pixel ratio 1, closed after use.
- First-run Help dismissed and play paused. The household was advanced with the paused game's frame stepping (`fastForward` in `scripts/activity-log-proof.cjs`) one game day at a time: one day on desktop and two on the phone until a privacy line was held, then six and seven days for Show earlier entries, which appears once more than 200 lines are visible.
- Only Tim was ticked after choosing the first Household name, Tim, and stepping frames so the panel saw the selection.

## Captures and what each shows

| File | Visible findings |
| --- | --- |
| `docs/player/images/ui-log-desktop.png` | Log open beside the house, below the Log button at the top right. Actions, Social and Career pressed; Chores, Skills, Details and Time not. Only Tim unticked at the end of the filter row. Lines from Tim, Bill and Casey, newest at the bottom, including "Bill: Annoyed that Tim walked in while they were using the bathtub. Awkward." and "Bill: Annoyed that Tim started using the toilet right in front of them. Awkward." Long lines wrap inside the panel. The panel ends above the dock. |
| `docs/player/images/ui-log-mobile.png` | Phone: the Log covers the width from the top edge to the dock, with the Log button at the top right beside Close and the filter row on two lines. Scrolled to "Casey: Annoyed that Bill started using the bathtub right in front of them. Awkward.", which wraps onto a second line. |
| `docs/player/images/ui-log-only-desktop.png` | Only Tim ticked: eight lines, each naming Tim, such as "Tim: Clean floor; Bill appreciates Tim, Casey appreciates Tim" and both of Bill's privacy lines about Tim. Lines involving only Bill and Casey are gone. |
| `docs/player/images/ui-log-only-mobile.png` | Phone with Only Tim ticked: lines where Tim acts or is named, including "Bill: Chat with Tim about TV; Bill loves it, Tim dislikes it" and "Bill: Annoyed by Tim's dishes". |
| `docs/player/images/ui-log-show-earlier-desktop.png` | Day 7: Show earlier entries at the top of the list, above the oldest of 200 shown lines. |
| `docs/player/images/ui-log-show-earlier-mobile.png` | The same on the phone, Day 8. |
| `log-show-earlier-after-desktop.png` | After choosing Show earlier entries: the button is gone because only three earlier lines were still held, and the line that was first stays in place below them. |
| `log-show-earlier-after-mobile.png` | Phone after Show earlier entries: earlier lines appear above, and "Tim: Annoyed that Casey interrupted", the line that was first, stays at the same height on screen. |

On desktop, the first line's top edge measured 223 pixels before the click and 222.75 after. The phone measurement found an earlier line with the same text, so the phone result rests on the two images, which show the line at the same height. No page errors were reported in either layout.

The guide's figures are crops of the first four images around the panel and its Log button; `docs/player/illustrations.json` records each crop rectangle and hash.

## Limits

These captures cover the four states above at two sizes. They do not cover the rest of the played pass in [AL-evidence], such as a watched conversation, every filter combination, a Load, or Build mode hiding the button. An independent visual review of these images had not run when this record was written.
