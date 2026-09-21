"""Muted Line art for the east-edge, left-hinged career portal.

The four drawers share one bottom-centre envelope. The frame is permanent;
the three leaf sprites rotate inward around ``HINGE`` without moving it.
"""
from math import hypot

from iso import P, box
from style import OUTLINE, OUTLINE_WIDTH, PALETTE as C, mix, mul


ENVELOPE = (112, 109)
HINGE = (0.43, -0.38)
LEAF_BOTTOM = 0.06
LEAF_TOP = 1.82

_FRAME_TOP = 2.0
_FRAME_X0 = 0.37
_FRAME_X1 = 0.51
_JAMB = 0.12
LEAF_EDGES = {
    "closed": (0.43, 0.38),
    "ajar": (0.03, 0.27),
    "open": (-0.33, -0.38),
}


def frontDoorFrameSELeft(d):
    """Draw the wall-height casing, planted hinge and stone threshold."""
    frame = mul(C["wall"], 0.89)
    frame_top = C["wall_top"]
    box(d, _FRAME_X0, -0.50, _FRAME_X1, -0.50 + _JAMB,
        0, _FRAME_TOP, frame, top=frame_top)
    box(d, _FRAME_X0, 0.50 - _JAMB, _FRAME_X1, 0.50,
        0, _FRAME_TOP, frame, top=frame_top)
    box(d, _FRAME_X0, -0.50, _FRAME_X1, 0.50,
        LEAF_TOP, _FRAME_TOP, frame, top=frame_top)

    # A broad threshold belongs to the fixed frame, so every leaf state meets
    # the same floor contact and never appears to hop during the swing.
    box(d, 0.30, -0.50, 0.53, 0.50, 0, 0.065,
        mul(C["skirt"], 0.82), top=mix(C["wall_top"], C["metal"], 0.24))

    # Three small plates communicate the authored hinge side at ordinary zoom.
    for z in (0.35, 0.91, 1.47):
        top = P(_FRAME_X0 - 0.012, -0.375, z + 0.075)
        bottom = P(_FRAME_X0 - 0.012, -0.375, z - 0.075)
        d.line([top, bottom], fill=mul(C["metal"], 0.74), width=2)
        d.line([top, bottom], fill=C["metal"], width=1)


def _leaf_point(far, along, z):
    hx, hy = HINGE
    fx, fy = far
    return P(hx + (fx - hx) * along, hy + (fy - hy) * along, z)


def _panel(d, far, along0, along1, z0, z1, fill):
    d.polygon(
        [
            _leaf_point(far, along0, z1),
            _leaf_point(far, along1, z1),
            _leaf_point(far, along1, z0),
            _leaf_point(far, along0, z0),
        ],
        fill=fill,
        outline=mul(C["wood_dark"], 0.74),
        width=1,
    )


def _front_door_leaf(d, state):
    """Draw one leaf around the fixed north jamb hinge."""
    far = LEAF_EDGES[state]
    hx, hy = HINGE
    fx, fy = far
    dx, dy = fx - hx, fy - hy
    length = hypot(dx, dy)
    nx, ny = -dy / length * 0.045, dx / length * 0.045

    # The thin return edge comes first. It gives the ajar and open leaves real
    # thickness while leaving the authored hinge coordinates untouched.
    d.polygon(
        [
            P(fx, fy, LEAF_TOP),
            P(fx + nx, fy + ny, LEAF_TOP),
            P(fx + nx, fy + ny, LEAF_BOTTOM),
            P(fx, fy, LEAF_BOTTOM),
        ],
        fill=mul(C["wood_dark"], 0.68),
        outline=OUTLINE,
        width=OUTLINE_WIDTH,
    )

    d.polygon(
        [
            P(hx, hy, LEAF_TOP),
            P(fx, fy, LEAF_TOP),
            P(fx, fy, LEAF_BOTTOM),
            P(hx, hy, LEAF_BOTTOM),
        ],
        fill=C["wood_dark"],
        outline=OUTLINE,
        width=OUTLINE_WIDTH,
    )

    # Two recessed panels make the leaf read as a front door instead of a
    # rotating brown board. Their world-space interpolation naturally keeps
    # the ajar state foreshortened.
    panel_fill = mix(C["wood_dark"], C["wood_light"], 0.34)
    _panel(d, far, 0.12, 0.88, 0.17, 0.76, panel_fill)
    _panel(d, far, 0.12, 0.88, 0.91, 1.67, panel_fill)

    handle = _leaf_point(far, 0.79, 0.88)
    d.ellipse(
        [handle[0] - 2, handle[1] - 2, handle[0] + 2, handle[1] + 2],
        fill=C["accent_brass"],
        outline=OUTLINE,
        width=1,
    )


def frontDoorClosedSELeft(d):
    _front_door_leaf(d, "closed")


def frontDoorAjarSELeft(d):
    _front_door_leaf(d, "ajar")


def frontDoorOpenSELeft(d):
    _front_door_leaf(d, "open")


SPRITES = (
    frontDoorFrameSELeft,
    frontDoorClosedSELeft,
    frontDoorAjarSELeft,
    frontDoorOpenSELeft,
)

EXACT = {sprite.__name__: ENVELOPE for sprite in SPRITES}
