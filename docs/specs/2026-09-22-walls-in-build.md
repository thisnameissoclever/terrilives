# The Walls tool shows every wall

Status: shipped in PR 112 at merge `c88ca76`; its played check is [A-walls-in-build].

This is [B-walls-in-build] in `docs/FEATURES.md`, asked for by the owner on 2026-09-22. The original play view omitted the front walls entirely. The current play view uses short walls and local fading, described in `2026-09-30-cutaway-walls.md`. The tools still need to expose the complete editable shell.

## [WB-draw] What is drawn, and when

While the Walls or Room tool is in use, every wall and doorway on the lot's edge list is drawn, including the front walls that play cuts away. How tall they stand is [WB-height]. Leaving those tools restores one-third-height interior and front walls, with local fading behind Sims. Rear outlines stay tall according to the current saved wall and window geometry. The Furniture and Buy tools keep the short view, since furniture is placed inside the rooms. The yard's edge gains no implied wall. Current worlds draw their saved boundaries directly; removing an original wall does not reconstruct an implicit house shell.

## [WB-height] Low and full-height walls

Asked for by the owner on 2026-10-19: full-height front walls hid the tiles being edited. The Walls and Room tools draw interior and front walls low by default, at the one-third height play uses. The lines the Walls tool has chosen, a window's whole span included, stand full height so the player sees the wall being edited. Each panel offers Low and Full height buttons, and T switches between them; Full draws every wall at full height and opacity, as the tools did before. The choice lasts for the session and applies to both tools. Rear outlines stay tall either way, derived from the current layout.

## [WB-pick] Choosing the wall under the pointer

A click in the Walls tool chooses the wall drawn under the pointer before it looks at the floor. Every wall, doorway and window line is tested as the face it is drawn with, at its drawn height, and the face nearest the camera wins. Only when no face is under the pointer does the floor point choose the nearest line, and a point up to 0.4 tiles outside the lot still reaches the lot's outer lines. A wall's face rises one to two tiles above its line on screen, so the floor alone chose a line behind the wall the player aimed at, or nothing at all on the lot's west and north edges.

With a mouse, the line a click would choose is marked with a fainter bar before the click ([WB-mark]).

## [WB-mark] Marking the chosen lines

The chosen line, run or window span is marked on the line itself: a rounded bar on the floor, drawn by the floor-marker pipeline of [PM-marker], blue where a wall may stand and coral where one may not, one bar per stretch of like validity. The chosen walls' own panels take the same blue or coral tint and stay legible at night. The Room, Floors and Land tools keep their per-tile rings.

Each hinged door draws its own frame, so the shell omits the empty doorway panel on that same line. Both wall axes use the current derived hinged-door lists. Current worlds have no separate starting-door frame or privileged doorway line.

Wall height changes presentation. Sims and light read the saved edge list, so raising a wall for inspection does not change its collision or lighting authority. Current floor appearance reads saved base surfaces and coverings. The static floor and wall block is rebuilt when the view choice changes, not on every click in the tool.

## [WB-evidence] Evidence

Tests pin that asking for the cut-away walls draws the same panels as a lot that is all house, apart from the back walls; that the doorway on a cut-away line appears; that the yard's floor looks the same either way; and that main.ts follows the Walls and Room tools and rebuilds only when the choice changes. The played check enters the Walls tool and the Room tool and leaves each.

For [WB-height], [WB-pick] and [WB-mark], `web/tests/wall-pick.test.ts` projects pixels on the faces of all four lot-edge walls at both heights and expects the line under the art; `architecture.test.ts` pins that only the chosen lines rise and are tinted; `ground-markers.test.ts` ties the bar's shader to its CPU replay; and `wall-view.test.ts` pins the Low and Full controls and the T key.
