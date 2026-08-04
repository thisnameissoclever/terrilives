#!/usr/bin/env python3
"""Round two. Same generator, five new directions, three changes from the notes.

1. Outlines go to 1 px and stop being black. A hairline in a warm dark
   reads as drawn; 2 px of pure black reads as a sticker.
2. Palettes come down. Nothing in here is at full saturation, and no wall
   is a hue - walls are near-neutrals that let the furniture carry colour.
3. Light becomes a real system rather than a palette. Night Shift only
   hinted at it: this has an ambient tint, a key direction, cast shadows
   on the floor, and practical lights that pool. That is what made the
   night read, so it is now available to every direction and at any hour.

Also: props are placed against walls and inside their own rooms now.
"""
import math, os
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import art
from art import (sx, sy, mul, mix, box, slab, cyl, Style, PX_PER_TILE_Z, HW, HH,
                 o_floor, o_wall, o_rug, o_bed, o_table, o_chair, o_sofa,
                 o_counter, o_fridge, o_bookcase, o_tv, o_toilet, o_bath,
                 o_shower, o_plant, o_lamp, sim, SKINS, HAIRS)

OUT = "/tmp/claude-0/-home-user-terrilives/1cad3393-2863-576b-9bf6-30e4a5e6b589/scratchpad/art2"
os.makedirs(OUT, exist_ok=True)

W, H = 9, 7


# --------------------------------------------------------------------------
# LIGHTING
# --------------------------------------------------------------------------
class Light:
    """A pool of light on the floor. Warm from lamps, cold from screens."""
    def __init__(self, x, y, r, colour, strength):
        self.x, self.y, self.r, self.colour, self.strength = x, y, r, colour, strength


def light_layer(size, ox, oy, lights, shafts, shaft_col):
    """Additive light, built once and screened over the floor."""
    lay = Image.new("RGB", size, (0, 0, 0))
    d = ImageDraw.Draw(lay)
    for s in shafts:                       # a window's worth of light on the floor
        x0, y0, x1, y1 = s
        d.polygon([(ox + sx(x0, y0), oy + sy(x0, y0)),
                   (ox + sx(x1, y0), oy + sy(x1, y0)),
                   (ox + sx(x1, y1), oy + sy(x1, y1)),
                   (ox + sx(x0, y1), oy + sy(x0, y1))], fill=shaft_col)
    lay = lay.filter(ImageFilter.GaussianBlur(9))
    for L in lights:
        px, py = ox + sx(L.x, L.y), oy + sy(L.x, L.y)
        rx, ry = L.r * HW, L.r * HH
        pool = Image.new("RGB", size, (0, 0, 0))
        ImageDraw.Draw(pool).ellipse([px - rx, py - ry, px + rx, py + ry],
                                     fill=mul(L.colour, L.strength))
        lay = ImageChops.add(lay, pool.filter(ImageFilter.GaussianBlur(rx * .34)))
    return lay


def cast_shadow(d, ox, oy, x0, y0, x1, y1, k, strength):
    """A blob on the floor, offset along the key direction."""
    dx, dy = k
    pts = [(ox + sx(x0 + dx, y0 + dy), oy + sy(x0 + dx, y0 + dy)),
           (ox + sx(x1 + dx, y0 + dy), oy + sy(x1 + dx, y0 + dy)),
           (ox + sx(x1 + dx, y1 + dy), oy + sy(x1 + dx, y1 + dy)),
           (ox + sx(x0 + dx, y1 + dy), oy + sy(x0 + dx, y1 + dy))]
    d.polygon(pts, fill=(0, 0, 0, int(150 * strength)))


# --------------------------------------------------------------------------
# THE FIVE
# --------------------------------------------------------------------------
def S(key, name, pal, **kw):
    s = Style(key, name, pal, **kw)
    return s


STYLES = [
S("muted", "Muted Line",
  dict(bg=(40, 38, 40), floor=(206, 190, 170), floor2=(199, 183, 163), grout=(178, 162, 143),
       wall=(232, 225, 214), wall_top=(242, 237, 228), skirt=(206, 197, 184),
       wood=(186, 138, 98), wood2=(196, 152, 112), fabric=(140, 164, 150),
       linen=(242, 238, 230), linen2=(224, 214, 200), cab=(150, 162, 172),
       counter=(238, 234, 226), metal=(176, 180, 184), dark=(62, 54, 52),
       porcelain=(244, 242, 236), water=(158, 190, 194), screen=(96, 110, 116),
       pot=(190, 122, 96), leaf=(126, 154, 108), shade=(238, 214, 168),
       accents=[(202, 118, 100), (109, 154, 148), (201, 163, 78), (107, 122, 140)]),
  outline=(62, 54, 52), outline_w=1, top=1.05, right=.90, left=.78, shadow=.20,
  char=dict(h=86, head=.215, shoulder=.33, hip=.26, leg=.34, square_head=True)),

S("golden", "Golden Hour",
  dict(bg=(58, 46, 42), floor=(206, 176, 140), floor2=(199, 169, 134), grout=(174, 145, 114),
       wall=(232, 216, 194), wall_top=(246, 233, 212), skirt=(206, 188, 164),
       wood=(168, 116, 74), wood2=(180, 128, 84), fabric=(150, 130, 112),
       linen=(244, 234, 216), linen2=(226, 210, 186), cab=(158, 140, 120),
       counter=(236, 226, 208), metal=(178, 170, 158), dark=(58, 44, 36),
       porcelain=(244, 238, 226), water=(160, 180, 176), screen=(92, 88, 82),
       pot=(176, 106, 74), leaf=(122, 140, 92), shade=(248, 222, 170),
       accents=[(198, 112, 78), (122, 138, 128), (206, 162, 82), (128, 108, 118)]),
  top=1.10, right=.90, left=.70, shadow=.34,
  char=dict(h=86, head=.20, shoulder=.32, hip=.26, leg=.36)),

S("overcast", "Overcast",
  dict(bg=(74, 78, 84), floor=(198, 198, 196), floor2=(192, 192, 190), grout=(174, 175, 174),
       wall=(226, 228, 228), wall_top=(238, 240, 240), skirt=(204, 206, 207),
       wood=(178, 156, 132), wood2=(188, 167, 143), fabric=(142, 156, 162),
       linen=(242, 243, 243), linen2=(222, 224, 226), cab=(166, 174, 178),
       counter=(234, 236, 236), metal=(180, 186, 190), dark=(64, 68, 72),
       porcelain=(246, 247, 247), water=(176, 198, 204), screen=(104, 112, 118),
       pot=(178, 140, 122), leaf=(132, 156, 134), shade=(236, 232, 220),
       accents=[(186, 130, 116), (124, 150, 156), (196, 178, 132), (120, 130, 146)]),
  top=1.04, right=.94, left=.87, shadow=.10,
  char=dict(h=84, head=.21, shoulder=.32, hip=.26, leg=.35)),

S("inkwash", "Ink and Wash",
  dict(bg=(228, 222, 208), floor=(224, 212, 190), floor2=(218, 205, 183), grout=(196, 182, 160),
       wall=(238, 232, 219), wall_top=(246, 242, 232), skirt=(220, 212, 197),
       wood=(196, 154, 108), wood2=(204, 165, 122), fabric=(146, 168, 170),
       linen=(248, 245, 238), linen2=(232, 224, 210), cab=(160, 170, 178),
       counter=(244, 240, 231), metal=(182, 186, 190), dark=(58, 62, 78),
       porcelain=(248, 246, 240), water=(166, 194, 200), screen=(104, 112, 128),
       pot=(190, 130, 100), leaf=(138, 162, 118), shade=(242, 224, 182),
       accents=[(198, 126, 108), (118, 152, 156), (204, 172, 104), (114, 124, 152)]),
  outline=(58, 62, 78), outline_w=1, top=1.04, right=.94, left=.86, shadow=.12, grain=.4,
  char=dict(h=84, head=.215, shoulder=.32, hip=.26, leg=.35)),

S("sodium", "Sodium",
  dict(bg=(14, 16, 26), floor=(56, 54, 62), floor2=(52, 50, 58), grout=(40, 39, 47),
       wall=(48, 48, 60), wall_top=(66, 66, 80), skirt=(38, 38, 48),
       wood=(104, 74, 54), wood2=(112, 82, 60), fabric=(74, 70, 92),
       linen=(158, 156, 168), linen2=(126, 124, 138), cab=(58, 60, 74),
       counter=(80, 82, 96), metal=(102, 106, 122), dark=(10, 11, 18),
       porcelain=(138, 142, 158), water=(72, 106, 128), screen=(132, 198, 224),
       pot=(94, 68, 52), leaf=(66, 98, 78), shade=(255, 186, 104),
       accents=[(226, 132, 78), (104, 158, 208), (200, 92, 96), (238, 190, 116)]),
  top=1.24, right=.80, left=.52, shadow=.55, edge_light=(150, 128, 120),
  char=dict(h=86, head=.19, shoulder=.31, hip=.25, leg=.38)),
]

# Per-direction light rig: (lights, window shafts, shaft colour, ambient tint)
RIG = {
  "muted":    ([Light(1.1, 4.6, 3.4, (255, 226, 172), .16)],
               [(5.0, 0.2, 8.6, 1.4)], (26, 24, 16), None),
  "golden":   ([Light(1.1, 4.6, 3.2, (255, 218, 150), .18)],
               [(5.0, 0.1, 8.7, 2.1), (0.2, 4.4, 3.4, 6.6)], (72, 48, 18), (255, 236, 208)),
  "overcast": ([], [(5.0, 0.2, 8.6, 1.6)], (16, 18, 22), (228, 234, 240)),
  "inkwash":  ([Light(1.1, 4.6, 3.0, (255, 232, 186), .12)],
               [(5.0, 0.2, 8.6, 1.5)], (22, 20, 14), None),
  "sodium":   ([Light(1.1, 4.6, 3.6, (255, 176, 88), .40),
                Light(3.8, 5.9, 2.4, (120, 190, 230), .26),
                Light(6.9, 1.1, 2.6, (255, 168, 74), .22)],
               [(5.0, 0.1, 8.7, 1.5)], (96, 58, 12), (188, 190, 220)),
}

KEY = {"muted": (.16, .16), "golden": (.42, .34), "overcast": (.10, .10),
       "inkwash": (.12, .12), "sodium": (.30, .26)}

PEOPLE = [(2.55, 1.15, 0), (6.75, 2.45, 1), (2.35, 4.75, 2)]


def scene(st):
    pad_x, pad_y = 40, 150
    size = ((W + H) * HW + pad_x * 2, (W + H) * HH + pad_y + 120)
    img = Image.new("RGB", size, st.bg)
    d = ImageDraw.Draw(img, "RGBA")
    ox, oy = pad_x + H * HW, pad_y

    for y in range(H):
        for x in range(W):
            o_floor(d, st, ox, oy, x, y)
    o_rug(d, st, ox, oy, 0.7, 4.4, 2.5, 2.0)

    lights, shafts, shaft_col, ambient = RIG[st.key]
    lay = light_layer(size, ox, oy, lights, shafts, shaft_col)
    # Clip light to the slab. A blurred pool near an edge otherwise spills
    # into the void and the lot glows into empty space.
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).polygon(
        [(ox + sx(0, 0), oy + sy(0, 0)), (ox + sx(W, 0), oy + sy(W, 0)),
         (ox + sx(W, H), oy + sy(W, H)), (ox + sx(0, H), oy + sy(0, H))], fill=255)
    lay = Image.composite(lay, Image.new("RGB", size, (0, 0, 0)), mask)
    img = ImageChops.add(img, lay)
    d = ImageDraw.Draw(img, "RGBA")

    items = []
    def add(x, y, fn, *a): items.append((x + y, len(items), x, y, fn, a))

    add(0, -0.14, o_wall, "ew", W)
    add(-0.14, 0, o_wall, "ns", H)
    add(4.5, -0.14, o_wall, "ns", 2.4)          # kitchen | bedroom
    add(4.5, 3.5, o_wall, "ns", 3.6)            # living  | bathroom
    add(4.64, 3.5, o_wall, "ew", 2.4)           # bedroom | bathroom
    add(8.1, 3.5, o_wall, "ew", 0.9)

    # Kitchen and dining, north-west. Counters on the wall, table clear of it.
    add(0, 0, o_counter, "plain"); add(1, 0, o_counter, "sink"); add(2, 0, o_counter, "hob")
    add(3, 0, o_fridge)
    add(1.3, 1.9, o_table); add(1.3, 3.0, o_chair); add(0.3, 1.9, o_chair)
    # Living, south-west. Sofa faces the television across the rug.
    add(0.15, 4.55, o_sofa); add(3.15, 5.3, o_tv); add(0.15, 3.1, o_lamp)
    # Bedroom, north-east. Bed against the party wall, shelves on the far wall.
    add(5.9, 0.15, o_bed); add(8.05, 0.3, o_bookcase); add(8.05, 2.5, o_plant)
    # Bathroom, south-east.
    add(5.05, 5.75, o_bath); add(7.7, 4.5, o_toilet); add(8.05, 5.75, o_shower)

    for i, (x, y, n) in enumerate(PEOPLE):
        items.append((x + y + .4, 900 + i, x, y, "sim", (n,)))

    k = KEY[st.key]
    glows = []
    for _, _, x, y, fn, a in sorted(items, key=lambda t: (t[0], t[1])):
        if fn == "sim":
            if st.shadow:
                cast_shadow(d, ox, oy, x - .22, y - .22, x + .22, y + .22, k, st.shadow)
            i = a[0]
            sim(d, st, ox, oy, x, y, SKINS[i], HAIRS[i], st.pal["accents"][i],
                mul(st.c("dark"), 2.2))
        else:
            if st.shadow and fn not in (o_wall, o_rug):
                cast_shadow(d, ox, oy, x, y, x + (2 if fn in (o_sofa, o_bath) else 1),
                            y + (2 if fn is o_bed else 1), k, st.shadow * .8)
            r = fn(d, st, ox, oy, x, y, *a)
            if isinstance(r, tuple) and r[0] == "glow":
                glows.append(r[1:])

    for g, pos in glows:
        img.paste(Image.alpha_composite(
            img.crop((pos[0], pos[1], pos[0] + g.width, pos[1] + g.height)).convert("RGBA"), g
        ).convert("RGB"), pos)

    if ambient:                       # the hour of day, as one multiply
        img = ImageChops.multiply(img, Image.new("RGB", size, ambient))
    if st.grain:
        import random
        random.seed(5)
        g = Image.new("L", size)
        gp = g.load()
        for yy in range(size[1]):
            for xx in range(size[0]):
                gp[xx, yy] = 238 + random.randint(0, 17)
        img = ImageChops.multiply(img, Image.merge("RGB", (g, g, g)))
    return img


if __name__ == "__main__":
    for st in STYLES:
        im = scene(st)
        p = f"{OUT}/{st.key}.png"
        im.save(p, optimize=True)
        print(f"{st.key:10s} {st.name:16s} {im.size}  {os.path.getsize(p)//1024} KB")
