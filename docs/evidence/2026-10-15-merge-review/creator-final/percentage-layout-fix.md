# Show saved percentage precision in the creator

The root coordinating review rejected the clipped percentage in `pass-01/01-condition-before.png`. The input stored the correct value, but its 69px width hid trailing digits of 73.1235. The prior review treated this as a field-width limitation. The human owner did not review or reject that capture.

## Change and impact

1. `web/src/ui/character-creator/creator.css` increases numeric input width from 69px to 104px. No value, precision, JavaScript, native command, or saved state changes.
2. The editor is now an inline-size container. When its actual content width is at most 28rem, each field places its label above its control and action buttons. Wider editors use separate label, control, Random, and Lock columns. Action buttons retain their intrinsic text widths.
3. Numeric groups wrap at their actual available width. The slider has a flexible 6rem basis; the number and unit remain together. Viewport-specific field placements were removed, while viewport rules for the shell, navigation, preview, and touch targets remain.

## Focused checks

The helper uses a fresh browser on `about:blank` with the actual stylesheet and a representative creator numeric row. It measures text with the computed font, reserves 16px for the native spin affordance, checks control/editor/document overflow, and saves screenshots. It does not start a server, build the application, or use WebGPU.

1. RED command: `$env:NUMBER_LAYOUT_RUN='number-layout-before'; node docs/evidence/2026-10-15-merge-review/creator-final/check-number-layout.cjs`. Exit 1. At every tested viewport, 69px left 51px of input content space; the text needed 48.316px plus the native control allowance. This agrees with the preserved actual-game clipped capture.
2. Width-only impact probe: `$env:NUMBER_LAYOUT_RUN='number-layout-width104'; node docs/evidence/2026-10-15-merge-review/creator-final/check-number-layout.cjs`. Exit 1. The text fit, but the 768px control overflowed. The failed image remains preserved.
3. GREEN command: `$env:NUMBER_LAYOUT_RUN='number-layout-after'; node docs/evidence/2026-10-15-merge-review/creator-final/check-number-layout.cjs`. Exit 0. At 1440, 1024, 768, 390, and 320px, the text fit with 86px of content space and no control, editor, or document overflow. All browser instances closed in `finally`.
4. Direct image inspection: every `number-layout-after/width-*.png` was opened and inspected. The full 73.1235 value and percent unit are readable. At 1024 and 768px, the slider sits above the number without crossing either action button. At 390 and 320px, the original single control row remains intact.
5. `node --check docs/evidence/2026-10-15-merge-review/creator-final/check-final-built.cjs` exited 0 after adding real-game percentage-width checks and captures at 1440, 768, 390, and 320px. Its bundle assertion now reads the rebuilt application's actual index filename.

These are focused layout checks, not acceptance of the rebuilt game. The parent owns the new build and an independent review of actual final application captures. The original clipped captures remain unchanged. No staging or commits were performed by this worker.

## Actual application check rejected the wrapped layout

Command: `$env:CREATOR_FINAL_RUN='pass-width'; $env:CREATOR_FINAL_BUILD_DIR='.local-build/merge-20261015/web-width'; node docs/evidence/2026-10-15-merge-review/creator-final/check-final-built.cjs`. Exit 1. Six checks passed before the 320px layout assertion failed. Browser and graphics diagnostics remained empty, and the browser closed in `finally`.

The complete 73.1235 value fit at 1440, 768, 390, and 320px. Control overflow was absent at the first three widths but present at 320px. Direct inspection of `pass-width/failure.png` shows the percent unit crowding Random. The actual scrollable dialog has less available width than the original standalone fixture, which did not force its scrollbar. The failed capture and report are preserved. Source remains at 104px with tablet wrapping; no 96px variation was applied or tested. Further layout changes are paused for the root's fresh-context better-way review.

## Structural review and stronger assertions

The fresh reviewer recommended keeping the 104px input, making numeric control groups wrap at their actual available width, and giving the range `flex: 1 1 6rem; width: auto`. This replaced the tablet-only wrapping rule. A strengthened fixture includes sixteen rows to force the actual 15px scrollbar and covers both Lock and Locked at 1440, 1051, 1050, 761, 760, 390, and 320px. Pairwise rectangle intersections and child containment initially passed all fourteen cases in `number-layout-responsive/`.

Direct inspection of all seven Locked captures exposed a measurement gap: button boxes did not intersect, but their text could extend outside them. The helper now also checks button `scrollWidth` against `clientWidth` and the editor's own horizontal overflow. Command `$env:NUMBER_LAYOUT_RUN='number-layout-label-check'; node docs/evidence/2026-10-15-merge-review/creator-final/check-number-layout.cjs` exits 1. At 1051px, Random text clips in both states and Locked clips in the locked state. At 761px, the same label problems occur together with internal editor overflow. The other widths pass these stronger assertions. These failures are retained, the browser is closed, and further outer-grid changes await the root's structural review. No application rebuild or server was started by this worker.

## Container-based field layout

The fresh review then specified the outer-grid architecture described above. It handles the editor's actual content width, including its scrollbar, and gives action buttons non-shrinking text widths. The 104px numeric field and flexible inner numeric group remain unchanged.

Command: `$env:NUMBER_LAYOUT_RUN='number-layout-container'; node docs/evidence/2026-10-15-merge-review/creator-final/check-number-layout.cjs`. Exit 0. All fourteen cases passed the stronger assertions at 1440, 1051, 1050, 761, 760, 390, and 320px in both Lock and Locked states. Every case preserves 73.1235, has no intersecting control rectangles or uncontained children, has no clipped action text, and has no control, document, editor-boundary, or internal editor overflow. The 320px case includes a 15px content scrollbar. The browser closed in `finally`.

All fourteen `number-layout-container/width-*.png` images were opened and inspected. The complete percentage and percent unit are readable, the action labels stay inside their buttons, and the field controls remain separated. At 1051 and 761px, compact fields place the label above the control row; the slider wraps above its atomic number and unit when needed. At 760px, the wider actual editor can keep the label beside its controls despite the narrower viewport. This is an intentional consequence of using available editor width rather than viewport width.

The actual-game helper now applies the same stronger measurements in both lock states and all seven viewports, saves captures before rejecting a failed assertion, and requires a real content scrollbar at 320px. The final rebuilt application passed 30 checks in `pass-container/`; all twenty captures were directly inspected. See `container-acceptance.md` for the exact command, build identities, visible findings, and limits. Independent image review remains with the root and its separate reviewer. No staging or commits were performed.
