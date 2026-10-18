# Per-housemate job search played check, 2026-10-18

A played check of issue 297 (`docs/specs/2026-10-18-job-search-per-person.md`) on the production bundle `index-DqDvnymP.js`, built from branch `twcl/297-job-search-per-sim` at commit `36b874f77`. It was served by `vite preview` on port 4173 and driven in a Playwright-controlled Chromium window at 929 by 861, with the game muted, starting from a new game with no save. Frames are lossless captures.

| Image | Moment | What it shows |
| --- | --- | --- |
| `01-career-tab-on.png` | Bill selected, Sim details open on the Career tab | Bill unemployed, with the **Look for work automatically when unemployed** box checked below the career assignment controls. |
| `02-career-tab-off.png` | The box clicked once | The same tab with the box unchecked. |
| `03-options.png` | Options opened | The household boxes are "Sims can die if hunger or energy stays empty" and "Allow sims to change careers autonomously"; there is no household job search box. |
| `04-after-reload.png` | After Save, a page reload and the saved game loading | Bill's Career tab with the box still unchecked. |

The page also reported these states, which the frames do not show as text. Tim's box was still checked after Bill's was turned off. After the reload the page read "Saved game loaded", Bill's box was unchecked and Tim's and Casey's were checked. The console reported no errors or warnings in the session.
