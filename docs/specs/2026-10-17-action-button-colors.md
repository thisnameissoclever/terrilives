# Action button colors

## Meaning

The owner requested a consistent visual convention across the room interface, all Build tools, and equivalent controls elsewhere: affirmative, continue, and next actions are green; cancel, never mind, back, and dismissal actions are red. Preserve the game's existing typography, sizes, spacing, borders, and control layout.

Use explicit action intent where each control is defined. Color must not be inferred from visible words or the existing `primary` class. Randomize and Continue currently share that class in the creator, but have different meanings.

| Intent | Treatment | Examples |
| --- | --- | --- |
| `affirmative` | Muted green | Confirm, Confirm changes, Continue, Next, Move in, Apply changes, Place, Build room, Buy, Assign, Apply preferences, Save, Retry, Got it |
| `negative` | Muted red | Cancel, Never mind, Back, Keep playing when it cancels a dialog, Close, Exit build, Clear selection, return to item selection |
| `neutral` | Existing ordinary style | Keep building in the Build exit dialog, tool tabs, zoom, rotation, filters, toggles, Randomize, Undo, Reset defaults, ordinary gameplay choices |

Keep building is an explicit neutral exception: it continues the current edit rather than discarding it. The Build decision dialog places Discard changes above Confirm changes, with Confirm last. Its behavior is defined by the [Build confirmation contract](2026-10-13-build-confirmation.md).

The convention describes direction through an operation, not whether an operation is harmless. A final Start over or Load game confirmation is green under the owner's requested rule. Preserve its existing replacement warning, specific action label, cancellation option, and focus behavior. Do not silently exempt destructive confirmations from the requested convention.

Standalone removal, sale, Clear orders, Clear assignment, and Quit are not navigation cancellations. Preserve their existing destructive treatment; where they lack an explicit role, use a distinct `destructive` role with the red palette and literal labels. Do not recolor all ordinary gameplay actions green. Do now on the chore board is an affirmative execution control. More actions in the radial menu is forward navigation; Back is negative. Opening an Options, Load, New game, or character-creation panel is ordinary navigation and remains neutral until the decision controls appear.

Close on a read-only panel is red dismissal; Got it is green acknowledgment. The labels remain essential because red does not necessarily imply discarded data. No control changes behavior, order, keyboard binding, confirmation requirement, or disabled capability as part of this styling work.

## Shared presentation

Add `data-action-intent="affirmative|negative|destructive"` to semantic controls. Missing intent means neutral. Dynamic action descriptions carry the same typed intent. A small helper may set/remove the attribute; do not introduce a universal button framework, text matcher, document-wide scanner, or mutation observer.

Use shared color variables consumed by each component's normal, hover, focus, and active rules. Initial dark-theme values:

| Role | Background | Text | Border | Hover/active background |
| --- | --- | --- | --- | --- |
| Affirmative | `#264f3d` | `#e8f8ed` | `#74ae88` | `#306348` |
| Negative/destructive | `#5b2d35` | `#fff0f1` | `#ca8993` | `#713b45` |

Keep the existing visible keyboard outline. Text must have at least 4.5:1 contrast against each enabled background. Hover/focus must not fall back to the generic gray button background. Disabled/pending controls remain visibly disabled and do not brighten on hover; preserve their existing capability and accessible disabled state. In forced-colors mode, allow system colors and retain boundaries, labels, and focus indication.

Scope cascade changes carefully: generic button rules, contextual placement controls, the creator's `.primary`, the chore board's Do now control, and the desktop-site notice's inline colors currently compete. Fix those sources rather than distributing `!important` overrides. Do not recolor links, selected tabs, or unrelated blue selection highlights.

## Coverage

Audit static controls in `web/index.html` and dynamic controls in placement actions, the creator, chores, book commerce, bed assignment, careers, object menus, the desktop-site notice, and graphics/floor recovery. Include Land's purchase dialog and the global Build footer. New room-selection/review controls must consume this same convention.

The implementation plan is [shared action colors](../superpowers/plans/2026-10-17-action-button-colors.md). It can be delivered independently of room identities. This document defines intended appearance; it does not claim the colors are already applied.

## Verification

Exercise actual rendered controls in normal, hover, keyboard-focus, pressed, pending, and disabled states. Include creator Randomize beside Continue, a cancel-only unaffordable land dialog, the destructive New game dialog, dynamically updated prices, and the radial menu's Back/More actions pair. Check desktop, compact layouts, enlarged text, and forced-colors mode. Preserve labels/icons so color is never the only cue.

Run the relevant existing interface tests, web type checking, and production build. Inspect actual game captures and obtain independent visual review. Update the player-facing changelog when the colors are delivered. No dependencies or gameplay behavior changes are authorized.
