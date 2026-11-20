# Career tab played visual pass, 2026-11-20

Stills from the played pass for the Career tab plan ([CT-tests], played visual pass) in [the Career tab plan](../../../specs/2026-11-19-career-tab.md). Every image here was inspected at full size; the focus ring was also checked in an enlarged crop.

## Build and browser

- **Code.** The running dev server on port 5174 served the branch at `b46bfec53` (the later `3c6856f2b` changed only docs). Served `web/src/ui/career-panel.ts`, `career-graph-modal.ts`, `compact-hud.css` and `web/src/main.ts` matched this worktree byte for byte after line ending normalisation. The wasm file was not hashed; the page exposed `goToWork`, `goToWorkStatus` and `careerInputHistory`, which only this branch has.
- **Browser.** Playwright driving installed Chrome, headless, `--mute-audio`, with the game's saved audio preference set to muted before load. One browser per run, closed in a `finally` block. `?stress=0` was used only for its harness handle (no filler Sims).
- **State.** A new game was advanced through the harness to Day 36, Monday 03:30 (five reviewed weeks for Tim and Bill, four for Casey, no promotions) and saved with the game's own save writer. Each run imported that file with Options, Import save. The migration case imported `crates/terri-wasm/tests/fixtures/career-inputs-v23/two-reviewed-weeks-tuesday-noon.sav`.
- **Viewports.** Desktop 1440 by 900; phone 390 by 844 with touch. Light: auto, so 03:30 to 04:30 is night and 09:00 to 15:00 is day.

## Images

| File | Viewport | State | Findings |
| --- | --- | --- | --- |
| `d-01-career-early-night.png` | desktop | Tim, 03:30, too early | Go to work disabled; "Next shift: Monday, 06:00 to 14:00." and "available at 04:00, two hours before the shift." Matches Mockup 1 variant B. |
| `d-02-career-due-night.png` | desktop | 04:01, due | Enabled; "Day shift starts at 06:00, in 1 hour 59 minutes." Score inputs show Helps and Hurts. One graph only. Matches Mockup 1. |
| `d-03-info-tooltip-keyboard.png`, `d-03z-info-focus-ring-zoom.png` | desktop | Tab to the i | Tooltip "Open the review graph. Pauses the game." shows. Defect D1: the focus ring touches the final "k" of the job title and the heading row grows about 3 pixels, moving the tab content down. |
| `d-04-inline-graph-tooltip-week5.png`, `d-04b-inline-graph-tooltip-week1.png` | desktop | hover on weeks 5 and 1 | Exact score and meaning shown; legend present. Defect D4 (minor): the week 1 tooltip's bottom edge meets the "100" axis label. |
| `d-05-window-all-weeks-paused-night.png` | desktop | window from the job title i while paused | Default filters, All weeks, "The game stays paused after you close this window." Also show: Pay per shift sits below the score inputs. |
| `d-05b-window-all-weeks-from-1x-day.png` | desktop | same, opened at 1x | "Closing this window resumes the game at 1x." The clock did not advance while open; after Escape the window closed, ticks resumed at 1x and focus returned to the i. |
| `d-06a-go-to-work-pressed.png` | desktop | pressed at 04:01, paused | "On the way to work." once drained; button disabled. |
| `d-06c-walking-out.png`, `d-06d-walking-out-later.png`, `d-06e-off-the-lot.png` | desktop | 04:09, 04:21, 05:26 | Tim stopped cooking breakfast, walked through the kitchen to the front door and left the lot. |
| `d-06f-career-after-arrival.png`, `d-07-career-at-work-day.png` | desktop | 05:26 and 09:00 | "At work until 14:00." disabled (variant C). 0 missed while waiting before 06:00. |
| `d-14-career-after-shift-day.png` | desktop | 15:00 | "Last shift: 480 of 480 scheduled minutes worked; 0 missed ... Earned $180.00." |
| `d-09-window-last4-all-inputs-day.png`, `d-09b-window-last4-all-inputs-scrolled.png` | desktop | Last 4 weeks, all seven inputs | Weeks 2 to 5, all seven rows drawn. |
| `d-10-window-tooltip-poor-week.png` | desktop | hover on week 1 | Poor week text and inputs. Observation O2: Trait fit and Social capacity are missing from the tooltip although their rows are switched on. |
| `d-11-window-from-overview-day.png` | desktop | window from the Overview row i | Opens the same window; Escape returns focus to the Overview i. |
| `d-12-overview-personality-open-night.png` | desktop | Overview, Personality open | 560 pixels wide, as Mockup 3. Measured 560 on Overview, Queue, People, Traits, Career and with each Overview section open; height at most 690. |
| `p-01-career-due-night.png` | phone | Career after Overview was scrolled | Observation O3: the tab opened 189 pixels down, so the Go to work box is above the fold. |
| `p-02-inline-graph-tap-week1.png` | phone | tap on inline week 1 | Tooltip shown. |
| `p-03-window-night.png`, `p-10-window-last4-day.png` | phone | review window | Full screen, paused badge, tap hint. Defect D3: the week 1 point (week 2 in Last 4 weeks) covers the "Poor, 40" label. |
| `p-04-window-week3-details.png` | phone | after tapping week 3 | Defect D2: nothing happens. |
| `p-07-window-filters.png` | phone | Filters open | Two columns of inputs, Also show line, graph options. |
| `p-08-career-at-work-day.png` | phone | 09:00 at work | Variant C at phone width. |
| `p-11-overview-personality-open-night.png` | phone | Overview, Personality open | Phone sheet unchanged at 374 pixels. |
| `m-03-v23-window-tooltip-not-recorded.png` | desktop | schema 23 save after one more review | Every input row reads "not recorded"; tooltip says "No score inputs were recorded for this week." The partial week after import correctly has no row. |

## Defects and observations

- **D1.** Desktop Career tab: keyboard focus on the i draws a ring that touches the job title and shifts the content down about 3 pixels.
- **D2.** Phone review window (390 pixels wide, with or without touch emulation): tapping a week, clicking it, or focusing the chart and pressing Left arrow never selects a week. The value stays "Week 5: 42 of 100", Previous week, Next week and Hide details never appear, and "Tap a week for details." stays visible. The same click and key select a week on desktop.
- **D3.** Phone review window: a week point covers the "Poor, 40" rule label.
- **D4.** Desktop inline graph: the week 1 tooltip touches the "100" axis label.
- **O1.** The walk to work took about 84 minutes. Sent at 04:02, Tim arrived at 05:26 with 0 missed minutes; sent at 04:50 in an earlier run, he arrived at about 06:10 with 10 missed minutes. Pressing in the last 84 minutes of the window still counts missed time.
- **O2.** The window tooltip omits Trait fit and Social capacity when those rows are shown.
- **O3.** Phone: switching tabs keeps the sheet's scroll offset.
- **O4.** Window summary sits on its own line under Show, not beside it as in Mockup 2; otherwise the layout matches.

## Layout check

`layout-check.js` ran in every captured state. No page overflow anywhere. Recurring findings: leading-space on `fieldset.career-controls` (top 21, left 10) and `fieldset.career-shift-change` (top 22, left 8) in every Career tab state at both widths; clipped `#dock-activity` when the dock activity text is truncated; double-rule between the review window header and the Sim details header behind the backdrop (gap 27, desktop, a measurement through the backdrop); double-rule between `#personal-details` and the sheet header when Personality is scrolled to the top.

## Limits

- The late state (variant D) was not reached: Tim and Casey left on their start tick, and nothing held them home.
- No promotion week occurred in five weeks, so the promotion tooltip and level split were not seen.
- Headless Chrome hides scrollbars, so scrollbars do not appear in these stills.
- No fresh independent visual review was run in this pass.
