# Seasons played pass, 2026-10-17

A played check of the seasons slice (issue 251, `docs/specs/2026-10-17-seasons.md`) on the production bundle of branch `twcl/251-seasons` at commit `ca43c82f0` (`index-CUB8CqgK.js`), served by `vite preview` on port 4173 and driven in a Playwright-controlled Chromium window, because the desktop app's browser pane was hidden and could not draw. Each season came from a save of the shipped lot on the first day of that season (days 1, 8, 15 and 22), prepared during implementation and written into the page's save slot, so the game loaded it at startup; the game's sound was muted. The desktop frames are 929 by 861 captures of the window, all taken between 13:00 and 14:15 on the game clock so that daylight does not differ much between them; the phone frame is 375 by 812.

| Image | Moment | What it shows |
| --- | --- | --- |
| `01-spring-desktop.jpg` | Day 1, Spring, 13:17 | The clock reads Day 1, Monday over Spring, 13:17; the yard's grass as authored, a mid green. |
| `02-summer-desktop.jpg` | Day 8, Summer, 12:30 | The clock reads Day 8, Monday over Summer, 12:30; the grass a little lighter and yellower than in Spring. |
| `03-autumn-desktop.jpg` | Day 15, Autumn, 13:00 | The clock reads Day 15, Monday over Autumn, 13:00; the grass a yellow-brown. |
| `04-winter-desktop.jpg` | Day 22, Winter, 14:14 | The clock reads Day 22, Monday over Winter, 14:14; the grass a pale, gray-green. |
| `05-winter-phone.jpg` | Day 22, Winter, at the phone width | The clock's two lines, Day 22, Monday and Winter, 15:55, right-aligned in the top-left panel without wrapping; the pale yard at the left edge; the page did not scroll sideways. |
| `06-yard-crops.png` | The same patch of yard from frames 01 to 04, enlarged three times | The grass's fine diagonal streaks in all four seasons; they are faintest in Winter but still visible. |

Measured from the frames, averaging the same 100 by 80 pixel patch of yard and a 40 by 20 patch of kitchen floor in each desktop frame (red, green, blue, out of 255):

| Season | Yard | Kitchen floor |
| --- | --- | --- |
| Spring | 139, 157, 109 | 167, 164, 151 |
| Summer | 150, 161, 117 | 167, 164, 153 |
| Autumn | 156, 131, 91 | 167, 164, 152 |
| Winter | 184, 192, 175 | 168, 163, 150 |

The yard changes in each season while the indoor floor stays within three levels, which matches the spec's rule that only the yard's grass changes. The street and the house walls look the same in all four frames. Summer is the smallest change, as the spec intends (`[-6, 0.9, 0.02]`); it is visible beside Spring but easy to miss on its own.

Checked in the page as well: the clock text read from the household summary after each load was Day 1, Monday | Spring, Day 8, Monday | Summer, Day 15, Monday | Autumn and Day 22, Monday | Winter; at the phone width the summary measured 182 by 83 pixels and the page's scroll width equaled its 375-pixel width; the console reported no errors on the final loads.
