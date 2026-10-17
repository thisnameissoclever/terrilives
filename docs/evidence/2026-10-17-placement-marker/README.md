# Placement marker played pass, 2026-10-17

A played check of the single footprint-sized placement marker (`docs/specs/2026-10-17-placement-marker.md`) on the production bundle of branch `twcl/build-marker-ellipse` at commit `3e3e3f8a6` (`index-CbDep52B.js`), served by `vite preview` on port 4173 and driven in a Playwright-controlled Chromium window, because the desktop app's browser pane was hidden and could not draw. The household's money came from a schema-thirteen save of the shipped lot with $1,000,000, written into the page's save slot and loaded at startup; the game's sound was muted and the household was paused while Build mode was open. Frames 01 to 06 are 929 by 861 captures of the window; frames 07 to 09 are enlarged crops of them. Nothing was bought: every placement was left pending and discarded with the footer's Cancel.

| Image | Moment | What it shows |
| --- | --- | --- |
| `01-double-bed-valid.jpg` | Buy tool, the Standard Double bed (2 by 2) placed on the kitchen floor; the status reads Ready to buy. | One blue ellipse round the whole bed's ghost, its rim showing where nothing stands in front; Buy $400, the two turn buttons, Choose item and Cancel beside it. |
| `02-bathtub-south-west.jpg` | Buy tool, the bathtub (1 by 2) facing south-west in the bathroom; Ready to buy. | One long blue ellipse tilted along the tub, its left end hidden behind the sink in front of it. |
| `03-bathtub-north-west.jpg` | The same tub turned to face north-west; Ready to buy. | The long ellipse tilted the other way, following the turned footprint, partly behind the existing bathtub in front of it. |
| `04-bathtub-refused.jpg` | The tub moved onto the sofa; the status reads That position overlaps other furniture. | The same single ellipse drawn in coral red round the tub's ghost, partly hidden by the sofa. |
| `05-furniture-dining-table.jpg` | Furniture tool, the dining table (2 by 1) selected; Ready to place. | One blue ellipse under the selected table, partly behind its chairs; Place, Sell $60 and Cancel beside it. |
| `06-housemate.jpg` | Build mode left, Bill selected | The housemate floor ellipse under Bill, its right side behind the shower in front of him. |
| `07-border-comparison.png` | Bill's marker from 06 and the bed marker's left rim from 01, enlarged six times side by side | The same blue and the same border width on both, including the housemate marker's left end, which now matches its top and bottom. |
| `08-bed-rim-at-short-wall.png` | The bed marker from 01, enlarged four times | The rim's right end stops at the short wall beside the hallway door instead of drawing over it. |
| `09-tub-rim-at-short-wall.png` | The turned tub's marker from 03, enlarged four times | The rim's left end stops at the base of the short wall behind the tub. |

No marker in these frames shows its center, because the ghost covers it in every placement; the plain fill at the center is checked by the CPU replica of the shader in `web/tests/ground-markers.test.ts`. The housemate marker and a placement marker do not appear together in any frame because Build mode does not draw the housemate marker, so frame 07 compares them at the same zoom instead.

Checked in the page as well: the served bundle was `index-CbDep52B.js`, built from commit `3e3e3f8a6` on a clean tree; each frame's status line is quoted above as the page reported it; the console reported only the known missing favicon.

## Independent visual review

REVIEW
