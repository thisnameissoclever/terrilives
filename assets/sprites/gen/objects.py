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
    diamond(d, A, A, B, B, None, outline=C["select"], width=2)
    diamond(d, A + .09, A + .09, B - .09, B - .09, None, outline=C["select"], width=1)


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
    """The same chair, reclined and with a footrest - Doug's chair."""
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


# ---------------------------------------------------------- characters ----
def _figure(d, palette):
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
    for s in (-1, 1):
        ax = px + s * (sh / 2 - aw * .3)
        d.rectangle([ax - aw / 2, top_y + torso * .12, ax + aw / 2, ty + leg * .10],
                    fill=mul(shirt, .93), outline=ol, width=w)
    hy = top_y - head_r
    d.rounded_rectangle([px - head_r, hy - head_r, px + head_r, hy + head_r],
                        radius=int(head_r * .42), fill=skin, outline=ol, width=w)
    d.chord([px - head_r, hy - head_r, px + head_r, hy + head_r * .35],
            180, 360, fill=hair, outline=ol, width=w)
    ey, r = hy + head_r * .12, max(1.2, head_r * .11)
    for s in (-1, 1):
        cx = px + s * head_r * .34
        d.ellipse([cx - r, ey - r, cx + r, ey + r], fill=ch["eye"])


def sim(d): _figure(d, CHARACTER_PALETTES[0])
def sim2(d): _figure(d, CHARACTER_PALETTES[1])
def sim3(d): _figure(d, CHARACTER_PALETTES[2])


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
]
