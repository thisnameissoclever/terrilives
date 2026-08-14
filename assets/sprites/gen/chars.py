"""Clear Line people: one billboard figure, every pose.

Hard rules, because the last version broke them:
- A hand is drawn on its sleeve. Never at a second x.
- Both shoes share one ground y. A walk is a stride, not one foot on a shelf.
- From the back, a held book is in FRONT of the body. Do not paint it, or
  the hands that hold it, on the spine.
"""
from style import (PALETTE as C, OUTLINE, OUTLINE_WIDTH, FACE_LEFT,
                   FACE_RIGHT, CHARACTER, mul)
from iso import P

HEAD_R = 6
TORSO_HALF = 8
ARM_HALF = 2.5
LEG_HALF = 3.6
ARM_OUT = 10


def _facing(facing):
    if facing == "se":
        return 1, False
    if facing == "sw":
        return -1, False
    if facing == "nw":
        return -1, True
    if facing == "ne":
        return 1, True
    raise ValueError(f"unknown person facing {facing!r}")


def _oval(d, x0, y0, x1, y1, **kw):
    d.ellipse([min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)], **kw)


def _column(d, x, y0, y1, half, fill):
    top, bot = min(y0, y1), max(y0, y1)
    if bot - top < 3:
        bot = top + 3
    d.rounded_rectangle(
        [x - half, top, x + half, bot],
        radius=min(half, 2),
        fill=fill, outline=OUTLINE, width=OUTLINE_WIDTH,
    )


def _hand(d, x, y, skin):
    _oval(d, x - 2, y - 2, x + 2, y + 2,
          fill=skin, outline=OUTLINE, width=OUTLINE_WIDTH)


def _shoe(d, x, py, back, colour):
    """Both feet end on the anchor row. Compact heels, not long pills."""
    if back:
        _oval(d, x - 2, py - 3, x + 2, py,
              fill=colour, outline=OUTLINE, width=OUTLINE_WIDTH)
    else:
        _oval(d, x - 2, py - 3, x + 3, py,
              fill=colour, outline=OUTLINE, width=OUTLINE_WIDTH)


def _head(d, cx, cy, palette, fx, back):
    skin, hair = palette["skin"], palette["hair"]
    ink = CHARACTER["eye"]
    ol, w = OUTLINE, OUTLINE_WIDTH
    r = HEAD_R
    if back:
        _oval(d, cx - r, cy - r - 2, cx + r, cy + r,
              fill=hair, outline=ol, width=w)
        return
    _oval(d, cx - r, cy - r, cx + r, cy + r,
          fill=skin, outline=ol, width=w)
    d.pieslice([cx - r, cy - r, cx + r, cy + r],
               start=200, end=340, fill=hair, outline=hair)
    eye_y = cy + 1
    d.rectangle([cx - 2 + fx, eye_y, cx - 1 + fx, eye_y + 2], fill=ink)
    d.rectangle([cx + 1 + fx, eye_y, cx + 2 + fx, eye_y + 2], fill=ink)


def _torso(d, cx, top_y, hip_y, fx, shirt, back):
    d.rounded_rectangle(
        [cx - TORSO_HALF, top_y, cx + TORSO_HALF, hip_y],
        radius=3, fill=shirt, outline=OUTLINE, width=OUTLINE_WIDTH,
    )
    if back:
        return
    if fx >= 0:
        d.rectangle([cx + 5, top_y + 5, cx + TORSO_HALF, hip_y - 2],
                    fill=mul(shirt, FACE_RIGHT))
    else:
        d.rectangle([cx - TORSO_HALF, top_y + 5, cx - 5, hip_y - 2],
                    fill=mul(shirt, FACE_LEFT))


def _collar(d, cx, top_y, shirt):
    d.rectangle([cx - 5, top_y, cx + 5, top_y + 4], fill=shirt)


def _shadow(d, px, py):
    _oval(d, px - 7, py - 3, px + 7, py, fill=mul(C["ink"], 1.6))


def _book(d, cx, cy, frame):
    page, cover, ol = C["linen"], C["wood_dark"], OUTLINE
    lift = 2 if frame else 0
    d.polygon(
        [(cx, cy + 5), (cx - 6, cy + 3), (cx - 5, cy - 3), (cx, cy - 1)],
        fill=page, outline=ol,
    )
    d.polygon(
        [(cx, cy + 5), (cx + 6, cy + 3), (cx + 5, cy - 3 - lift), (cx, cy - 1)],
        fill=mul(page, .96), outline=ol,
    )
    d.line([(cx - 6, cy + 4), (cx, cy + 6), (cx + 6, cy + 4)],
           fill=cover, width=2)


def person(d, palette, facing="se", pose="idle", frame=0):
    fx, back = _facing(facing)
    px, py = P(.5, .5)
    shirt, trouser = palette["shirt"], palette["trouser"]
    skin = palette["skin"]
    shoe = mul(trouser, 0.55)
    sleeve = shirt
    far, near = -fx, fx
    phase = 1 if frame else -1

    hem = py - 4
    hip_y = py - 24
    top_y = py - 50
    lean = 0

    if pose == "walk":
        lean = fx
    elif pose == "read":
        hip_y = py - 20
        top_y = py - 44
        lean = fx
    elif pose == "exercise":
        lean = fx * 2
        drop = 4 if frame else 0
        hip_y = py - 22 + drop
        top_y = py - 46 + drop

    cx = px + lean
    head_y = top_y - 5
    hang_y = hip_y + 1

    _shadow(d, px, py)

    def arm(side, hand_y, x_off=0, show_hand=True):
        x = cx + side * ARM_OUT + x_off
        _column(d, x, top_y + 5, hand_y, ARM_HALF, sleeve)
        if show_hand:
            _hand(d, x, hand_y, skin)
        return x

    def leg(side, x_off=0):
        x = px + side * 5 + lean + x_off
        _column(d, x, hip_y - 1, hem, LEG_HALF, trouser)
        _shoe(d, x, py, back, shoe)

    def body():
        _torso(d, cx, top_y, hip_y, fx, shirt, back)
        _collar(d, cx, top_y, shirt)
        _head(d, cx + fx, head_y, palette, fx, back)
        _collar(d, cx, top_y, shirt)

    if pose == "idle":
        arm(far, hang_y)
        leg(far)
        body()
        leg(near)
        arm(near, hang_y)
    elif pose == "walk":
        fwd = phase
        arm(far, hang_y + (4 if frame else 0), x_off=-fwd)
        leg(far, x_off=-fwd * far * 4)
        body()
        leg(near, x_off=fwd * near * 4)
        arm(near, hang_y + (0 if frame else 4), x_off=fwd * near * 2)
    elif pose == "talk":
        arm(far, hang_y)
        leg(far)
        body()
        leg(near)
        if frame == 0:
            arm(near, top_y + 16)
        else:
            arm(near, top_y - 1)
    elif pose == "eat":
        arm(far, hang_y)
        leg(far)
        body()
        leg(near)
        if frame == 0:
            hx = arm(near, top_y + 16)
            food_y = top_y + 16
        else:
            hx = arm(near, top_y + 2)
            food_y = top_y + 2
        if not back:
            _oval(d, hx - 2, food_y - 3, hx + 3, food_y + 1,
                  fill=C["accent_clay"], outline=OUTLINE, width=1)
    elif pose in ("read", "standread"):
        book_y = (py - 30) if pose == "read" else (py - 36)
        if back:
            arm(far, hang_y)
            leg(far)
            body()
            leg(near)
            arm(near, hang_y - (2 if frame else 0))
        else:
            arm(far, book_y)
            leg(far)
            body()
            leg(near)
            _book(d, cx + fx, book_y, frame)
            arm(near, book_y - (2 if frame else 0))
    elif pose == "exercise":
        arm(far, top_y - 1)
        leg(far, x_off=-fx * 3)
        body()
        leg(near, x_off=fx * 3)
        arm(near, top_y - 1)
    elif pose == "watch":
        arm(far, hang_y)
        leg(far, x_off=phase)
        body()
        leg(near, x_off=phase)
        if frame and not back:
            arm(near, top_y + 8)
        else:
            arm(near, hang_y)
    else:
        raise ValueError(f"unknown pose {pose!r}")
