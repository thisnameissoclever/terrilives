"""One-off: dump 6x crops of furniture under visual QA. Do not commit."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image

import objects
from iso import canvas, emit
from style import PALETTE as C, mul

OUT = os.path.join(os.path.dirname(__file__), "_qa", "x6")
os.makedirs(OUT, exist_ok=True)

NAMES = (
    "loungeChairRelax",
    "loungeChair",
    "bedDouble",
    "kitchenFridgeBuiltIn",
    "kitchenSink",
    "kitchenStove",
    "bookcaseClosedDoors",
    "radio",
    "pottedPlant",
    "televisionVintage",
    "toiletSquare",
    "bathroomSinkSquare",
    "bathtub",
    "lampRoundFloor",
    "coatRackStanding",
    "chair",
    "trashcan",
    "loungeSofaLong",
    "loungeSofaOttoman",
    "kitchenCabinet",
)

# Map palette (and common muls) to a letter so ASCII is about materials, not luminance.
LETTERS = []
for key, ch in (
    ("floor", "."), ("grout", ","), ("wood", "W"), ("wood_light", "w"),
    ("wood_dark", "D"), ("fabric", "F"), ("linen", "L"), ("linen_alt", "l"),
    ("cabinet", "C"), ("counter", "K"), ("metal", "M"), ("porcelain", "P"),
    ("water", "A"), ("screen", "s"), ("pot", "o"), ("leaf", "G"),
    ("shade", "h"), ("ink", "i"), ("accent_clay", "R"), ("accent_sage", "E"),
    ("accent_brass", "B"), ("accent_slate", "S"), ("card", "c"),
):
    LETTERS.append((C[key], ch))
    for f in (.42, .48, .50, .58, .70, .78, .82, .85, .88, .90, .92, .94,
              .96, .98, 1.04, 1.05, 1.06, 1.08, 1.10, 1.12, 1.18, 1.22,
              1.32, 1.38, 1.42, 1.48, 1.50):
        LETTERS.append((mul(C[key], f), ch))


def letter(px):
    if px[3] < 32:
        return " "
    rgb = px[:3]
    best, dist = "?", 1e9
    for col, ch in LETTERS:
        d = abs(col[0] - rgb[0]) + abs(col[1] - rgb[1]) + abs(col[2] - rgb[2])
        if d < dist:
            best, dist = ch, d
    return "i" if dist > 80 and rgb[0] < 80 else best


def ascii_dump(img, max_w=64):
    w, h = img.size
    step = max(1, (w + max_w - 1) // max_w)
    rows = []
    for y in range(0, h, step):
        line = []
        for x in range(0, w, step):
            line.append(letter(img.getpixel((x, min(y, h - 1)))))
        rows.append("".join(line))
    return "\n".join(rows)


def render_named(name):
    img, d = canvas()
    getattr(objects, name)(d)
    crop, _, _ = emit(img)
    return crop


def main():
    one = os.path.join(os.path.dirname(__file__), "_qa", "1x")
    os.makedirs(one, exist_ok=True)
    for name in NAMES:
        crop = render_named(name)
        crop.save(os.path.join(one, f"{name}.png"))
        big = crop.resize((crop.width * 6, crop.height * 6), Image.NEAREST)
        path = os.path.join(OUT, f"{name}.png")
        big.save(path)
        print(f"===== {name} {crop.size} =====")
        print(ascii_dump(crop))
        print()


if __name__ == "__main__":
    main()
