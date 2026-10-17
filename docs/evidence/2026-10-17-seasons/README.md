# Seasons played pass, 2026-10-17

A played check of the seasons slice (issue 251, `docs/specs/2026-10-17-seasons.md`) on the production bundle of branch `twcl/251-seasons` at commit `0188f5c60` (`index-CAxGGnvp.js`, rebuilt from the committed tree), served by `vite preview` on port 4173 and driven in a Playwright-controlled Chromium window, because the desktop app's browser pane was hidden and could not draw. Each season came from a save of the shipped lot on the first day of that season (days 1, 8, 15 and 22), prepared during implementation and written into the page's save slot, so the game loaded it at startup; the game's sound was muted. Frames 01 to 05 are lossless PNG captures: the four desktop frames at 929 by 861, taken between 12:40 and 13:13 on the game clock so that daylight barely differs between them, and the phone frame at 375 by 812.

| Image | Moment | What it shows |
| --- | --- | --- |
| `01-spring-desktop.png` | Day 1, Spring, 13:13 | The clock reads Day 1, Monday over Spring, 13:13; the yard's grass as authored, a mid green. |
| `02-summer-desktop.png` | Day 8, Summer, 12:40 | The clock reads Day 8, Monday over Summer, 12:40; the grass a lighter straw green, like sun-dried grass. |
| `03-autumn-desktop.png` | Day 15, Autumn, 12:47 | The clock reads Day 15, Monday over Autumn, 12:47; the grass a yellow-brown. |
| `04-winter-desktop.png` | Day 22, Winter, 12:41 | The clock reads Day 22, Monday over Winter, 12:41; the grass a pale gray-green. |
| `05-winter-phone.png` | Day 22, Winter, 14:25, at the phone width | The clock's two lines, Day 22, Monday and Winter, 14:25, right-aligned in the top-left panel without wrapping; the page did not scroll sideways. |
| `06-yard-crops.png` | The same patch of yard from frames 01 to 04, enlarged three times | The grass's fine diagonal streaks in all four seasons. |

Measured from the desktop frames: the yard is the average of a 40 by 30 pixel patch of grass alone at x 0 to 39, y 540 to 569 (its brightness varies by about 1.3 levels across the patch, so nothing else is in it), and the floor is the average of a 40 by 20 patch of kitchen floor at x 560 to 599, y 280 to 299 (red, green, blue, out of 255):

| Season | Yard | Kitchen floor |
| --- | --- | --- |
| Spring | 150, 170, 116 | 167, 163, 151 |
| Summer | 179, 177, 128 | 167, 163, 152 |
| Autumn | 168, 142, 96 | 167, 163, 152 |
| Winter | 199, 209, 193 | 167, 163, 152 |

The yard changes in each season while the indoor floor stays within one level, which matches the spec's rule that only the yard's grass changes; the street and the house walls look the same in all four frames. In the CIELAB color space, where a difference of about 2.3 is just visible, Summer's grass is 10.3 from Spring's and 15.4 from Autumn's, Spring to Autumn is 21.0 and Spring to Winter 26.6. The Summer color matches the value predicted from the tuning before the capture (179, 176, 128) to within one level.

Checked in the page as well: the clock text read from the household summary after each load named the save's day and season; at the phone width the summary measured 182 by 83 pixels and the page's scroll width equaled its 375-pixel width; the console reported only the known missing favicon on the first load and no errors after the season loads.

## Independent visual review

A fresh reviewer inspected the first capture of this slice, made on commit `ca43c82f0` with the earlier Summer look `[-6, 0.9, 0.02]`, from the images alone. It found that only the yard's grass changes between seasons: floors, walls, street, lot edge and background matched within three levels, the yard's edges against the street and the house were crisp with no seam, halo or tint bleeding, the clock was legible with the season on its second line, and the phone clock neither wrapped nor clipped. The grass's streaks kept the same measured contrast in every season, between 1.17 and 1.35 levels, so Winter loses no pattern even though it looks fainter on the paler grass.

It judged Summer impossible to tell from Spring by the yard alone (a difference of about 4.8); the Summer look is now `[-20, 0.85, 0.04]`, measured above at 10.3. It also found that the first capture's yard colors had included part of the dark background beside the lot, and that its stated time range was wrong; the measurements and times above are taken afresh from grass-only patches and from each frame's clock. It noted Winter's grass is nearly as light as the cream wall caps, so the house outline is softer in Winter, although the walls still stand out by hue and by the caps' highlight line. Two things it saw are older than this branch: on the phone the 2x and 3x speed labels sit over the scene with no background and are hard to read against light furniture, and the phone's Collapse button uses smaller type than its neighbors.
