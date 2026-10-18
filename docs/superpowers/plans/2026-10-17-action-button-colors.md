# Action Button Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make affirmative/forward controls green and cancel/back/dismissal controls red throughout the game while retaining existing control behavior and visual proportions.

**Architecture:** Explicit action metadata selects shared semantic color variables. Static markup and dynamic renderers use the same attribute, and component styles preserve that role in every interaction state. No runtime text matching or new component framework is required.

**Tech Stack:** Existing TypeScript, HTML, CSS, Vitest, and browser tools. No dependencies.

**Spec:** [Action button colors](../../specs/2026-10-17-action-button-colors.md). This is independent of the [room plan](2026-10-17-room-identities.md), whose new controls consume the same convention.

## Global constraints

1. Affirmative, continue, and next actions are green; cancel, never mind, back, and dismissal actions are red.
2. Preserve the game's existing typography, sizes, spacing, borders, and control layout.
3. Color must not be inferred from visible words or the existing `primary` class.
4. No control changes behavior, order, keyboard binding, confirmation requirement, or disabled capability as part of this styling work.
5. Text must have at least 4.5:1 contrast against each enabled background.
6. No dependencies or gameplay behavior changes are authorized.

## Review focus

1. Creator Randomize shares `.primary` with Continue: keep Randomize neutral. Task 2.
2. Placement hover/focus selectors override generic colors: verify computed states. Tasks 1 and 3.
3. Pending controls change labels and prices: retain intent and disabled state after updates. Task 2.
4. Keep playing cancels a destructive dialog: classify its action, not its wording. Task 1.
5. Red/green cues disappear in forced-colors mode: preserve labels, borders, and keyboard focus. Task 3.

### Task 1: Define shared intent styling and mark static controls

**Files:** create `web/src/ui/action-intent.ts` and `action-intent.css`; modify `web/index.html`, relevant CSS imports in `web/src/main.ts`, `web/src/ui/build-controls.css`, `character-creator/creator.css`, `compact-hud.css`.

**Interfaces:** `export type ActionIntent = 'affirmative' | 'negative' | 'destructive' | 'neutral'`; `setActionIntent(button: HTMLButtonElement, intent: ActionIntent): void` sets `data-action-intent`, removing it for neutral. CSS supplies role colors through shared custom properties; it does not change geometry.

- [ ] Capture representative current controls in the actual game for comparison: Build footer, creator Randomize/Continue, Land dialog, New game dialog, and an object menu. Preserve a safe separate save and avoid the owner's running game/storage.
- [ ] Audit static buttons in `web/index.html`. Mark Build Confirm/Cancel, Exit build, window placement/back, Buy land and its dialog, Save, final Load/Start over, Keep playing, Got it, Close, and retry controls according to the spec. Keep all six Build tool tabs neutral.
- [ ] Add the shared style file using the spec's exact palette. Make existing component state selectors consume role variables so hover/focus/active retain the role. Preserve neutral defaults. Remove conflicting inline colors only at the actual owning component.
- [ ] Check enabled text contrast mathematically for every normal/hover background pair. Preserve accessible disabled state and neutral muted appearance while pending; do not brighten disabled controls on hover.
- [ ] Run existing build-context, builder-controls, creator-view, land-tool, and persistence-controller tests plus `npm --prefix web run typecheck`. Do not add tests that merely assert that a CSS source contains a chosen hex value.
- [ ] Inspect the affected static controls in-browser, including focus and cancellation behavior, then commit the shared presentation and static classifications.

### Task 2: Apply intent at dynamic action definitions

**Files:** `web/src/ui/placement-actions.ts`, `character-creator/view.ts`, `chores-board.ts`, `book-commerce.ts`, `bed-assignment.ts`, `career-panel.ts`, `object-menu.ts`, `floor-scene-status.ts`, `desktop-site-notice.ts`, and dynamic controls in `main.ts`; existing related tests.

**Interfaces:** Add `readonly intent: ActionIntent` to `ContextAction` and set it at each action definition. On every render/update, call the shared helper rather than inferring role from `label`, `id`, or `enabled`. Creator forward and cancel controls carry their role independently of `.primary`.

| Surface | Affirmative | Negative/destructive | Neutral |
| --- | --- | --- | --- |
| Placement | Place, Buy, Build room, Place Window | Cancel, Back/Wall controls, Clear selection, Choose item when returning to the catalog; Sell/Remove use destructive | Rotation, Doorway choice, ordinary tool choices |
| Creator | Continue, Apply changes, Move in | Cancel, Back | Randomize, Undo, Reset defaults, preset selection |
| Chores | Apply preferences, Do now | Close | Person/preference selectors |
| Commerce | Buy book | Sell book uses destructive | Item browsing |
| Beds/careers | Assign | Clear assignment/Quit use destructive | Person/path selection |
| Object menu | More actions as forward navigation | Back, Close menu, Never mind | Ordinary gameplay actions |
| Recovery/notice | Retry graphics, Retry floor materials | Close notice | Informational links |

- [ ] Extend meaningful dynamic tests to assert intent survives label/price updates and pending state. Cover creator Continue/Apply/Move in while Randomize stays neutral, placement capability changes, and the radial Back/More actions pair.
- [ ] Run those tests and require failures for the missing semantic attributes before implementing the dynamic renderers.
- [ ] Assign intent at each definition and update attributes when controls are reused. Remove obsolete inherited `.primary` color assumptions. Preserve all handlers, warnings, pending guards, and focus-return behavior.
- [ ] Remove desktop-site notice inline colors that defeat the shared role, keeping its independent layout. Do not make startup-failure rendering depend on the main stylesheet pipeline.
- [ ] Run `npm --prefix web test -- --maxWorkers=1 tests/build-context.test.ts tests/builder-controls.test.ts tests/creator-view.test.ts tests/land-tool.test.ts tests/persistence-controller.test.ts tests/chores-board.test.ts tests/book-controls.test.ts tests/bed-assignment.test.ts tests/career-panel.test.ts tests/desktop-site-notice.test.ts` and `npm --prefix web run typecheck`.
- [ ] Commit the dynamic integration after checking the final diff for unintended behavior changes.

### Task 3: Verify visual coverage and document the convention

**Files:** extend `scripts/verify-build-controls.cjs` or add a focused sibling browser check; dated screenshots/report under `docs/evidence/2026-10-17-action-button-colors/`; `docs/player-visible-strings.md`, build-control documentation, and the delivery-date changelog.

**Interfaces:** Browser checks inspect computed background/text/border colors of actual controls after normal, hover, focus, pressed, disabled, and pending transitions. They operate on an isolated task-owned page and close it in a `finally` block. Stop task-owned preview servers at completion.

- [ ] Verify the entire inventory in the actual game. Include a cancel-only unaffordable Land dialog, destructive Start over/Keep playing, creator forward/back, book prices, chore Do now, and dynamically updated placement actions.
- [ ] Check desktop, compact portrait, short landscape, enlarged text, keyboard-only operation, and forced-colors mode. Confirm color changes do not shrink targets, hide focus, or alter button order.
- [ ] Inspect captures yourself and obtain a fresh independent visual review. Correct conflicts revealed by computed colors; do not approve from CSS text alone.
- [ ] Run `npm --prefix web run typecheck`, `npm --prefix web test -- --maxWorkers=1`, and `npm --prefix web run build`. Before an authorized code push, run the repository's full required gates from `docs/testing-protocol.md`; do not duplicate passing checks without a new change or unresolved concern.
- [ ] Document the semantic attribute and preserve the distinction between navigation direction and destructive risk. Correct the stale five-tool descriptions when touching Build documentation; include Land.
- [ ] Apply the changelog skill for delivery. A player-facing note can say: `Confirmation and next-step buttons are green. Cancel, back and close buttons are red.` Run changelog tests/build and document-ID checks.
- [ ] Obtain a fresh complete-change review. When delivery is authorized, push, merge, verify the remote state, synchronize the checkout, and report deployment separately. The room feature may remain planned while this independent change ships.

## Scope boundary

This plan does not implement room identity or change save formats. It establishes the shared styling consumed by that feature. The exact colors may be adjusted only to meet measured contrast or the owner's visual feedback while retaining the requested green/red meanings and the existing visual style.
