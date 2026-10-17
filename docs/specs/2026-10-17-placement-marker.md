# Placement marker in Build mode

While the Buy tool shows a purchase ghost, or the Furniture tool has a placed object selected to move, the object stands on one floor marker: an ellipse in the style of the marker under a selected housemate, sized and shaped to the object's footprint. One marker belongs to one object. The marker replaces one ring sprite per footprint tile, which the ghost's art mostly hid, so that a two by two pool showed a single square at one corner.

## Contents

- [[PM-marker] One floor ellipse per object](#pm-marker-one-floor-ellipse-per-object)
- [[PM-rows] Marker rows and the marker pass](#pm-rows-marker-rows-and-the-marker-pass)
- [Verification](#verification)

## [PM-marker] One floor ellipse per object

1. **Shape.** The marker is an ellipse on the floor whose axes run along world x and world y. For a footprint $w$ tiles along world x and $d$ tiles along world y, as the preview reports them after facing, its semi-axes are $a = w/\sqrt{2} + m$ and $b = d/\sqrt{2} + m$ tiles, with the margin $m = 0.08$ (`PLACEMENT_MARKER_MARGIN` in `web/src/render/ground-selection.ts`). With $m = 0$ the ellipse passes through the footprint's four corners, which lie at $(\pm w/2, \pm d/2)$ from its center, because $\frac{(w/2)^2}{w^2/2} + \frac{(d/2)^2}{d^2/2} = 1$. Any positive margin keeps every corner, and so the whole object, inside the marker.
2. **Center.** Tile centers are whole numbers, so the footprint of a preview at tile $(x, y)$ is centered at $(x + (w-1)/2, y + (d-1)/2)$. The marker takes the same fixture registration offset as the ghost's art, so the marker of a wall-registered fixture stays under the drawn fixture, as the housemate marker follows a registered fixture.
3. **Projection.** At zoom $s$, the isometric projection draws world x along $u = a s (32, 21)$ and world y along $v = b s (-32, 21)$ in screen pixels. The marker is every point $c + u \cos t + v \sin t$ around its screen center $c$. A square footprint gives an upright ellipse with the housemate marker's proportions. A 1 by 2 footprint gives one long ellipse tilted along the object's length, and turning the object turns the ellipse.
4. **Look.** The marker shares the housemate marker's pass and numbers: a 1.95 pixel border at 0.94 opacity, a fill at 0.105 opacity, and the same anti-aliasing. A placement marker's border keeps that width all the way round a stretched or tilted ellipse. The fragment shader maps the screen offset to the unit circle, takes $f = |q| - 1$ for the mapped offset $q$, and divides $f$ by the length of its screen gradient to estimate the distance to the edge in pixels. The housemate marker keeps its approved border, which measures distance along the ellipse's short axis, so its left and right ends stay about 1.5 times as thick as its top and bottom.
5. **Color.** A placement the game accepts draws the housemate marker's blue, sRGB (0.29, 0.77, 0.98). A refused placement draws a coral red, sRGB (0.98, 0.34, 0.29): the blue's saturation and brightness at the hue of the refused ghost tint (229, 140, 133). The ghost's art keeps its existing accepted and refused tints.
6. **Depth.** The marker lies on the floor-decal plane, `FLOOR_DEPTH - DEPTH_LAYER_STEP / 4`, as the housemate marker does. It is drawn after the opaque pass with a depth test and no depth write, so the ghost and anything in front of it hide the marker's middle while its rim shows around the object. It writes no identity, so picking passes through it, and it takes neither local light nor sky shade.

## [PM-rows] Marker rows and the marker pass

1. `writePlacementPreview` writes the marker as the first of its rows, then the art and any foreground layer. A preview therefore writes two or three rows whatever its footprint size, and `placementInstanceCount` counts the same.
2. Every marker row holds `GROUND_SELECTION_COMMAND` (-14) in instance field 8. Fields 0 and 1 hold its screen center, field 2 its depth, field 3 the selection ring sprite (never sampled), fields 4 to 6 its color, field 9 its border style, and fields 10 and 11 its world semi-axes in tiles. `web/src/render/ground-selection.ts` owns this layout and the two marker writers.
3. The sprite renderer finds every marker row before the frame's passes begin and draws the other dynamic rows around them. The grime, low wall and activity annotation draws cover ranges that hold no marker row.
4. A frame holds at most two markers: the selected housemate's and one placement's. The marker pass draws every marker as an instance of one draw, from a uniform buffer sized once for four markers (`MAX_GROUND_MARKERS`), so a steady frame allocates nothing. A fifth marker row throws rather than reaching the sprite pass, which would read the command as wall art.
5. The Walls tool's tile highlight keeps one ring sprite per tile, because it marks a line of tiles rather than one object.

## Verification

Unit tests in `web/tests/ground-markers.test.ts` and `web/tests/placement-preview.test.ts` cover the semi-axes, the projected axes for 1 by 1, 2 by 2 and 1 by 2 footprints in both orientations, footprint corners on the marker without margin and inside it with margin, the screen box, the housemate marker's unchanged 30 by 19.6875 pixel ellipse and short-axis border, exactly one marker row per preview with its command, center, depth and color for accepted and refused placements, discovery of a housemate marker and a placement marker in one frame, and the sprite draws around marker slots.

The Node tests cannot run WGSL. The shader's pixel distance estimate, border width and depth behavior are verified by reading the shader and by a played check in the game. A played check shows a two by two object, a 1 by 2 object in both facings, an accepted and a refused placement, and the housemate marker unchanged beside a placement marker.
