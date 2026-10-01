# The phone Build dock keeps controls reachable

The original dock slice shipped in PR 102 at merge `909604a`. The approved [contextual build controls](2026-10-01-build-context-controls.md) replace its panel action rows and four-tool layout.

## [PD-parts] Navigation, settings and contextual actions

The dock contains Build mode, Exit build, and all five tools: Furniture, Walls, Room, Buy and Floors. Settings, selection information and a collapsed Shortcuts reference follow. Catalogue filters, colours, prices, object identity and refusal explanations remain available.

Edits now appear around the active selection in the viewport. The dock does not duplicate placement, rotation, sale, wall or floor actions. Empty space between contextual buttons still accepts game input.

## [PD-tall] Tool content scrolls below navigation

Build moves the same panel into the bottom dock at widths of 700px or less, or heights of 480px or less. Heading, Exit build and tool navigation stay outside scrolling tool content. Labels retain natural widths; narrow navigation scrolls horizontally. Focused form controls use ordinary scrolling into view.

## [PD-short] Compact actions respect the space budget

The panel is bounded to the viewport's available height. Contextual actions stay above it and clear of world controls. When an arc cannot fit, actions use compact rows; targets remain at least 44px. The separate Sim dock keeps its existing breakpoint.

Compact rows share one grid with world controls, visible game space and the tool panel. This allocates intrinsic button height rather than clipping an independently positioned box. Short landscape uses the available row width and puts heading beside navigation. Moving controls between hosts preserves focus.

## [PD-rows] Reading order and hiding

Desktop settings precede selection feedback and Shortcuts. Phone settings scroll without covering navigation. Shortcuts starts closed when entering another tool; selection redraws preserve an opened disclosure. Hidden must win against every responsive display rule, including for contextual actions behind a modal dialog.

## Review record

Earlier dock revisions pinned actions over scrolling content and clipped controls or focus. This revision keeps navigation outside scrolling content and moves edit actions into the viewport. Current evidence belongs to [the build controls report](../assets/review-evidence/build-controls/README.md); PR 102 measurements describe its earlier layout.
