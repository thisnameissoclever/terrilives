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
import math

from PIL import ImageDraw

from style import (PALETTE as C, ACCENTS, OUTLINE, OUTLINE_WIDTH, CHARACTER,
                   CHARACTER_PALETTES, mul, mix)
from iso import (P, OX, OY, sx, sy, box, slab, cyl, diamond, legs, canvas,
                 emit, HW, HH, Z_UNIT)

WALL_H = 2.0
A, B = -0.5, 0.5          # a 1x1 footprint, centred on the anchor tile


# ---------------------------------------------------------------- shell ----
def floor(d):
    diamond(d, A, A, B, B, C["floor"], outline=C["grout"], width=1)


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


# ------------------------------------------------------------- kitchen ----
def _counter(d, kind, facing="se"):
    """The kitchen run. `facing` swaps which way the working face points."""
    box(d, A + .04, A + .04, B - .04, B - .04, 0, 0.78, C["cabinet"])
    slab(d, A, A, B, B, 0.86, C["counter"], thick=0.08)
    # A handle line, so a run of cabinets is not three identical blocks.
    if facing == "se":
        d.line([P(B - .04, A + .30, 0.60), P(B - .04, B - .30, 0.60)],
               fill=mul(C["metal"], .8), width=2)
    else:
        d.line([P(A + .30, B - .04, 0.60), P(B - .30, B - .04, 0.60)],
               fill=mul(C["metal"], .8), width=2)
    if kind == "sink":
        diamond(d, A + .18, A + .18, B - .18, B - .18, mul(C["metal"], .82),
                outline=OUTLINE, width=OUTLINE_WIDTH)
        box(d, -.05, A + .20, .05, A + .27, 0.86, 0.99, C["metal"])
    elif kind == "hob":
        for cx, cy in ((-.18, -.18), (.18, -.18), (-.18, .18), (.18, .18)):
            p = P(cx, cy, 0.87)
            d.ellipse([p[0] - 7, p[1] - 5, p[0] + 7, p[1] + 5],
                      fill=mul(C["ink"], 1.6), outline=OUTLINE, width=OUTLINE_WIDTH)
    elif kind == "corner":
        slab(d, A, A, B, B, 0.86, C["counter"], thick=0.08)


def kitchenCabinet(d): _counter(d, "plain")
def kitchenSink(d): _counter(d, "sink")
def kitchenStove(d): _counter(d, "hob")
def kitchenCabinetSW(d): _counter(d, "plain", "sw")
def kitchenSinkSW(d): _counter(d, "sink", "sw")
def kitchenStoveSW(d): _counter(d, "hob", "sw")
def kitchenCabinetCornerInnerSW(d): _counter(d, "corner", "sw")


def kitchenFridgeBuiltIn(d):
    box(d, A + .08, A + .08, B - .08, B - .08, 0, 1.55, C["metal"])
    d.line([P(B - .08, A + .30, 1.02), P(B - .08, A + .30, 0.62)],
           fill=mul(C["ink"], 1.4), width=2)
    d.line([P(B - .08, A + .16, 0.86), P(B - .08, B - .16, 0.86)],
           fill=mul(C["metal"], .72), width=1)


# ------------------------------------------------------------ bathroom ----
def toiletSquare(d):
    p = C["porcelain"]
    box(d, -.20, A + .06, .20, A + .28, 0, 0.80, p)
    box(d, -.22, A + .28, .22, B - .14, 0, 0.40, p)
    slab(d, -.24, A + .26, .24, B - .12, 0.46, mul(p, .97), thick=0.05)


def bathroomSinkSquare(d):
    p = C["porcelain"]
    box(d, -.10, -.06, .10, .10, 0, 0.52, mul(p, .92))       # pedestal
    box(d, -.26, -.22, .26, .22, 0.52, 0.70, p)
    diamond(d, -.18, -.14, .18, .14, mul(p, .86),
            outline=OUTLINE, width=OUTLINE_WIDTH)
    box(d, -.04, -.24, .04, -.16, 0.70, 0.90, C["metal"])


def showerRound(d):
    g = mix(C["water"], (255, 255, 255), 0.5)
    box(d, A + .08, A + .08, B - .08, B - .08, 0, 0.12, C["porcelain"])
    box(d, A + .08, A + .08, B - .08, A + .18, 0.12, 1.62, g)     # glass
    box(d, A + .08, A + .08, A + .18, B - .08, 0.12, 1.62, mix(g, C["wall"], .25))
    box(d, -.06, A + .10, .06, A + .18, 1.44, 1.56, C["metal"])   # head


def bathtub(d):
    p = C["porcelain"]
    box(d, -1.40, A + .10, B - .06, B - .10, 0, 0.50, p)
    diamond(d, -1.28, A + .22, B - .18, B - .22, C["water"],
            outline=OUTLINE, width=OUTLINE_WIDTH)
    box(d, -1.36, A + .18, -1.28, A + .26, 0.50, 0.66, C["metal"])


def washerDryerStacked(d):
    box(d, A + .10, A + .10, B - .10, B - .10, 0, 0.74, C["metal"])
    box(d, A + .10, A + .10, B - .10, B - .10, 0.74, 1.46, mul(C["metal"], 1.04))
    for z in (0.36, 1.08):
        p = P(B - .10, 0, z)
        d.ellipse([p[0] - 9, p[1] - 9, p[0] + 9, p[1] + 9],
                  fill=mul(C["screen"], 1.1), outline=OUTLINE, width=OUTLINE_WIDTH)


# --------------------------------------------------------------- sleep ----
def bedDouble(d):
    w = C["wood"]
    box(d, -1.42, A + .06, B - .06, B - .06, 0, 0.26, w)
    box(d, -1.42, A + .06, -1.30, B - .06, 0, 0.86, w)             # headboard
    slab(d, -1.30, A + .10, B - .10, B - .10, 0.46, C["linen"], thick=0.18)
    slab(d, -0.62, A + .10, B - .10, B - .10, 0.50, C["fabric"], thick=0.12)
    slab(d, -1.24, A + .16, -0.86, B - .30, 0.52, C["linen_alt"], thick=0.10)
    slab(d, -1.24, -.02, -0.86, B - .14, 0.52, C["linen_alt"], thick=0.10)


def bedBunk(d):
    w = C["wood"]
    for z in (0.30, 1.20):
        box(d, -1.42, A + .06, B - .06, B - .06, z, z + 0.10, w)
        slab(d, -1.34, A + .10, B - .10, B - .10, z + 0.26, C["linen"], thick=0.16)
        slab(d, -0.66, A + .10, B - .10, B - .10, z + 0.30, C["fabric"], thick=0.10)
    for dx in (-1.40, B - .12):                                    # posts
        box(d, dx, A + .06, dx + .12, A + .18, 0, 1.86, mul(w, .9))
        box(d, dx, B - .18, dx + .12, B - .06, 0, 1.86, mul(w, .9))


def cabinetBedDrawer(d):
    w = C["wood_light"]
    box(d, -.28, -.28, .28, .28, 0, 0.52, w)
    d.line([P(.28, -.14, 0.36), P(.28, .14, 0.36)], fill=mul(C["metal"], .8), width=2)


def sideTableDrawers(d):
    w = C["wood"]
    box(d, A + .10, A + .10, B - .10, B - .10, 0, 0.66, w)
    for z in (0.24, 0.48):
        d.line([P(B - .10, -.14, z), P(B - .10, .14, z)],
               fill=mul(C["metal"], .8), width=2)


# --------------------------------------------------------------- lounge ----
def loungeSofaLong(d):
    f = C["fabric"]
    box(d, -1.42, A + .06, B - .06, B - .06, 0, 0.32, mul(f, .92))
    slab(d, -1.36, A + .26, B - .10, B - .10, 0.48, f, thick=0.16)
    box(d, -1.42, A + .06, B - .06, A + .26, 0, 0.80, f)
    box(d, -1.42, A + .06, -1.28, B - .06, 0, 0.60, mul(f, .96))
    box(d, B - .20, A + .06, B - .06, B - .06, 0, 0.60, mul(f, .96))


def loungeSofaOttoman(d):
    f = C["fabric"]
    box(d, A + .10, A + .10, B - .10, B - .10, 0, 0.36, mul(f, .94))
    slab(d, A + .06, A + .06, B - .06, B - .06, 0.44, f, thick=0.10)


def loungeChair(d):
    f = C["accent_clay"]
    box(d, A + .14, A + .14, B - .14, B - .14, 0, 0.30, mul(f, .92))
    slab(d, A + .10, A + .22, B - .10, B - .10, 0.44, f, thick=0.14)
    box(d, A + .14, A + .14, B - .14, A + .26, 0, 0.78, f)
    box(d, A + .14, A + .14, A + .24, B - .14, 0, 0.58, mul(f, .96))
    box(d, B - .24, A + .14, B - .14, B - .14, 0, 0.58, mul(f, .96))


def loungeChairRelax(d):
    """The same chair, reclined and with a footrest - Bill's chair."""
    f = C["accent_clay"]
    box(d, A + .14, -.10, B - .14, B - .12, 0, 0.28, mul(f, .92))
    slab(d, A + .10, -.02, B - .10, B - .10, 0.42, f, thick=0.14)
    box(d, A + .16, -.30, B - .16, -.16, 0, 0.86, f)              # raked back
    box(d, A + .18, A + .06, B - .18, A + .22, 0, 0.34, mul(f, .96))   # footrest


def televisionVintage(d):
    box(d, -.22, -.14, .22, .14, 0, 0.24, mul(C["ink"], 1.5))
    box(d, -.34, -.16, .34, -.04, 0.24, 0.84, mul(C["ink"], 1.7))
    d.polygon([P(-.30, -.16, 0.80), P(.30, -.16, 0.80),
               P(.30, -.16, 0.32), P(-.30, -.16, 0.32)],
              fill=C["screen"], outline=OUTLINE, width=OUTLINE_WIDTH)


def radio(d):
    box(d, -.16, -.12, .16, .12, 0, 0.34, C["wood_dark"])
    p = P(.16, 0, 0.20)
    d.ellipse([p[0] - 6, p[1] - 5, p[0] + 6, p[1] + 5],
              fill=mul(C["metal"], .9), outline=OUTLINE, width=OUTLINE_WIDTH)
    d.line([P(-.10, -.12, 0.34), P(-.10, -.12, 0.62)], fill=C["metal"], width=2)


# --------------------------------------------------------------- study ----
def table(d):
    w = C["wood"]
    legs(d, A, A, B, B, 0.54, w)
    slab(d, A - .04, A - .04, B + .04, B + .04, 0.64, w, thick=0.10)


def desk(d):
    w = C["wood"]
    box(d, A + .08, A + .10, A + .34, B - .10, 0, 0.56, mul(w, .88))
    legs(d, B - .30, A, B, B, 0.56, w, inset=0.06)
    slab(d, A, A - .04, B + .04, B + .04, 0.64, w, thick=0.09)
    d.line([P(A + .34, -.14, 0.42), P(A + .34, .14, 0.42)],
           fill=mul(C["metal"], .8), width=2)


def chair(d):
    w = C["wood_light"]
    legs(d, A + .16, A + .16, B - .16, B - .16, 0.42, w, inset=0.03, thick=0.07)
    slab(d, A + .14, A + .14, B - .14, B - .14, 0.48, w, thick=0.07)
    box(d, A + .14, A + .14, B - .14, A + .22, 0.48, 1.00, w)


def chairDesk(d):
    w = C["accent_slate"]
    # The five-star base is drawn in PIXELS around the contact point rather
    # than in tile coordinates. Arms of 0.3 tiles from the tile's south
    # corner reach past it, and `emit` rejects anything below the anchor
    # row - correctly, since it would be a chair sunk into the floor.
    bx, by = P(.5, .5)
    by -= 9
    cyl(d, .5, .5, 0.10, 0, 0.40, C["metal"])
    for a in range(5):
        r = math.radians(a * 72 + 18)
        d.line([(bx, by), (bx + math.cos(r) * 15, by + math.sin(r) * 9)],
               fill=mul(C["metal"], .78), width=3)
    slab(d, A + .18, A + .18, B - .18, B - .18, 0.50, w, thick=0.08)
    box(d, A + .18, A + .18, B - .18, A + .26, 0.50, 1.04, w)


def bookcaseClosedWide(d):
    _bookcase(d, wide=True)


def bookcaseClosedDoors(d):
    _bookcase(d, wide=False)


def _bookcase(d, wide):
    w = C["wood"]
    x0 = -1.36 if wide else A + .10
    box(d, x0, A + .08, B - .08, A + .40, 0, 1.55, mul(w, .84))
    shelves = 4
    for i in range(shelves):
        z = 0.30 + i * 0.32
        slab(d, x0 + .04, A + .12, B - .12, A + .36, z, w, thick=0.05)
        span = (B - .12) - (x0 + .04)
        n = 6 if wide else 3
        for j in range(n):
            bx = x0 + .08 + j * (span / n)
            h = 0.16 + ((i * 7 + j * 5) % 4) * 0.03
            box(d, bx, A + .16, bx + span / n - .03, A + .32,
                z, z + h, ACCENTS[(i * 3 + j) % len(ACCENTS)])


# --------------------------------------------------------------- props ----
def pottedPlant(d):
    cyl(d, .5, .5, 0.16, 0, 0.32, C["pot"])
    px, py = P(.5, .5, 0.32)
    for ang, ln in ((-72, 26), (-40, 34), (-8, 30), (26, 33), (58, 24), (96, 20)):
        r = math.radians(ang - 90)
        d.line([(px, py), (px + math.cos(r) * ln * .8, py + math.sin(r) * ln)],
               fill=C["leaf"], width=4)
    d.ellipse([px - 4, py - 4, px + 4, py + 4], fill=mul(C["leaf"], .9))


def lampRoundFloor(d):
    px, py = P(.5, .5)
    d.ellipse([px - 12, py - 10, px + 12, py], fill=mul(C["metal"], .8),
              outline=OUTLINE, width=OUTLINE_WIDTH)
    d.rectangle([px - 2, py - 1.30 * Z_UNIT, px + 2, py], fill=C["metal"],
                outline=OUTLINE, width=OUTLINE_WIDTH)
    top = py - 1.30 * Z_UNIT
    d.polygon([(px - 11, top + 18), (px - 17, top + 18), (px - 12, top - 4),
               (px + 12, top - 4), (px + 17, top + 18), (px + 11, top + 18)],
              fill=C["shade"], outline=OUTLINE, width=OUTLINE_WIDTH)
    d.ellipse([px - 17, top + 13, px + 17, top + 23], fill=mul(C["shade"], 1.12),
              outline=OUTLINE, width=OUTLINE_WIDTH)


def coatRackStanding(d):
    px, py = P(.5, .5)
    d.ellipse([px - 10, py - 8, px + 10, py], fill=mul(C["wood_dark"], .9),
              outline=OUTLINE, width=OUTLINE_WIDTH)
    d.rectangle([px - 2, py - 1.42 * Z_UNIT, px + 2, py], fill=C["wood"],
                outline=OUTLINE, width=OUTLINE_WIDTH)
    top = py - 1.42 * Z_UNIT
    for s in (-1, 1):
        d.line([(px, top + 6), (px + s * 11, top + 1)], fill=C["wood"], width=3)
    box(d, -.10, -.10, .10, .10, 1.02, 1.30, C["accent_sage"])     # a coat on it


def trashcan(d):
    cyl(d, .5, .5, 0.18, 0, 0.52, mul(C["metal"], .96))


def cardboardBoxOpen(d):
    k = C["card"]
    box(d, A + .14, A + .14, B - .14, B - .14, 0, 0.42, k)
    diamond(d, A + .18, A + .18, B - .18, B - .18, mul(k, .72),
            outline=OUTLINE, width=OUTLINE_WIDTH)
    for (x0, y0, x1, y1) in ((A + .14, A + .10, B - .14, A + .16),
                             (A + .10, A + .14, A + .16, B - .14)):
        box(d, x0, y0, x1, y1, 0.42, 0.56, mul(k, 1.05))


def hair_cap(d, cx, cy, r, radius, colour, ol, w):
    """The hair, following the HEAD's silhouette rather than an ellipse.

    This was a `chord` of the ellipse inscribed in the head's box, and it
    left the owner's report: "each sim's head kind of extends out from the
    side of their hair, which makes it look like they have two little bald
    spots on the top left and right corners". That is exactly what it was.
    The head is a ROUNDED RECTANGLE, whose top corners sit at the corner of
    its box minus a small radius; the inscribed ellipse's top corners are
    much further in. The skin between the two curves is the bald spot, and
    it appears on both sides of every head in the game.

    A rounded rectangle with the same radius and only its TOP corners
    rounded traces the head exactly, so there is no gap to leave. The flat
    bottom edge is the hairline, which is what the chord's flat side was
    already doing.
    """
    # The hairline sits at -0.15r rather than at the old chord box's
    # +0.35r, and the difference is not a taste change. `chord(180, 360)`
    # fills the upper HALF of the ellipse inscribed in its box, so its flat
    # edge landed at the ellipse's vertical midpoint - well above the box
    # bottom the coordinates named. A rectangle over the same box fills all
    # of it, and the first version of this fix drew hair down over the
    # eyes.
    #
    # The height is then 0.85r, which is the smallest that still admits the
    # head's own 0.42r corner radius twice over. Any lower a hairline and
    # the corners have to shrink, and they are the whole reason this
    # traces the head instead of an ellipse. `max` keeps that true for a
    # caller passing its own radius.
    bottom = cy - r * .15
    radius = min(radius, (bottom - (cy - r)) / 2)
    d.rounded_rectangle(
        [cx - r, cy - r, cx + r, bottom],
        radius=radius,
        corners=(True, True, False, False),
        fill=colour, outline=ol, width=w,
    )


# ---------------------------------------------------------- characters ----
def _talk_arm(d, palette, shoulder, side, depth, frame, arm_width):
    """Draw the partner-side arm for one restrained conversation pose."""
    shirt, skin = palette["shirt"], palette["skin"]
    sx0, sy0 = shoulder
    depth_offset = depth * 1.2

    if frame == 0:
        points = [
            (sx0, sy0),
            (sx0 + side * 2.2, sy0 + 7.0 + depth_offset),
            (sx0 + side * .8, sy0 + 12.5 + depth_offset),
        ]
    else:
        points = [
            (sx0, sy0),
            (sx0 + side * 1.8, sy0 + 6.2 + depth_offset),
            (sx0 - side * 2.2, sy0 + 3.9 + depth_offset),
        ]

    d.line(points, fill=OUTLINE, width=arm_width + 2 * OUTLINE_WIDTH,
           joint="curve")
    d.line(points, fill=mul(shirt, .93), width=arm_width, joint="curve")
    hx, hy = points[-1]
    hand_r = 2.5
    d.ellipse([hx - hand_r, hy - hand_r, hx + hand_r, hy + hand_r],
              fill=skin, outline=OUTLINE, width=OUTLINE_WIDTH)


def _eat_arm(d, palette, shoulder, side, depth, frame, arm_width):
    """Draw one restrained hand-to-mouth eating gesture. [EA3]."""
    shirt, skin = palette["shirt"], palette["skin"]
    sx0, sy0 = shoulder
    depth_offset = depth * .8

    if frame == 0:
        points = [
            (sx0, sy0),
            (sx0 + side * 2.4, sy0 + 5.8 + depth_offset),
            (sx0 - side * .8, sy0 + 4.0 + depth_offset),
        ]
    else:
        points = [
            (sx0, sy0),
            (sx0 + side * 2.0, sy0 + 4.6 + depth_offset),
            (sx0 - side * 2.8, sy0 - 2.8 + depth_offset * .4),
        ]

    d.line(points, fill=OUTLINE, width=arm_width + 2 * OUTLINE_WIDTH,
           joint="curve")
    d.line(points, fill=mul(shirt, .93), width=arm_width, joint="curve")
    hx, hy = points[-1]
    hand_r = 2.5
    d.ellipse([hx - hand_r, hy - hand_r, hx + hand_r, hy + hand_r],
              fill=skin, outline=OUTLINE, width=OUTLINE_WIDTH)


def _figure(d, palette, action=None, facing=None, frame=0):
    """One sim, in one palette. [ML-chars].

    Every proportion comes from CHARACTER and only the four colours vary,
    so the three variants are the same person in different clothes rather
    than three different builds. That is deliberate: silhouette is what
    reads at one tile, and three silhouettes would make the household
    look like three species.
    """
    ch = CHARACTER
    H = ch["height"]
    head_r = H * ch["head"]
    px, py = P(.5, .5)
    skin, hair = palette["skin"], palette["hair"]
    shirt, trouser = palette["shirt"], palette["trouser"]
    ol, w = OUTLINE, OUTLINE_WIDTH

    d.ellipse([px - 13, py - 10, px + 13, py], fill=(0, 0, 0, 46))
    sh, hip, leg = ch["shoulder"] * H, ch["hip"] * H, ch["leg"] * H
    torso = H - leg - head_r * 2
    ty = py - leg
    lw = hip * .42
    for s in (-1, 1):
        cx = px + s * hip * .26
        d.rectangle([cx - lw / 2, ty, cx + lw / 2, py], fill=trouser, outline=ol, width=w)
    top_y = ty - torso
    d.rectangle([px - sh / 2, top_y, px + sh / 2, ty], fill=shirt, outline=ol, width=w)
    aw = sh * .22
    action_side = None
    action_depth = None
    if facing is not None:
        action_side, action_depth = {
            "se": (1, 1),
            "nw": (-1, -1),
            "sw": (-1, 1),
            "ne": (1, -1),
        }[facing]
    assert (action is None) == (facing is None)
    assert action in (None, "talk", "eat")
    for s in (-1, 1):
        ax = px + s * (sh / 2 - aw * .3)
        if s == action_side:
            shoulder_height = .36 if action_depth > 0 else .22
            shoulder = (ax, top_y + torso * shoulder_height)
            if action == "talk":
                _talk_arm(d, palette, shoulder, s, action_depth, frame,
                          round(aw))
            else:
                _eat_arm(d, palette, shoulder, s, action_depth, frame,
                         round(aw))
        else:
            d.rectangle([ax - aw / 2, top_y + torso * .12, ax + aw / 2,
                         ty + leg * .10], fill=mul(shirt, .93), outline=ol,
                        width=w)
    hy = top_y - head_r
    d.rounded_rectangle([px - head_r, hy - head_r, px + head_r, hy + head_r],
                        radius=int(head_r * .42), fill=skin, outline=ol, width=w)
    hair_cap(d, px, hy, head_r, int(head_r * .42), hair, ol, w)
    gaze_x = action_side * 1.8 if action_side is not None else 0
    gaze_y = action_depth * 1.0 if action_depth is not None else 0
    ey, r = hy + head_r * .12 + gaze_y, max(1.2, head_r * .11)
    for s in (-1, 1):
        cx = px + s * head_r * .34 + gaze_x
        d.ellipse([cx - r, ey - r, cx + r, ey + r], fill=ch["eye"])


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
    """A seated body with an open book, anchored at the chair socket.

    The chair remains its own prop quad. This body therefore carries only the
    contact cues the person owns: bent legs, a lowered hip, hands on a book,
    and a small page adjustment in frame one. Everything stays inside the
    established 38 by 88 action envelope.
    """
    px, py = P(.5, .5)
    side, depth = {
        "se": (1, 1),
        "nw": (-1, -1),
        "sw": (-1, 1),
        "ne": (1, -1),
    }[facing]
    skin, hair = palette["skin"], palette["hair"]
    shirt, trouser = palette["shirt"], palette["trouser"]
    ol, w = OUTLINE, OUTLINE_WIDTH

    d.ellipse([px - 13, py - 7, px + 13, py], fill=(0, 0, 0, 46))

    # A pair of bent legs is the silhouette cue that stops a shortened
    # standing sprite from pretending to be seated. The depth sign changes
    # which knee is higher without changing the bottom-centre anchor.
    hip_y = py - 26
    for leg_side in (-1, 1):
        hip_x = px + leg_side * 4
        knee_x = px + leg_side * 7 + side * 2
        knee_y = py - 15 + (depth * leg_side * 2)
        foot_x = knee_x + side * 2
        points = [(hip_x, hip_y), (knee_x, knee_y), (foot_x, py - 3)]
        d.line(points, fill=ol, width=8, joint="curve")
        d.line(points, fill=trouser, width=6, joint="curve")
        d.line([(foot_x - 3, py - 2), (foot_x + 4, py - 2)],
               fill=ol, width=3)

    top_y = py - 59
    shoulder_y = top_y + 8
    d.rectangle([px - 3, py - 64, px + 3, shoulder_y + 1],
                fill=skin, outline=ol, width=w)
    d.polygon([
        (px - 12, shoulder_y),
        (px + 12, shoulder_y),
        (px + 8, hip_y + 2),
        (px - 8, hip_y + 2),
    ], fill=shirt, outline=ol)

    # Both hands converge on the book. Frame one shifts the anchor-side hand
    # and lifts one page corner, a restrained adjustment rather than a flap.
    book_x = px + side * 3
    book_y = py - 34 + depth
    hand_shift = side * (2 if frame else 0)
    for arm_side in (-1, 1):
        shoulder = (px + arm_side * 9, shoulder_y + 4)
        hand = (book_x + arm_side * 6 + (hand_shift if arm_side == side else 0),
                book_y + 2 - depth * arm_side)
        elbow = (px + arm_side * 12, py - 43 + depth * arm_side)
        d.line([shoulder, elbow, hand], fill=ol, width=6, joint="curve")
        d.line([shoulder, elbow, hand], fill=mul(shirt, .93), width=4,
               joint="curve")
        d.ellipse([hand[0] - 2, hand[1] - 2, hand[0] + 2, hand[1] + 2],
                  fill=skin, outline=ol, width=w)

    page = C["linen"]
    cover = C["wood_dark"]
    d.polygon([
        (book_x, book_y + 8),
        (book_x - 8, book_y + 5),
        (book_x - 7, book_y - 4),
        (book_x, book_y - 1),
    ], fill=page, outline=ol)
    right_top = book_y - (4 if frame == 0 else 7)
    d.polygon([
        (book_x, book_y + 8),
        (book_x + 8, book_y + 5),
        (book_x + 7, right_top),
        (book_x, book_y - 1),
    ], fill=mul(page, .96), outline=ol)
    d.line([(book_x - 8, book_y + 6), (book_x, book_y + 9),
            (book_x + 8, book_y + 6)], fill=cover, width=2)
    d.line([(book_x, book_y - 1), (book_x, book_y + 8)], fill=ol, width=1)

    head_r = 12
    head_x = px + side
    head_y = py - 73
    d.rounded_rectangle([
        head_x - head_r, head_y - head_r,
        head_x + head_r, head_y + head_r,
    ], radius=5, fill=skin, outline=ol, width=w)
    hair_cap(d, head_x, head_y, head_r, 5, hair, ol, w)
    eye_y = head_y + 3 + depth
    for eye_side in (-1, 1):
        eye_x = head_x + eye_side * 4 + side
        d.ellipse([eye_x - 1, eye_y - 1, eye_x + 1, eye_y + 1],
                  fill=CHARACTER["eye"])


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
    """An upright reader holding one open book toward the target object.

    The Sim stays on the ordinary adjacent path tile, so the body keeps the
    established standing contact point. Both hands, the book, gaze, and page
    adjustment carry the authored facing while the legs remain planted.
    """
    ch = CHARACTER
    height = ch["height"]
    head_r = height * ch["head"]
    px, py = P(.5, .5)
    side, depth = {
        "se": (1, 1),
        "nw": (-1, -1),
        "sw": (-1, 1),
        "ne": (1, -1),
    }[facing]
    skin, hair = palette["skin"], palette["hair"]
    shirt, trouser = palette["shirt"], palette["trouser"]
    ol, w = OUTLINE, OUTLINE_WIDTH

    d.ellipse([px - 13, py - 10, px + 13, py], fill=(0, 0, 0, 46))
    shoulder_width = ch["shoulder"] * height
    hip_width = ch["hip"] * height
    leg_height = ch["leg"] * height
    torso_height = height - leg_height - head_r * 2
    hip_y = py - leg_height
    leg_width = hip_width * .42
    for leg_side in (-1, 1):
        leg_x = px + leg_side * hip_width * .26
        d.rectangle(
            [leg_x - leg_width / 2, hip_y, leg_x + leg_width / 2, py],
            fill=trouser,
            outline=ol,
            width=w,
        )

    top_y = hip_y - torso_height
    d.rectangle(
        [px - shoulder_width / 2, top_y, px + shoulder_width / 2, hip_y],
        fill=shirt,
        outline=ol,
        width=w,
    )

    # The open book sits clear of the torso at native size. Frame one lifts
    # the target-side page corner and shifts that hand by two pixels, enough
    # to read as a page adjustment without becoming frantic semaphore.
    book_x = px + side * 2
    book_y = py - 40 + depth
    hand_shift = side * (2 if frame else 0)
    for arm_side in (-1, 1):
        shoulder_x = px + arm_side * (shoulder_width / 2 - 2)
        shoulder_y = top_y + torso_height * (.28 if depth > 0 else .20)
        hand_x = book_x + arm_side * 6
        if arm_side == side:
            hand_x += hand_shift
        hand_y = book_y + 3 - depth * arm_side
        elbow_x = px + arm_side * 10
        elbow_y = py - 46 + depth * arm_side
        points = [(shoulder_x, shoulder_y), (elbow_x, elbow_y), (hand_x, hand_y)]
        d.line(points, fill=ol, width=6, joint="curve")
        d.line(points, fill=mul(shirt, .93), width=4, joint="curve")
        d.ellipse(
            [hand_x - 2, hand_y - 2, hand_x + 2, hand_y + 2],
            fill=skin,
            outline=ol,
            width=w,
        )

    page = C["linen"]
    cover = C["wood_dark"]
    d.polygon(
        [
            (book_x, book_y + 8),
            (book_x - 8, book_y + 5),
            (book_x - 7, book_y - 4),
            (book_x, book_y - 1),
        ],
        fill=page,
        outline=ol,
    )
    right_top = book_y - (4 if frame == 0 else 7)
    d.polygon(
        [
            (book_x, book_y + 8),
            (book_x + 8, book_y + 5),
            (book_x + 7, right_top),
            (book_x, book_y - 1),
        ],
        fill=mul(page, .96),
        outline=ol,
    )
    d.line(
        [(book_x - 8, book_y + 6), (book_x, book_y + 9), (book_x + 8, book_y + 6)],
        fill=cover,
        width=2,
    )
    d.line([(book_x, book_y - 1), (book_x, book_y + 8)], fill=ol, width=1)

    head_y = top_y - head_r
    head_x = px + side
    d.rounded_rectangle(
        [head_x - head_r, head_y - head_r, head_x + head_r, head_y + head_r],
        radius=int(head_r * .42),
        fill=skin,
        outline=ol,
        width=w,
    )
    hair_cap(d, head_x, head_y, head_r, int(head_r * .42), hair, ol, w)
    eye_y = head_y + head_r * .12 + depth
    eye_r = max(1.2, head_r * .11)
    for eye_side in (-1, 1):
        eye_x = head_x + eye_side * head_r * .34 + side * 1.8
        d.ellipse(
            [eye_x - eye_r, eye_y - eye_r, eye_x + eye_r, eye_y + eye_r],
            fill=ch["eye"],
        )


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
    else:                                   # wait
        d.ellipse([px - 8, py - 8, px + 8, py + 8], outline=ink, width=1)
        d.line([(px, py), (px, py - 5)], fill=ink, width=1)
        d.line([(px, py), (px + 4, py + 2)], fill=ink, width=1)


def indicatorTalk(d): _bubble(d, "talk")
def indicatorEat(d): _bubble(d, "eat")
def indicatorSleep(d): _bubble(d, "sleep")
def indicatorWait(d): _bubble(d, "wait")
def indicatorReading(d): _bubble(d, "read")


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
}

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
]
