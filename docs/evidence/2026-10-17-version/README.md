# Version line played check, 2026-10-17

A played check of the version line at the top of the Options panel (issue 276) on the production bundle of branch `twcl/276-version` at commit `1ca74cd30` (`index-BCTzqj0g.js`), served by `vite preview` on port 4173 and driven in a Playwright-controlled Chromium window, because the desktop app's browser pane was hidden and could not draw. The game's sound was off.

| Image | Moment | What it shows |
| --- | --- | --- |
| `01-options-desktop.jpg` | Options opened at 929 by 861 | Version 1.0.0 in small muted text as the panel's first line, above Close Options. |
| `02-options-phone.jpg` | Options opened at 375 by 812 | The same line at the top of the panel, inside the screen; the page did not scroll sideways (scroll width 375 pixels). |

Checked in the page as well: the line read Version 1.0.0, was the panel's first child, had no tab stop, and used a 12 pixel font.
