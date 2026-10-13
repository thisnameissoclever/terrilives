# Mobile long-press verification

Observed 2026-10-13 on the Windows desktop, as a follow-up to PR #255 commit `8a51dd3ed1d76ba39d75f5d4248a71a47466e6bb`. The user reported native text selection and a browser menu covering the game menu after a mobile long press.

## Candidate identity

| File | SHA-256 |
| --- | --- |
| `web/src/input.ts` | `52C69A311BF4B7DF97628CB5C972DE3A5AA14E9BC377718A818801528ED6C709` |
| `web/src/ui/menu-selection.ts` | `43BE6A8B51873123C968839E92B9076DA2BF40F26740CB94A76E1D387F7F8773` |
| `web/index.html` | `0AF381B3558B389A00288228A1BD56149065A0C840798DAC9F2922E1E2D4A8BB` |

## Observed causes

The canvas already handled its contextmenu event, but the newly opened action menu was another DOM surface. The canvas and menus lacked selection and touch-callout styles, and menu roots did not cancel native selection/menu events.

A separate browser trace then proved release activation at the original overlapping hold position, x=130, y=550. The Armchair menu remained open through the hold and screenshot, with no selection or viewport resize. On release, pointer ID 4 delivered pointerup to the captured canvas, then a trusted click to the newly visible Enter build mode button. Build opened before a deliberate menu tap. Canvas-only click suppression could not intercept that target.

## Changes

1. The canvas, object menu, and build-action menu disable text selection and touch callouts, including the WebKit-prefixed styles.
2. Menu roots prevent selectstart and contextmenu defaults without cancelling pointer, touch-scroll, click, or keyboard events.
3. The opening pointer's release click is consumed at document capture before it reaches a menu action. Keyboard activation and unrelated pointers remain available. A fresh gesture resets stale suppression when no canvas pointer remains held; legacy MouseEvent clicks use the last released pointer identity.

## Checks

| Check | Observed result | Exit / verdict |
| --- | --- | --- |
| New selection guards before implementation | Two assertions failed because native events were not prevented | 1, expected regression |
| Retargeted-release regression before implementation | Menu opened, but the matching release click was not prevented | 1, expected regression |
| `npm run typecheck` in `web` | No TypeScript errors | 0, PASS |
| `npm test -- --maxWorkers=1 tests/menu-selection.test.ts tests/input.test.ts tests/targeted-dishes.test.ts tests/object-menu.test.ts tests/object-menu-layout.test.ts tests/object-commerce-menu.test.ts tests/build-context.test.ts tests/gesture-unlock.test.ts` in `web` | 186 tests passed | 0, PASS |
| `npm run build` in `web` | Production bundle built; existing large-chunk advisory remains | 0, PASS |

Removing fresh-gesture reset made a deliberate tap reusing the opener's pointer ID fail. Resetting unconditionally made another finger disarm the opener and failed its release assertion. Both mutations exited 1, the original source bytes and SHA-256 were restored, and the focused suite passed afterward.

## Touch-browser evidence

A separate Chromium context used a 390 by 844 mobile viewport, touch enabled, and `navigator.maxTouchPoints=1`. Real browser touch input was sent through the Chrome DevTools Protocol at the same overlapping position. No test finger was moved to avoid the button.

1. Holding opened Armchair actions. The finger stayed down for another 800 ms after the action became visible.
2. Menu text remained unselected. The action's computed user-select was none; selection and context-menu events were cancelled.
3. Immediately after release, the menu remained open, Build remained inactive, and selected text remained empty.
4. A separate touch tap entered Build with `Armchair: Chapterhouse Wingback at (9, 9)` selected.
5. After leaving Build, the New housemate name field retained user-select=text, did not cancel selection, and allowed all 15 characters of a test name to be selected. The form was not submitted.

[Initial mobile view](touch-before.png) and [menu after release](mobile-long-press.png). The highlighted action is button focus, not text selection; the browser selection was empty.

The task-owned contexts were closed in finally blocks and the preview server was stopped. Emulated touch verifies the application event sequence, not the native selection toolbar of the owner's physical mobile browser. Owner confirmation on that browser remains required before merge. The previously reported atlas full-suite timeout is unchanged and was not rerun for this focused follow-up. No Rust or WebAssembly source changed.
