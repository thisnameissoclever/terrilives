# Creator numeric-field visual cross-review

## Known defective capture

Inspected `creator-final/pass-01/01-condition-before.png` directly at its original 1240 by 900 pixels.

1. **REJECT.** The Low spirits severity number field does not show its complete saved percentage. Its rightmost digits are clipped inside the input, while the separate percent suffix remains visible. The label, slider, Random button, and Lock button are readable; the failure is specifically the numeric value's available width.
2. This is a visible layout defect. The screenshot does not establish loss or rounding of the stored value. The separate creator report records exact severity preservation and successful apply/save/reload checks.
3. Repaired acceptance requires readable complete percentage text on desktop and narrow screens, with no horizontal page overflow or overlap of the suffix and adjacent controls. Stored precision must remain unchanged.

## Repaired captures

Independently inspected all 20 actual built captures in `creator-final/pass-container/`. These are screenshots of the application, separate from the earlier isolated layout fixtures. The original defective screenshot above remains rejected.

| Capture | Verdict | Visible result |
| --- | --- | --- |
| `02-condition-width-1440-lock.png` | PASS | Complete `73.1235`, separate percent suffix, readable Random and Lock buttons. |
| `02-condition-width-1440-locked.png` | PASS | Complete number and suffix; Random and Locked labels fit without collision. |
| `02-condition-width-1051-lock.png` | PASS | Full number, suffix, and action labels fit within the narrower editor beside its scrollbar. |
| `02-condition-width-1051-locked.png` | PASS | Locked remains fully readable; number and percent suffix remain separate. |
| `02-condition-width-1050-lock.png` | PASS | Full value, suffix, slider, and action buttons fit in the row. |
| `02-condition-width-1050-locked.png` | PASS | Full Locked label fits; no overlap with the percent suffix. |
| `02-condition-width-761-lock.png` | PASS | Slider and numeric value wrap within their control column; the complete value, suffix, Random, and Lock remain readable. |
| `02-condition-width-761-locked.png` | PASS | Wrapped numeric value and suffix remain separate from the complete Locked button beside the scrollbar. |
| `02-condition-width-760-lock.png` | PASS | Narrow-layout row shows the entire number and all control labels. |
| `02-condition-width-760-locked.png` | PASS | Full Locked label and percent suffix remain distinct. |
| `02-condition-width-390-lock.png` | PASS | Wrapped slider and full number fit; percent suffix and action labels do not collide. |
| `02-condition-width-390-locked.png` | PASS | Complete Locked label fits beside Random; number and percent remain readable below the slider. |
| `02-condition-width-320-lock.png` | PASS | With the editor scrollbar visible, complete `73.1235`, percent suffix, Random, and Lock remain contained and readable. |
| `02-condition-width-320-locked.png` | PASS | Long Locked label remains complete at the smallest captured width; no numeric/unit/button collision. |
| `01-condition-before.png` | PASS | Existing saved severity is fully readable in the repaired desktop creator. |
| `02-condition-reselected.png` | PASS | Reselected condition still displays the complete percentage; surrounding controls remain readable. |
| `03-existing-review.png` | PASS | Review displays `Low spirits severity 73.1235%` in full; trait summary and Apply changes are readable. |
| `04-narrow-reset.png` | PASS | Sleep timing number and hour suffix are separate; Reset section and Continue remain readable. |
| `05-narrow-review.png` | PASS | Review disclosures and Move in remain readable with the optional preview hidden. |
| `06-created-household.png` | PASS | The resulting narrow game view shows configured housemates and reachable household controls. |

The narrow navigation strip intentionally scrolls horizontally; clipping at its ends is separate from the repaired fields. At 320 pixels the footer wraps Continue onto another row without obscuring its label.

Read-only CSS inspection confirms that field layout now responds to the editor's own content width, action-button tracks preserve intrinsic text width, numeric controls retain a 104-pixel input, and the slider may wrap. These changes address the visible constraints without changing stored precision or native behavior.

The associated browser report records 30 checks, status PASS, no errors, and `browserClosed: true`. Those are reported interaction results; the per-image verdicts above are this independent visual judgment. During that image-review pass, this reviewer did not open a browser, run tests or builds, change source, or alter the index.

**Final visual verdict: APPROVE the numeric-width repair for the captured desktop and narrow layouts.** No blocking visual finding remains in these captures.

## Independent actual-play follow-through

Ran `node docs/evidence/2026-10-15-merge-review/width-review/actual-play.cjs` against a task-owned Vite preview of `.local-build/merge-20261015/web-container` on port 5193, using a fresh headed Chrome context with audio muted. The program returned exit code 0, status PASS, 25 checks, no browser/graphics warnings or errors, `browserClosed: true`, and `ownedPreviewClosed: true`.

1. Loaded an existing character with the exact saved condition fixture and displayed `73.1235`. Operated Lock and Locked at 1440, 761, and 320 pixels. Independent measurements found no numeric clipping, control collisions, clipped button labels, editor overflow, or page overflow.
2. Navigated all seven creator sections at 320 pixels, inspected Needs & habits and Review, then edited the name at desktop width and applied through Review. Native snapshot comparison retained every other stored character field, including exact condition bits. Reopening the editor still displayed the complete percentage.
3. Confirmed the browser loaded the final container build's application stylesheet. Inspected all ten new screenshots directly: six width/Lock states, narrow Review, narrow Needs & habits, desktop Review, and the reopened condition. Each passes visual review. The 320-pixel footer wraps its action onto a separate row; the navigation strip scrolls intentionally. Neither obscures the tested fields or actions.
4. The browser and preview server were closed in finally blocks. The owner browser and port 5190 were not accessed. No production source, stage, index, or commit was changed.

The helper, exact checks, native snapshots, measurements, and actual screenshots are retained under `width-review/`. **Independent actual-play verdict: APPROVE.**

## Final changelog content and layout

Independently inspected the actual built `changelog-browser/1440-dark.png`, `1440-light.png`, `390-dark.png`, and `390-light.png` captures. **PASS for all four.** Titles, dates, section headings, bullets, save-compatibility consequences, and the update link are readable. Text wraps within the cards without visible clipping or collisions; section spacing remains clear in both themes and widths.

The previously omitted dish-position correction is now present under Fixed: dishes stay at the table setting where the meal was eaten. The copy describes the delivered creator, cleanliness, save, and rendering behavior without development details or a material unsupported claim. No further changelog finding. This follow-up used image inspection only and changed no browser, source, index, or commit.
