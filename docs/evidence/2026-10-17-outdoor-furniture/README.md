# Outdoor furniture played pass, 2026-10-17

A played check of the pool, the pool lounger and the patio umbrella (issue 250, `docs/specs/2026-10-17-outdoor-furniture.md`) on two production bundles of branch `twcl/250-outdoor`. Frames 01 to 10 come from `index-Dd0DGKyd.js`, built from commit `960dfd1b9`; its WebAssembly module was built just before that commit merged main's pull request 288, which changed only comments, tests and one function's visibility in the simulation crate. Frames 11 to 17 come from `index-C3jW8RCU.js`, built from commit `4adaa66fd`, whose only change a player can see is the umbrella's shorter description. Both builds give each outdoor sprite registered depth from the `outdoor-depth` bundle, so frames 07 to 16 show housemates drawn against it.

Each bundle was served by `vite preview` on port 4173 and driven in a Playwright-controlled Chromium window, because the desktop app's browser pane was hidden and could not draw. Both sessions loaded the same save of the shipped lot into the page's save slot, with the game's sound muted. In the first session the clock ran for about 20 seconds while the page loaded, and the game was paused at Day 1, 17:28 with funds of 1,000,120; in the second it was paused at 08:40 with funds of 1,000,000. The art itself was reviewed separately in `docs/assets/review-evidence/outdoor/2026-10-17/art-review.md`.

Frames are lossless 929 by 861 captures. All frames except 01 are taken after one step of Zoom out and a middle-button drag that brought the yard in front of the house into view. Frames 08, 10, 12, 14 and 16 are four times enlargements of the frame before each.

| Image | Moment | What it shows |
| --- | --- | --- |
| `01-yard-filter.png` | Build mode, the Buy tool, the Yard button pressed | The Yard filter pressed and the three cards it leaves, each with its picture: Patio umbrella, Shady Eight, 90; Pool, Backyard Square, 1,200; Pool lounger, Sunstrip, 120. |
| `02-pool-ghost.png` | The pool chosen and moved onto the grass in front of the house | The pool's ghost on the grass inside one blue floor ellipse, with Buy $1,200 above it. |
| `03-lounger-ghost-south-west.png` | The pool bought, then the lounger moved beside it in its first facing | The lounger's ghost inside one long ellipse tilted along it, with Buy $120 above it; the pool sits behind the Choose item and Cancel bar. |
| `04-lounger-ghost-north-west.png` | The lounger turned clockwise once | The lounger and its ellipse turned. |
| `05-three-bought.png` | The lounger turned back and bought, the umbrella placed on the grass and bought, and the selection cleared | The pool, the lounger and the umbrella on the grass, with funds of 998,710: 1,000,120 less $1,200, $120 and $90. |
| `06-lounger-menu.png` | After the footer's Confirm, which also left Build mode, Bill selected and a right-click on the lounger | The action menu titled Pool lounger, Sunstrip, with Sit, Enter build mode and Nothing. |
| `07-housemate-on-lounger.png` | Sit ordered, the clock run until Bill sat, paused at 22:18 | Bill sitting on the lounger at night, with the seat bubble over his head and the selection ring under him, well above the bottom panel. |
| `08-housemate-on-lounger-zoom.png` | Frame 07 enlarged | Bill's whole body on the foot end of the lounger with his feet on the grass, the ring under his feet and the bubble above his head. |
| `09-housemate-on-lounger-north-west.png` | The lounger turned with the Furniture tool so its backrest end faces the camera, Sit ordered again, paused at 23:24 | Bill sitting on the turned lounger, with the bubble over his head and the ring under him. |
| `10-housemate-on-lounger-north-west-zoom.png` | Frame 09 enlarged | Bill's whole body on the lounger's edge with his feet on the grass and his hand on the cushion; no part of his body is missing. |
| `11-housemate-on-lounger-south-east.png` | Second session: the three items bought again with the lounger in its south-east facing, Sit ordered, paused at 12:33 | Bill sitting on the lounger's far edge with his back to the camera, the bubble over his head. |
| `12-housemate-on-lounger-south-east-zoom.png` | Frame 11 enlarged | The cushion's near edge in front of Bill's hips and the lounger hiding his lower legs; his head, back and arms are whole. |
| `13-housemate-on-lounger-north-east.png` | The lounger turned to its north-east facing, Sit ordered, paused at 14:12 | Bill sitting on the lounger's far edge with his back to the camera, the umbrella behind him. |
| `14-housemate-on-lounger-north-east-zoom.png` | Frame 13 enlarged | The cushion in front of Bill's legs and the ring under the lounger; his head, back and arms are whole. |
| `15-housemate-behind-umbrella.png` | Bill walking to the north-east lounger, captured while the clock ran, at 13:55 | Bill passing behind the umbrella, between its pole and the house, just outside the canopy's edge. |
| `16-housemate-behind-umbrella-zoom.png` | Frame 15 enlarged | The canopy, all of it nearer the camera than Bill, drawn over his chest, with his hair above it, his legs below it and the pole in front of his ring. |
| `17-umbrella-ghost.png` | Second session: the umbrella chosen and moved onto the grass | The umbrella's ghost inside one small round ellipse, with Buy $90 above it. |

The page reported these states, which the frames do not show as text. The first spot tried for the pool was refused with "Keep the entire object inside the lot." because it reached past the lot edge; the pool, lounger and umbrella ghosts in the frames read "Ready to buy.", and each purchase read like "Patio umbrella bought.".

The Furniture tool reported the bought lounger's facing as "South-west" in the first session and "South-east" in the second, and each turn as the facing named in the table. The lounger's menu description in the first build reads "A wooden sun lounger with a padded teal cushion and a raised back." The console reported only the missing favicon in either session.

The queue and activity text that follows is also page-reported. Before the first Sit, Bill's queue read "Going to read: The Quiet Moon", an action he had chosen himself, and no player order was queued. Sit was ordered at 17:28; the queue showed "Returning: The Quiet Moon" while he put the book back, then "Sit: Pool lounger" from 18:17 as he walked out, and his activity read Sitting at 19:58. The pause landed after that sitting ended, so Sit was ordered again at 21:12, and a script in the page paused the game within 50 milliseconds of his activity reading Sitting, at 22:18.

For frame 09 the turned lounger needed the tile Bill stood on ("A Sim is standing there."), so he walked off first and sat at 23:23 after a third order. In the second session the same script paused each sitting, and a capture every 150 to 200 milliseconds recorded each walk; the game refused to turn the lounger while he sat on it ("Wait until nobody is using or approaching this object."), so he got up before the north-east turn. In both sessions Sit was chosen by activating its menu button directly from a script in the page.

Not checked: a housemate walking behind the pool, which neither walk in these sessions passed close enough to show.
