"""Isometric primitives, and the anchoring rule that makes a sprite a sprite.

THE ANCHORING RULE, because it is the part that silently ruins everything
if it is wrong and looks fine in a preview either way.

`sprites.wgsl` draws every quad bottom-centre anchored at the entity's
screen position plus `anchor`, which is half a tile down. So a tile's
screen position is the CENTRE of its diamond, and a sprite's bottom edge
sits on that diamond's SOUTH corner.

Everything here therefore draws in local tile-corner coordinates with the
origin at the anchor tile's centre, which puts the anchor point at local
corner (0.5, 0.5). Multi-tile objects grow toward NEGATIVE x and y - up
and back on screen - because that is the direction an isometric sprite can
grow without moving its own footprint out from under it.

`emit` then crops to the drawn pixels, pads the crop so it is symmetric
about the anchor's x, and pins its bottom to the anchor's y. Get that
wrong and every object floats or sinks by a few pixels, uniformly, which
reads as "the art is bad" rather than as an off-by-one.
"""
from PIL import Image, ImageDraw

from style import (TILE_HALF_WIDTH as HW, TILE_HALF_HEIGHT as HH, Z_UNIT,
                   OUTLINE, OUTLINE_WIDTH, FACE_TOP, FACE_RIGHT, FACE_LEFT,
                   PALETTE, mul)

# A canvas large enough for the biggest sprite (the double bed, 117x103 in
# the outgoing atlas) with room to spare, and the origin well inside it.
PAD = 200
OX, OY = PAD, PAD


def sx(x, y):
    return (x - y) * HW


def sy(x, y):
    return (x + y) * HH


def canvas():
    img = Image.new("RGBA", (PAD * 2, PAD * 2), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img, "RGBA")


def P(x, y, z=0.0):
    """Local tile-corner coordinates to canvas pixels."""
    return (OX + sx(x, y), OY + sy(x, y) - z * Z_UNIT)


def box(d, x0, y0, x1, y1, z0, z1, colour, *, top=None, outline=True):
    """An axis-aligned box, as its three visible faces.

    Faces are painted left, right, top in that order so the top's outline
    lands over the two side seams rather than under them.
    """
    ol = OUTLINE if outline else None
    w = OUTLINE_WIDTH
    tc = top or colour
    d.polygon([P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)],
              fill=mul(colour, FACE_LEFT), outline=ol, width=w)
    d.polygon([P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0), P(x1, y0, z0)],
              fill=mul(colour, FACE_RIGHT), outline=ol, width=w)
    d.polygon([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)],
              fill=mul(tc, FACE_TOP), outline=ol, width=w)


def slab(d, x0, y0, x1, y1, z, colour, thick=0.06, **kw):
    box(d, x0, y0, x1, y1, z - thick, z, colour, **kw)


def cyl(d, cx, cy, r, z0, z1, colour, *, outline=True):
    """An ellipse-topped column. Lamps, pots, bins, mugs.

    The base ellipse is CENTRED on the contact point, so half of it falls
    below - correct in isometric, and a problem for `emit`, which pins a
    sprite's bottom to the anchor row. Lifting the whole column by the
    ellipse's semi-minor axis makes it sit ON the ground point rather
    than straddle it, which is what bottom-centre anchoring wants.
    """
    ol = OUTLINE if outline else None
    w = OUTLINE_WIDTH
    rx, ry = r * HW * 1.3, r * HH * 1.3
    px, py = OX + sx(cx, cy), OY + sy(cx, cy) - ry
    zt, zb = z1 * Z_UNIT, z0 * Z_UNIT
    d.polygon([(px - rx, py - zt), (px + rx, py - zt),
               (px + rx, py - zb), (px - rx, py - zb)],
              fill=mul(colour, FACE_RIGHT), outline=ol, width=w)
    d.ellipse([px - rx, py - zb - ry, px + rx, py - zb + ry],
              fill=mul(colour, FACE_RIGHT), outline=ol, width=w)
    d.ellipse([px - rx, py - zt - ry, px + rx, py - zt + ry],
              fill=mul(colour, FACE_TOP), outline=ol, width=w)


def diamond(d, x0, y0, x1, y1, fill, outline=None, width=1):
    d.polygon([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)],
              fill=fill, outline=outline, width=width)


def legs(d, x0, y0, x1, y1, top_z, colour, inset=0.10, thick=0.08):
    """Four legs under a surface. Every table-shaped thing wants these."""
    for dx in (x0 + inset, x1 - inset - thick):
        for dy in (y0 + inset, y1 - inset - thick):
            box(d, dx, dy, dx + thick, dy + thick, 0, top_z, mul(colour, 0.86))


def emit(img, exact_w=None, exact_h=None):
    """Crop to the art, symmetric about the anchor's x, bottom on its y.

    Returns (cropped, width, height). A sprite whose art reaches below the
    anchor row would be standing in the floor, so that is an error rather
    than something to accommodate quietly.

    `exact_w` / `exact_h` pin a dimension. Three sprites need it because
    their size IS the projection rather than a consequence of it, and
    `iso.test.ts` asserts both: the floor is exactly one tile, and a wall
    panel is exactly one tile edge wide. A stray outline pixel would take
    the floor to 66 and tile the whole ground plane with seams.
    """
    bbox = img.getbbox()
    if bbox is None:
        raise ValueError("nothing drawn")
    left, top, right, bottom = bbox
    # `getbbox` returns an EXCLUSIVE bottom and right, so the last drawn
    # row is `bottom - 1`. The anchor row is OY + HH and art is allowed to
    # occupy it, which makes the exclusive limit OY + HH + 1.
    anchor_x, limit = OX, OY + HH + 1
    if bottom > limit:
        raise ValueError(
            f"art reaches {bottom - limit}px below the anchor row; the "
            f"object would stand in the floor rather than on it")
    half = (exact_w // 2) if exact_w else max(anchor_x - left, right - anchor_x)
    top = (limit - exact_h) if exact_h else top
    crop = img.crop((anchor_x - half, top, anchor_x - half + (exact_w or half * 2),
                     limit))
    return crop, crop.width, crop.height
