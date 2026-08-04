"""Muted Line: the whole art direction, as data.

This file IS the style bible. [T13] asked for one as a folder of reference
images to condition a generative model on; a generator does not need to be
conditioned, it needs constants, so the bible is executable and there is
exactly one of it. [K1]'s "define ~32 colours and snap everything to them"
is enforced by construction here: the drawing code cannot reach a colour
that is not in PALETTE, because there is nowhere else to get one.

Chosen 2026-08-03. See docs/specs/2026-08-03-muted-line-implementation.md.
"""

# --------------------------------------------------------------------------
# Geometry, shared with the renderer
# --------------------------------------------------------------------------
# These MUST equal TILE_HALF_WIDTH and TILE_HALF_HEIGHT in
# web/src/render/iso.ts. They are not a round 2:1, and the reason is
# recorded there and in build-atlas.ps1: the ground plane was measured off
# the art rather than chosen, and a sprite drawn at a different slope than
# the grid it stands on is what made wall runs look jagged. test_contract.py
# reads iso.ts and fails if these drift.
TILE_HALF_WIDTH = 32
TILE_HALF_HEIGHT = 21

# How tall one "tile unit" of height draws. A free parameter - nothing in
# the renderer reads it - so it is a pure proportion choice. At 38 a wall
# is 1.75 units and stands 66 px, which reads as a room without hiding the
# furniture behind it.
Z_UNIT = 38

# --------------------------------------------------------------------------
# The palette
# --------------------------------------------------------------------------
# Two rules, and they are what make this direction Muted Line rather than
# round one's Bold Flat:
#
#   1. Nothing is at full saturation.
#   2. No WALL is a hue. Walls and floors are near-neutrals so that the
#      furniture carries all of the colour. Round one made the walls
#      mustard and the result fought everything standing in front of it.
PALETTE = {
    # Ground and shell
    "void":        (40, 38, 40),
    "floor":       (206, 190, 170),
    "floor_alt":   (199, 183, 163),
    "grout":       (178, 162, 143),
    "wall":        (232, 225, 214),
    "wall_top":    (242, 237, 228),
    "skirt":       (206, 197, 184),

    # Materials
    "wood":        (186, 138, 98),
    "wood_light":  (196, 152, 112),
    "wood_dark":   (150, 110, 78),
    "fabric":      (140, 164, 150),
    "linen":       (242, 238, 230),
    "linen_alt":   (224, 214, 200),
    "cabinet":     (150, 162, 172),
    "counter":     (238, 234, 226),
    "metal":       (176, 180, 184),
    "porcelain":   (244, 242, 236),
    "water":       (158, 190, 194),
    "screen":      (96, 110, 116),
    "pot":         (190, 122, 96),
    "leaf":        (126, 154, 108),
    "shade":       (238, 214, 168),
    "card":        (198, 176, 146),

    # Ink. Never pure black: a hairline in a warm dark reads as drawn,
    # 2 px of #000 reads as a sticker sitting on top of the render.
    "ink":         (62, 54, 52),

    # Accents. The only saturated entries, and they belong to furniture,
    # clothing and state - never to a surface.
    "accent_clay": (202, 118, 100),
    "accent_sage": (109, 154, 148),
    "accent_brass":(201, 163, 78),
    "accent_slate":(107, 122, 140),

    # Signal colours, for UI-adjacent sprites only.
    "select":      (109, 154, 148),
    "warn":        (202, 118, 100),
}

ACCENTS = [PALETTE[k] for k in
           ("accent_clay", "accent_sage", "accent_brass", "accent_slate")]

# --------------------------------------------------------------------------
# Line and shading
# --------------------------------------------------------------------------
OUTLINE = PALETTE["ink"]
OUTLINE_WIDTH = 1

# Face brightness multipliers. Top catches the key, the +x face takes
# most of it, the +y face least. Kept shallow on purpose: a steep ramp
# reads as plastic at this size.
FACE_TOP = 1.05
FACE_RIGHT = 0.90
FACE_LEFT = 0.78

CONTACT_SHADOW = 0.20

# --------------------------------------------------------------------------
# The character build
# --------------------------------------------------------------------------
# Proportions, as fractions of total height. Shared by every sim; only
# the colours below vary.
CHARACTER = {
    "height":   86,
    "head":     0.215,   # head radius as a fraction of height
    "shoulder": 0.33,
    "hip":      0.26,
    "leg":      0.34,
    "square_head": True,
    "eye": PALETTE["ink"],
}


# One entry per sim who can appear on screen, and the whole of [ML-chars]
# as it actually shipped.
#
# **The spec proposed three tinted instances per sim - body, head, hair -
# so that skin, hair and clothing could vary continuously from three atlas
# entries. This is not that, and the reason is worth writing down.** Three
# instances per sim means every slot arithmetic in `frame.ts` shifts, the
# bubbles and the carried badges move behind two new depth nudges, and
# eight tests that name a slot by its index get rewritten - all to give a
# household of THREE people the variety a character creator would need.
# Baking the combinations is absurd for a creator and obviously right for
# a cast, and the cast is what exists.
#
# What changes that: a player picking a sim's appearance, or a cast big
# enough that the atlas grows faster than the shell would. Neither is
# close. The per-instance tint attribute the spec asked for landed anyway
# and is carrying the emissive channel, so the day the trade flips, the
# hard half is already done.
#
# Skin tones span warm-light to warm-deep; nothing here is a hue the
# palette above does not already contain, and no two entries share a
# silhouette cue, so the three read apart at one tile even in the dark.
CHARACTER_PALETTES = [
    {
        "skin":    (232, 196, 164),
        "hair":    (74, 58, 50),
        "shirt":   PALETTE["accent_sage"],
        "trouser": PALETTE["accent_slate"],
    },
    {
        "skin":    (186, 138, 104),
        "hair":    (38, 32, 34),
        "shirt":   PALETTE["accent_clay"],
        "trouser": PALETTE["ink"],
    },
    {
        "skin":    (244, 214, 190),
        "hair":    (176, 118, 64),
        "shirt":   PALETTE["accent_brass"],
        "trouser": PALETTE["accent_slate"],
    },
]


def mul(colour, factor):
    """Scale a colour, clamped. The only way this file's palette varies."""
    return tuple(max(0, min(255, int(c * factor))) for c in colour[:3])


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
