<#
.SYNOPSIS
  Builds assets/sprites/atlas.png and its two manifests from the Kenney
  furniture kit plus two generated sprites.

.DESCRIPTION
  The source zip is gitignored (assets/vendor/), so this script is the
  provenance of the committed atlas: without it nobody can regenerate the
  art from the URL recorded in ASSETS.md. It writes three files:

    assets/sprites/atlas.png   the packed texture
    assets/sprites/atlas.toml  the manifest terri-data validates against
    web/src/render/atlas.ts    the same manifest, for the renderer

  Two manifests rather than one because the two readers cannot share a
  format without a new dependency: Rust reads TOML already and the web
  build has no TOML parser. They are written in the same pass from the
  same in-memory list, so they cannot disagree unless one is hand-edited,
  and web/tests/atlas.test.ts reads the TOML and fails if they do.

  Windows only: it uses System.Drawing. CI never runs it - the atlas is a
  committed artifact, not a build step - so a Linux port is only worth
  writing if the art starts changing often.

.NOTES
  SCALE. Kenney's isometric floor tile is 208 source pixels across and
  our tile diamond is 2 * TILE_HALF_WIDTH = 64, so every borrowed sprite
  is scaled by 64/208 and drawn at that size, one texel per screen pixel.

  PROJECTION. The kit's ground plane and ours used to disagree, and that
  disagreement was what made wall runs look jagged. This note used to say
  the choice was between scaling uniformly by width - leaving footprints
  a few pixels off - and squashing every object's height by 0.69 to match
  the ratio, and that width won.

  That framing missed the third option, which is the one that ships now:
  **reshape OUR tile grid to match the art instead of reshaping the art
  to match our grid.** Squashing sprites costs height; changing
  TILE_HALF_HEIGHT costs nothing, because the sprites are untouched and
  only the diamond they stand on changes.

  Measured rather than guessed. A vertical wall's top edge is parallel to
  the ground edge it stands on, so it is a direct probe of the ground
  plane: Isometric/wall_SE.png climbs 69 px over 104 px of run, a slope
  of 0.663, so one of our 32 px tile edges must drop 21 px rather than 16.
  iso.ts therefore carries TILE_HALF_HEIGHT = 21 and this script's
  $TILE_H = 42.

  The floor sprite is the WRONG thing to measure and gives 0.72: it is a
  slab with visible side faces, so its widest scanline sits below the top
  face's midline. That is the measurement that produced the 1.42:1 figure
  this note used to quote.
#>
[CmdletBinding()]
param(
  [string] $Zip = (Join-Path $PSScriptRoot '..\vendor\kenney_furniture-kit.zip'),
  [string] $OutDir = $PSScriptRoot,
  [string] $WebOut = (Join-Path $PSScriptRoot '..\..\web\src\render\atlas.ts')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem

# One tile across in our screen pixels: 2 * TILE_HALF_WIDTH and
# 2 * TILE_HALF_HEIGHT from web/src/render/iso.ts. Only the generated
# floor diamond uses $TILE_H, because only it has to align with the tile
# grid exactly.
$TILE_W = 64
# 42, not 32, and it is 2 * TILE_HALF_HEIGHT from iso.ts. See PROJECTION in
# the notes above: it is measured off the kit's own wall geometry so that a
# run of wall panels chains into one flat surface instead of a sawtooth.
$TILE_H = 42

# One metre in Kenney source pixels, and it is NOT their floor tile.
#
# Their floor tile renders 208 px across, but their grid is not our
# metre: `grid.rs` says one tile is roughly one metre, while measuring
# their furniture against its real-world size puts their tile at about
# 1.7 m. A toilet is roughly 0.4 x 0.7 m and renders 66 px wide, and an
# isometric box of footprint w by d is (w + d) * halfTile wide, so their
# half-tile is 66 / 1.1 = 60 px and their metre is 120. A bunk bed at
# 1.0 x 2.0 m and 172 px wide gives 115 by the same arithmetic.
#
# Scaling by their tile instead - the obvious reading - draws every piece
# of furniture at 58% of its size, which is what the first pass did: the
# lot read as an empty warehouse with doll's-house props in it.
$KENNEY_METRE_PX = 118
$SCALE = $TILE_W / $KENNEY_METRE_PX

# THE WALLS. Two things were wrong and they compounded, which is why the
# first two attempts each fixed half of it and still looked broken.
#
# **Wrong sprite.** `wall_*` covers one of THEIR tile edges, which at the
# metre scale above is 1.84 of ours, so drawing one per tile overlapped
# consecutive panels by about 27 px and the run read as overlapping
# boards. Narrowing the width alone was tried and is worse - the panel's
# top and bottom edges are diagonals cut to the tile slope, and scaling x
# without y re-slopes them, so the run opens into a picket fence.
#
# The kit has the piece that was wanted all along: **`wallHalf_*` is half
# WIDTH, not half height** - 57 x 175 against the full panel's 109 x 212.
# One of those covers one of our tile edges almost exactly, and it is
# still taller than the sim, so it reads as a wall rather than a skirting
# board. It is scaled to exactly $TILE_W / 2 px wide by
# `Get-ScaledKenneySprite -TargetWidth`, uniformly on both axes, so no
# edge is re-sloped.
#
# **Wrong grid.** Even a tile-wide panel sawtooths if the panel's top edge
# and the tile grid climb at different angles, and they did: the art
# climbs at 0.663 and a 2:1 grid climbs at 0.5. That is fixed in iso.ts by
# TILE_HALF_HEIGHT, not here; see PROJECTION in the notes at the top.

# Atlas width in texels. Everything packs into shelves this wide.
#
# 512 rather than 256 since the house grew from 8 objects to 33. Shelf
# packing wastes the tail of every shelf, and at 256 a 93 px bed left
# almost nothing usable beside it, so 36 sprites packed into a texture
# 700 px tall and mostly empty. Widening halves the shelf count and lets
# the tall pieces sit beside each other. Nothing downstream reads the
# dimensions as a constant: both manifests are written from `$ATLAS_W` and
# the measured height in the same pass.
$ATLAS_W = 512
# Transparent gutter between sprites, so linear filtering at a quad edge
# cannot pick up its neighbour.
$PAD = 1

# Declaration order IS the sprite index that content resolves to and the
# render buffer carries, so this list is append-only in spirit: inserting
# in the middle renumbers every sprite after it and silently redraws the
# lot. Packing order below is by height and does not affect these.
$SOURCES = @(
  @{ name = 'floor';                  from = 'generated:floor' }
  @{ name = 'sim';                    from = 'generated:sim' }
  # `wallHalf`, not `wall`, and scaled to one tile edge exactly. See THE
  # WALLS above.
  @{ name = 'wallNS';                 from = 'wallHalf_SE'; width = ($TILE_W / 2) }
  @{ name = 'wallEW';                 from = 'wallHalf_SW'; width = ($TILE_W / 2) }
  @{ name = 'kitchenFridgeBuiltIn';   from = 'kitchenFridgeBuiltIn_SE' }
  @{ name = 'bathroomSinkSquare';     from = 'bathroomSinkSquare_SE' }
  @{ name = 'showerRound';            from = 'showerRound_SE' }
  @{ name = 'toiletSquare';           from = 'toiletSquare_SE' }
  @{ name = 'bookcaseClosedDoors';    from = 'bookcaseClosedDoors_SE' }
  # **Both of these were swapped for pieces that fit their footprint.**
  #
  # Objects occupy exactly ONE tile in the simulation whatever their sprite's
  # width, so a sprite much wider than a tile is drawn over ground it does not
  # own - and since sims now stand on an ADJACENT tile, "adjacent" can land
  # underneath the sprite. Measured on the old pair: a sim standing beside the
  # 2.38-tile corner sofa had 88% of its own sprite inside the sofa's.
  #
  # `loungeSofaOttoman` is 0.78 tiles wide, so one tile of separation actually
  # clears it. `televisionVintage` replaces `cabinetTelevisionDoors`, which was
  # never a television at all - it is a cabinet, 109x110 in the source and
  # therefore square, which is why [C4] recorded it reading as a plank lying on
  # the floor. The vintage set is also the better joke for an object named
  # Cathode Companion.
  #
  # **The bed cannot be fixed this way and is deliberately left alone.** Every
  # bed in the kit is at least 1.46 tiles wide, because a bed genuinely is a
  # multi-tile object; there is no asset that would make one tile of separation
  # enough. That is the case for real footprints, recorded as [A-6] in
  # docs/alpha-feel-notes.md, not something to paper over with a smaller
  # picture of a bed.
  @{ name = 'loungeSofaOttoman';      from = 'loungeSofaOttoman_SE' }
  @{ name = 'televisionVintage';      from = 'televisionVintage_SE' }
  @{ name = 'bedBunk';                from = 'bedBunk_SE' }
  # Appended last, deliberately. The index IS what the render buffer carries,
  # so inserting anywhere but the end renumbers every sprite after it and
  # silently redraws the lot.
  @{ name = 'selectionRing';          from = 'generated:selectionRing' }

  # ---- M2b: the five-room house -------------------------------------------
  #
  # Appended in one block, after the selection ring, for the same append-only
  # reason: the index is the render buffer's, not this file's, and grouping
  # these by room would have meant inserting `kitchenStove` next to
  # `kitchenFridgeBuiltIn` and renumbering everything below it.
  #
  # **Every piece here stands on the floor, and that is a rule rather than an
  # accident of taste.** A footprint BLOCKS its tiles, and the simulation has
  # no notion of a decoration a sim may walk over or of a thing mounted on a
  # wall. So the kit's rugs, doormats, wall mirrors, upper cabinets, ceiling
  # fans and worktop appliances are all deliberately absent: each would either
  # be an invisible obstacle in the middle of a room, or a floating object
  # occupying the tile a sim needs in order to reach the thing underneath it.
  # docs/specs/2026-07-30-the-house-design.md [B4] records the alternative
  # that was rejected, which is a `blocks = false` flag on a footprint.
  @{ name = 'kitchenStove';           from = 'kitchenStove_SE' }
  @{ name = 'kitchenCabinet';         from = 'kitchenCabinet_SE' }
  @{ name = 'kitchenSink';            from = 'kitchenSink_SE' }
  @{ name = 'table';                  from = 'table_SE' }
  @{ name = 'chair';                  from = 'chair_SE' }
  @{ name = 'trashcan';               from = 'trashcan_SE' }
  @{ name = 'loungeSofaLong';         from = 'loungeSofaLong_SE' }
  @{ name = 'loungeChair';            from = 'loungeChair_SE' }
  @{ name = 'loungeChairRelax';       from = 'loungeChairRelax_SE' }
  @{ name = 'radio';                  from = 'radio_SE' }
  @{ name = 'pottedPlant';            from = 'pottedPlant_SE' }
  # `cardboardBoxOpen` and not the kit's `plantSmall1`/`plantSmall2`, which
  # were tried first and measured at 8 x 10 px after scaling - a speck
  # occupying a whole blocked tile, which reads as an invisible obstacle
  # rather than as an ornament. Anything standing on a tile has to be big
  # enough to explain why a sim cannot walk there.
  @{ name = 'cardboardBoxOpen';       from = 'cardboardBoxOpen_SE' }
  @{ name = 'lampRoundFloor';         from = 'lampRoundFloor_SE' }
  @{ name = 'coatRackStanding';       from = 'coatRackStanding_SE' }
  @{ name = 'bedDouble';              from = 'bedDouble_SE' }
  @{ name = 'sideTableDrawers';       from = 'sideTableDrawers_SE' }
  @{ name = 'cabinetBedDrawer';       from = 'cabinetBedDrawer_SE' }
  @{ name = 'desk';                   from = 'desk_SE' }
  @{ name = 'chairDesk';              from = 'chairDesk_SE' }
  @{ name = 'bookcaseClosedWide';     from = 'bookcaseClosedWide_SE' }
  @{ name = 'bathtub';                from = 'bathtub_SE' }
  @{ name = 'washerDryerStacked';     from = 'washerDryerStacked_SE' }

  # ---- A-11: facings, corners, doorways ------------------------------------
  #
  # Appended in one block, same append-only reason as every block above.
  #
  # **The one-facing era ends here, by the owner's direction**: the kit
  # ships every piece at four facings and importing only `_SE` is why the
  # kitchen run faced the wrong wall. The convention for names: the plain
  # name stays the `_SE` facing (nothing existing renumbers or renames),
  # and a directional variant appends its facing - `kitchenStoveSW` is
  # `kitchenStove_SW`. Content refers to atlas names, so a placement's
  # `facing` field resolves `<sprite>SW` and the compile step fails on a
  # facing nobody imported - import them as the lot needs them rather
  # than all 132 at once; the atlas index space is the render buffer's.
  #
  # Wall corners, scaled to the same half-tile edge as the two panels so
  # they tile against them; the doorway piece is one tile edge wide by
  # the kit's own geometry (59x148 source, 32x80 scaled) and 18 px
  # shorter than a wall panel, which reads as a lintel.
  @{ name = 'wallCornerNW';           from = 'wallCornerRond_SW'; width = ($TILE_W / 2) }
  @{ name = 'doorwayNS';              from = 'doorway_SE'; width = ($TILE_W / 2) }
  @{ name = 'doorwayEW';              from = 'doorway_SW'; width = ($TILE_W / 2) }
  # The kitchen run along the north wall, facing the room: south-west
  # facings for the four run pieces, and the inner corner that turns the
  # run down the west wall toward the fridge.
  @{ name = 'kitchenStoveSW';         from = 'kitchenStove_SW' }
  @{ name = 'kitchenCabinetSW';       from = 'kitchenCabinet_SW' }
  @{ name = 'kitchenSinkSW';          from = 'kitchenSink_SW' }
  @{ name = 'kitchenCabinetCornerInnerSW'; from = 'kitchenCabinetCornerInner_SW' }

  # ---- A-11 PR 2: activity indicator bubbles --------------------------------
  #
  # Generated, like the floor and the ring: the kit ships no UI glyphs.
  # One bubble per activity the render buffer's `activities` column can
  # report (walking and none draw nothing - motion is its own indicator).
  # The owner's direction made these the priority: "if you can't see
  # what they're doing, they may as well not be doing anything."
  @{ name = 'indicatorTalk';          from = 'generated:indicatorTalk' }
  @{ name = 'indicatorEat';           from = 'generated:indicatorEat' }
  @{ name = 'indicatorSleep';         from = 'generated:indicatorSleep' }
  @{ name = 'indicatorWait';          from = 'generated:indicatorWait' }

  # ---- M2f PR 3: carried-item badges -----------------------------------------
  # One badge per item kind in content/chains.toml, named carried_<kind>
  # so the shell can resolve them by convention from the pack's own
  # item_kinds list rather than from a second table. The transform is
  # the point: a sim's bag becoming a plate mid-errand is the chain
  # made visible.
  @{ name = 'carried_ingredients';    from = 'generated:carriedIngredients' }
  @{ name = 'carried_dinner';         from = 'generated:carriedDinner' }
)

function New-HighQualityGraphics([System.Drawing.Bitmap] $target) {
  $g = [System.Drawing.Graphics]::FromImage($target)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  return $g
}

# `TargetWidth` overrides $SCALE for sprites whose width has to land on an
# exact number of screen pixels rather than on a shared metre. Only the two
# wall panels use it, because only they have to tile: everything else is a
# freestanding object where a pixel either way is invisible.
#
# **It scales both axes by the same factor.** Forcing the width and leaving
# the height alone re-slopes every diagonal edge in the sprite, which is the
# picket-fence failure recorded in THE WALLS above.
function Get-ScaledKenneySprite([string] $entry, [int] $TargetWidth = 0) {
  $item = $script:archive.Entries | Where-Object { $_.FullName -eq "Isometric/$entry.png" }
  if (-not $item) { throw "the kit has no Isometric/$entry.png" }
  $stream = $item.Open()
  $source = [System.Drawing.Bitmap]::new($stream)
  $stream.Dispose()

  $factor = if ($TargetWidth -gt 0) { $TargetWidth / $source.Width } else { $SCALE }
  $w = [Math]::Max(1, [int][Math]::Round($source.Width * $factor))
  $h = [Math]::Max(1, [int][Math]::Round($source.Height * $factor))
  $scaled = [System.Drawing.Bitmap]::new($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = New-HighQualityGraphics $scaled
  $g.DrawImage($source, (New-Object System.Drawing.Rectangle(0, 0, $w, $h)))
  $g.Dispose()
  $source.Dispose()
  return $scaled
}

# The floor is generated rather than borrowed because it is the one
# sprite whose geometry has to agree with worldToScreen exactly. A tile
# that is a few pixels off tiles with visible seams or overlaps across
# 432 of them, and Kenney's diamond is the wrong ratio for ours anyway.
function New-FloorSprite {
  $scale = 4
  $big = [System.Drawing.Bitmap]::new(($TILE_W * $scale), ($TILE_H * $scale), [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = New-HighQualityGraphics $big
  $w = $TILE_W * $scale
  $h = $TILE_H * $scale
  # Inset by half a scaled pixel so the diamond's own antialiased edge
  # stays inside the sprite instead of being clipped by it.
  [System.Drawing.PointF[]] $points = @(
    [System.Drawing.PointF]::new([float]($w / 2), [float]0.5),
    [System.Drawing.PointF]::new([float]($w - 0.5), [float]($h / 2)),
    [System.Drawing.PointF]::new([float]($w / 2), [float]($h - 0.5)),
    [System.Drawing.PointF]::new([float]0.5, [float]($h / 2))
  )
  $fill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 186, 155, 118))
  $edge = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 160, 130, 96), ($scale * 1.0))
  $g.FillPolygon($fill, $points)
  $g.DrawPolygon($edge, $points)
  $fill.Dispose(); $edge.Dispose(); $g.Dispose()

  $out = [System.Drawing.Bitmap]::new($TILE_W, $TILE_H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g2 = New-HighQualityGraphics $out
  $g2.DrawImage($big, (New-Object System.Drawing.Rectangle(0, 0, $TILE_W, $TILE_H)))
  $g2.Dispose(); $big.Dispose()
  return $out
}

# Which sim is selected, drawn on the ground at its feet.
#
# A floor ring rather than an outline or a head icon, and
# docs/specs/2026-07-30-selection-and-input-design.md [I2] carries the argument:
# an outline needs the sprite's silhouette, which means a second pre-rendered
# outline per sprite or a shader pass sampling neighbouring alpha; a head icon
# leaves the canvas above a sim standing at the top of a lot, because sprites
# here reach 114 px and the camera is fixed.
#
# **Exactly the floor tile's dimensions**, so it is bottom-centre anchored to the
# same point and lands concentric with the tile the sim occupies rather than
# needing an offset nobody would maintain. An ellipse inscribed in the diamond
# rather than a diamond outline: the ring should read as lying ON the ground, and
# a diamond outline reads as a second floor tile.
#
# The colour is the HUD's existing accent, so the selection cue and the need bars
# agree without introducing a palette entry.
function New-SelectionRingSprite {
  $scale = 4
  $w = $TILE_W * $scale
  $h = $TILE_H * $scale
  $big = [System.Drawing.Bitmap]::new($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = New-HighQualityGraphics $big

  # Inset so the stroke stays inside the sprite instead of being clipped by it,
  # and so the ring sits within its tile rather than bleeding onto the next one.
  $inset = 5 * $scale
  $pen = New-Object System.Drawing.Pen(
    [System.Drawing.Color]::FromArgb(235, 111, 178, 210), ($scale * 2.5))
  $g.DrawEllipse($pen, $inset, $inset, ($w - 2 * $inset), ($h - 2 * $inset))
  $pen.Dispose(); $g.Dispose()

  $out = [System.Drawing.Bitmap]::new($TILE_W, $TILE_H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g2 = New-HighQualityGraphics $out
  $g2.DrawImage($big, (New-Object System.Drawing.Rectangle(0, 0, $TILE_W, $TILE_H)))
  $g2.Dispose(); $big.Dispose()
  return $out
}

# An activity bubble: a rounded white balloon (with a tail for speech)
# holding a simple glyph drawn from primitives - dots for talking, a
# fork for eating, an hourglass for waiting - or floating Zz text for
# sleeping. Same 4x-then-downsample recipe as every generated sprite.
function New-IndicatorSprite([string] $kind) {
  $scale = 4
  $side = 26
  $w = $side * $scale
  $h = $side * $scale
  $big = [System.Drawing.Bitmap]::new($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = New-HighQualityGraphics $big

  $white = [System.Drawing.Color]::FromArgb(235, 250, 250, 248)
  $ink = [System.Drawing.Color]::FromArgb(255, 40, 44, 52)
  $brush = New-Object System.Drawing.SolidBrush($white)
  $inkBrush = New-Object System.Drawing.SolidBrush($ink)
  $inkPen = New-Object System.Drawing.Pen($ink, (2 * $scale))

  if ($kind -ne 'sleep') {
    # The balloon. Sleeping skips it: floating letters read as sleep on
    # their own, and a boxed Zz reads as a text-message notification.
    $g.FillEllipse($brush, (2 * $scale), (1 * $scale), ($w - 4 * $scale), ($h - 9 * $scale))
    if ($kind -eq 'talk') {
      # The tail that makes it a SPEECH bubble rather than a badge.
      $tail = @(
        (New-Object System.Drawing.PointF((9 * $scale), ($h - 10 * $scale))),
        (New-Object System.Drawing.PointF((13 * $scale), ($h - 10 * $scale))),
        (New-Object System.Drawing.PointF((8 * $scale), ($h - 2 * $scale)))
      )
      $g.FillPolygon($brush, $tail)
    }
  }

  switch ($kind) {
    'talk' {
      foreach ($cx in @(8, 13, 18)) {
        $g.FillEllipse($inkBrush, (($cx - 1.4) * $scale), (7.6 * $scale), (2.8 * $scale), (2.8 * $scale))
      }
    }
    'eat' {
      # A fork: three prongs into a spine, then a handle.
      foreach ($px in @(10, 13, 16)) {
        $g.DrawLine($inkPen, ($px * $scale), (4 * $scale), ($px * $scale), (8 * $scale))
      }
      $g.DrawLine($inkPen, (10 * $scale), (8 * $scale), (16 * $scale), (8 * $scale))
      $g.DrawLine($inkPen, (13 * $scale), (8 * $scale), (13 * $scale), (14 * $scale))
    }
    'wait' {
      # An hourglass: two triangles tip to tip.
      $top = @(
        (New-Object System.Drawing.PointF((9 * $scale), (4 * $scale))),
        (New-Object System.Drawing.PointF((17 * $scale), (4 * $scale))),
        (New-Object System.Drawing.PointF((13 * $scale), (9 * $scale)))
      )
      $bottom = @(
        (New-Object System.Drawing.PointF((13 * $scale), (9 * $scale))),
        (New-Object System.Drawing.PointF((9 * $scale), (14 * $scale))),
        (New-Object System.Drawing.PointF((17 * $scale), (14 * $scale)))
      )
      $g.FillPolygon($inkBrush, $top)
      $g.FillPolygon($inkBrush, $bottom)
    }
    'sleep' {
      $fontBig = New-Object System.Drawing.Font('Segoe UI', (9 * $scale), [System.Drawing.FontStyle]::Bold)
      $fontSmall = New-Object System.Drawing.Font('Segoe UI', (6 * $scale), [System.Drawing.FontStyle]::Bold)
      $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 250, 250, 248))
      $g.DrawString('Z', $fontBig, $textBrush, (3 * $scale), (6 * $scale))
      $g.DrawString('z', $fontSmall, $textBrush, (13 * $scale), (2 * $scale))
      $fontBig.Dispose(); $fontSmall.Dispose(); $textBrush.Dispose()
    }
  }
  $brush.Dispose(); $inkBrush.Dispose(); $inkPen.Dispose(); $g.Dispose()

  $out = [System.Drawing.Bitmap]::new($side, $side, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g2 = New-HighQualityGraphics $out
  $g2.DrawImage($big, (New-Object System.Drawing.Rectangle(0, 0, $side, $side)))
  $g2.Dispose(); $big.Dispose()
  return $out
}

# A small held-item badge, no balloon: it rides the sim's hands rather
# than its thoughts. 18 px, drawn 4x and downsampled like the
# indicators.
function New-CarriedItemSprite([string] $kind) {
  $scale = 4
  $side = 18
  $w = $side * $scale
  $h = $side * $scale
  $big = [System.Drawing.Bitmap]::new($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = New-HighQualityGraphics $big

  $ink = [System.Drawing.Color]::FromArgb(255, 40, 44, 52)
  $inkPen = New-Object System.Drawing.Pen($ink, (1.6 * $scale))

  switch ($kind) {
    'ingredients' {
      # A grocery bag: a tan trapezoid with a folded top and a leafy
      # something poking out.
      $paper = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 209, 174, 122))
      $fold = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 184, 148, 96))
      $leaf = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 106, 168, 79))
      $bag = @(
        (New-Object System.Drawing.PointF((4 * $scale), (6 * $scale))),
        (New-Object System.Drawing.PointF((14 * $scale), (6 * $scale))),
        (New-Object System.Drawing.PointF((13 * $scale), (16 * $scale))),
        (New-Object System.Drawing.PointF((5 * $scale), (16 * $scale)))
      )
      $g.FillPolygon($paper, $bag)
      $g.FillRectangle($fold, (4 * $scale), (6 * $scale), (10 * $scale), (2 * $scale))
      $g.FillEllipse($leaf, (6 * $scale), (2 * $scale), (3 * $scale), (4.5 * $scale))
      $g.FillEllipse($leaf, (9.5 * $scale), (2.5 * $scale), (3 * $scale), (4 * $scale))
      $paper.Dispose(); $fold.Dispose(); $leaf.Dispose()
    }
    'dinner' {
      # A plate with a steaming dome: white ellipse, domed lid, two
      # wisps.
      $china = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 245, 245, 240))
      $dome = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 214, 217, 224))
      $g.FillEllipse($china, (2 * $scale), (11 * $scale), (14 * $scale), (5 * $scale))
      $g.FillPie($dome, (4 * $scale), (5 * $scale), (10 * $scale), (12 * $scale), 180, 180)
      $steamPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(200, 250, 250, 248), (1.2 * $scale))
      $g.DrawArc($steamPen, (6.5 * $scale), (1 * $scale), (2 * $scale), (3 * $scale), 90, 180)
      $g.DrawArc($steamPen, (10 * $scale), (1 * $scale), (2 * $scale), (3 * $scale), 270, 180)
      $steamPen.Dispose(); $china.Dispose(); $dome.Dispose()
    }
  }
  $inkPen.Dispose(); $g.Dispose()

  $out = [System.Drawing.Bitmap]::new($side, $side, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g2 = New-HighQualityGraphics $out
  $g2.DrawImage($big, (New-Object System.Drawing.Rectangle(0, 0, $side, $side)))
  $g2.Dispose(); $big.Dispose()
  return $out
}

# The kit has 140 pieces of furniture and no people, so the one sprite
# the game most needs is the one nothing ships. Drawn from primitives at
# 4x and downsampled, which is enough antialiasing to sit next to
# pre-rendered art without looking pasted on.
function New-SimSprite {
  $scale = 4
  # A 1.7 m adult next to a 1.8 m fridge, which scales to 83 px tall, so
  # 78. Width follows from the drawing below rather than from anatomy.
  $w = 38; $h = 78
  $big = [System.Drawing.Bitmap]::new(($w * $scale), ($h * $scale), [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = New-HighQualityGraphics $big
  $s = { param($v) [float]($v * $scale) }

  $shadow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70, 20, 16, 30))
  $legs = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 58, 72, 105))
  $torso = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 226, 92, 58))
  $skin = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 240, 201, 162))
  $hair = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 74, 52, 42))

  # A contact shadow, so the sim reads as standing on the floor rather
  # than floating above it. It is part of the sprite because a separate
  # shadow pass would be a second draw call.
  $g.FillEllipse($shadow, (& $s 3), (& $s 67), (& $s 32), (& $s 11))
  # Legs, torso, arms, head, hair. Rounded rectangles approximated with
  # ellipses, which at this size is indistinguishable and much shorter.
  $g.FillEllipse($legs, (& $s 10), (& $s 46), (& $s 8), (& $s 26))
  $g.FillEllipse($legs, (& $s 20), (& $s 46), (& $s 8), (& $s 26))
  $g.FillEllipse($torso, (& $s 8), (& $s 25), (& $s 22), (& $s 30))
  $g.FillEllipse($torso, (& $s 3), (& $s 29), (& $s 7), (& $s 20))
  $g.FillEllipse($torso, (& $s 28), (& $s 29), (& $s 7), (& $s 20))
  $g.FillEllipse($skin, (& $s 10), (& $s 6), (& $s 18), (& $s 20))
  $g.FillEllipse($hair, (& $s 9), (& $s 3), (& $s 20), (& $s 13))

  $shadow.Dispose(); $legs.Dispose(); $torso.Dispose(); $skin.Dispose(); $hair.Dispose()
  $g.Dispose()

  $out = [System.Drawing.Bitmap]::new($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g2 = New-HighQualityGraphics $out
  $g2.DrawImage($big, (New-Object System.Drawing.Rectangle(0, 0, $w, $h)))
  $g2.Dispose(); $big.Dispose()
  return $out
}

$script:archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $Zip))
try {
  $sprites = @()
  foreach ($spec in $SOURCES) {
    $bitmap = switch ($spec.from) {
      'generated:floor' { New-FloorSprite }
      'generated:sim' { New-SimSprite }
      'generated:selectionRing' { New-SelectionRingSprite }
      'generated:indicatorTalk' { New-IndicatorSprite 'talk' }
      'generated:indicatorEat' { New-IndicatorSprite 'eat' }
      'generated:indicatorSleep' { New-IndicatorSprite 'sleep' }
      'generated:indicatorWait' { New-IndicatorSprite 'wait' }
      'generated:carriedIngredients' { New-CarriedItemSprite 'ingredients' }
      'generated:carriedDinner' { New-CarriedItemSprite 'dinner' }
      default {
        # `width` is optional and only the wall panels set it; absent, it is
        # $null, which the [int] parameter takes as 0 and the function reads
        # as "use $SCALE".
        Get-ScaledKenneySprite $spec.from -TargetWidth $spec.width
      }
    }
    $sprites += [pscustomobject]@{
      name   = $spec.name
      bitmap = $bitmap
      x      = 0
      y      = 0
    }
  }

  # Shelf packing, tallest first. Twelve sprites do not need anything
  # cleverer, and a stable sort keeps the output byte-identical across
  # runs so a regenerated atlas produces no spurious diff.
  $shelfX = $PAD
  $shelfY = $PAD
  $shelfH = 0
  foreach ($sprite in ($sprites | Sort-Object -Stable -Property { -$_.bitmap.Height })) {
    if ($shelfX + $sprite.bitmap.Width + $PAD -gt $ATLAS_W) {
      $shelfX = $PAD
      $shelfY += $shelfH + $PAD
      $shelfH = 0
    }
    $sprite.x = $shelfX
    $sprite.y = $shelfY
    $shelfX += $sprite.bitmap.Width + $PAD
    if ($sprite.bitmap.Height -gt $shelfH) { $shelfH = $sprite.bitmap.Height }
  }
  $atlasH = $shelfY + $shelfH + $PAD

  $atlas = [System.Drawing.Bitmap]::new($ATLAS_W, $atlasH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = New-HighQualityGraphics $atlas
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  foreach ($sprite in $sprites) {
    $g.DrawImage($sprite.bitmap, $sprite.x, $sprite.y, $sprite.bitmap.Width, $sprite.bitmap.Height)
  }
  $g.Dispose()

  $pngPath = Join-Path $OutDir 'atlas.png'
  $atlas.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $atlas.Dispose()

  $toml = [System.Text.StringBuilder]::new()
  [void]$toml.AppendLine('# GENERATED by assets/sprites/build-atlas.ps1. Do not edit by hand.')
  [void]$toml.AppendLine('#')
  [void]$toml.AppendLine('# The atlas manifest terri-data validates every object''s `sprite` field')
  [void]$toml.AppendLine('# against, and resolves to the index the render buffer carries. That')
  [void]$toml.AppendLine('# index is the position of the [[sprite]] block below, counting from 0,')
  [void]$toml.AppendLine('# so reordering this file renumbers every sprite after the change.')
  [void]$toml.AppendLine('#')
  [void]$toml.AppendLine('# x, y, w and h are texels in atlas.png. w and h are also the sprite''s')
  [void]$toml.AppendLine('# size on screen: the quad is drawn one texel to one pixel.')
  [void]$toml.AppendLine('')
  [void]$toml.AppendLine("image = ""atlas.png""")
  [void]$toml.AppendLine("width = $ATLAS_W")
  [void]$toml.AppendLine("height = $atlasH")
  foreach ($sprite in $sprites) {
    [void]$toml.AppendLine('')
    [void]$toml.AppendLine('[[sprite]]')
    [void]$toml.AppendLine("name = ""$($sprite.name)""")
    [void]$toml.AppendLine("x = $($sprite.x)")
    [void]$toml.AppendLine("y = $($sprite.y)")
    [void]$toml.AppendLine("w = $($sprite.bitmap.Width)")
    [void]$toml.AppendLine("h = $($sprite.bitmap.Height)")
  }
  # LF, not the platform newline. Both files are committed text read by a
  # Rust build script and a TypeScript bundler on whatever CI runs, and a
  # regenerated atlas should diff as the sprites that moved rather than as
  # every line in the file.
  [System.IO.File]::WriteAllText(
    (Join-Path $OutDir 'atlas.toml'),
    $toml.ToString().Replace("`r`n", "`n"))

  $ts = [System.Text.StringBuilder]::new()
  [void]$ts.AppendLine('// GENERATED by assets/sprites/build-atlas.ps1. Do not edit by hand.')
  [void]$ts.AppendLine('//')
  [void]$ts.AppendLine('// The renderer''s half of the atlas manifest. The other half is')
  [void]$ts.AppendLine('// assets/sprites/atlas.toml, which terri-data validates content')
  [void]$ts.AppendLine('// against; `atlas.test.ts` reads that file and fails if the two drift.')
  [void]$ts.AppendLine('//')
  [void]$ts.AppendLine('// A sprite''s INDEX is its position in `SPRITES`, and that index is what')
  [void]$ts.AppendLine('// the render buffer carries for every entity. It has to agree with the')
  [void]$ts.AppendLine('// order of the [[sprite]] blocks in the TOML, which is why both files')
  [void]$ts.AppendLine('// are written in one pass rather than maintained separately.')
  [void]$ts.AppendLine('')
  [void]$ts.AppendLine('/** One packed sprite. `w` and `h` are texels and screen pixels alike. */')
  [void]$ts.AppendLine('export interface AtlasSprite {')
  [void]$ts.AppendLine('  readonly name: string;')
  [void]$ts.AppendLine('  readonly x: number;')
  [void]$ts.AppendLine('  readonly y: number;')
  [void]$ts.AppendLine('  readonly w: number;')
  [void]$ts.AppendLine('  readonly h: number;')
  [void]$ts.AppendLine('}')
  [void]$ts.AppendLine('')
  [void]$ts.AppendLine("export const ATLAS_WIDTH = $ATLAS_W;")
  [void]$ts.AppendLine("export const ATLAS_HEIGHT = $atlasH;")
  [void]$ts.AppendLine('')
  [void]$ts.AppendLine('export const SPRITES: readonly AtlasSprite[] = [')
  foreach ($sprite in $sprites) {
    [void]$ts.AppendLine("  { name: '$($sprite.name)', x: $($sprite.x), y: $($sprite.y), w: $($sprite.bitmap.Width), h: $($sprite.bitmap.Height) },")
  }
  [void]$ts.AppendLine('];')
  [void]$ts.AppendLine('')
  [void]$ts.AppendLine('/**')
  [void]$ts.AppendLine(' * The index of a sprite the shell itself draws - the floor and the two')
  [void]$ts.AppendLine(' * wall orientations - by name.')
  [void]$ts.AppendLine(' *')
  [void]$ts.AppendLine(' * Smart objects must NOT come through here. Their sprite is content, so')
  [void]$ts.AppendLine(' * it arrives already resolved in the render buffer; naming one here')
  [void]$ts.AppendLine(' * would be a second copy of the object list in TypeScript.')
  [void]$ts.AppendLine(' *')
  [void]$ts.AppendLine(' * Throws rather than returning -1: an unknown name is a build mistake,')
  [void]$ts.AppendLine(' * and -1 would index the uniform array out of range, which WGSL clamps')
  [void]$ts.AppendLine(' * instead of trapping - so the whole floor would silently draw as some')
  [void]$ts.AppendLine(' * other sprite.')
  [void]$ts.AppendLine(' */')
  [void]$ts.AppendLine('export function spriteIndex(name: string): number {')
  [void]$ts.AppendLine('  const index = SPRITES.findIndex((sprite) => sprite.name === name);')
  [void]$ts.AppendLine('  if (index < 0) {')
  [void]$ts.AppendLine('    throw new Error(`atlas.png has no sprite named ${name}`);')
  [void]$ts.AppendLine('  }')
  [void]$ts.AppendLine('  return index;')
  [void]$ts.AppendLine('}')
  $webDir = (Resolve-Path -LiteralPath (Split-Path $WebOut)).Path
  [System.IO.File]::WriteAllText(
    (Join-Path $webDir (Split-Path $WebOut -Leaf)),
    $ts.ToString().Replace("`r`n", "`n"))

  Write-Output "atlas.png $ATLAS_W x $atlasH, $($sprites.Count) sprites"
  foreach ($i in 0..($sprites.Count - 1)) {
    $s = $sprites[$i]
    Write-Output ("  [{0,2}] {1,-24} {2,3},{3,3}  {4,3}x{5,3}" -f $i, $s.name, $s.x, $s.y, $s.bitmap.Width, $s.bitmap.Height)
  }
  foreach ($sprite in $sprites) { $sprite.bitmap.Dispose() }
}
finally {
  $script:archive.Dispose()
}
