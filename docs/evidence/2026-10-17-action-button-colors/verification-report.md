# Action color browser verification

The final native Chrome run passed 22 actual-game records and 8 controlled-component records, with no browser page errors. Enabled text contrast was at least 6.35:1 in the measured normal, hover, held-press, and keyboard-focus states. Each measured state retained its control's width and height. The source hashes, computed values, explicit intents, focus outlines, disabled states, and viewport sizes are recorded in [the final receipt](final/browser-report.json).

The run followed the forced-colors correction in commit `534ab2b3b`. It used a fresh isolated context, muted audio, the existing Vite server at `http://127.0.0.1:5189`, and the actual game. Startup required the loading cover to be detached, no startup-failure card, and a working Build action. The verifier closed its pages, context, and browser in `finally`; it did not own or stop the server.

To repeat using an existing Playwright installation:

```powershell
$env:PLAYWRIGHT_MODULE = '<existing Playwright module path>'
$env:GAME_URL = 'http://127.0.0.1:5189'
$env:HEADED = '1'
node scripts/verify-action-colors.cjs output/playwright/action-colors
```

`PLAYWRIGHT_MODULE` may be omitted when `playwright` already resolves. No dependency was installed. The retained `final/` files are exact copies of the successful run's receipt and its listed captures; the separate path prevents earlier same-name image previews from being mistaken for current pixels.

## Inspection of final captures

The browser verifier's author inspected all 20 files below at their supplied resolution. This inspection records visible findings; the computed checks alone cannot establish appearance. A [fresh independent review](independent-review.md) inspected the same final captures and approved the action color scope.

| Capture in `final/` | Visible result |
| --- | --- |
| `build-desktop.png` | Green Confirm, red Cancel and Exit build; selected Furniture remains blue. Exit build has a distinct focus outline. |
| `build-phone.png` | At 390x844, the six tool tabs, footer actions and focused Exit build fit. Tool content scrolls independently. |
| `build-landscape.png` | At 844x390, the footer and tool row remain visible; green/red actions retain readable labels. |
| `build-enlarged-text.png` | Build text and form controls use twice their computed font size through a test-only override. Furniture wraps across lines; content scrolls. Cancel, Confirm and Exit build remain readable and accessible within the panel. |
| `pressed-confirm.png` | The actual held-down Confirm remains green with a readable label. |
| `pressed-cancel.png` | The actual held-down Cancel remains red with a readable label. |
| `build-forced-colors.png` | The focused Confirm has readable black system text on a white system button face, a black boundary and a distinct purple focus outline. |
| `land-dialog.png` | The unaffordable quote explains the price and zero funds. Its sole action is red Cancel with a visible focus outline. |
| `buy-affordable.png` | A real furniture sale funded an enabled $140 Buy quote. Buy is green with a focus outline; Choose item and Cancel are red. This capture proves the quote and control, not purchase acceptance. |
| `creator-desktop.png` | Continue is green and Cancel is red with a cyan focus outline. Randomize, Reset, Turn and Pause remain neutral. |
| `creator-next.png` | Continue advances from Appearance to Personality. The footer retains green Continue and red Cancel. Section navigation remains neutral or blue when selected. |
| `new-game-dialog.png` | The replacement warning remains visible. Start over is green; Keep playing is red with a focus outline. The destructive action was not executed. |
| `radial-menu.png` | The real Fridge menu at 320x568 has a red close control and neutral ordinary actions. Its action region scrolls; all rows need not be visible at once. |
| `radial-more.png` | Real More actions is green, fully visible, and outlined for keyboard focus. |
| `radial-back.png` | Real Back is red, fully visible, and outlined for keyboard focus after advancing the actual Fridge menu. |
| `component-radial-back.png` | A controlled 15-entry menu also shows green More actions and red focused Back while ordinary entries remain neutral. |
| `component-book-prices.png` | Controlled BookCommerce updates Buy book from $12 to $19 while preserving green intent. Sell book is red with a focus outline and retains its $3 price. |
| `component-chores.png` | Controlled ChoresBoard Do now is green with a visible focus outline. Apply preferences is also green. |
| `component-bed.png` | Controlled bed Assign is green with a focus outline. The unavailable Clear assignment control is visibly disabled. |
| `component-pending-books.png` | A controlled request through the actual BookResults class leaves Buy book and Sell book natively disabled and visibly muted. The label and updated price remain present. |

## Defect found and corrected

The original forced-colors CSS used system Highlight and HighlightText for emphasized controls. Native Chrome drew a white text backplate behind white Confirm text, making the label unreadable. This remained reproducible in a clean session without dragging or selected text. [The diagnostic receipt](forced-colors-diagnostic.json) records an empty Selection and automatic forced-color adjustment.

`forced-colors-clean-focus.png` retains the defective actual-game result. `forced-colors-buttonface-diagnostic.png` retains a controlled CSS override using ButtonFace and ButtonText, which restored the label. These diagnostic files are separate from the final actual-source capture. The [blind review](forced-colors-blind-review.md) rejected the defective Case A before learning the condition mapping, accepted the diagnostic Case B, and then accepted the actual repaired source capture in `final/build-forced-colors.png`.

## Evidence limits

1. Book prices and pending state, ChoresBoard Do now, and bed Assign use exported components with controlled sources. They do not prove equivalent live-world state, native command acceptance, or completion timing. Real radial pagination has separate actual-game evidence.
2. Land was unaffordable. No affordable Land confirmation or completed land purchase was exercised. The furniture Buy control was enabled and quoted correctly; its purchase was not executed.
3. The creator has neutral section navigation rather than a dedicated Back control. Continue and Cancel were exercised on desktop. No compact creator capture is included.
4. This focused browser run does not cover every career action, recovery notice, catalogue item, or conditional Build action. Their dedicated tests and the parent task's broader verification remain separate evidence.
5. Enlarged text uses a deliberate presentation override rather than browser zoom. Forced-colors evidence covers the shown Windows/Chrome system palette and focused Build control. The run does not claim every operating-system contrast theme was tested.
6. The verifier exercised pointer states and explicit keyboard routes. It does not claim a complete play session performed entirely by keyboard. Full unit tests, type checking, production build, documentation, changelog, independent review and delivery belong to the parent task.
