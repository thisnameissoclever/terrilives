# The Walls tool shows every wall

Status: shipped in PR 112 at merge `c88ca76`; its played check is [A-walls-in-build].

This is [B-walls-in-build] in `docs/FEATURES.md`, asked for by the owner on 2026-09-22. During play the house's east and south walls, and any wall or doorway on a line with house on its north or west side and yard on its south or east side, are cut away so the rooms can be seen ([OS-walls] in `docs/specs/2026-09-22-the-outside.md`). In the Walls tool that hid exactly the lines the player might want to edit.

## [WB-draw] What is drawn, and when

While the Walls tool or the Room tool is in use, every wall and doorway on the lot's edge list is drawn, the cut-away ones included. Leaving the tool, or leaving Build, cuts them away again. The back walls still run along the house's north and west sides only, so the yard's edge gains no wall. The Furniture and Buy tools keep the cut-away view, since furniture is placed inside the rooms.

The front door draws its own frame on its line, so that line's empty doorway panel is left out, as a hinged interior door's is; the shell reads the line from the boundary's `front_door_lines`.

Only the drawing changes. Sims and light already read the edge list, not the drawn panels, so nothing a sim does and no light changes when the walls appear. The yard's floor keeps its look, which follows the house's size separately. The static floor and wall block is rebuilt when the choice changes, not on every click in the tool.

## [WB-evidence] Evidence

Tests pin that asking for the cut-away walls draws the same panels as a lot that is all house, apart from the back walls; that the doorway on a cut-away line appears; that the yard's floor looks the same either way; and that main.ts follows the Walls and Room tools and rebuilds only when the choice changes. The played check enters the Walls tool and the Room tool and leaves each.
