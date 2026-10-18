# R7 wall selection harness review

## Real goal

[G1] Use the real Walls controls to divide the intended empty room in the loaded 30 by 26 household, then inspect the resulting room review. Success requires the intended geometry and review to appear in the actual game, with no direct simulation mutation.

## Diagnosis check

[D1] The harness duplicated the projection incorrectly. Production uses half-width 32 and half-height 21, scales the world term, then adds the camera origin (`web/src/render/iso.ts:22`, `:52`, `:70`, `:84`). For vertical edge `{axis:0,x:18,y:2}`, the floor-line midpoint is `(17.5,2)`, because edge coordinates sit half a tile before tile centers (`web/src/ui/wall-tool.ts:45-64`). With the reported initial origin `(576,-191.99978065490723)` and scale 1, the harness's half-height 16 produces `(1072,120.00021934509277)`. That explains the hardcoded `(1072,120)` almost exactly. Production puts the intended midpoint at approximately `(1072,217.50021934509277)` in buffer pixels. This is evidence about the failed calculation, not a replacement hardcoded click instruction.

[D2] Assuming buffer dimensions equal the reported 1280 by 900 CSS dimensions, production inverts the first click to approximately `(15.178566,-0.321434)`. `nearestLine` therefore chooses horizontal `{axis:1,x:15,y:0}`. The reported last result `{axis:1,x:15,y:3,state:1,reason:null}` agrees with the wrong orientation and column. The exact progression to row 3 is unproven because the original command sequence was not saved. A concrete additional failure mechanism exists: `W` sets `pending`, while `choose` ignores arrow movement until `afterCommands` receives the matching result (`web/src/ui/wall-tool.ts:146-147`, `:172-176`, `:201-205`, `:219-236`). Sending `W`, Down, `W` before the drain can discard Down and the second edit. The harness must await the matching edit result between segments.

[D3] After originY became -163.5, the same `(1072,120)` inverts to `(14.5,-1)` under the same buffer/CSS assumption. That is outside the selectable lot, whose minimum world coordinate is -0.5 (`web/src/ui/wall-tool.ts:56-64`). `choosePoint` does nothing for a null line; it does not clear an existing selection (`:140-144`). Therefore “Choose a line” is consistent with an already empty selection. The camera shift alone explains this attempt's miss.

[D4] Updating the origin while retaining half-height 16 preserves the projection defect. For intended midpoint `(wx,wy)`, the wrong Y is low by `5*(wx+wy)*scale` buffer pixels. Production's inverse moves both recovered coordinates by `-5*(wx+wy)/42` world tiles. At `(17.5,2)`, both shift by about -2.32143. A status saying “A wall stands on this line” proves that some wall was selected, not which one. Exact third-attempt coordinates and selected edge remain unavailable.

[D5] Browser coordinates require the current canvas rect and actual buffer size. `clientToWorld` multiplies client offsets by `canvas.width/rect.width` and `canvas.height/rect.height` before the inverse projection (`web/src/input.ts:293-306`). `canvasToClient` already provides the inverse conversion (`:983-994`). The framebuffer uses device-pixel ratio and a texture-size constraint, and resizing shifts the origin (`web/src/main.ts:1484-1492`). A 1280 by 900 viewport does not establish a 1280 by 900 buffer. Do not multiply or divide by device-pixel ratio separately after using these ratios. The numeric reconstructions above are conditional until buffer dimensions are recorded.

[D6] The current tool changes the meaning of the same click. Review ignores it; Rooms selection consumes its rounded tile; a picked book is handled before Walls; only active Walls receives the fractional world point (`web/src/main.ts:2167-2175`). Walls also refuses selection while blocked or pending and can delegate window-owned lines (`web/src/ui/wall-tool.ts:140-150`). Load and review block edits (`web/src/main.ts:2278-2284`). The worker is currently reloading its manual baseline, so no subsequent click should occur until Load has finished and Walls is visibly active.

## What was taken as fixed but is not

[F1] Room area and anchor do not specify a split. Forty-eight tiles and anchor `[14,2]` do not prove that edge x18, rows 2 through 7 crosses the intended irregular room. Read `roomTiles(1)` through the existing read-only bridge (`web/src/bridge.ts:858`) and inspect its membership. Confirm each proposed segment separates two tiles in that room, and that the full barrier actually separates its connectivity, before touching the game. A read-only flood fill over the saved membership and proposed barriers can establish this without editing the simulation.

[F2] Pointer selection need not be the mechanism for every wall segment. Walls already has deterministic orientation and grid navigation, including an initial center selection (`web/src/ui/wall-tool.ts:201-211`, `:299-310`). Keyboard operation is a supported player path. It can also supply an independent selection reference for checking the repaired pointer harness; it cannot by itself prove pointer accuracy.

[F3] Live origin is insufficient camera state. The existing stress getter exposes x/y but not scale (`web/src/main.ts:2537-2548`). This session reports initial scale 1 and no zoom input, which supports scale 1 only while that history remains true. Do not silently reuse it after wheel, pinch, zoom-button input, or a session change. Projection belongs in the verification harness, using existing production functions and observed state; there is no evidence supporting a renderer rewrite.

## Alternative routes

[ALT1] Repair the pointer harness around production geometry.

Mechanism: import the served production `screenX`, `screenY`, `canvasToClient`, `clientToWorld`, and `nearestLine`; project the intended edge midpoint using a fresh camera/rect/buffer snapshot; assert the complete inverse selects exactly the requested edge before any pointer action. Assert that the browser hit target is the canvas. After the selection click, inspect the two highlighted floor tiles before pressing Wall.

Work required: save the formerly ad hoc commands as a small harness helper; record state and expected edge; add the positive and negative controls below; separate selection from edit and edit from the next movement.

Costs and risks: requires a trustworthy scale and the actual module URLs from this served application. A camera or layout change between measurement and click invalidates the result. Shared functions establish consistency but do not independently prove the rendered highlight, so retain visual inspection.

Makes easier or harder later: removes duplicated geometry and records failed assumptions; remains sensitive to an unobserved camera change.

[ALT2] Use supported keyboard navigation with the repaired pointer path as a separate control.

Mechanism: enter Walls through its button, establish an empty selection through its real controls, then use `V` to select the known center vertical line. For a verified 30 by 26 lot this starts at `{axis:0,x:15,y:13}`. Navigate to the membership-verified target by discrete arrows. Inspect the highlight, press `W`, await its matching result, and advance one segment. BuildToolSwitch restores canvas focus (`web/src/ui/build-tools.ts:85-92`); avoid a second Escape when already unselected, because it can leave Build.

Work required: derive the route from the actual dimensions and target, assert the active tool and focus, and record each completed edit. Still repair and validate the faulty pointer calculation so the defect is not hidden.

Costs and risks: more input events, no pointer acceptance by itself, and pending guards still require completion checks.

Makes easier or harder later: allows camera-independent wall edits and offers an independent reference selection for pointer verification. It does not remove the need to inspect the final visible split.

## Executable verification control before further clicking

[V1] Run this read-only calculation in the existing browser harness, using modules from the exact served application and the actual canvas element. `scale` must come from established current state. For this session only, the reported initial scale 1 and absence of zoom input support passing 1. The snippet deliberately does not import assumed URL paths, read an invented debug field, or mutate the runtime.

```js
function validateWallPoint({ edge, width, height, canvas, camera,
  screenX, screenY, canvasToClient, clientToWorld, nearestLine }) {
  const rect = canvas.getBoundingClientRect();
  const wx = edge.x - (edge.axis === 0 ? 0.5 : 0);
  const wy = edge.y - (edge.axis === 1 ? 0.5 : 0);
  const point = canvasToClient(
    screenX(wx, wy, camera.x, camera.scale),
    screenY(wx, wy, camera.y, camera.scale),
    rect, canvas.width, canvas.height);
  if (!point) throw new Error('Canvas has no usable size');
  const world = clientToWorld(point.x, point.y, rect,
    canvas.width, canvas.height, camera.x, camera.y, camera.scale);
  const line = world && nearestLine(world[0], world[1], width, height);
  const exact = line && line.axis === edge.axis
    && line.x === edge.x && line.y === edge.y;
  if (!exact) throw new Error('Projected pointer selects another edge');
  if (document.elementFromPoint(point.x, point.y) !== canvas)
    throw new Error('Canvas does not own the projected pointer position');
  return { point, world, line, camera: { ...camera },
    rect: rect.toJSON(), buffer: [canvas.width, canvas.height] };
}
```

[V2] Before accepting the repaired helper, feed the old half-height-16 Y calculation through the same production inverse and `nearestLine`. Require the expected-edge assertion to fail. Also evaluate the recorded `(1072,120)` against the actual saved snapshots. If it fails for a different reason than the arithmetic above, retain that evidence and revise the diagnosis; do not change production to satisfy it. This control is a harness calculation only, with no defective click or source mutation.

[V3] Complete Load, confirm the loaded room membership and original geometry, enter Build and Walls through their controls, require `#build-tool-walls[aria-pressed="true"]`, visible `#wall-tool`, no active modal/review, and canvas focus. Refresh origin, rect, buffer and scale provenance immediately before using the validated point. If any changed since validation, recalculate without clicking. A selection click must show the expected adjacent tile pair from `tilesBeside(edge)` (`web/src/ui/wall-tool.ts:68-71`, `:320-323`). Do not use “A wall stands on this line” as an identity assertion. Inspect the screenshot or compare against a keyboard-established reference selection before `W`.

[V4] After each `W`, require `lastWallEditResult` to match axis, x, y, state 1 and no refusal, and require the corresponding wall edge to exist before another movement. A preexisting stale result is insufficient: establish the requested segment was open before editing and observe its transition. Finally inspect the complete barrier and resulting room review. Stop on a refused or mismatched edit; do not add timeouts or retries to conceal a wrong target.

## Recommendation

[R1] Take ALT1, repair the pointer harness around production geometry, then use ALT2's supported keyboard navigation as an independent selection reference if the highlighted tiles are difficult to identify. The exact 16-versus-21 computation explains the first and third targeting errors; the changed origin explains the second. Keep all writes on the real input path. Verify room membership first, validate the old calculation fails before further clicking, and separate selection, edit completion, and final review. No renderer change is justified by this evidence.

## What I could not determine

[U1] No saved harness or full command transcript exists. The caller supplied the three attempts and current state. I inspected production source but performed no browser interaction, runtime mutation, tests, or builds. The actual buffer dimensions, exact third-attempt click, per-key timings, current selected edge, and room membership still need receipts from the owning worker. These gaps prevent claiming that every observed symptom has one proven cause or that x18/y2..7 is the correct split.

[U2] Existing documentation contains historical assumptions: `web/src/input.ts:251-253` describes a fixed 1280 by 720 buffer, while current `main.ts:1484-1492` resizes it. The wall-tool specification also describes an earlier immediate-edit slice. This review follows current executable source. Updating those documents is outside this report-only assignment.

**Next steps**: R7 should verify the intended split from room membership, record the canvas state, and run V1 and V2 before another selection click. No user decision is needed for those checks.
