"""Clear Line people: one billboard figure, every pose.

A person is shoulders, a torso, two arms, two legs, a neck, and a head
with a face. Hands live on their sleeves. Standing poses keep both shoes on
one ground y; seated actions own their contact geometry. Raised hands sit
beside the head, never on it. Food lives in a hand, never as a snout.
"""
from style import (PALETTE as C, OUTLINE, OUTLINE_WIDTH, FACE_LEFT,
                   FACE_RIGHT, CHARACTER, mul)
from iso import P

HEAD_RX = 7
HEAD_RY = 8
TORSO_HALF = 8
ARM_HALF = 2.5
LEG_HALF = 3.5
ARM_OUT = 9


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
    if bot - top < 4:
        bot = top + 4
    d.rounded_rectangle(
        [x - half, top, x + half, bot],
        radius=min(half, 2),
        fill=fill, outline=OUTLINE, width=OUTLINE_WIDTH,
    )


def _bent_limb(d, points, fill, width=5):
    """One outlined two-segment limb with a readable knee or elbow."""
    d.line(points, fill=OUTLINE, width=width + 3, joint="curve")
    d.line(points, fill=fill, width=width, joint="curve")
    radius = max(2, width // 2)
    for x, y in points[1:-1]:
        _oval(d, x - radius, y - radius, x + radius, y + radius,
              fill=fill, outline=OUTLINE, width=1)


def _hand(d, x, y, skin):
    _oval(d, x - 2, y - 2, x + 2, y + 2,
          fill=skin, outline=OUTLINE, width=OUTLINE_WIDTH)


def _shoe(d, x, py, fx, back, colour):
    """Compact heel on the anchor row, toe toward the facing."""
    if back:
        _oval(d, x - 2, py - 3, x + 2, py,
              fill=colour, outline=OUTLINE, width=OUTLINE_WIDTH)
    elif fx >= 0:
        _oval(d, x - 2, py - 3, x + 4, py,
              fill=colour, outline=OUTLINE, width=OUTLINE_WIDTH)
    else:
        _oval(d, x - 4, py - 3, x + 2, py,
              fill=colour, outline=OUTLINE, width=OUTLINE_WIDTH)


def _head(d, cx, cy, palette, fx, back):
    """Skin oval, hair as a cap, eyes on the remaining face."""
    skin, hair = palette["skin"], palette["hair"]
    ink = CHARACTER["eye"]
    ol, w = OUTLINE, OUTLINE_WIDTH
    rx, ry = HEAD_RX, HEAD_RY
    if back:
        _oval(d, cx - rx - 1, cy - ry - 2, cx + rx + 1, cy + ry - 2,
              fill=hair, outline=ol, width=w)
        return
    _oval(d, cx - rx, cy - ry, cx + rx, cy + ry,
          fill=skin, outline=ol, width=w)
    _oval(d, cx - rx + 1, cy - ry - 2, cx + rx - 1, cy - 2, fill=hair)
    _oval(d, cx - fx * 4 - 1, cy - ry, cx - fx * 4 + 2, cy - 3, fill=hair)
    eye_y = cy + 2
    d.rectangle([cx - 3 + fx, eye_y, cx - 2 + fx, eye_y + 2], fill=ink)
    d.rectangle([cx + 1 + fx, eye_y, cx + 2 + fx, eye_y + 2], fill=ink)


def _torso(d, cx, top_y, hip_y, fx, shirt, back):
    """One coat. A second outlined box through the chest reads as a seam."""
    d.rounded_rectangle(
        [cx - TORSO_HALF, top_y, cx + TORSO_HALF, hip_y],
        radius=4, fill=shirt, outline=OUTLINE, width=OUTLINE_WIDTH,
    )
    if back:
        return
    shade = mul(shirt, FACE_RIGHT if fx >= 0 else FACE_LEFT)
    if fx >= 0:
        d.rectangle([cx + 3, top_y + 6, cx + TORSO_HALF - 1, hip_y - 3],
                    fill=shade)
    else:
        d.rectangle([cx - TORSO_HALF + 1, top_y + 6, cx - 3, hip_y - 3],
                    fill=shade)


def _neck(d, cx, top_y, skin):
    """Chin sits in the collar. A stalk between them is a pin on a coat."""
    d.rectangle([cx - 3, top_y - 2, cx + 3, top_y + 2], fill=skin)


def _shadow(d, px, py):
    _oval(d, px - 8, py - 3, px + 8, py, fill=mul(C["ink"], 1.6))


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


def _morsel(d, x, y):
    """A bite of food in a hand, not a cube glued to the face."""
    d.rectangle([x - 1, y - 1, x + 1, y + 1],
                fill=C["accent_clay"], outline=OUTLINE, width=1)


def person(d, palette, facing="se", pose="idle", frame=0):
    fx, back = _facing(facing)
    px, py = P(.5, .5)
    shirt, trouser = palette["shirt"], palette["trouser"]
    skin = palette["skin"]
    shoe = mul(trouser, 0.55)
    far, near = -fx, fx
    phase = 1 if frame else -1

    hip_y = py - 26
    top_y = py - 50
    lean = 0
    hem = py - 4

    if pose == "walk":
        lean = fx
    elif pose == "read":
        hip_y = py - 18
        top_y = py - 42
        lean = fx
    elif pose == "exercise":
        # The hip is a fixed contact on the saddle. Pedalling moves the knees
        # and feet, not the whole body up and down like a reluctant piston.
        lean = fx
        hip_y = py - 30
        top_y = py - 52

    cx = px + lean
    head_y = top_y - 6
    hang_y = hip_y + 2
    head_cx = cx + fx

    _shadow(d, px, py)

    def arm(side, hand_y, x_off=0, raised=False):
        x = cx + side * ARM_OUT + x_off
        if raised:
            _column(d, x, min(hand_y, top_y + 4), max(hand_y, top_y + 10),
                    ARM_HALF, shirt)
        else:
            _column(d, x, top_y + 6, hand_y, ARM_HALF, shirt)
        _hand(d, x, hand_y, skin)
        return x

    def leg(side, x_off=0):
        x = px + side * 5 + lean + x_off
        _column(d, x, hip_y - 1, hem, LEG_HALF, trouser)
        _shoe(d, x, py, fx, back, shoe)

    def body():
        _torso(d, cx, top_y, hip_y, fx, shirt, back)
        _neck(d, cx, top_y, skin)
        _head(d, head_cx, head_y, palette, fx, back)

    if pose == "idle":
        arm(far, hang_y)
        leg(far)
        body()
        leg(near)
        arm(near, hang_y)
    elif pose == "walk":
        fwd = phase
        arm(far, hang_y + (3 if frame else 0), x_off=-fwd)
        leg(far, x_off=-fwd * far * 3)
        body()
        leg(near, x_off=fwd * near * 3)
        arm(near, hang_y + (0 if frame else 3), x_off=fwd * near)
    elif pose == "talk":
        arm(far, hang_y)
        leg(far)
        body()
        leg(near)
        if frame == 0:
            arm(near, top_y + 18)
        else:
            arm(near, head_y + 4, raised=True)
    elif pose == "eat":
        arm(far, hang_y)
        leg(far)
        body()
        leg(near)
        if frame == 0:
            hx = arm(near, top_y + 18)
            if not back:
                _morsel(d, hx + fx, top_y + 16)
        else:
            arm(near, head_y + 8, raised=True)
    elif pose in ("read", "standread"):
        book_y = (py - 28) if pose == "read" else (py - 34)
        if back:
            arm(far, hang_y)
            leg(far)
            _book(d, cx + fx, book_y, frame)
            body()
            leg(near)
            arm(near, book_y + (0 if frame else 3))
        else:
            arm(far, book_y + 4)
            leg(far)
            body()
            _book(d, cx + fx, book_y, frame)
            leg(near)
            arm(near, book_y - (2 if frame else 0))
    elif pose == "exercise":
        low_pedal = (px - fx * 5, py - 13)
        high_pedal = (px - fx * 14, py - 30)
        low_knee = (px - fx * 2, py - 20)
        high_knee = (px - fx * 10, py - 18)

        def rider_arm(side, hand_x, hand_y):
            shoulder = (cx + side * 6, top_y + 7)
            elbow = (cx + fx * 5 + side * 2, top_y + 15)
            _bent_limb(d, [shoulder, elbow, (hand_x, hand_y)], shirt, width=4)
            _hand(d, hand_x, hand_y, skin)

        def rider_leg(side, foot, knee):
            hip = (cx + side * 3, hip_y - 1)
            _bent_limb(d, [hip, knee, foot], trouser, width=6)
            _oval(d, foot[0] - 4, foot[1] - 2,
                  foot[0] + 4, foot[1] + 2,
                  fill=shoe, outline=OUTLINE, width=OUTLINE_WIDTH)

        far_foot, near_foot = (
            (high_pedal, low_pedal) if frame == 0 else (low_pedal, high_pedal)
        )
        far_knee, near_knee = (
            (high_knee, low_knee) if frame == 0 else (low_knee, high_knee)
        )

        # Both hands remain planted on the swept bars while the feet exchange
        # the opposing pedal positions. Far limbs draw first, as elsewhere.
        rider_arm(far, px + fx * 4, py - 55)
        rider_leg(far, far_foot, far_knee)
        body()
        rider_leg(near, near_foot, near_knee)
        rider_arm(near, px + fx * 11, py - 50)
    elif pose == "watch":
        arm(far, hang_y)
        leg(far, x_off=phase)
        body()
        leg(near, x_off=phase)
        if frame and not back:
            arm(near, head_y + 10, raised=True)
        else:
            arm(near, hang_y)
    else:
        raise ValueError(f"unknown pose {pose!r}")
