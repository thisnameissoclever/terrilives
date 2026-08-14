"""Every sprite in the game, drawn from primitives.

The names here are a CONTRACT, not a naming choice. `content/objects.toml`
resolves 30 of them, `tiles.ts` asks for 6 more by hand, and terri-data
fails the content build on a dangling reference, so dropping or renaming
one breaks the game rather than making it look different.

Walls stay tile-CENTRED panels here, matching what `tiles.ts` draws today.
Moving them onto tile edges is [B7] and is a renderer change, not an art
change. What this file can fix without [B7] is the picket-fence read: the
outgoing panels carry a bright lit edge that repeats every 32 px down a
run, so the run stripes. These do not have one.
"""
from style import (PALETTE as C, OUTLINE, OUTLINE_WIDTH,
                   CHARACTER_PALETTES, FACE_LEFT, FACE_RIGHT, FACE_TOP,
                   mul, mix)
from iso import (P, Pf, OX, OY, sx, sy, box, slab, cyl, diamond, surface,
                 facing_aabb, legs, contact_shadow, canvas, emit, plump,
                 HW, HH, Z_UNIT)
from chars import person

WALL_H = 2.0
A, B = -0.5, 0.5          # a 1x1 footprint, centred on the anchor tile
FACINGS = ("se", "sw", "nw", "ne")


# ---------------------------------------------------------------- shell ----
def floor(d):
    diamond(d, A, A, B, B, C["floor"], outline=C["grout"], width=1)
    # Two hairline diagonals. A flat diamond reads as a void; a grouted
    # one reads as a tile the furniture can sit on. The lines stay inside
    # the outline so a 1 px overshoot cannot seam the ground plane.
    d.line([P(A + .04, A + .04), P(B - .04, B - .04)],
           fill=mul(C["grout"], 1.04), width=1)
    d.line([P(A + .04, B - .04), P(B - .04, A + .04)],
           fill=mul(C["grout"], 0.96), width=1)


def selectionRing(d):
    # The pale outer key remains visible after the midnight ambient multiply;
    # the sage inner key keeps the selection colour recognizable at noon.
    # The renderer makes this overlay fully emissive, so both inks remain
    # semantic UI rather than inheriting a nearby lamp pool.
    diamond(d, A, A, B, B, None, outline=C["linen"], width=3)
    diamond(d, A + .09, A + .09, B - .09, B - .09, None, outline=C["select"], width=2)


def _wall(d, axis, height=WALL_H, skirt=True):
    def face(z0, z1, colour, cap=True):
        a = (lambda t, z: P(0, t, z)) if axis == "ns" else (lambda t, z: P(t, 0, z))
        d.polygon([a(A, z1), a(B, z1), a(B, z0), a(A, z0)], fill=colour)
        if cap:
            d.line([a(A, z1), a(B, z1)], fill=OUTLINE, width=OUTLINE_WIDTH)
            d.line([a(A, z0), a(B, z0)], fill=OUTLINE, width=OUTLINE_WIDTH)
    face(0, height, mul(C["wall"], 0.94))
    # A picture rail, not a second material. Horizontal only, so a run
    # does not picket-fence.
    a = (lambda t, z: P(0, t, z)) if axis == "ns" else (lambda t, z: P(t, 0, z))
    d.line([a(A, 1.62), a(B, 1.62)], fill=mul(C["wall"], 0.86), width=1)
    if skirt:
        face(0, 0.14, mul(C["skirt"], 0.94))


def wallNS(d):
    _wall(d, "ns")


def wallEW(d):
    _wall(d, "ew")


def wallCornerNW(d):
    """Closes the join where the two boundary runs meet.

    Full height on purpose. The outgoing piece is roughly half a panel
    tall, which leaves an open wedge at the corner that reads as a hole in
    the room - the thing [A-11] reported as "wall segments don't touch".
    """
    t = 0.11
    box(d, -t / 2, -t / 2, t / 2, t / 2, 0, WALL_H, mul(C["wall"], .96),
        top=C["wall_top"])
    box(d, -t / 2, -t / 2, t / 2, t / 2, 0, 0.14, C["skirt"])


def _doorway(d, axis):
    """A lintel over an opening: the wall, with its bottom two thirds gone."""
    def face(a0, a1, z0, z1, colour):
        if axis == "ns":
            pts = [P(0, a0, z1), P(0, a1, z1), P(0, a1, z0), P(0, a0, z0)]
        else:
            pts = [P(a0, 0, z1), P(a1, 0, z1), P(a1, 0, z0), P(a0, 0, z0)]
        d.polygon(pts, fill=colour, outline=OUTLINE, width=OUTLINE_WIDTH)
    wall = mul(C["wall"], 0.94)
    face(A, B, 1.30, WALL_H, wall)                 # the lintel
    face(A, A + .12, 0, 1.30, wall)                # jambs
    face(B - .12, B, 0, 1.30, wall)


def doorwayNS(d):
    _doorway(d, "ns")


def doorwayEW(d):
    _doorway(d, "ew")


def _front_visible(facing):
    """SE and SW put the working face on a camera-visible isometric side."""
    return facing in ("se", "sw")


def _panel(d, x, y0, y1, z0, z1, colour, facing):
    """A rectangle on the local +x face, which is the SE working face."""
    d.polygon([
        Pf(x, y0, z1, facing), Pf(x, y1, z1, facing),
        Pf(x, y1, z0, facing), Pf(x, y0, z0, facing),
    ], fill=colour, outline=OUTLINE, width=OUTLINE_WIDTH)


def _bar_handle(d, x, y, z, facing, *, tall=0.22, colour=None):
    """A brass bar standing off the working face, not a 2px scribble."""
    colour = colour or C["accent_brass"]
    box(d, x, y, x + .08, y + .10, z, z + tall, colour, facing=facing)


def _handle(d, x, y0, y1, z, facing, colour=None):
    colour = colour or mul(C["metal"], .75)
    d.line([Pf(x, y0, z, facing), Pf(x, y1, z, facing)], fill=colour, width=2)


def _span(facing, along_tiles, across=0.88, inset=0.06):
    """A 2-tile AABB that always grows away from the camera.

    SE/NW run along x; SW/NE run along y. Details choose which end is the
    headboard; the box itself stays in the safe -x/-y quadrant.
    """
    if facing in ("se", "nw"):
        return (0.5 - inset - along_tiles, -across / 2,
                0.5 - inset, across / 2)
    return (-across / 2, 0.5 - inset - along_tiles,
            across / 2, 0.5 - inset)


def _basin(d, x0, y0, x1, y1, rim_z, porcelain, *, facing="se",
           water=False, lip=0.16, depth=0.32, cap=True):
    """A recessed hole. Inner-wall outlines are omitted on purpose: they
    bisect the well and turn it into a sticker on the rim."""
    x0, y0, x1, y1 = facing_aabb(x0, y0, x1, y1, facing)
    well_z = rim_z - depth
    ix0, iy0, ix1, iy1 = x0 + lip, y0 + lip, x1 - lip, y1 - lip
    far_a = mul(porcelain, 0.42) if water else mul(C["ink"], 1.28)
    far_b = mul(porcelain, 0.36) if water else mul(C["ink"], 1.18)
    d.polygon(
        [P(ix0, iy0, rim_z), P(ix1, iy0, rim_z),
         P(ix1, iy0, well_z), P(ix0, iy0, well_z)],
        fill=far_a,
    )
    d.polygon(
        [P(ix0, iy0, rim_z), P(ix0, iy1, rim_z),
         P(ix0, iy1, well_z), P(ix0, iy0, well_z)],
        fill=far_b,
    )
    contents = C["water"] if water else mul(C["ink"], 1.08)
    content_z = well_z + depth * (0.42 if water else 0.08)
    surface(d, ix0 + .02, iy0 + .02, ix1 - .02, iy1 - .02, content_z, contents)
    if water:
        d.polygon(
            [P(ix0, iy1, rim_z), P(ix1, iy1, rim_z),
             P(ix1, iy1, well_z), P(ix0, iy1, well_z)],
            fill=mul(porcelain, 0.72),
        )
        d.polygon(
            [P(ix1, iy0, rim_z), P(ix1, iy1, rim_z),
             P(ix1, iy1, well_z), P(ix1, iy0, well_z)],
            fill=mul(porcelain, 0.58),
        )
    if cap:
        d.polygon(
            [P(x0, y1, rim_z), P(x1, y1, rim_z),
             P(x1, y1 - lip, rim_z), P(x0, y1 - lip, rim_z)],
            fill=mul(porcelain, FACE_TOP), outline=OUTLINE, width=OUTLINE_WIDTH,
        )
        d.polygon(
            [P(x1, y0, rim_z), P(x1, y1, rim_z),
             P(x1 - lip, y1, rim_z), P(x1 - lip, y0, rim_z)],
            fill=mul(porcelain, FACE_TOP), outline=OUTLINE, width=OUTLINE_WIDTH,
        )


def _faucet(d, x, y, z, facing, height=0.26):
    """Stem on the far rim, spout reaching toward the basin centre."""
    box(d, x - .035, y - .035, x + .035, y + .035, z, z + height, C["metal"],
        facing=facing)
    box(d, x - .03, y - .02, x + .03, y + .14, z + height - .02, z + height + .05,
        C["metal"], facing=facing)
    box(d, x - .025, y + .10, x + .025, y + .16, z + height - .10, z + height - .02,
        C["metal"], facing=facing)


# ------------------------------------------------------------- kitchen ----
def _counter(d, kind, facing="se"):
    """The kitchen run. `facing` is which way the working face points."""
    contact_shadow(d, A + .02, A + .02, B - .02, B - .02, facing)
    box(d, A + .04, A + .04, B - .04, B - .04, 0, 0.78, C["cabinet"],
        facing=facing)
    if kind != "corner":
        _panel(d, B - .04, A + .16, B - .24, 0.12, 0.70,
               mul(C["cabinet"], .88), facing)
        if kind == "hob":
            _panel(d, B - .04, A + .22, B - .28, 0.26, 0.46,
                   mul(C["ink"], 1.22), facing)
            _panel(d, B - .04, A + .18, B - .24, 0.56, 0.70,
                   C["accent_brass"], facing)
        else:
            _panel(d, B - .04, A + .18, A + .28, 0.38, 0.58,
                   C["accent_brass"], facing)
    slab(d, A, A, B, B, 0.86, C["counter"], thick=0.08, facing=facing)
    if kind == "sink":
        _basin(d, A + .18, A + .18, B - .18, B - .18, 0.86, C["counter"],
               facing=facing, water=False, lip=0.10, depth=0.28, cap=False)
        _faucet(d, 0.0, A + .10, 0.86, facing, height=0.26)
    elif kind == "hob":
        for cx, cy in ((-.14, -.14), (.14, -.14), (-.14, .14), (.14, .14)):
            surface(d, cx - .10, cy - .10, cx + .10, cy + .10, 0.87,
                    mul(C["ink"], 1.42), facing=facing)
            surface(d, cx - .06, cy - .06, cx + .06, cy + .06, 0.875,
                    C["counter"], facing=facing)
            surface(d, cx - .03, cy - .03, cx + .03, cy + .03, 0.88,
                    mul(C["metal"], .70), facing=facing)
        box(d, -.24, A + .02, .24, A + .14, 0.86, 1.02, C["metal"],
            facing=facing)
        for kx in (-.16, -.05, .05, .16):
            box(d, kx - .03, A + .05, kx + .03, A + .12, 1.02, 1.08,
                C["accent_brass"], facing=facing)


def kitchenCabinet(d): _counter(d, "plain")
def kitchenSink(d): _counter(d, "sink")
def kitchenStove(d): _counter(d, "hob")
def kitchenCabinetSW(d): _counter(d, "plain", "sw")
def kitchenSinkSW(d): _counter(d, "sink", "sw")
def kitchenStoveSW(d): _counter(d, "hob", "sw")
def kitchenCabinetCornerInnerSW(d): _counter(d, "corner", "sw")


def _fridge(d, facing="se"):
    contact_shadow(d, A + .06, A + .06, B - .06, B - .06, facing)
    box(d, A + .08, A + .08, B - .08, B - .08, 0, 1.62, C["metal"],
        top=mul(C["metal"], 1.06), facing=facing)
    _panel(d, B - .08, A + .10, B - .10, 0, 0.12, mul(C["ink"], 1.38), facing)
    _panel(d, B - .08, A + .12, B - .14, 1.18, 1.54, mul(C["metal"], .88),
           facing)
    _panel(d, B - .08, A + .12, B - .14, 0.16, 1.12, mul(C["metal"], .94),
           facing)
    _panel(d, B - .08, A + .14, A + .24, 1.26, 1.48, C["accent_brass"], facing)
    _panel(d, B - .08, A + .14, A + .24, 0.36, 0.86, C["accent_brass"], facing)


def kitchenFridgeBuiltIn(d):
    _fridge(d, "se")


# ------------------------------------------------------------ bathroom ----
def _toilet(d, facing="se"):
    p = C["porcelain"]
    contact_shadow(d, -.24, -.32, .24, .34, facing)
    box(d, -.18, -.32, .18, -.02, 0, 0.70, p, facing=facing)
    slab(d, -.20, -.34, .20, .00, 0.76, mul(p, .98), thick=0.06, facing=facing)
    box(d, .10, -.26, .16, -.16, 0.60, 0.68, C["metal"], facing=facing)
    box(d, -.16, -.04, .16, .30, 0, 0.28, p, skip_top=True, facing=facing)
    box(d, -.16, -.04, .16, .04, 0.28, 0.34, p, facing=facing)
    _basin(d, -.16, -.04, .16, .30, 0.34, p, facing=facing, lip=0.07, depth=0.18)
    box(d, -.16, .23, .16, .30, 0.28, 0.34, p, facing=facing)


def toiletSquare(d):
    _toilet(d, "se")


def _bathroom_sink(d, facing="se"):
    p = C["porcelain"]
    contact_shadow(d, -.24, -.20, .24, .20, facing)
    box(d, -.08, -.06, .08, .08, 0, 0.48, mul(p, .92), facing=facing)
    box(d, -.28, -.22, .28, .22, 0.48, 0.70, p, facing=facing)
    _basin(d, -.24, -.18, .24, .18, 0.70, p,
           facing=facing, water=False, lip=0.07, depth=0.26)
    _faucet(d, 0.0, -.16, 0.70, facing, height=0.24)


def bathroomSinkSquare(d):
    _bathroom_sink(d, "se")


def _shower(d, facing="se"):
    g = mix(C["water"], (255, 255, 255), 0.55)
    p = C["porcelain"]
    contact_shadow(d, A + .06, A + .06, B - .06, B - .06, facing)
    box(d, A + .08, A + .08, B - .08, B - .08, 0, 0.12, p, facing=facing)
    surface(d, A + .16, A + .16, B - .16, B - .16, 0.12, mul(p, .78),
            outline=OUTLINE, width=OUTLINE_WIDTH, facing=facing)
    box(d, A + .08, A + .08, B - .08, A + .16, 0.12, 1.64, g, facing=facing)
    box(d, A + .08, A + .08, A + .16, B - .08, 0.12, 1.64,
        mix(g, C["wall"], .22), facing=facing)
    box(d, -.10, A + .08, .10, A + .16, 1.48, 1.62, C["metal"], facing=facing)
    box(d, -.03, A + .10, .03, A + .14, 1.18, 1.48, C["metal"], facing=facing)
    box(d, -.08, A + .10, .08, A + .18, 1.14, 1.20, C["metal"], facing=facing)


def showerRound(d):
    _shower(d, "se")


def _bathtub(d, facing="se", filled=False):
    """Porcelain tub. Empty shows the well; full keeps water inside the rim."""
    p = C["porcelain"]
    x0, y0, x1, y1 = _span(facing, 1.86, across=0.80, inset=0.08)
    contact_shadow(d, x0, y0, x1, y1, "se")
    box(d, x0, y0, x1, y1, 0, 0.40, p, skip_top=True)
    lip = 0.16
    box(d, x0, y0, x1, y0 + lip, 0.40, 0.48, p)
    box(d, x0, y0, x0 + lip, y1, 0.40, 0.48, p)
    _basin(d, x0, y0, x1, y1, 0.48, p, facing="se", water=filled,
           lip=lip, depth=0.34)
    box(d, x0, y1 - lip, x1, y1, 0.40, 0.48, p)
    box(d, x1 - lip, y0, x1, y1, 0.40, 0.48, p)
    if facing in ("se", "sw"):
        fx, fy = x0 + .10, y0 + .12
    else:
        fx, fy = x1 - .10, y1 - .12
    box(d, fx - .05, fy - .05, fx + .05, fy + .05, 0.48, 0.72, C["metal"])
    box(d, fx - .04, fy - .02, fx + .04, fy + .14, 0.70, 0.76, C["metal"])


def bathtub(d):
    _bathtub(d, "se", filled=False)


def bathtubFull(d):
    _bathtub(d, "se", filled=True)


def _laundry(d, facing="se"):
    contact_shadow(d, A + .08, A + .08, B - .08, B - .08, facing)
    box(d, A + .10, A + .10, B - .10, B - .10, 0, 0.74, C["metal"],
        facing=facing)
    box(d, A + .10, A + .10, B - .10, B - .10, 0.74, 1.48, mul(C["metal"], 1.04),
        facing=facing)
    if _front_visible(facing):
        for z in (0.34, 1.06):
            _panel(d, B - .10, A + .22, B - .22, z - .16, z + .16,
                   mul(C["screen"], 1.08), facing)
    _handle(d, B - .10, A + .16, A + .28, 0.58, facing, C["accent_brass"])
    _handle(d, B - .10, A + .16, A + .28, 1.28, facing, C["accent_brass"])


def washerDryerStacked(d):
    _laundry(d, "se")


# --------------------------------------------------------------- sleep ----
def _double_bed(d, facing="se"):
    """A wooden bed: thin headboard, mattress, two small pillows, a duvet.

    The headboard is a panel at the HEAD end, not a slab along the side.
    Pillows sit at that head, plump, and occupy about a quarter of the
    length so they cannot be mistaken for a second mattress. A near
    headboard (NW/NE) is painted AFTER the bedding so it occludes correctly.
    """
    w = C["wood"]
    x0, y0, x1, y1 = _span(facing, 1.90, across=0.86, inset=0.06)
    contact_shadow(d, x0, y0, x1, y1, "se")
    along_x = facing in ("se", "nw")
    head_far = facing in ("se", "sw")
    box(d, x0, y0, x1, y1, 0, 0.16, mul(w, .92))

    def headboard():
        if along_x:
            if head_far:
                box(d, x0, y0, x0 + .08, y1, 0, 0.90, w)
            else:
                box(d, x1 - .08, y0, x1, y1, 0, 0.90, w)
        else:
            if head_far:
                box(d, x0, y0, x1, y0 + .08, 0, 0.90, w)
            else:
                box(d, x0, y1 - .08, x1, y1, 0, 0.90, w)

    def bedding():
        if along_x:
            mx0, mx1 = (x0 + .08, x1 - .02) if head_far else (x0 + .02, x1 - .08)
            slab(d, mx0, y0 + .04, mx1, y1 - .04, 0.36, C["linen"], thick=0.18)
            length = mx1 - mx0
            if head_far:
                dx0, dx1 = mx0 + length * .36, mx1
                px0, px1 = mx0 + .03, mx0 + .28
            else:
                dx0, dx1 = mx0, mx1 - length * .36
                px0, px1 = mx1 - .28, mx1 - .03
            slab(d, dx0, y0 + .05, dx1, y1 - .05, 0.44, C["fabric"], thick=0.12)
            mid = (y0 + y1) / 2
            plump(d, px0, y0 + .06, px1, mid - .03, 0.36, 0.42, C["linen_alt"])
            plump(d, px0, mid + .03, px1, y1 - .06, 0.36, 0.42, C["linen_alt"])
            d.line([P(px0 + .04, mid, 0.41), P(px1 - .02, mid, 0.41)],
                   fill=OUTLINE, width=1)
        else:
            my0, my1 = (y0 + .08, y1 - .02) if head_far else (y0 + .02, y1 - .08)
            slab(d, x0 + .04, my0, x1 - .04, my1, 0.36, C["linen"], thick=0.18)
            length = my1 - my0
            if head_far:
                dy0, dy1 = my0 + length * .36, my1
                hy0, hy1 = my0 + .03, my0 + .22
            else:
                dy0, dy1 = my0, my1 - length * .36
                hy0, hy1 = my1 - .22, my1 - .03
            slab(d, x0 + .05, dy0, x1 - .05, dy1, 0.44, C["fabric"], thick=0.12)
            mid = (x0 + x1) / 2
            plump(d, x0 + .06, hy0, mid - .03, hy1, 0.36, 0.42, C["linen_alt"])
            plump(d, mid + .03, hy0, x1 - .06, hy1, 0.36, 0.42, C["linen_alt"])
            d.line([P(mid, hy0 + .04, 0.41), P(mid, hy1 - .02, 0.41)],
                   fill=OUTLINE, width=1)

    if head_far:
        headboard()
        bedding()
    else:
        bedding()
        headboard()


def bedDouble(d):
    _double_bed(d, "se")


def _bunk(d, facing="se"):
    """Two bunks on four posts, painted far-to-near so posts do not ghost."""
    w = C["wood"]
    x0, y0, x1, y1 = _span(facing, 1.90, across=0.86, inset=0.06)
    contact_shadow(d, x0, y0, x1, y1, "se")
    t = 0.10
    posts = [(x0, y0), (x0, y1 - t), (x1 - t, y0), (x1 - t, y1 - t)]
    # Camera sees +x and +y. Only the back corner stays behind the mattresses;
    # splitting by x+y on a long bed puts the screen-left post in the far
    # group and it ghosts through the near-left corner.
    near_posts = [p for p in posts if p[0] >= x1 - t - 0.001 or p[1] >= y1 - t - 0.001]
    far_posts = [p for p in posts if p not in near_posts]
    along_x = facing in ("se", "nw")

    def post(x, y):
        box(d, x, y, x + t, y + t, 0, 1.94, mul(w, .88))

    def bunk_level(z):
        # Mattress sits INSIDE the posts so the rails do not punch through it.
        box(d, x0 + t, y0 + t, x1 - t, y1 - t, z, z + 0.08, w)
        slab(d, x0 + t + .04, y0 + t + .04, x1 - t - .04, y1 - t - .04,
             z + 0.20, C["linen"], thick=0.12)
        if along_x:
            mid = (y0 + y1) / 2
            slab(d, x0 + t + .06, y0 + t + .08, x0 + t + .20, mid - .02,
                 z + 0.30, C["linen_alt"], thick=0.07)
            slab(d, x0 + t + .06, mid + .02, x0 + t + .20, y1 - t - .08,
                 z + 0.30, C["linen_alt"], thick=0.07)
            slab(d, x0 + t + .22, y0 + t + .06, x1 - t - .06, y1 - t - .06,
                 z + 0.24, C["fabric"], thick=0.08)
        else:
            mid = (x0 + x1) / 2
            slab(d, x0 + t + .08, y0 + t + .06, mid - .02, y0 + t + .20,
                 z + 0.30, C["linen_alt"], thick=0.07)
            slab(d, mid + .02, y0 + t + .06, x1 - t - .08, y0 + t + .20,
                 z + 0.30, C["linen_alt"], thick=0.07)
            slab(d, x0 + t + .06, y0 + t + .22, x1 - t - .06, y1 - t - .06,
                 z + 0.24, C["fabric"], thick=0.08)

    for x, y in far_posts:
        post(x, y)
    bunk_level(0.22)
    bunk_level(1.10)
    for x, y in near_posts:
        post(x, y)
    # Ladder on the near long edge, after the near posts.
    if along_x:
        lx = x1 - .04
        d.line([P(lx, y1 - .02, 0.30), P(lx, y1 - .02, 1.28)],
               fill=OUTLINE, width=3)
        d.line([P(lx - .16, y1 - .02, 0.30), P(lx - .16, y1 - .02, 1.28)],
               fill=OUTLINE, width=3)
        for z in (0.48, 0.72, 0.96, 1.20):
            d.line([P(lx - .16, y1 - .02, z), P(lx, y1 - .02, z)],
                   fill=C["wood"], width=2)
    else:
        ly = y1 - .04
        d.line([P(x1 - .02, ly, 0.30), P(x1 - .02, ly, 1.28)],
               fill=OUTLINE, width=3)
        d.line([P(x1 - .02, ly - .16, 0.30), P(x1 - .02, ly - .16, 1.28)],
               fill=OUTLINE, width=3)
        for z in (0.48, 0.72, 0.96, 1.20):
            d.line([P(x1 - .02, ly - .16, z), P(x1 - .02, ly, z)],
                   fill=C["wood"], width=2)


def bedBunk(d):
    _bunk(d, "se")


def _dresser(d, facing="se"):
    w = C["wood_light"]
    contact_shadow(d, -.30, -.30, .30, .30, facing)
    box(d, -.28, -.28, .28, .28, 0, 0.56, w, facing=facing)
    for z in (0.18, 0.38):
        _handle(d, .28, -.12, .12, z, facing)


def cabinetBedDrawer(d):
    _dresser(d, "se")


def _nightstand(d, facing="se"):
    w = C["wood"]
    contact_shadow(d, A + .08, A + .08, B - .08, B - .08, facing)
    box(d, A + .10, A + .10, B - .10, B - .10, 0, 0.68, w, facing=facing)
    for z in (0.24, 0.48):
        _handle(d, B - .10, -.12, .12, z, facing)
    box(d, -.08, -.08, .08, .08, 0.68, 0.78, C["shade"], facing=facing)


def sideTableDrawers(d):
    _nightstand(d, "se")


# --------------------------------------------------------------- lounge ----
def _long_sofa(d, facing="se"):
    f = C["fabric"]
    x0, y0, x1, y1 = _span(facing, 1.90, across=0.86, inset=0.06)
    contact_shadow(d, x0, y0, x1, y1, "se")
    box(d, x0, y0, x1, y1, 0, 0.22, mul(f, .88))
    along_x = facing in ("se", "nw")
    if along_x:
        box(d, x0, y0, x1, y0 + .16, 0.22, 0.78, f)
        box(d, x0, y0, x0 + .14, y1, 0.22, 0.54, mul(f, .96))
        slab(d, x0 + .14, y0 + .16, x1 - .14, y1 - .04, 0.52, mul(f, 1.04),
             thick=0.16)
        mid = (x0 + x1) / 2
        d.line([P(mid, y0 + .20, 0.52), P(mid, y1 - .08, 0.52)],
               fill=mul(f, .82), width=1)
        box(d, x1 - .14, y0, x1, y1, 0.22, 0.54, mul(f, .96))
    else:
        box(d, x0, y0, x0 + .16, y1, 0.22, 0.78, f)
        box(d, x0, y0, x1, y0 + .14, 0.22, 0.54, mul(f, .96))
        slab(d, x0 + .16, y0 + .14, x1 - .04, y1 - .14, 0.52, mul(f, 1.04),
             thick=0.16)
        mid = (y0 + y1) / 2
        d.line([P(x0 + .20, mid, 0.52), P(x1 - .08, mid, 0.52)],
               fill=mul(f, .82), width=1)
        box(d, x0, y1 - .14, x1, y1, 0.22, 0.54, mul(f, .96))


def loungeSofaLong(d):
    _long_sofa(d, "se")


def _ottoman(d, facing="se"):
    f = C["fabric"]
    contact_shadow(d, A + .08, A + .08, B - .08, B - .08, facing)
    legs(d, A + .14, A + .14, B - .14, B - .14, 0.16, mul(f, .82),
         inset=0.02, thick=0.09, facing=facing)
    slab(d, A + .10, A + .10, B - .10, B - .10, 0.32, f, thick=0.14,
         facing=facing)
    surface(d, -.05, -.05, .05, .05, 0.33, mul(f, .84), facing=facing)


def loungeSofaOttoman(d):
    _ottoman(d, "se")


def _armchair(d, facing="se"):
    f = C["accent_clay"]
    contact_shadow(d, A + .12, A + .12, B - .12, B - .12, facing)
    box(d, A + .14, A + .14, B - .14, B - .14, 0, 0.22, mul(f, .88),
        facing=facing)
    box(d, A + .14, A + .14, B - .14, A + .28, 0.22, 0.86, f, facing=facing)
    box(d, A + .14, A + .14, A + .26, B - .14, 0.22, 0.58, mul(f, .96),
        facing=facing)
    slab(d, A + .26, A + .28, B - .14, B - .14, 0.42, mul(f, 1.04), thick=0.16,
         facing=facing)
    box(d, B - .26, A + .14, B - .14, B - .14, 0.22, 0.58, mul(f, .96),
        facing=facing)


def loungeChair(d):
    _armchair(d, "se")


def _wingback(d, facing="se"):
    """Reclined, with a footrest - Bill's chair."""
    f = C["accent_clay"]
    dark = mul(f, .78)
    contact_shadow(d, A + .10, A + .12, B - .04, B - .12, facing)
    for lx, ly in ((A + .18, A + .18), (A + .18, B - .26),
                   (B - .28, A + .18), (B - .28, B - .26)):
        box(d, lx, ly, lx + .10, ly + .10, 0, 0.28, dark, facing=facing)
    for lx, ly in ((B - .16, A + .24), (B - .16, B - .30)):
        box(d, lx, ly, lx + .10, ly + .10, 0, 0.18, dark, facing=facing)
    box(d, A + .12, A + .14, A + .28, B - .14, 0.24, 1.08, f, facing=facing)
    box(d, A + .12, A + .10, A + .38, A + .22, 0.72, 1.10, mul(f, .96),
        facing=facing)
    box(d, A + .12, B - .22, A + .38, B - .10, 0.72, 1.10, mul(f, .94),
        facing=facing)
    slab(d, A + .26, A + .20, B - .18, B - .20, 0.42, mul(f, 1.04), thick=0.16,
         facing=facing)
    box(d, A + .26, A + .12, B - .22, A + .22, 0.42, 0.56, mul(f, .98),
        facing=facing)
    box(d, A + .26, B - .22, B - .22, B - .12, 0.42, 0.56, mul(f, .98),
        facing=facing)
    slab(d, B - .22, A + .24, B - .14, B - .24, 0.34, mul(f, .96), thick=0.10,
         facing=facing)
    slab(d, B - .20, A + .22, B - .04, B - .22, 0.28, mul(f, .92), thick=0.12,
         facing=facing)


def loungeChairRelax(d):
    _wingback(d, "se")


def _tv(d, facing="se"):
    contact_shadow(d, -.42, -.18, .42, .18, facing)
    box(d, -.40, -.16, .40, .16, 0, 0.16, C["wood_dark"], facing=facing)
    box(d, -.28, -.12, .28, .12, 0.16, 0.62, mul(C["ink"], 1.48), facing=facing)
    if _front_visible(facing):
        _panel(d, .28, -.09, .09, 0.24, 0.56, mul(C["ink"], 1.12), facing)
        _panel(d, .26, -.07, .07, 0.28, 0.52, C["screen"], facing)
        box(d, .28, .05, .32, .10, 0.22, 0.28, C["accent_brass"], facing=facing)
    else:
        _panel(d, -.28, -.09, .09, 0.22, 0.58, mul(C["wood_dark"], .9), facing)


def televisionVintage(d):
    _tv(d, "se")


def _radio(d, facing="se"):
    """A wide wooden table radio: dark grille, brass dial, short antenna."""
    w = C["wood_dark"]
    contact_shadow(d, -.46, -.24, .46, .24, facing)
    for fx, fy in ((-.38, -.16), (.30, -.16), (-.38, .10), (.30, .10)):
        box(d, fx, fy, fx + .08, fy + .08, 0, 0.05, mul(w, .85), facing=facing)
    box(d, -.44, -.22, .44, .22, 0.05, 0.34, w, top=C["wood"], facing=facing)
    _panel(d, .44, -.18, .10, 0.08, 0.30, mul(w, .48), facing)
    for i in range(3):
        gy = -.14 + i * 0.08
        d.line([Pf(.44, gy, 0.10, facing), Pf(.44, gy, 0.28, facing)],
               fill=mul(C["ink"], 1.10), width=1)
    _panel(d, .44, .12, .20, 0.10, 0.22, C["accent_brass"], facing)
    d.line([Pf(-.36, -.22, 0.34, facing), Pf(-.36, -.22, 0.48, facing)],
           fill=C["metal"], width=1)


def radio(d):
    _radio(d, "se")


# --------------------------------------------------------------- study ----
def _table(d, facing="se"):
    w = C["wood"]
    x0, y0, x1, y1 = _span(facing, 1.70, across=0.92, inset=0.04)
    contact_shadow(d, x0, y0, x1, y1, "se")
    legs(d, x0 + .04, y0 + .04, x1 - .04, y1 - .04, 0.54, w)
    slab(d, x0 - .02, y0 - .02, x1 + .02, y1 + .02, 0.64, w, thick=0.10)


def table(d):
    _table(d, "se")


def _desk(d, facing="se"):
    w = C["wood"]
    x0, y0, x1, y1 = _span(facing, 1.70, across=0.88, inset=0.06)
    contact_shadow(d, x0, y0, x1, y1, "se")
    if facing in ("se", "nw"):
        box(d, x0, y0 + .08, x0 + .28, y1 - .08, 0, 0.56, mul(w, .88))
        legs(d, x1 - .32, y0, x1, y1, 0.56, w, inset=0.06)
        slab(d, x0, y0 - .02, x1 + .02, y1 + .02, 0.64, w, thick=0.09)
        _handle(d, x0 + .28, -.12, .12, 0.40, "se")
    else:
        box(d, x0 + .08, y0, x1 - .08, y0 + .28, 0, 0.56, mul(w, .88))
        legs(d, x0, y1 - .32, x1, y1, 0.56, w, inset=0.06)
        slab(d, x0 - .02, y0, x1 + .02, y1 + .02, 0.64, w, thick=0.09)
        d.line([P(x0 + .18, y0 + .28, 0.40), P(x1 - .18, y0 + .28, 0.40)],
               fill=mul(C["metal"], .75), width=2)


def desk(d):
    _desk(d, "se")


def _chair(d, facing="se"):
    w = C["wood_light"]
    contact_shadow(d, A + .12, A + .12, B - .12, B - .12, facing)
    legs(d, A + .16, A + .16, B - .16, B - .16, 0.42, w, inset=0.02, thick=0.08,
         facing=facing)
    slab(d, A + .14, A + .14, B - .14, B - .14, 0.50, w, thick=0.08,
         facing=facing)
    box(d, A + .14, A + .14, A + .24, A + .24, 0.50, 1.12, w, facing=facing)
    box(d, B - .24, A + .14, B - .14, A + .24, 0.50, 1.12, w, facing=facing)
    box(d, A + .14, A + .14, B - .14, A + .22, 0.70, 0.82, w, facing=facing)
    box(d, A + .14, A + .14, B - .14, A + .22, 0.92, 1.04, w, facing=facing)


def chair(d):
    _chair(d, "se")


def _desk_chair(d, facing="se"):
    w = C["accent_slate"]
    m = C["metal"]
    contact_shadow(d, A + .14, A + .14, B - .14, B - .14, facing)
    box(d, -.22, -.04, .22, .04, 0, 0.08, m, facing=facing)
    box(d, -.04, -.22, .04, .22, 0, 0.08, m, facing=facing)
    box(d, -.035, -.035, .035, .035, 0.08, 0.46, m, facing=facing)
    slab(d, A + .18, A + .18, B - .18, B - .18, 0.54, w, thick=0.12,
         facing=facing)
    box(d, A + .18, A + .18, B - .18, A + .28, 0.54, 1.08, w, facing=facing)


def chairDesk(d):
    _desk_chair(d, "se")


def bookcaseClosedWide(d):
    _aquarium(d, frame=0)


def aquariumCabinet1(d):
    _aquarium(d, frame=1)


def _aquarium(d, frame):
    """A compact cabinet aquarium, biased away from its west wall.

    The historical sprite name remains the content and save-facing key for
    frame zero. Frame one redraws only the fish. Keeping the cabinet, water,
    plants, rocks, and hardware identical prevents the whole object from
    shivering when the renderer advances its ambient animation.
    """
    x0, y0, x1, y1 = -.06, -.46, .70, .30
    wood = C["wood_dark"]
    water = C["water"]

    # Cabinet and cap. The +x/-y offset moves the visible envelope about
    # thirteen pixels right while the one-tile simulation footprint stays put.
    box(d, x0, y0, x1, y1, 0, .44, wood, top=C["wood"])
    slab(d, x0 - .02, y0 - .02, x1 + .02, y1 + .02,
         .49, C["wood"], thick=.05)

    # Water volume. The slightly different face values are material shading,
    # not light emission; the aquarium remains an ordinary lit object quad.
    gx0, gy0, gx1, gy1 = x0 + .05, y0 + .05, x1 - .05, y1 - .05
    d.polygon(
        [P(gx0, gy1, 1.35), P(gx1, gy1, 1.35),
         P(gx1, gy1, .52), P(gx0, gy1, .52)],
        fill=(*mul(water, .92), 220), outline=OUTLINE, width=OUTLINE_WIDTH,
    )
    d.polygon(
        [P(gx1, gy0, 1.35), P(gx1, gy1, 1.35),
         P(gx1, gy1, .52), P(gx1, gy0, .52)],
        fill=(*mul(water, .82), 220), outline=OUTLINE, width=OUTLINE_WIDTH,
    )
    d.polygon(
        [P(gx0, gy0, 1.35), P(gx1, gy0, 1.35),
         P(gx1, gy1, 1.35), P(gx0, gy1, 1.35)],
        fill=(*mul(water, 1.07), 210), outline=OUTLINE, width=OUTLINE_WIDTH,
    )

    # Gravel, two rocks, and plants survive native-size display as distinct
    # shapes. Fine aquarium detail has a habit of turning into decorative lint.
    box(d, gx0 + .02, gy0 + .02, gx1 - .02, gy1 - .02,
        .52, .62, C["card"], top=C["linen_alt"])
    for rx, ry, radius, colour in (
        (.03, -.35, 4, C["accent_slate"]),
        (.38, -.08, 3, C["wood_dark"]),
    ):
        px, py = P(rx, ry, .66)
        d.ellipse([px - radius, py - radius / 2,
                   px + radius, py + radius / 2],
                  fill=colour, outline=OUTLINE, width=1)
    for root_x, root_y, lean in ((-.12, -.27, -1), (.45, -.02, 1)):
        root = P(root_x, root_y, .63)
        for reach, lift in ((6, 17), (2, 21), (-5, 15)):
            d.line([root, (root[0] + lean * reach, root[1] - lift)],
                   fill=C["leaf"], width=2)

    # Dark frame, lid, and cabinet hardware sell the furniture silhouette.
    for cx, cy in ((gx0, gy0), (gx1, gy0), (gx1, gy1), (gx0, gy1)):
        d.line([P(cx, cy, .50), P(cx, cy, 1.39)], fill=OUTLINE, width=2)
    slab(d, x0 - .03, y0 - .03, x1 + .03, y1 + .03,
         1.43, wood, thick=.08)
    d.line([P(x1, -.18, .12), P(x1, -.18, .34)],
           fill=mul(C["wood"], .72), width=1)
    for knob_y in (-.35, -.05):
        kx, ky = P(x1, knob_y, .25)
        d.ellipse([kx - 1.5, ky - 1.5, kx + 1.5, ky + 1.5],
                  fill=C["accent_brass"], outline=OUTLINE, width=1)

    # Only these fish coordinates depend on the frame. Each shifts by a few
    # pixels and flips a tail, enough to read without becoming a screensaver.
    fish = (
        (-19 + frame * 3, -8, 1, C["accent_clay"]),
        (4 - frame * 2, -6, -1, C["accent_brass"]),
        (12 + frame * 2, 4, 1, C["accent_slate"]),
    )
    centre_x, centre_y = OX + 12, OY - 22
    for fx, fy, direction, colour in fish:
        cx, cy = centre_x + fx, centre_y + fy
        d.ellipse([cx - 4, cy - 2, cx + 4, cy + 2],
                  fill=colour, outline=OUTLINE, width=1)
        tail_x = cx - direction * (7 if frame == 0 else 8)
        d.polygon([(cx - direction * 3, cy),
                   (tail_x, cy - 3), (tail_x, cy + 3)],
                  fill=mul(colour, .9), outline=OUTLINE)
        eye_x = cx + direction * 2
        d.point((eye_x, cy - 1), fill=OUTLINE)


def _bookcase(d, wide=False, facing="se"):
    w = C["wood"]
    along = 0.28
    across = 1.70 if wide else 0.86
    x0, y0, x1, y1 = _span(facing, along, across=across, inset=0.08)
    contact_shadow(d, x0, y0, x1, y1, "se")
    t = 0.06
    spines = (
        C["accent_clay"], C["accent_sage"], C["accent_brass"], C["accent_slate"],
        C["wood_dark"], C["fabric"], mul(C["accent_clay"], .82),
        mul(C["accent_slate"], .88),
    )
    box(d, x0, y0, x0 + t, y1, 0, 1.48, mul(w, .78))
    box(d, x0, y0, x1, y0 + t, 0, 1.48, mul(w, .88))
    box(d, x0, y0, x1, y1, 0, 0.10, mul(w, .84))
    shelves = 4
    n = 11 if wide else 6
    for i in range(shelves):
        z = 0.10 + i * 0.34
        slab(d, x0 + t, y0 + t, x1 - .02, y1 - t, z, w, thick=0.06)
        span = (y1 - t - .02) - (y0 + t + .02)
        for j in range(n):
            by0 = y0 + t + .02 + j * (span / n)
            by1 = by0 + span / n - .016
            h = 0.20 + ((i * 7 + j * 3) % 5) * 0.020
            box(d, x0 + t + .02, by0, x1 - .10, by1, z, z + h,
                spines[(i * 5 + j) % len(spines)])
    box(d, x1 - t, y0, x1, y0 + t, 0, 1.48, mul(w, .90))
    box(d, x1 - t, y1 - t, x1, y1, 0, 1.48, mul(w, .92))
    slab(d, x0 - .02, y0 - .02, x1 + .02, y1 + .02, 1.54, w, thick=0.08)


def bookcaseClosedDoors(d):
    _bookcase(d, wide=False, facing="se")


# --------------------------------------------------------------- props ----
def _plant(d, facing="se"):
    contact_shadow(d, -.18, -.18, .18, .18, facing)
    box(d, -.16, -.16, .16, .16, 0, 0.30, C["pot"], facing=facing)
    surface(d, -.12, -.12, .12, .12, 0.30, mul(C["wood_dark"], 0.88),
            facing=facing)
    dark, mid, light = mul(C["leaf"], 0.78), C["leaf"], mul(C["leaf"], 1.08)
    for lx, ly, z, rx, ry, col in (
        (-.10, -.12, 0.52, 6, 8, dark),
        (.12, -.10, 0.58, 7, 9, mid),
        (-.02, -.08, 0.72, 8, 11, light),
        (-.14, .00, 0.48, 6, 7, mid),
        (.10, .04, 0.56, 7, 8, dark),
        (.00, .02, 0.64, 6, 9, mid),
        (-.06, .10, 0.50, 5, 7, light),
        (.06, .08, 0.46, 5, 6, dark),
    ):
        px, py = Pf(lx, ly, z, facing)
        d.ellipse([px - rx, py - ry, px + rx, py + ry],
                  fill=col, outline=OUTLINE, width=OUTLINE_WIDTH)


def pottedPlant(d):
    _plant(d, "se")


def _lamp(d, facing="se"):
    contact_shadow(d, -.16, -.16, .16, .16, facing)
    slab(d, -.14, -.14, .14, .14, 0.08, C["metal"], thick=0.08, facing=facing)
    box(d, -.03, -.03, .03, .03, 0.08, 1.16, C["metal"], facing=facing)
    px, py = Pf(0, 0, 1.16, facing)
    d.polygon(
        [(px - 9, py + 1), (px - 16, py + 18), (px + 16, py + 18), (px + 9, py + 1)],
        fill=C["shade"], outline=OUTLINE, width=OUTLINE_WIDTH,
    )
    d.ellipse([px - 16, py + 14, px + 16, py + 22],
              fill=mul(C["shade"], 1.08), outline=OUTLINE, width=OUTLINE_WIDTH)


def lampRoundFloor(d):
    _lamp(d, "se")


def _coat_rack(d, facing="se"):
    contact_shadow(d, -.14, -.14, .14, .14, facing)
    slab(d, -.12, -.12, .12, .12, 0.08, C["wood_dark"], thick=0.08, facing=facing)
    box(d, -.03, -.03, .03, .03, 0.08, 1.36, C["wood"], facing=facing)
    box(d, -.16, -.03, .16, .03, 1.28, 1.34, C["wood"], facing=facing)
    coat = C["accent_sage"]
    d.polygon(
        [
            Pf(-.02, -.04, 1.26, facing),
            Pf(.10, -.04, 1.26, facing),
            Pf(.16, .08, 0.52, facing),
            Pf(.02, .12, 0.48, facing),
            Pf(-.12, .08, 0.52, facing),
        ],
        fill=coat, outline=OUTLINE, width=OUTLINE_WIDTH,
    )
    d.line([Pf(.02, -.02, 1.22, facing), Pf(.04, .08, 0.58, facing)],
           fill=mul(coat, .82), width=1)


def coatRackStanding(d):
    _coat_rack(d, "se")


def _bin(d, facing="se"):
    cyl(d, 0, 0, 0.18, 0, 0.52, mul(C["metal"], .96), facing=facing)
    d.line([Pf(.05, -.16, 0.52, facing), Pf(.05, -.16, 0.68, facing)],
           fill=C["metal"], width=2)


def trashcan(d):
    _bin(d, "se")


def _bike(d, facing="se"):
    """A compact upright exercise bike on the old moving-box index."""
    px, py = P(.5, .5)
    mirror = -1 if facing in ("sw", "nw") else 1
    frame = C["accent_slate"]
    metal = C["metal"]

    def pt(dx, dy):
        return (px + dx * mirror, py + dy)

    # The mat and machine lean left of the saddle anchor, leaving the east
    # wall and lot edge clear while retaining the honest one-tile footprint.
    d.polygon([pt(-32, -10), pt(-5, -24), pt(14, -14), pt(-14, 0)],
              fill=mul(C["ink"], 1.55), outline=OUTLINE, width=1)

    wheel_x, wheel_y = pt(-10, -14)
    d.ellipse([wheel_x - 12, wheel_y - 10,
               wheel_x + 12, wheel_y + 10],
              fill=mul(C["screen"], .72), outline=OUTLINE, width=2)
    d.ellipse([wheel_x - 7, wheel_y - 6,
               wheel_x + 7, wheel_y + 6],
              fill=mul(metal, .88), outline=OUTLINE, width=1)
    d.ellipse([wheel_x - 2, wheel_y - 2,
               wheel_x + 2, wheel_y + 2],
              fill=C["accent_brass"], outline=OUTLINE, width=1)

    saddle = pt(0, -29)
    crank = (wheel_x, wheel_y)
    front = pt(10, -7)
    handle = pt(10, -43)
    for a, b in ((saddle, crank), (crank, front), (front, handle),
                 (saddle, front)):
        d.line([a, b], fill=OUTLINE, width=6)
        d.line([a, b], fill=frame, width=4)

    d.rounded_rectangle([saddle[0] - 8, saddle[1] - 4,
                         saddle[0] + 7, saddle[1] + 1],
                        radius=2, fill=mul(C["ink"], 1.12),
                        outline=OUTLINE, width=1)
    bar = pt(7, -44)
    bar2 = pt(15, -47)
    d.line([bar, bar2], fill=OUTLINE, width=4)
    d.line([bar, bar2], fill=frame, width=2)
    console = pt(4, -53)
    console2 = pt(13, -45)
    d.rounded_rectangle([min(console[0], console2[0]), min(console[1], console2[1]),
                         max(console[0], console2[0]), max(console[1], console2[1])],
                        radius=2, fill=C["screen"], outline=OUTLINE, width=1)

    d.line([pt(-5, -18), pt(6, -9)], fill=OUTLINE, width=2)
    for foot in (pt(-8, -20), pt(9, -7)):
        d.line([(foot[0] - 4, foot[1]), (foot[0] + 4, foot[1])],
               fill=OUTLINE, width=3)
    d.line([pt(-25, -2), pt(-2, -2)], fill=OUTLINE, width=3)
    d.line([pt(2, -2), pt(14, -2)], fill=OUTLINE, width=3)
    d.polygon([pt(5, -44), pt(10, -43), pt(8, -30), pt(3, -31)],
              fill=C["linen"], outline=OUTLINE)


def cardboardBoxOpen(d):
    _bike(d, "se")


def _figure(d, palette, action=None, facing="se", frame=0):
    pose = "idle" if action is None else action
    person(d, palette, facing, pose, frame)


def sim(d): _figure(d, CHARACTER_PALETTES[0])
def sim2(d): _figure(d, CHARACTER_PALETTES[1])
def sim3(d): _figure(d, CHARACTER_PALETTES[2])


def simTalkSE0(d): _figure(d, CHARACTER_PALETTES[0], "talk", "se", 0)
def simTalkSE1(d): _figure(d, CHARACTER_PALETTES[0], "talk", "se", 1)
def simTalkNW0(d): _figure(d, CHARACTER_PALETTES[0], "talk", "nw", 0)
def simTalkNW1(d): _figure(d, CHARACTER_PALETTES[0], "talk", "nw", 1)
def simTalkSW0(d): _figure(d, CHARACTER_PALETTES[0], "talk", "sw", 0)
def simTalkSW1(d): _figure(d, CHARACTER_PALETTES[0], "talk", "sw", 1)
def simTalkNE0(d): _figure(d, CHARACTER_PALETTES[0], "talk", "ne", 0)
def simTalkNE1(d): _figure(d, CHARACTER_PALETTES[0], "talk", "ne", 1)

def sim2TalkSE0(d): _figure(d, CHARACTER_PALETTES[1], "talk", "se", 0)
def sim2TalkSE1(d): _figure(d, CHARACTER_PALETTES[1], "talk", "se", 1)
def sim2TalkNW0(d): _figure(d, CHARACTER_PALETTES[1], "talk", "nw", 0)
def sim2TalkNW1(d): _figure(d, CHARACTER_PALETTES[1], "talk", "nw", 1)
def sim2TalkSW0(d): _figure(d, CHARACTER_PALETTES[1], "talk", "sw", 0)
def sim2TalkSW1(d): _figure(d, CHARACTER_PALETTES[1], "talk", "sw", 1)
def sim2TalkNE0(d): _figure(d, CHARACTER_PALETTES[1], "talk", "ne", 0)
def sim2TalkNE1(d): _figure(d, CHARACTER_PALETTES[1], "talk", "ne", 1)

def sim3TalkSE0(d): _figure(d, CHARACTER_PALETTES[2], "talk", "se", 0)
def sim3TalkSE1(d): _figure(d, CHARACTER_PALETTES[2], "talk", "se", 1)
def sim3TalkNW0(d): _figure(d, CHARACTER_PALETTES[2], "talk", "nw", 0)
def sim3TalkNW1(d): _figure(d, CHARACTER_PALETTES[2], "talk", "nw", 1)
def sim3TalkSW0(d): _figure(d, CHARACTER_PALETTES[2], "talk", "sw", 0)
def sim3TalkSW1(d): _figure(d, CHARACTER_PALETTES[2], "talk", "sw", 1)
def sim3TalkNE0(d): _figure(d, CHARACTER_PALETTES[2], "talk", "ne", 0)
def sim3TalkNE1(d): _figure(d, CHARACTER_PALETTES[2], "talk", "ne", 1)

def simEatSE0(d): _figure(d, CHARACTER_PALETTES[0], "eat", "se", 0)
def simEatSE1(d): _figure(d, CHARACTER_PALETTES[0], "eat", "se", 1)
def simEatNW0(d): _figure(d, CHARACTER_PALETTES[0], "eat", "nw", 0)
def simEatNW1(d): _figure(d, CHARACTER_PALETTES[0], "eat", "nw", 1)
def simEatSW0(d): _figure(d, CHARACTER_PALETTES[0], "eat", "sw", 0)
def simEatSW1(d): _figure(d, CHARACTER_PALETTES[0], "eat", "sw", 1)
def simEatNE0(d): _figure(d, CHARACTER_PALETTES[0], "eat", "ne", 0)
def simEatNE1(d): _figure(d, CHARACTER_PALETTES[0], "eat", "ne", 1)

def sim2EatSE0(d): _figure(d, CHARACTER_PALETTES[1], "eat", "se", 0)
def sim2EatSE1(d): _figure(d, CHARACTER_PALETTES[1], "eat", "se", 1)
def sim2EatNW0(d): _figure(d, CHARACTER_PALETTES[1], "eat", "nw", 0)
def sim2EatNW1(d): _figure(d, CHARACTER_PALETTES[1], "eat", "nw", 1)
def sim2EatSW0(d): _figure(d, CHARACTER_PALETTES[1], "eat", "sw", 0)
def sim2EatSW1(d): _figure(d, CHARACTER_PALETTES[1], "eat", "sw", 1)
def sim2EatNE0(d): _figure(d, CHARACTER_PALETTES[1], "eat", "ne", 0)
def sim2EatNE1(d): _figure(d, CHARACTER_PALETTES[1], "eat", "ne", 1)

def sim3EatSE0(d): _figure(d, CHARACTER_PALETTES[2], "eat", "se", 0)
def sim3EatSE1(d): _figure(d, CHARACTER_PALETTES[2], "eat", "se", 1)
def sim3EatNW0(d): _figure(d, CHARACTER_PALETTES[2], "eat", "nw", 0)
def sim3EatNW1(d): _figure(d, CHARACTER_PALETTES[2], "eat", "nw", 1)
def sim3EatSW0(d): _figure(d, CHARACTER_PALETTES[2], "eat", "sw", 0)
def sim3EatSW1(d): _figure(d, CHARACTER_PALETTES[2], "eat", "sw", 1)
def sim3EatNE0(d): _figure(d, CHARACTER_PALETTES[2], "eat", "ne", 0)
def sim3EatNE1(d): _figure(d, CHARACTER_PALETTES[2], "eat", "ne", 1)


def _reading_figure(d, palette, facing, frame):
    person(d, palette, facing, "read", frame)



def simReadSE0(d): _reading_figure(d, CHARACTER_PALETTES[0], "se", 0)
def simReadSE1(d): _reading_figure(d, CHARACTER_PALETTES[0], "se", 1)
def simReadNW0(d): _reading_figure(d, CHARACTER_PALETTES[0], "nw", 0)
def simReadNW1(d): _reading_figure(d, CHARACTER_PALETTES[0], "nw", 1)
def simReadSW0(d): _reading_figure(d, CHARACTER_PALETTES[0], "sw", 0)
def simReadSW1(d): _reading_figure(d, CHARACTER_PALETTES[0], "sw", 1)
def simReadNE0(d): _reading_figure(d, CHARACTER_PALETTES[0], "ne", 0)
def simReadNE1(d): _reading_figure(d, CHARACTER_PALETTES[0], "ne", 1)

def sim2ReadSE0(d): _reading_figure(d, CHARACTER_PALETTES[1], "se", 0)
def sim2ReadSE1(d): _reading_figure(d, CHARACTER_PALETTES[1], "se", 1)
def sim2ReadNW0(d): _reading_figure(d, CHARACTER_PALETTES[1], "nw", 0)
def sim2ReadNW1(d): _reading_figure(d, CHARACTER_PALETTES[1], "nw", 1)
def sim2ReadSW0(d): _reading_figure(d, CHARACTER_PALETTES[1], "sw", 0)
def sim2ReadSW1(d): _reading_figure(d, CHARACTER_PALETTES[1], "sw", 1)
def sim2ReadNE0(d): _reading_figure(d, CHARACTER_PALETTES[1], "ne", 0)
def sim2ReadNE1(d): _reading_figure(d, CHARACTER_PALETTES[1], "ne", 1)

def sim3ReadSE0(d): _reading_figure(d, CHARACTER_PALETTES[2], "se", 0)
def sim3ReadSE1(d): _reading_figure(d, CHARACTER_PALETTES[2], "se", 1)
def sim3ReadNW0(d): _reading_figure(d, CHARACTER_PALETTES[2], "nw", 0)
def sim3ReadNW1(d): _reading_figure(d, CHARACTER_PALETTES[2], "nw", 1)
def sim3ReadSW0(d): _reading_figure(d, CHARACTER_PALETTES[2], "sw", 0)
def sim3ReadSW1(d): _reading_figure(d, CHARACTER_PALETTES[2], "sw", 1)
def sim3ReadNE0(d): _reading_figure(d, CHARACTER_PALETTES[2], "ne", 0)
def sim3ReadNE1(d): _reading_figure(d, CHARACTER_PALETTES[2], "ne", 1)


def _standing_reading_figure(d, palette, facing, frame):
    person(d, palette, facing, "standread", frame)



def simStandReadSE0(d): _standing_reading_figure(d, CHARACTER_PALETTES[0], "se", 0)
def simStandReadSE1(d): _standing_reading_figure(d, CHARACTER_PALETTES[0], "se", 1)
def simStandReadNW0(d): _standing_reading_figure(d, CHARACTER_PALETTES[0], "nw", 0)
def simStandReadNW1(d): _standing_reading_figure(d, CHARACTER_PALETTES[0], "nw", 1)
def simStandReadSW0(d): _standing_reading_figure(d, CHARACTER_PALETTES[0], "sw", 0)
def simStandReadSW1(d): _standing_reading_figure(d, CHARACTER_PALETTES[0], "sw", 1)
def simStandReadNE0(d): _standing_reading_figure(d, CHARACTER_PALETTES[0], "ne", 0)
def simStandReadNE1(d): _standing_reading_figure(d, CHARACTER_PALETTES[0], "ne", 1)

def sim2StandReadSE0(d): _standing_reading_figure(d, CHARACTER_PALETTES[1], "se", 0)
def sim2StandReadSE1(d): _standing_reading_figure(d, CHARACTER_PALETTES[1], "se", 1)
def sim2StandReadNW0(d): _standing_reading_figure(d, CHARACTER_PALETTES[1], "nw", 0)
def sim2StandReadNW1(d): _standing_reading_figure(d, CHARACTER_PALETTES[1], "nw", 1)
def sim2StandReadSW0(d): _standing_reading_figure(d, CHARACTER_PALETTES[1], "sw", 0)
def sim2StandReadSW1(d): _standing_reading_figure(d, CHARACTER_PALETTES[1], "sw", 1)
def sim2StandReadNE0(d): _standing_reading_figure(d, CHARACTER_PALETTES[1], "ne", 0)
def sim2StandReadNE1(d): _standing_reading_figure(d, CHARACTER_PALETTES[1], "ne", 1)

def sim3StandReadSE0(d): _standing_reading_figure(d, CHARACTER_PALETTES[2], "se", 0)
def sim3StandReadSE1(d): _standing_reading_figure(d, CHARACTER_PALETTES[2], "se", 1)
def sim3StandReadNW0(d): _standing_reading_figure(d, CHARACTER_PALETTES[2], "nw", 0)
def sim3StandReadNW1(d): _standing_reading_figure(d, CHARACTER_PALETTES[2], "nw", 1)
def sim3StandReadSW0(d): _standing_reading_figure(d, CHARACTER_PALETTES[2], "sw", 0)
def sim3StandReadSW1(d): _standing_reading_figure(d, CHARACTER_PALETTES[2], "sw", 1)
def sim3StandReadNE0(d): _standing_reading_figure(d, CHARACTER_PALETTES[2], "ne", 0)
def sim3StandReadNE1(d): _standing_reading_figure(d, CHARACTER_PALETTES[2], "ne", 1)


def _walking_figure(d, palette, facing, frame):
    person(d, palette, facing, "walk", frame)



def simWalkSE0(d): _walking_figure(d, CHARACTER_PALETTES[0], "se", 0)
def simWalkSE1(d): _walking_figure(d, CHARACTER_PALETTES[0], "se", 1)
def simWalkNW0(d): _walking_figure(d, CHARACTER_PALETTES[0], "nw", 0)
def simWalkNW1(d): _walking_figure(d, CHARACTER_PALETTES[0], "nw", 1)
def simWalkSW0(d): _walking_figure(d, CHARACTER_PALETTES[0], "sw", 0)
def simWalkSW1(d): _walking_figure(d, CHARACTER_PALETTES[0], "sw", 1)
def simWalkNE0(d): _walking_figure(d, CHARACTER_PALETTES[0], "ne", 0)
def simWalkNE1(d): _walking_figure(d, CHARACTER_PALETTES[0], "ne", 1)

def sim2WalkSE0(d): _walking_figure(d, CHARACTER_PALETTES[1], "se", 0)
def sim2WalkSE1(d): _walking_figure(d, CHARACTER_PALETTES[1], "se", 1)
def sim2WalkNW0(d): _walking_figure(d, CHARACTER_PALETTES[1], "nw", 0)
def sim2WalkNW1(d): _walking_figure(d, CHARACTER_PALETTES[1], "nw", 1)
def sim2WalkSW0(d): _walking_figure(d, CHARACTER_PALETTES[1], "sw", 0)
def sim2WalkSW1(d): _walking_figure(d, CHARACTER_PALETTES[1], "sw", 1)
def sim2WalkNE0(d): _walking_figure(d, CHARACTER_PALETTES[1], "ne", 0)
def sim2WalkNE1(d): _walking_figure(d, CHARACTER_PALETTES[1], "ne", 1)

def sim3WalkSE0(d): _walking_figure(d, CHARACTER_PALETTES[2], "se", 0)
def sim3WalkSE1(d): _walking_figure(d, CHARACTER_PALETTES[2], "se", 1)
def sim3WalkNW0(d): _walking_figure(d, CHARACTER_PALETTES[2], "nw", 0)
def sim3WalkNW1(d): _walking_figure(d, CHARACTER_PALETTES[2], "nw", 1)
def sim3WalkSW0(d): _walking_figure(d, CHARACTER_PALETTES[2], "sw", 0)
def sim3WalkSW1(d): _walking_figure(d, CHARACTER_PALETTES[2], "sw", 1)
def sim3WalkNE0(d): _walking_figure(d, CHARACTER_PALETTES[2], "ne", 0)
def sim3WalkNE1(d): _walking_figure(d, CHARACTER_PALETTES[2], "ne", 1)


def _exercise_figure(d, palette, facing, frame):
    person(d, palette, facing, "exercise", frame)



def _watch_fish_figure(d, palette, facing, frame):
    person(d, palette, facing, "watch", frame)



def _named_action_sprites(stem, drawer):
    """Create append-only named atlas callables without 48 copy-paste shells."""
    sprites = []
    for look, palette in zip(("sim", "sim2", "sim3"), CHARACTER_PALETTES):
        for facing, facing_name in (("se", "SE"), ("nw", "NW"),
                                    ("sw", "SW"), ("ne", "NE")):
            for frame in (0, 1):
                def sprite(d, palette=palette, facing=facing, frame=frame):
                    drawer(d, palette, facing, frame)
                sprite.__name__ = f"{look}{stem}{facing_name}{frame}"
                sprites.append(sprite)
    return tuple(sprites)


EXERCISE_SPRITES = _named_action_sprites("Exercise", _exercise_figure)
WATCH_FISH_SPRITES = _named_action_sprites("WatchFish", _watch_fish_figure)


# ---------------------------------------------------------- indicators ----
def _bubble(d, glyph):
    px, py = OX, OY + HH - 13
    d.ellipse([px - 12, py - 12, px + 12, py + 12], fill=C["linen"],
              outline=OUTLINE, width=OUTLINE_WIDTH)
    ink = C["ink"]
    if glyph == "talk":
        for i, dy in enumerate((-4, 0, 4)):
            d.ellipse([px - 6 + i * 5, py + dy - 1, px - 4 + i * 5, py + dy + 1], fill=ink)
        d.line([(px - 7, py + 5), (px + 7, py + 5)], fill=ink, width=1)
    elif glyph == "eat":
        d.line([(px - 4, py - 7), (px - 4, py + 7)], fill=ink, width=2)
        for dx in (-6, -2):
            d.line([(px + dx, py - 7), (px + dx, py - 2)], fill=ink, width=1)
        d.line([(px + 5, py - 7), (px + 5, py + 7)], fill=ink, width=2)
        d.ellipse([px + 2, py - 7, px + 8, py], fill=ink)
    elif glyph == "read":
        d.polygon([(px, py + 6), (px - 8, py + 3), (px - 7, py - 6),
                   (px, py - 3)], fill=None, outline=ink)
        d.polygon([(px, py + 6), (px + 8, py + 3), (px + 7, py - 6),
                   (px, py - 3)], fill=None, outline=ink)
        d.line([(px, py - 3), (px, py + 6)], fill=ink, width=1)
    elif glyph == "sleep":
        # TWO Z's, not three, and the big one is 11 px tall.
        #
        # The first cut drew three stacked Z's inside a 26 px bubble. Each
        # got about 4 px of height and a 1 px stroke, which is not enough
        # travel for the diagonal to read as a diagonal: at size the whole
        # thing collapsed into three horizontal squiggles, and the owner's
        # report was a screenshot and "what does this icon mean?".
        #
        # A glyph in a 26 px circle gets one clear shape and at most one
        # echo of it. The big Z's stroke is 2 px so its diagonal survives
        # having to cross pixel rows, and the small z sits up and to the
        # right, which is where the eye expects a Zzz to trail off to.
        #
        # The bubble's inner radius is 12, so everything here stays inside
        # a 17 px box on the centre. The first attempt at the redraw was
        # legible and two pixels too big, and it cut the circle open at
        # the bottom left and clipped the small z at the top right.
        for (cx, cy, w, h, stroke) in ((-2, 2, 8, 9, 2), (5, -5, 4, 4, 1)):
            x0, x1 = px + cx - w / 2, px + cx + w / 2
            y0, y1 = py + cy - h / 2, py + cy + h / 2
            d.line([(x0, y0), (x1, y0)], fill=ink, width=stroke)
            d.line([(x1, y0), (x0, y1)], fill=ink, width=stroke)
            d.line([(x0, y1), (x1, y1)], fill=ink, width=stroke)
    elif glyph == "exercise":
        # Pedal crank and handlebars, kept open enough to survive 26 pixels.
        d.ellipse([px - 7, py - 2, px + 3, py + 8],
                  outline=ink, width=2)
        d.line([(px - 2, py + 3), (px + 4, py - 5),
                (px + 7, py + 4)], fill=ink, width=2)
        d.line([(px + 2, py - 5), (px + 8, py - 7)],
               fill=ink, width=2)
    elif glyph == "watch":
        d.ellipse([px - 8, py - 5, px + 6, py + 5],
                  outline=ink, width=2)
        d.polygon([(px - 8, py), (px - 12, py - 4),
                   (px - 12, py + 4)], fill=ink)
        d.ellipse([px + 2, py - 1, px + 4, py + 1], fill=ink)
    else:                                   # wait
        d.ellipse([px - 8, py - 8, px + 8, py + 8], outline=ink, width=1)
        d.line([(px, py), (px, py - 5)], fill=ink, width=1)
        d.line([(px, py), (px + 4, py + 2)], fill=ink, width=1)


def indicatorTalk(d): _bubble(d, "talk")
def indicatorEat(d): _bubble(d, "eat")
def indicatorSleep(d): _bubble(d, "sleep")
def indicatorWait(d): _bubble(d, "wait")
def indicatorReading(d): _bubble(d, "read")
def indicatorExercise(d): _bubble(d, "exercise")
def indicatorWatchFish(d): _bubble(d, "watch")


def _carried(d, kind):
    px, py = OX, OY + HH - 9
    if kind == "ingredients":
        d.rectangle([px - 7, py - 6, px + 7, py + 7], fill=C["card"],
                    outline=OUTLINE, width=OUTLINE_WIDTH)
        d.line([(px - 4, py - 6), (px - 4, py - 9)], fill=C["leaf"], width=2)
        d.line([(px + 2, py - 6), (px + 2, py - 10)], fill=C["leaf"], width=2)
    else:
        d.ellipse([px - 8, py - 3, px + 8, py + 5], fill=C["porcelain"],
                  outline=OUTLINE, width=OUTLINE_WIDTH)
        d.ellipse([px - 5, py - 4, px + 5, py + 1], fill=C["accent_clay"])


def carried_ingredients(d): _carried(d, "ingredients")
def carried_dinner(d): _carried(d, "dinner")


def heldSnack(d):
    """A compact sandwich that stays legible in the eating hand."""
    px, py = OX, OY + HH
    bread = mul(C["linen"], .95)
    crust = C["wood"]
    d.rounded_rectangle(
        [px - 6, py - 9, px + 6, py - 2],
        radius=2,
        fill=bread,
        outline=OUTLINE,
        width=OUTLINE_WIDTH,
    )
    d.line([(px - 5, py - 5), (px + 5, py - 5)], fill=crust, width=2)
    d.line([(px - 4, py - 4), (px + 4, py - 4)], fill=C["leaf"], width=1)


# The order is the atlas order, and the atlas order is a sprite's INDEX.
# terri-data resolves names to indices at content-compile time and both
# manifests are written from this one list, so they cannot disagree.
# Sprites whose dimensions ARE the projection rather than a consequence of
# it. iso.test.ts pins every entry here.
EXACT = {
    "floor": (2 * HW, 2 * HH),
    "selectionRing": (2 * HW, 2 * HH),
    "wallNS": (HW, None),
    "wallEW": (HW, None),
    "doorwayNS": (HW, None),
    "doorwayEW": (HW, None),
    "sim": (38, 88),
    "sim2": (38, 88),
    "sim3": (38, 88),
    "cardboardBoxOpen": (80, 88),
    "bookcaseClosedWide": (80, 104),
    "aquariumCabinet1": (80, 104),
    "indicatorExercise": (26, 26),
    "indicatorWatchFish": (26, 26),
    "simTalkSE0": (38, 88),
    "simTalkSE1": (38, 88),
    "simTalkNW0": (38, 88),
    "simTalkNW1": (38, 88),
    "simTalkSW0": (38, 88),
    "simTalkSW1": (38, 88),
    "simTalkNE0": (38, 88),
    "simTalkNE1": (38, 88),
    "sim2TalkSE0": (38, 88),
    "sim2TalkSE1": (38, 88),
    "sim2TalkNW0": (38, 88),
    "sim2TalkNW1": (38, 88),
    "sim2TalkSW0": (38, 88),
    "sim2TalkSW1": (38, 88),
    "sim2TalkNE0": (38, 88),
    "sim2TalkNE1": (38, 88),
    "sim3TalkSE0": (38, 88),
    "sim3TalkSE1": (38, 88),
    "sim3TalkNW0": (38, 88),
    "sim3TalkNW1": (38, 88),
    "sim3TalkSW0": (38, 88),
    "sim3TalkSW1": (38, 88),
    "sim3TalkNE0": (38, 88),
    "sim3TalkNE1": (38, 88),
    "simEatSE0": (38, 88),
    "simEatSE1": (38, 88),
    "simEatNW0": (38, 88),
    "simEatNW1": (38, 88),
    "simEatSW0": (38, 88),
    "simEatSW1": (38, 88),
    "simEatNE0": (38, 88),
    "simEatNE1": (38, 88),
    "sim2EatSE0": (38, 88),
    "sim2EatSE1": (38, 88),
    "sim2EatNW0": (38, 88),
    "sim2EatNW1": (38, 88),
    "sim2EatSW0": (38, 88),
    "sim2EatSW1": (38, 88),
    "sim2EatNE0": (38, 88),
    "sim2EatNE1": (38, 88),
    "sim3EatSE0": (38, 88),
    "sim3EatSE1": (38, 88),
    "sim3EatNW0": (38, 88),
    "sim3EatNW1": (38, 88),
    "sim3EatSW0": (38, 88),
    "sim3EatSW1": (38, 88),
    "sim3EatNE0": (38, 88),
    "sim3EatNE1": (38, 88),
    "simReadSE0": (38, 88),
    "simReadSE1": (38, 88),
    "simReadNW0": (38, 88),
    "simReadNW1": (38, 88),
    "simReadSW0": (38, 88),
    "simReadSW1": (38, 88),
    "simReadNE0": (38, 88),
    "simReadNE1": (38, 88),
    "sim2ReadSE0": (38, 88),
    "sim2ReadSE1": (38, 88),
    "sim2ReadNW0": (38, 88),
    "sim2ReadNW1": (38, 88),
    "sim2ReadSW0": (38, 88),
    "sim2ReadSW1": (38, 88),
    "sim2ReadNE0": (38, 88),
    "sim2ReadNE1": (38, 88),
    "sim3ReadSE0": (38, 88),
    "sim3ReadSE1": (38, 88),
    "sim3ReadNW0": (38, 88),
    "sim3ReadNW1": (38, 88),
    "sim3ReadSW0": (38, 88),
    "sim3ReadSW1": (38, 88),
    "sim3ReadNE0": (38, 88),
    "sim3ReadNE1": (38, 88),
    "simStandReadSE0": (38, 88),
    "simStandReadSE1": (38, 88),
    "simStandReadNW0": (38, 88),
    "simStandReadNW1": (38, 88),
    "simStandReadSW0": (38, 88),
    "simStandReadSW1": (38, 88),
    "simStandReadNE0": (38, 88),
    "simStandReadNE1": (38, 88),
    "sim2StandReadSE0": (38, 88),
    "sim2StandReadSE1": (38, 88),
    "sim2StandReadNW0": (38, 88),
    "sim2StandReadNW1": (38, 88),
    "sim2StandReadSW0": (38, 88),
    "sim2StandReadSW1": (38, 88),
    "sim2StandReadNE0": (38, 88),
    "sim2StandReadNE1": (38, 88),
    "sim3StandReadSE0": (38, 88),
    "sim3StandReadSE1": (38, 88),
    "sim3StandReadNW0": (38, 88),
    "sim3StandReadNW1": (38, 88),
    "sim3StandReadSW0": (38, 88),
    "sim3StandReadSW1": (38, 88),
    "sim3StandReadNE0": (38, 88),
    "sim3StandReadNE1": (38, 88),
    "simWalkSE0": (38, 88),
    "simWalkSE1": (38, 88),
    "simWalkNW0": (38, 88),
    "simWalkNW1": (38, 88),
    "simWalkSW0": (38, 88),
    "simWalkSW1": (38, 88),
    "simWalkNE0": (38, 88),
    "simWalkNE1": (38, 88),
    "sim2WalkSE0": (38, 88),
    "sim2WalkSE1": (38, 88),
    "sim2WalkNW0": (38, 88),
    "sim2WalkNW1": (38, 88),
    "sim2WalkSW0": (38, 88),
    "sim2WalkSW1": (38, 88),
    "sim2WalkNE0": (38, 88),
    "sim2WalkNE1": (38, 88),
    "sim3WalkSE0": (38, 88),
    "sim3WalkSE1": (38, 88),
    "sim3WalkNW0": (38, 88),
    "sim3WalkNW1": (38, 88),
    "sim3WalkSW0": (38, 88),
    "sim3WalkSW1": (38, 88),
    "sim3WalkNE0": (38, 88),
    "sim3WalkNE1": (38, 88),
    "heldSnack": (14, 10),
}

for action_sprite in EXERCISE_SPRITES + WATCH_FISH_SPRITES:
    EXACT[action_sprite.__name__] = (38, 88)


def _facing_sprite(name, drawer, facing):
    def sprite(d):
        drawer(d, facing)
    sprite.__name__ = name
    return sprite


# SW kitchen run pieces already live in the fixed prefix. Everything else
# appends the three missing builder turns after the historical 223.
_ALREADY_HAS_SW = {
    "kitchenCabinet", "kitchenSink", "kitchenStove",
}
_FURNITURE_DRAWERS = (
    ("kitchenFridgeBuiltIn", _fridge),
    ("bathroomSinkSquare", _bathroom_sink),
    ("showerRound", _shower),
    ("toiletSquare", _toilet),
    ("bookcaseClosedDoors", lambda d, facing: _bookcase(d, False, facing)),
    ("loungeSofaOttoman", _ottoman),
    ("televisionVintage", _tv),
    ("bedBunk", _bunk),
    ("kitchenStove", lambda d, facing: _counter(d, "hob", facing)),
    ("kitchenCabinet", lambda d, facing: _counter(d, "plain", facing)),
    ("kitchenSink", lambda d, facing: _counter(d, "sink", facing)),
    ("table", _table),
    ("chair", _chair),
    ("trashcan", _bin),
    ("loungeSofaLong", _long_sofa),
    ("loungeChair", _armchair),
    ("loungeChairRelax", _wingback),
    ("radio", _radio),
    ("pottedPlant", _plant),
    ("cardboardBoxOpen", _bike),
    ("lampRoundFloor", _lamp),
    ("coatRackStanding", _coat_rack),
    ("bedDouble", _double_bed),
    ("sideTableDrawers", _nightstand),
    ("cabinetBedDrawer", _dresser),
    ("desk", _desk),
    ("chairDesk", _desk_chair),
    ("bathtub", _bathtub),
    ("washerDryerStacked", _laundry),
)
OBJECT_FACING_VARIANTS = []
for base, drawer in _FURNITURE_DRAWERS:
    for facing in ("SW", "NW", "NE"):
        if facing == "SW" and base in _ALREADY_HAS_SW:
            continue
        OBJECT_FACING_VARIANTS.append(
            _facing_sprite(f"{base}{facing}", drawer, facing.lower())
        )

for sprite in OBJECT_FACING_VARIANTS:
    if sprite.__name__.startswith("cardboardBoxOpen"):
        EXACT[sprite.__name__] = (80, 88)


def _bathtub_full(d, facing):
    _bathtub(d, facing, filled=True)


BATHTUB_FULL_VARIANTS = [
    _facing_sprite(f"bathtubFull{facing}", _bathtub_full, facing.lower())
    for facing in ("SW", "NW", "NE")
]


SPRITES = [
    floor, sim, wallNS, wallEW, kitchenFridgeBuiltIn, bathroomSinkSquare,
    showerRound, toiletSquare, bookcaseClosedDoors, loungeSofaOttoman,
    televisionVintage, bedBunk, selectionRing, kitchenStove, kitchenCabinet,
    kitchenSink, table, chair, trashcan, loungeSofaLong, loungeChair,
    loungeChairRelax, radio, pottedPlant, cardboardBoxOpen, lampRoundFloor,
    coatRackStanding, bedDouble, sideTableDrawers, cabinetBedDrawer, desk,
    chairDesk, bookcaseClosedWide, bathtub, washerDryerStacked, wallCornerNW,
    doorwayNS, doorwayEW, kitchenStoveSW, kitchenCabinetSW, kitchenSinkSW,
    kitchenCabinetCornerInnerSW, indicatorTalk, indicatorEat, indicatorSleep,
    indicatorWait, carried_ingredients, carried_dinner,
    # Appended, never inserted: the list order IS the sprite index, and
    # `sim` has to stay at 1 because a compiled pack already resolved it.
    sim2, sim3,
    # Conversation frames are an append-only extension. Frame zero is the
    # quiet partner-facing pose and frame one raises that same arm to chest
    # height. Cardinal labels are screen directions after lot projection.
    simTalkSE0, simTalkSE1, simTalkNW0, simTalkNW1,
    simTalkSW0, simTalkSW1, simTalkNE0, simTalkNE1,
    sim2TalkSE0, sim2TalkSE1, sim2TalkNW0, sim2TalkNW1,
    sim2TalkSW0, sim2TalkSW1, sim2TalkNE0, sim2TalkNE1,
    sim3TalkSE0, sim3TalkSE1, sim3TalkNW0, sim3TalkNW1,
    sim3TalkSW0, sim3TalkSW1, sim3TalkNE0, sim3TalkNE1,
    # Eating frames append after conversation. The quiet frame holds the
    # anchor-side hand at chest height and the active frame raises it to the
    # mouth. [EA3].
    simEatSE0, simEatSE1, simEatNW0, simEatNW1,
    simEatSW0, simEatSW1, simEatNE0, simEatNE1,
    sim2EatSE0, sim2EatSE1, sim2EatNW0, sim2EatNW1,
    sim2EatSW0, sim2EatSW1, sim2EatNE0, sim2EatNE1,
    sim3EatSE0, sim3EatSE1, sim3EatNW0, sim3EatNW1,
    sim3EatSW0, sim3EatSW1, sim3EatNE0, sim3EatNE1,
    # Seated reading appends after eating. The body owns the seated contact,
    # open book, hands, and page adjustment; the chair stays its existing
    # object quad beneath it. [SR-art].
    simReadSE0, simReadSE1, simReadNW0, simReadNW1,
    simReadSW0, simReadSW1, simReadNE0, simReadNE1,
    sim2ReadSE0, sim2ReadSE1, sim2ReadNW0, sim2ReadNW1,
    sim2ReadSW0, sim2ReadSW1, sim2ReadNE0, sim2ReadNE1,
    sim3ReadSE0, sim3ReadSE1, sim3ReadNW0, sim3ReadNW1,
    sim3ReadSW0, sim3ReadSW1, sim3ReadNE0, sim3ReadNE1,
    indicatorReading,
    # Standing reading follows the established Reading activity and indicator
    # but keeps its own upright silhouette and append-only visual-action art.
    # [BR-art].
    simStandReadSE0, simStandReadSE1, simStandReadNW0, simStandReadNW1,
    simStandReadSW0, simStandReadSW1, simStandReadNE0, simStandReadNE1,
    sim2StandReadSE0, sim2StandReadSE1, sim2StandReadNW0, sim2StandReadNW1,
    sim2StandReadSW0, sim2StandReadSW1, sim2StandReadNE0, sim2StandReadNE1,
    sim3StandReadSE0, sim3StandReadSE1, sim3StandReadNW0, sim3StandReadNW1,
    sim3StandReadSW0, sim3StandReadSW1, sim3StandReadNE0, sim3StandReadNE1,
    # Real directional walk frames append after every shipped action index.
    # Opposite legs and arms exchange silhouettes between the two phases.
    simWalkSE0, simWalkSE1, simWalkNW0, simWalkNW1,
    simWalkSW0, simWalkSW1, simWalkNE0, simWalkNE1,
    sim2WalkSE0, sim2WalkSE1, sim2WalkNW0, sim2WalkNW1,
    sim2WalkSW0, sim2WalkSW1, sim2WalkNE0, sim2WalkNE1,
    sim3WalkSE0, sim3WalkSE1, sim3WalkNW0, sim3WalkNW1,
    sim3WalkSW0, sim3WalkSW1, sim3WalkNE0, sim3WalkNE1,
    # Snack food is a hand overlay. Dinner keeps its existing index and pixels.
    heldSnack,
    # Aquarium motion, action indicators, and character poses append after
    # every shipped record. Frame zero keeps the historical aquarium index.
    aquariumCabinet1, indicatorExercise, indicatorWatchFish,
    *EXERCISE_SPRITES,
    *WATCH_FISH_SPRITES,
    *OBJECT_FACING_VARIANTS,
    bathtubFull,
    *BATHTUB_FULL_VARIANTS,
]
