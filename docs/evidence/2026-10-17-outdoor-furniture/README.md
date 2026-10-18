# Outdoor furniture played pass, 2026-10-17

A played check of the pool, the pool lounger and the patio umbrella (issue 250, `docs/specs/2026-10-17-outdoor-furniture.md`) on the production bundle of branch `twcl/250-outdoor` at commit `a6601921a` (`index-ogptpZ8i.js`, rebuilt from the committed tree after main was merged in, so the placement marker and the seasons clock appear too). It was served by `vite preview` on port 4173 and driven in a Playwright-controlled Chromium window, because the desktop app's browser pane was hidden and could not draw. The household's money came from a schema-thirteen save of the shipped lot with $1,000,000, written into the page's save slot; the game's sound was muted. Frames are lossless 929 by 861 captures, after one step of Zoom out from frame 03 on; frame 08 is a four times enlargement of frame 07. The art itself was reviewed separately in `docs/assets/review-evidence/outdoor/2026-10-17/art-review.md`.

| Image | Moment | What it shows |
| --- | --- | --- |
| `01-yard-filter.png` | Build mode, the Buy tool, the new Yard button under Room pressed | Yard listed as a Room button, and the three cards it leaves: Patio umbrella, Shady Eight, $90; Pool, Backyard Square, $1,200; Pool lounger, Sunstrip, $120. |
| `02-pool-ghost.png` | The pool chosen and placed on the yard below the house; Ready to buy. | The pool's ghost on the grass inside one blue floor ellipse, with Buy $1,200 beside it. |
| `03-lounger-ghost-south-west.png` | The pool bought, then the lounger placed beside it facing south-west; Ready to buy. | The lounger's ghost inside one long ellipse tilted along it, with Buy $120 beside it. |
| `04-lounger-ghost-north-west.png` | The lounger turned clockwise once; Ready to buy. | The lounger and its ellipse turned to face north-west. |
| `05-three-bought.png` | The lounger turned back and bought, then the umbrella placed and bought | The pool, the lounger and the umbrella on the yard, funds 998,590 (1,000,000 less $1,200, $120 and $90); the red ellipse is the next umbrella's ghost, refused because the spot is now taken. |
| `06-lounger-menu.png` | After the footer's Confirm and Exit build, Bill selected, a right-click on the lounger | The action menu titled Pool lounger, Sunstrip, with Sit, Enter build mode and Nothing. |
| `07-housemate-on-lounger.png` | Sit chosen, the clock run until Bill reached the lounger | Bill sitting on the lounger in the yard at night, with the seat bubble over his head and the selection ring under him. |
| `08-housemate-on-lounger-zoom.png` | Frame 07 enlarged around the lounger | Bill's whole body on the lounger's front edge with his feet on the grass, the ring under his feet and the bubble above his head. |

Checked in the page as well: each status line above is quoted as the page reported it; the lounger's menu description reads "A wooden sun lounger with a padded teal cushion and a raised back. Housemates can sit on its edge; lying back on it is not available yet."; the household's queue showed "Sit: Pool lounger" before Bill walked to it, and his activity then read Sitting; the console reported only the known missing favicon on the first load and no errors after it.

The driving window reported one quirk of the test harness rather than of the game: the action menu ignores a click from the same pointer that opened it, a guard for phones, and Playwright's mouse always reports the same pointer, so Sit was chosen by activating its menu button directly.
