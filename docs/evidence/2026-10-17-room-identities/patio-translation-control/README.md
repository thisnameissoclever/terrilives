# Patio translation renderer control

The production renderer preserves the paved patch during a ten-tile west
translation in this controlled fixture. All 784 interior paving samples match
exactly, with no browser or GPU error reported. This is a renderer check, not
acceptance of native land purchases, Build cancellation, saves, or cleaning.

1. Render the appended Outdoor patio covering with the normal architecture atlas,
   finish resources, static-floor builder, and SpriteRenderer in displayed Chrome.
   The canvas is 640 by 560 pixels in an 850 by 700 viewport, at scale 1.5.
2. Paint tiles centered at x=4..6 and y=4..6. Render a 12 by 12 lot with origin
   (0,0), then a 22 by 12 lot with house origin (10,0) and all painted tiles moved
   ten columns. Offset the camera by the corresponding isometric displacement so
   the same paving remains at the same screen positions.
3. Sample coordinates 3.65 through 6.35 on both axes in steps of 0.1. These remain
   inside the painted footprint, whose physical bounds are 3.5 through 6.5. Reject
   samples outside the opaque gray material before comparing pixel values.

Both [before-west.png](before-west.png) and [after-west.png](after-west.png) show
the same rectangular gray paving and aligned grout. Additional unpainted ground
changes the surrounding crop. The tile-pattern image repeats exactly every 32
pixels horizontally, within its 256-pixel width. Its nominal four-tile period
therefore does not imply that a ten-tile translation moves the visible pattern.
No renderer change was required.

[The render report](render-report.json) records sample results and camera settings.
[The source receipt](source-receipt.json) records hashes and inspection limits.
The generated WebAssembly module is not used by this fixture. Actual in-game
purchase, cancellation, reload, and cleaning remain separate acceptance checks.
