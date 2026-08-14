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


def facing_xy(x, y, facing="se"):
    """Rotate a point in the lot plane. Matches terri-data's placement matrix.

    SE is the atlas's unsuffixed sprite. SW, NW, NE are the builder turns.
    The matrices are the same ones `rotate_socket_terms` uses, so a handle
    drawn on the working face stays on that working face after a turn.
    """
    if facing == "se":
        return x, y
    if facing == "sw":
        return -y, x
    if facing == "nw":
        return -x, -y
    if facing == "ne":
        return y, -x
    raise ValueError(f"unknown furniture facing {facing!r}")


def facing_aabb(x0, y0, x1, y1, facing="se"):
    """Axis-aligned bounds of a box after a lot-plane rotation."""
    pts = [
        facing_xy(x0, y0, facing),
        facing_xy(x1, y0, facing),
        facing_xy(x0, y1, facing),
        facing_xy(x1, y1, facing),
    ]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def Pf(x, y, z=0.0, facing="se"):
    """`P`, after a furniture facing rotation."""
    rx, ry = facing_xy(x, y, facing)
    return P(rx, ry, z)


def box(d, x0, y0, x1, y1, z0, z1, colour, *, top=None, outline=True,
        facing="se", skip_top=False):
    """An axis-aligned box, as its three visible faces.

    Faces are painted left, right, top in that order so the top's outline
    lands over the two side seams rather than under them. `skip_top` is for
    a vessel whose lid is a rim around a hole, not a solid diamond.
    """
    x0, y0, x1, y1 = facing_aabb(x0, y0, x1, y1, facing)
    ol = OUTLINE if outline else None
    w = OUTLINE_WIDTH
    tc = top or colour
    d.polygon([P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)],
              fill=mul(colour, FACE_LEFT), outline=ol, width=w)
    d.polygon([P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0), P(x1, y0, z0)],
              fill=mul(colour, FACE_RIGHT), outline=ol, width=w)
    if skip_top:
        return
    d.polygon([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)],
              fill=mul(tc, FACE_TOP), outline=ol, width=w)


def slab(d, x0, y0, x1, y1, z, colour, thick=0.06, **kw):
    box(d, x0, y0, x1, y1, z - thick, z, colour, **kw)


def diamond(d, x0, y0, x1, y1, fill, outline=None, width=1, facing="se"):
    x0, y0, x1, y1 = facing_aabb(x0, y0, x1, y1, facing)
    d.polygon([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)],
              fill=fill, outline=outline, width=width)


def surface(d, x0, y0, x1, y1, z, fill, outline=None, width=1, facing="se"):
    """A diamond in the lot plane at height `z`.

    `diamond` is the ground plane. A basin, a hob, or a bowl opening that
    uses it ends up as a square sitting on the floor in front of the object.
    """
    x0, y0, x1, y1 = facing_aabb(x0, y0, x1, y1, facing)
    d.polygon(
        [P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)],
        fill=fill, outline=outline, width=width,
    )


def contact_shadow(d, x0, y0, x1, y1, facing="se"):
    """An opaque stain under furniture. The pipeline discards alpha below 0.5."""
    diamond(d, x0, y0, x1, y1, mul(PALETTE["ink"], 1.35), facing=facing)


def cyl(d, cx, cy, r, z0, z1, colour, *, outline=True, facing="se"):
    """An ellipse-topped column. Lamps, pots, bins, mugs.

    The base ellipse is CENTRED on the contact point, so half of it falls
    below - correct in isometric, and a problem for `emit`, which pins a
    sprite's bottom to the anchor row. Lifting the whole column by the
    ellipse's semi-minor axis makes it sit ON the ground point rather
    than straddle it, which is what bottom-centre anchoring wants.
    """
    cx, cy = facing_xy(cx, cy, facing)
    ol = OUTLINE if outline else None
    w = OUTLINE_WIDTH
    rx, ry = r * HW * 1.3, r * HH * 1.3
    px, py = OX + sx(cx, cy), OY + sy(cx, cy) - ry
    zt, zb = z1 * Z_UNIT, z0 * Z_UNIT
    # Bottom ellipse first, then an unoutlined body covering its upper arc,
    # then the top. Outlining both ellipses after the body draws a bowtie.
    d.ellipse([px - rx, py - zb - ry, px + rx, py - zb + ry],
              fill=mul(colour, FACE_RIGHT), outline=ol, width=w)
    d.polygon([(px - rx, py - zt), (px + rx, py - zt),
               (px + rx, py - zb), (px - rx, py - zb)],
              fill=mul(colour, FACE_RIGHT))
    if outline:
        d.line([(px - rx, py - zt), (px - rx, py - zb)], fill=ol, width=w)
        d.line([(px + rx, py - zt), (px + rx, py - zb)], fill=ol, width=w)
    d.ellipse([px - rx, py - zt - ry, px + rx, py - zt + ry],
              fill=mul(colour, FACE_TOP), outline=ol, width=w)


def plump(d, x0, y0, x1, y1, z0, z1, colour, facing="se"):
    """A cushion or pillow: box sides plus a soft ellipse top.

    A slab's top is a diamond, and at pillow size that diamond reads as a
    brick or a second mattress. The ellipse uses the same bounds so it still
    sits on the bed, but the corners round off.
    """
    x0, y0, x1, y1 = facing_aabb(x0, y0, x1, y1, facing)
    ol, w = OUTLINE, OUTLINE_WIDTH
    d.polygon([P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)],
              fill=mul(colour, FACE_LEFT), outline=ol, width=w)
    d.polygon([P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0), P(x1, y0, z0)],
              fill=mul(colour, FACE_RIGHT), outline=ol, width=w)
    pts = [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    d.ellipse([min(xs) + 2, min(ys) + 1, max(xs) - 2, max(ys) - 1],
              fill=mul(colour, FACE_TOP))


def legs(d, x0, y0, x1, y1, top_z, colour, inset=0.10, thick=0.11,
         facing="se"):
    """Four legs under a surface. Every table-shaped thing wants these."""
    for dx in (x0 + inset, x1 - inset - thick):
        for dy in (y0 + inset, y1 - inset - thick):
            box(d, dx, dy, dx + thick, dy + thick, 0, top_z, mul(colour, 0.86),
                facing=facing)


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
