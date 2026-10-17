# Land tool played pass, 2026-10-17

A played check of the Build mode Land tool (issue 254, part two) on the production bundle of branch `twcl/254-land-ui`, served by `vite preview` on port 4173 and driven in the desktop app's built-in browser at a 1400 by 900 viewport with the game's sound off. The household's money came from a schema-thirteen save of the shipped lot with $1,000,000, written into the page's save slot; the household with $0 is a New game. Frames `01` to `03` come from the first page session on the bundle before the floor fix, entered at 02:02 of day one; frames `04` to `07` come from a second session on the fixed bundle, which loaded the same save at startup and played on to 21:34 before Build was entered, which is why the household there holds $1,000,120; frame `08` is a New game on the fixed bundle; frames `09` and `10` come from a third session on the bundle with the shell lighting fix, loading a save of the shipped lot at 08:00 with $1,000,000 so the check runs in daylight.

| Image | Moment | What it shows |
| --- | --- | --- |
| `01-three-strips-outlined.jpg` | Land tool chosen, nothing picked | Three outlined strips ten tiles deep beyond the west, north and south sides; none on the street side; the panel's three strip buttons and the status "Choose a strip of land." |
| `02-unaffordable-strip-chosen.jpg` | Behind the house picked with $0 | The west strip filled in the red tint; the status in red reads the size, 160 squares, $24,000 and "You have $0." |
| `08-cancel-only-dialog.jpg` | Buy land with $0 | The confirmation repeats the total and says the land cannot be bought yet; only Cancel is offered. |
| `03-affordable-quote.jpg` | Behind the house picked with $1,000,000 | The strip filled in the blue tint; the status reads "$976,000 would remain." |
| `04-rear-strip-bought.jpg` | After Buy in the confirmation | The house and everything in it where they were on screen; ten tiles of yard beyond the west wall; floor and shell walls along the house; funds 976,120; status "Bought 160 squares behind the house for $24,000." |
| `05-cancel-restores-lot.jpg` | After Cancel in the build panel | The original lot and funds back, the house still in place; status "Pending changes cancelled." |
| `06-right-strip-bought.jpg` | Right side bought | Ten tiles of yard beyond the north wall; the house in place; funds 970,120. |
| `07-play-after-confirm.jpg` | After Confirm and Exit build | Normal play on the grown lot. |
| `09-daylight-rear-strip.jpg` | The strip behind the house bought at 08:10, on the bundle with the shell lighting fix | Daylight: the new yard behind the house is lit, the house interior along its west wall is lit as the rest of the house, with no band of outside light crossing the back wall; funds 976,000. |
| `10-daylight-both-strips.jpg` | The right side bought after the rear strip | The right strip is now 30 by 10, 300 squares at $174 a square, $52,200; both new yards lit, the house interior even along the north and west walls; funds 923,800. |
| `00-defect-floor-before-fix.jpg` | The moment of `04` on the build before the floor fix | The floor material zone still decided house against yard from the grid's origin, so grass covered the east of the house and floor reached past the west wall. Kept so the review can be seen to reject it. |

Two defects were found and fixed during the pass, both in commit `932024a9b`: the floor material zone (`web/src/render/tiles.ts`) now follows the house's place, and the confirmation's Buy button hides under the `hidden` attribute (`web/index.html`), which its flex display had overridden.

## Independent visual review

A fresh-context reviewer read all nine images at full size and in enlarged crops, and measured ring rows and the house interior's pixels between frames. Verdict: pass on every expectation that can be read from the frames: the three outlines and the clear street side, the red fill and red quote at $0, the Cancel-only dialog, the blue fill and remaining-funds quote, the two purchases adding grass beyond the shell walls without moving the house, floor or walls (the house interior of `04` and `05` differs by zero pixels), the floor-and-grass defect visible in `00` and absent in `04`, the cancel restoring the lot and funds, and the play view afterward.

Two observations, neither a failure: when the chosen strip is unaffordable, the unchosen outlines take the same red tint, because one highlight carries one tint for all its tiles; and "Pending changes cancelled." in the build panel predates this change and keeps its spelling. The funds in `04` read 976,120 rather than 976,000 because the household earned $120 between `03` and `04`.
