# Shifts and careers played pass, 2026-10-24

This record holds the played pass for [shifts and more career paths](../../specs/2026-10-18-shifts-and-careers.md) ([WS-played]) on the branch `twcl/296-shifts-and-careers` at commit `c14aea9a7`, which includes main through `d1ba84590` (the activity log, pull request 291) and the owner's rulings of 2026-10-24. Each still below was inspected at full size; enlarged crops were used for bodies, beds and selection markers.

## Contents

- [Build and browser](#build-and-browser)
- [Captures and findings](#captures-and-findings)
- [Independent review](#independent-review)
- [Limits](#limits)

## Build and browser

- **Build.** `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` and `npm run build` in `web/` at `c14aea9a7`. Served `index.html` SHA-256 `c4d38f11693fd59fbbd87d571cfecdee2d63330ff2dd066eee0445a1c04c7c22`, bundle `index-DN4CLjPn.js` SHA-256 `7fd0df8037b70e98542becdbb52ed7315586d0447f3701c553754f881be6edb3`, wasm `terri_wasm_bg-CPrEBrgW.wasm` SHA-256 `da1d92a3c6c52705bd1beec304e50348560ab97abd2f028a722c05c17e7ab80e`. The served page named the same bundle before any capture.
- **Server.** `vite preview` on `127.0.0.1:4191`, a task-owned port; ports 5174 and 4173 were not used. It was stopped after the pass.
- **Browser.** Playwright driving installed Google Chrome, headed, with `--mute-audio` and the game's audio preference saved as muted before load; one browser at a time, closed in a `finally` block after each run. No `?stress` parameter was used.
- **Viewports.** Desktop 1440 by 960 and phone 375 by 812. Each run started a new game in a fresh profile, except the schema-twenty run, which imported a save with Options > Import save.
- **Speed.** 3x, paused for every capture and every activity reading.

## Captures and findings

| File | Point | What it shows |
| --- | --- | --- |
| `01-assign-office-by-chance.png` | 2 | Bill unemployed, Monday 00:01; Career path Office; Shift reads By chance; Assign enabled. The list offered By chance, `Day shift, Monday to Friday, 06:00 to 14:00, 95% chance` and `Late shift, Monday to Friday, 12:00 to 20:00, 5% chance` (read from the page). |
| `02-assign-hospital-by-chance.png` | 2 | The three-shift Hospital path with By chance; its list offered day 40%, late 30% and night 30% chances, night reading `Friday to Tuesday, 23:00 to 07:00`. |
| `03-assign-hospital-late-chosen.png` | 2 | The late shift chosen before Assign; the closed selector cuts the line after `23:00`, and the line beneath repeats it in full with `30% chance`. |
| `04-assign-night-watch-by-chance.png` | 2 | Night watch with By chance; its list offered `Night shift, Sunday to Thursday`, `Night shift, Wednesday to Sunday` and `Late shift, Monday to Friday, 14:00 to 22:00`. |
| `05-bill-shift-schedule-after-assign.png` | 2 | After Assign with the late shift: `Career assigned.`; the Shift schedule group selects the held late shift, repeats its whole line and keeps Change shift disabled. |
| `06-tim-day-overview-row.png` | 1 | Tim's Overview row: `Office clerk, Day shift, Monday to Friday, 06:00 to 14:00`. |
| `07-bill-late-overview-row.png` | 1 | Bill's row: `Ward orderly, Late shift, Wednesday to Sunday, 15:00 to 23:00`. |
| `08-casey-night-overview-row.png`, `34-phone-casey-overview-row.png` | 1 | Casey's row at desktop and phone width: `Night watch, Night shift, Sunday to Thursday, 22:00 to 06:00`; the days wrap past Sunday. |
| `09-tim-day-career-tab.png`, `10-bill-late-career-tab.png`, `11-casey-night-career-tab.png` | 1 | The Career tab schedule line of the day, late and night worker, matching each row. These sheet crops carry no name or clock; the run log ties them to Monday 00:01. |
| `12-tim-refused-at-work.png` | 3 | Monday 07:41, Tim At work; after choosing the late shift and Change shift, the status reads `Not while they are at work or on the way.` and his schedule is unchanged. |
| `13-tim-change-chosen-with-note.png` | 3 | Monday 14:40, at home after the day shift: the late shift chosen under Shift schedule, Change shift enabled, and the note. |
| `14-tim-after-change.png` | 3 | `Shift changed.`, the late shift selected and Change shift disabled again. Before and after, the tab read `No streak running.` and `The next promotion needs 2 good weeks in a row.`, because a new game has no good weeks to reset (run log). |
| `15-tim-late-overview-row.png` | 3 | Tim's row now reads the late shift. |
| `18-tim-late-start-tuesday.png` | 3 | Tuesday 12:03, the day after that change: Tim returns his book first and then leaves for the late shift; he stayed home at 06:00. |
| `38-change-at-0011-before-the-day-shift.png` | 3 | A separate run: Tim changes from the day shift to the late shift at Monday 00:11, before either starts that day. |
| `39-old-day-shift-worked-monday-0657.png`, `40-monday-1200-still-on-the-old-shift.png` | 3 | That Monday the old day shift still runs: Tim set off at 06:04, was At work at 06:57, and is still at work at 12:02, so the new late shift did not start that day. |
| `41-tuesday-0603-home-before-the-new-shift.png`, `42-tuesday-1203-leaving-for-the-new-shift.png` | 3 | On Tuesday Tim is home at 06:03 and leaves for the late shift at 12:03; he was At work at 13:28. |
| `16-casey-leaving-tuesday-2204.png` | 4 | Casey on the night watch's night shift, Tuesday 22:04: Walking through the living room toward the front door, marker under her feet. |
| `35-casey-at-work-monday.png` | 4 | Monday 22:59, Casey At work and off the lot. |
| `17-casey-asleep-tuesday-0904.png` | 4 | Tuesday 09:04, Casey asleep in the lower bunk with the sleep bubble while a housemate is up at the kitchen counter and Tim is at work. |
| `19-new-game-tim-leaving-monday-0603.png`, `20-new-game-tim-leaving-tuesday-0608.png` | 5 | A new game: at Monday 06:03 and Tuesday 06:08 Tim is Walking out for his 06:00 shift; the run log has him leaving at 06:02 and 06:01 and At work at 06:39 on Tuesday. |
| `21-new-game-bill-hired-monday.png` | 5 | Bill hired by Monday's 09:00 search (captured just after 09:22 by the run log): kitchen porter, late shift. |
| `22-new-game-casey-hired-tuesday.png` | 5 | Casey hired by Tuesday's search: night watch, `Night shift, Wednesday to Sunday`. |
| `23-new-game-talking.png`, `24-new-game-eating.png`, `25-new-game-sleeping.png` | 5 | Bill and Casey talking (Monday 02:28); Tim eating at the table (Tuesday 00:40, a separate new game); Tim asleep in the double bed (Tuesday 15:41). |
| `37-schema-20-after-import.png` | 6 | Main's schema-twenty save `crates/terri-wasm/tests/fixtures/shifts-v20/shipped-household.sav` imported: Day 4, Thursday 10:00, `Imported game loaded and saved`. |
| `26-schema-20-tim.png`, `27-schema-20-bill.png`, `28-schema-20-casey.png` | 6 | The top of each Career tab after that import: Tim and Bill `Office clerk, Day shift, Monday to Friday, 06:00 to 14:00`, Casey `Lowly barista, Early shift, Tuesday to Saturday, 05:30 to 12:30`, each its level's standard schedule. The run log records that the Shift schedule selector held that same shift for each. |
| `29` to `32` (`phone-*`) | 2, 3 | The assignment, Shift schedule, refusal and change at phone width; each selector's whole line appears beneath it. |

Every [WS-played] point has a capture. The run logs with each sampled activity are kept with the task logs, not in the repository.

**Findings.**

- **F-1, fixed.** A closed Shift selector cuts long lines at phone width and in the desktop sheet, hiding the chance or the end time. The selected shift's whole line now appears beneath each selector (`03`, `05`, `29`, `30`).
- **F-2, observation.** Leaving for a shift waits while a reader returns their book, as on main; in this pass Tim did so on Tuesday at 12:03 (`18`). The bookcase reservation behind the longest such waits is issue 339 ([verification record](../../specs/2026-10-18-shifts-and-careers-verification.md#tims-first-shift)).
- **F-3, observation.** Casey on the night shift slept about two and a half hours on Tuesday morning in each run that sampled it; the one-week trace places 91 percent of her sleep between 07:00 and 18:00. Her short daytime sleep follows her Energy need, which the shift's sleep offset does not change.
- **F-4, observation.** A sleeping person's selection marker sits beside the bunk, partly behind the bathroom wall (`17`); this is how beds draw the marker on main and was not changed.

## Independent review

A fresh reviewer received the [WS-played] points and the first set of captures without an expected verdict. It found every point shown at least in part and raised fifteen findings. Their dispositions:

1. Panel-only crops do not identify the person or the time: full frames with the selected name and the clock were added (`12`, `16`, `35`, `37` and the change-day set), and the table gives the time of each panel crop from the run logs.
2. No frame showed Tim leaving at 06:00: `19` and `20` now do.
3. Casey was partly hidden while leaving: `16` now shows her in the open living room.
4. No frame shows a good-week count after the change: the row for `14` gives the count from the page; a new game has none to reset, and `changing_shift_costs_only_the_good_week_streak` in `crates/terri-sim/src/shift_tests.rs` covers the reset.
5. The chance was not visible in the closed selector: F-1, fixed.
6. The marker of a sleeper: F-4.
7. Clipped selector text: F-1, fixed.
8. The Overview row wraps inside a time range: the row is right-aligned text in a narrow panel and wraps at spaces; left as it is.
9. Tim's status line is cut: the dock truncates long activity text by design; the full text is in the Overview's Doing row.
10. The phone sheet covers part of the Player guide button: main's layout, unchanged by this work.
11. The job search box was cut by the dock in the mobile controls capture: the capture now scrolls to the end of the tab, so the box shows.
12. The miniature graph's axis labels are small: main's graph, unchanged.
13. A new job showed the old job's last shift and pay: the attendance line now describes only the current job (`the_attendance_report_describes_only_the_current_job`), and the guide's assigned capture was retaken.
14. A file name disagreed with its clock: names now follow the clock.
15. Two night watch night shifts differ only by days: by design, the days distinguish them.

For the guide, the reviewer found that the Career crops did not show the shift controls; a figure, `career-shift`, now shows Assign a career and Shift schedule beside the instructions that describe them.

## Limits

These are browser observations of one session per viewport with the seed a new game draws; another new game can differ. Animations were watched only as paused frames. The rendered guide pages were not inspected in both themes in this pass; the guide images were inspected as files.
