# Build mode exit played pass, 2026-10-17

A played check of the Leave Build mode dialog and the footer's leaving Confirm and Cancel, on the production bundle of branch `twcl/build-exit-confirm` at commit `4d5c16047` (`index-Dy1HfXfB.js`), served by `vite preview` on port 4173 and driven in a Playwright-controlled Chromium window, because the desktop app's browser pane was hidden and could not draw. The household's money came from a schema-thirteen save of the shipped lot with $1,000,000, written into the page's save slot; the game's sound was muted. The game clock ran between steps, so a $120 shift payment arrived partway through, which is why the funds below rise once.

| Image | Moment | What it shows |
| --- | --- | --- |
| `01-exit-dialog-desktop.jpg` | An armchair bought in Build mode, then Exit build, at 929 by 861 | The dialog Leave Build mode? over the dimmed game, its text, and Keep building (focused, outlined), Confirm changes and Discard changes stacked one per row. |
| `02-exit-dialog-phone.jpg` | A potted plant bought, then Exit build, at 375 by 812 | The same dialog inside the phone width, 16 pixels from each side, all three buttons full width; the page did not scroll sideways. |

Checked in the page, each step observed rather than assumed:

| Step | Result |
| --- | --- |
| Exit build with an armchair bought and not confirmed | The dialog opened; focus was on Keep building; Build mode stayed open. |
| Escape in the dialog | The dialog closed and Build mode stayed open. |
| Exit build, then Confirm changes | Build mode closed; funds stayed at 999,860, so the armchair was kept. |
| A potted plant bought ($25), then Exit build, then Discard changes | The dialog opened; Build mode closed; funds returned from 999,955 to 999,980. |
| A potted plant bought, then the footer's Cancel | Build mode closed with no dialog; funds returned from 999,955 to 999,980. |
| A potted plant bought, then the footer's Confirm | Build mode closed with no dialog; funds stayed at 999,955. |
| Build mode entered and left with nothing pending | Build mode closed with no dialog. |

The console reported only the known missing favicon.
