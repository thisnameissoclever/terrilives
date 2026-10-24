# Shifts and careers played pass, 2026-10-24

This record holds the played pass for [shifts and more career paths](../../specs/2026-10-18-shifts-and-careers.md) ([WS-played]) on the branch `twcl/296-shifts-and-careers` at merge commit `d79c9e258`, which includes main through `d1ba84590` (the activity log, pull request 291). Each still below was inspected at full size; enlarged crops were used for bodies, beds and selection markers.

## Contents

- [Build and browser](#build-and-browser)
- [Captures and findings](#captures-and-findings)
- [Independent review](#independent-review)
- [Limits](#limits)

## Build and browser

- **Build.** `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` and `npm run build` in `web/` at `d79c9e258`. Served `index.html` SHA-256 `f41e2cd12444edaf26323d7f2d8f8b414e32ca633c620b228121e6604c5c2e83`, bundle `index-DyxaWcdx.js` SHA-256 `82cb3e5a32cb5784b74a81b88cbefc0abca5313f67fc0316e1e4929d8cfce324`, wasm `terri_wasm_bg-B5MlBgC7.wasm` SHA-256 `6ed9a4991bc8b9bebe01cf4fad1166dc815ebb1c1f9b37d7d50ac2dc82850dbf`. The served page named the same bundle before any capture.
- **Server.** `vite preview` on `127.0.0.1:4191`, a task-owned port; ports 5174 and 4173 were not used. It was stopped after the pass.
- **Browser.** Playwright driving installed Google Chrome, headed, with `--mute-audio` and the game's audio preference saved as muted before load; one browser at a time, closed in a `finally` block after each run. No `?stress` parameter was used.
- **Viewports.** Desktop 1440 by 960 and phone 375 by 812. Each run started a new game in a fresh profile, except the schema-twenty run, which imported a save with Options > Import save.
- **Speed.** 3x, paused for every capture and every activity reading.

## Captures and findings

| File | Point | What it shows |
| --- | --- | --- |
| `01-assign-office-by-chance.png` | 2 | Bill unemployed; Career path Office; Shift reads By chance; Assign enabled. The list offered By chance, `Day shift, Monday to Friday, 06:00 to 14:00, 95% chance` and `Late shift, Monday to Friday, 12:00 to 20:00, 5% chance` (read from the page). |
| `02-assign-hospital-by-chance.png` | 2 | The three-shift Hospital path with By chance. The list offered day 40%, late 30% and night 30% chances, night reading `Friday to Tuesday, 23:00 to 07:00`. |
| `03-assign-hospital-late-chosen.png` | 2 | The late shift chosen before Assign. The closed selector cuts the line after `23:00`, so its chance is hidden at this width; finding F-1. |
| `04-assign-night-watch-by-chance.png` | 2 | Night watch with By chance; its list offered `Night shift, Sunday to Thursday`, `Night shift, Wednesday to Sunday` and `Late shift, Monday to Friday, 14:00 to 22:00`. |
| `05-bill-current-shift-after-assign.png` | 2 | After Assign with the late shift: Career assigned., and the Current shift group selects the held late shift with Change shift disabled. |
| `06-tim-day-overview-row.png` | 1 | Tim's Overview row: `Office clerk, Day shift, Monday to Friday, 06:00 to 14:00`. |
| `07-bill-late-overview-row.png` | 1 | Bill's row: `Ward orderly, Late shift, Wednesday to Sunday, 15:00 to 23:00`. |
| `08-casey-night-overview-row.png` | 1 | Casey's row: `Night watch, Night shift, Sunday to Thursday, 22:00 to 06:00`; the days wrap past Sunday. |
| `09-tim-day-career-tab.png`, `10-bill-late-career-tab.png`, `11-casey-night-career-tab.png` | 1 | The Career tab schedule line of the day, late and night worker, matching each row. |
| `12-tim-refused-at-work.png` | 3 | Monday 07:11, Tim At work; after choosing the late shift and Change shift, the status reads `Not while they are at work or on the way.` and his schedule is unchanged. |
| `13-tim-change-chosen-with-note.png` | 3 | At home after the shift, the late shift chosen under Current shift, Change shift enabled, and the note. |
| `14-tim-after-change.png` | 3 | `Shift changed.`, the late shift selected and Change shift disabled again. |
| `15-tim-late-overview-row.png` | 3 | Tim's row now reads the late shift. |
| `16-casey-leaving-at-22-tuesday.png` | 4 | Tuesday 22:04, Casey Walking through the hall toward the front door; the shower stall hides part of her body by depth, and the marker is under her feet. |
| `35-casey-at-work-monday-2250.png` | 4 | Monday 22:50, Casey At work and off the lot. |
| `17-casey-asleep-tuesday-0919.png` | 4 | Tuesday 09:19, Casey asleep in the lower bunk with the sleep bubble; a housemate is up at the fridge and Tim is at work. |
| `33-phone-casey-asleep-tuesday-1002.png` | 4 | Phone width, Tuesday 10:02, Casey asleep in the bunk. |
| `18-tim-late-start-tuesday-1205.png` | 3 | The day after the change: Tuesday 12:05, Tim returning his book before leaving for the late shift; he had stayed home at 06:00. |
| `36-phone-tim-leaving-late-shift-tuesday-1206.png` | 3 | Phone run: Tuesday 12:06, Tim Walking out for the late shift; he reached work at 13:08. |
| `19-new-game-tim-monday-0603.png`, `20-new-game-tim-tuesday-0603.png` | 5 | A new game at Monday and Tuesday 06:03: Tim's shift has started and he is returning a book first, as the reading system requires; finding F-2. |
| `21-new-game-bill-hired-monday.png` | 5 | Bill hired by Monday's 09:00 search (captured just after 09:29 by the run log): kitchen porter, late shift. |
| `22-new-game-casey-hired-tuesday.png` | 5 | Casey hired by Tuesday's search: night watch, `Night shift, Wednesday to Sunday`. |
| `23-new-game-talking.png`, `24-new-game-eating.png`, `25-new-game-sleeping.png` | 5 | Bill and Casey talking (Monday 04:43); Casey eating at the table while Bill joins the meal (Tuesday 07:49); Tim asleep in the double bed (Monday 23:17). |
| `37-schema-20-after-import.png` | 6 | Main's schema-twenty save `crates/terri-wasm/tests/fixtures/shifts-v20/shipped-household.sav` imported: Day 4, Thursday 10:00, `Imported game loaded and saved`. |
| `26-schema-20-tim.png`, `27-schema-20-bill.png`, `28-schema-20-casey.png` | 6 | After that import: Tim and Bill `Office clerk, Day shift, Monday to Friday, 06:00 to 14:00`, Casey `Lowly barista, Early shift, Tuesday to Saturday, 05:30 to 12:30`, each its level's standard schedule, with the Current shift selector on that shift. |
| `29` to `32`, `34` (`phone-*`) | 1 to 3 | The same assignment, Current shift, refusal and change at phone width; text fits except the selector line noted in F-1. |

Every [WS-played] point has a capture. The run logs with each sampled activity are kept with the task logs, not in the repository.

**Findings.**

- **F-1, deferred.** At the desktop sheet's 360-pixel width a closed Shift selector cuts long options, hiding the chance or the end time; the open list shows the whole line, and the phone sheet is wide enough. A native selector cannot wrap. Shorter wording is a choice for the owner's review of the [WS-shell] strings (ruling 12), so the wording was not changed here.
- **F-2, deferred to issue 339 and the reading system.** In both new-game mornings Tim's 06:00 shift started on time, but he first returned a book and set off at 06:24 on Monday and 06:32 on Tuesday (sampled every three minutes). The run on the career content from before shifts behaves the same way ([verification record](../../specs/2026-10-18-shifts-and-careers-verification.md#tims-first-shift)). No frame shows the moment of departure; frame `12` shows him at work at 07:11 on Monday in the assignment run.
- **F-3, observation.** Casey on the night shift slept about two and a half hours on Tuesday morning (08:37 to 11:01) and did not sleep on Wednesday morning before noon in a two-day sample; the one-week trace places 91 percent of her sleep between 07:00 and 18:00. Her short daytime sleep follows her Energy need, which the shift's sleep offset does not change.
- **F-4, observation.** A sleeping person's selection marker sits beside the bunk, partly behind the bathroom wall (`17`, `33`); this is how beds draw the marker on main and was not changed.

## Independent review

A fresh reviewer received the [WS-played] points and these captures without an expected verdict. It found every point shown at least in part and raised fifteen findings. Their dispositions:

1. Panel-only crops do not identify the person or the time: frames `12`, `35`, `36` and `37` were added or replaced with full frames that show the selected name and the clock; the table above gives the time of each panel crop from the run logs.
2. No frame shows Tim leaving at 06:00: recorded as F-2.
3. Casey in `16` is partly hidden: the shower stall is in front of her by depth; `35` adds her At work and off the lot.
4. No frame shows a good-week count after the change: in a new game the count is already 0, so the reset cannot be seen here; `changing_shift_costs_only_the_good_week_streak` in `crates/terri-sim/src/shift_tests.rs` covers it.
5. The chance is not visible in the closed selector: F-1.
6. The marker of a sleeper: F-4.
7. Clipped selector text: F-1.
8. The Overview row wraps inside a time range: the row is right-aligned text in a narrow panel and wraps at spaces; left as it is.
9. Tim's status line is cut: the dock truncates long activity text with an ellipsis by design; the full text is in the Overview's Doing row.
10. The phone sheet covers part of the Player guide button: main's layout, unchanged by this work.
11. The job search box is cut by the dock in the mobile controls capture: the sheet scrolls; unchanged.
12. The miniature graph's axis labels are small: main's graph, unchanged.
13. `36 missed` beside `missed-work deduction 0` may confuse: the deduction starts after two missed hours by the attendance rules; main's wording, unchanged.
14. A file name said 06:02 against a 06:03 clock: renamed.
15. Two night watch night shifts differ only by days: by design, the days distinguish them.

For the guide, the reviewer found that the Career crops did not show the shift controls. A new figure, `career-shift`, now shows Assign a career and Current shift beside the instructions that describe them.

## Limits

These are browser observations of one session per viewport with the seed a new game draws; another new game can differ. Animations were watched only as paused frames. The rendered guide pages were not inspected in both themes in this pass; the guide images were inspected as files.
