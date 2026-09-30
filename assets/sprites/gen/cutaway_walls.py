"""Short wall faces on the same zero-thickness planes as the full shell."""
from iso import P
from style import PALETTE, OUTLINE, mul

HEIGHT = 2 / 3


def face(d, axis, start, end):
    point = (lambda t, z: P(0, t, z)) if axis == "ns" else (lambda t, z: P(t, 0, z))
    d.polygon([point(start, HEIGHT), point(end, HEIGHT), point(end, 0), point(start, 0)],
              fill=mul(PALETTE["wall"], .94))
    d.polygon([point(start, .14), point(end, .14), point(end, 0), point(start, 0)],
              fill=mul(PALETTE["skirt"], .94))
    for z, colour in ((0, OUTLINE), (.14, OUTLINE),
                      (HEIGHT - .06, PALETTE["wall_top"]), (HEIGHT, OUTLINE)):
        d.line([point(start, z), point(end, z)], fill=colour, width=1)


def joined(mask):
    def draw(d):
        for bit, axis, start, end in ((1, "ns", -.5, 0), (8, "ew", -.5, 0),
                                     (2, "ew", 0, .5), (4, "ns", 0, .5)):
            if mask & bit:
                face(d, axis, start, end)
    draw.__name__ = f"wallLow{mask}"
    return draw


def doorwayLowNS(d):
    face(d, "ns", -.5, -.38)
    face(d, "ns", .38, .5)


def doorwayLowEW(d):
    face(d, "ew", -.5, -.38)
    face(d, "ew", .38, .5)


SPRITES = tuple(joined(mask) for mask in range(1, 16)) + (doorwayLowNS, doorwayLowEW)
# Half-open horizontal ownership prevents adjacent translucent panels blending twice.
EXACT = {draw.__name__: (32, None) for draw in SPRITES}
