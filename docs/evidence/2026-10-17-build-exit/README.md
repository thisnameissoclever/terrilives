# Build mode exit played pass, 2026-10-17

A played check of the Leave Build mode dialog, the footer's leaving Confirm and Cancel, and the contextual Cancel that clears only the selection, driven in a Playwright-controlled Chromium window because the desktop app's browser pane was hidden and could not draw. The bundles were served by `vite preview` on port 4173. Frames `01`, `03` and `04`, and the steps marked final below, come from branch `twcl/build-exit-confirm` at commit `ac69644ab` (`index-BMzvdbXq.js`, rebuilt from the committed tree with the same file name). Frame `02` and the other steps come from commit `4d5c16047` (`index-Dy1HfXfB.js`); the dialog's markup and styles are unchanged between the two commits. The household's money came from a schema-thirteen save of the shipped lot with $1,000,000, written into the page's save slot; the game's sound was muted. The game clock ran outside Build mode, so a $120 shift payment arrives between some steps, which is why the funds rise.

| Image | Moment | What it shows |
| --- | --- | --- |
| `01-exit-dialog-desktop.jpg` | A potted plant bought in Build mode and not confirmed, then Exit build, at 929 by 861 | The dialog Leave Build mode? over the dimmed game, its text, and Keep building (focused, outlined), Confirm changes and Discard changes stacked one per row. A capture taken 41 seconds earlier, with Escape held from the game view after eight key repeats, was byte for byte the same image, because the household was paused and the dialog looks the same whichever way it opens, so only this one is kept. |
| `02-exit-dialog-phone.jpg` | A potted plant bought, then Exit build, at 375 by 812 | The same dialog inside the phone width, 16 pixels from each side, all three buttons full width; the page did not scroll sideways. |
| `03-context-cancel-keeps-batch.jpg` | A potted plant bought, the Buy tool still showing a new plant's ghost, then the Cancel beside it | Build mode still open with no ghost and no buttons beside it, and the game view holding keyboard focus (its blue inner outline); the bought plant stands in the kitchen; funds unchanged at 1,000,095. |
| `04-after-double-click-confirm.jpg` | A plant bought, then a double-click on the footer's Confirm | Play mode, the plant kept in the kitchen, funds 1,000,095, and Bill's queue holding only Take a bath: Bathtub, so the second click gave no order. |

Checked in the page, each step observed rather than assumed:

| Step | Bundle | Result |
| --- | --- | --- |
| Exit build with an armchair bought and not confirmed | `4d5c16047` | The dialog opened; focus was on Keep building; Build mode stayed open. |
| Escape in the dialog | `4d5c16047` | The dialog closed and Build mode stayed open. |
| Exit build, then Confirm changes | `4d5c16047` | Build mode closed; funds stayed at 999,860, so the armchair was kept. |
| A potted plant bought ($25), then Exit build, then Discard changes | `4d5c16047` | The dialog opened; Build mode closed; funds returned from 999,955 to 999,980. |
| A potted plant bought, then the footer's Cancel | `4d5c16047` | Build mode closed with no dialog; funds returned from 999,955 to 999,980. |
| A potted plant bought, then the footer's Confirm | `4d5c16047` | Build mode closed with no dialog; funds stayed at 999,955. |
| Build mode entered and left with nothing pending | `4d5c16047` | Build mode closed with no dialog. |
| A plant bought, then the Cancel beside the next ghost | final | The ghost and its buttons cleared and the status read Choose something to buy.; Build mode stayed open with no dialog; funds stayed at 1,000,095, so the purchase was kept. |
| Escape held from the game view (focus on the page body), with the plant still pending | final | The first keydown opened the dialog with focus on Keep building; eight repeated keydowns and the key's release left it open; a fresh press closed it as Keep building, with Build mode still open and funds unchanged. |
| Exit build, then a double-click on Discard changes | final | Build mode closed; funds returned from 1,000,095 to 1,000,120; Bill, selected, kept the same queue (Sleep: Bunk bed) and received no order from the second click, which landed on the game where the dialog had been. |
| A plant bought, then a double-click on the footer's Confirm | final | Build mode closed; funds stayed at 1,000,095; Bill's queue (Take a bath: Bathtub) was unchanged. |

The console reported only the known missing favicon on the first page load and no errors during the final steps.
