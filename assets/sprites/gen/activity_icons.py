"""Activity bubbles, authored in logical pixels and exported at density two."""
from PIL import Image, ImageDraw

from style import PALETTE


# Order matches render_buffer::activity. Idle and off-lot work have no head bubble.
ICONS = (
    (1, "Walking", "walk"), (2, "Wait", "wait"),
    (3, "Eat", "eat"), (4, "Talk", "talk"), (5, "Sleep", "sleep"),
    (7, "Use", "use"), (8, "Reading", "read"),
    (9, "Exercise", "exercise"), (10, "WatchFish", "fish"),
    (11, "Sitting", "sit"), (12, "Shower", "shower"),
    (13, "Toilet", "toilet"), (14, "TV", "tv"),
    (15, "LyingDown", "lie"), (16, "WashHands", "hands"),
    (17, "WashDishes", "dishes"), (18, "Radio", "radio"),
    (19, "Correspondence", "letter"), (20, "Bath", "bath"),
    (21, "Ingredients", "ingredients"), (22, "PrepareFood", "prepare"),
    (23, "Cooking", "cook"),
)


class Pen:
    """Centered geometry with one stroke weight across the small silhouettes."""
    def __init__(self, drawing, ink, density=4):
        self.d, self.ink, self.density = drawing, ink, density

    def point(self, x, y):
        return ((x + 13) * self.density, (y + 13) * self.density)

    def box(self, xy):
        return (*self.point(*xy[:2]), *self.point(*xy[2:]))

    def line(self, xy, width=1.4):
        self.d.line([self.point(*p) for p in xy], fill=self.ink,
                    width=round(width * self.density), joint="curve")

    def ellipse(self, xy, fill=False, width=1.4):
        self.d.ellipse(self.box(xy), outline=self.ink,
                       fill=self.ink if fill else None,
                       width=round(width * self.density))

    def rect(self, xy, radius=0, fill=False, width=1.4):
        self.d.rounded_rectangle(self.box(xy), radius=radius * self.density,
                                 outline=self.ink,
                                 fill=self.ink if fill else None,
                                 width=round(width * self.density))

    def polygon(self, xy, fill=False):
        points = [self.point(*p) for p in xy]
        self.d.polygon(points, fill=self.ink if fill else None)
        if not fill:
            self.line([*xy, xy[0]])


def draw_glyph(p, glyph):
    if glyph == "walk":
        p.ellipse((-6, -7, -2, 0), fill=True)
        p.ellipse((2, -1, 6, 6), fill=True)
        p.ellipse((-5.5, 2, -2.5, 4), fill=True)
        p.ellipse((2.5, -5, 5.5, -3), fill=True)
    elif glyph == "wait":
        p.ellipse((-7.5, -7.5, 7.5, 7.5))
        p.line([(0, -5), (0, 0), (4, 2)])
    elif glyph == "eat":
        p.line([(-4.5, -7), (-4.5, 7)])
        p.line([(-7, -7), (-7, -2), (-2, -2), (-2, -7)])
        p.ellipse((2, -7, 7, 0))
        p.line([(4.5, 0), (4.5, 7)])
    elif glyph == "talk":
        p.rect((-8, -6, 4, 2), radius=2)
        p.line([(-5, 2), (-5, 5), (-1, 2)])
        p.line([(6, -3), (8, -3), (8, 5), (5, 5), (5, 8), (1, 5), (-1, 5)])
    elif glyph == "sleep":
        p.line([(-7, -4), (1, -4), (-7, 6), (1, 6)], width=1.8)
        p.line([(3, -7), (7, -7), (3, -2), (7, -2)], width=1.2)
    elif glyph == "use":
        p.polygon([(-3, -7), (3, -7), (3, -4), (6, -2), (8, -2),
                   (8, 2), (6, 2), (3, 4), (3, 7), (-3, 7),
                   (-3, 4), (-6, 2), (-8, 2), (-8, -2), (-6, -2), (-3, -4)])
        p.ellipse((-2.5, -2.5, 2.5, 2.5))
    elif glyph == "read":
        p.polygon([(0, -4), (-7.5, -6), (-7.5, 5), (0, 7)])
        p.polygon([(0, -4), (7.5, -6), (7.5, 5), (0, 7)])
        p.line([(-5.5, -2.5), (-2, -1.5)], width=1)
        p.line([(2, -1.5), (5.5, -2.5)], width=1)
    elif glyph == "exercise":
        p.ellipse((-8, -1, -1, 6))
        p.ellipse((1, -1, 8, 6))
        p.line([(-4.5, 2.5), (-1, -4), (4.5, 2.5), (-4.5, 2.5), (2, -4), (4.5, 2.5)])
        p.line([(-3, -4), (1, -4)])
        p.line([(2, -4), (2, -7), (6, -7)])
    elif glyph == "fish":
        p.ellipse((-4.5, -4, 7.5, 4))
        p.polygon([(-4.5, 0), (-8, -3.5), (-8, 3.5)], fill=True)
        p.ellipse((3.5, -1, 5, .5), fill=True, width=1)
        p.line([(-1, -4), (1, -6), (3, -4)], width=1)
    elif glyph == "sit":
        p.rect((-5, -7, 4, 1), radius=1.5)
        p.line([(-7, -1), (-7, 4), (7, 4), (7, -1)])
        p.line([(-5, 4), (-5, 7)])
        p.line([(5, 4), (5, 7)])
        p.line([(-7, 1), (7, 1)])
    elif glyph == "shower":
        p.line([(-7, -7), (-2, -7), (1, -4)])
        p.line([(-1, -2), (4, -7)], width=2)
        for x, y in ((2, 0), (5, -2), (-1, 3), (2, 5), (6, 2)):
            p.line([(x, y), (x + 1.5, y + 1.5)], width=1.3)
    elif glyph == "toilet":
        p.rect((-7, -7, -2, 0), radius=1)
        p.line([(-3, 0), (7, 0), (6, 4), (2, 5), (2, 7), (-3, 7), (-3, 2), (-6, 2)])
        p.line([(-2, -2), (7, -2)])
    elif glyph == "tv":
        p.rect((-8, -5, 8, 5), radius=1.5)
        p.line([(-4, -8), (0, -5), (4, -8)], width=1.2)
        p.line([(0, 5), (0, 7), (-4, 7), (4, 7)])
    elif glyph == "lie":
        p.line([(-8, -3), (-8, 4), (8, 4), (8, -1)])
        p.line([(-8, 1), (8, 1)])
        p.ellipse((-6, -5, -2, -1))
        p.line([(-1, -2), (2, -2), (5, 0), (7, 0)], width=2)
        p.line([(-6, 4), (-6, 6)])
        p.line([(6, 4), (6, 6)])
    elif glyph == "hands":
        p.polygon([(0, -8), (-2, -4), (-1, -2), (1, -2), (2, -4)], fill=True)
        p.line([(-8, 3), (-5, 0), (-2, 0), (0, 2), (3, 2), (6, -1), (8, 1), (3, 7), (-3, 7), (-6, 5)])
        p.line([(-3, 3), (1, 4), (3, 2)], width=1.2)
    elif glyph == "dishes":
        p.ellipse((-7, -5, 5, 7))
        p.ellipse((-4.5, -2.5, 2.5, 4.5), width=1)
        p.ellipse((4, -7, 7, -4), width=1.1)
        p.ellipse((6, -1, 8, 1), fill=True, width=1)
    elif glyph == "radio":
        p.rect((-8, -4, 8, 6), radius=1)
        p.line([(-5, -4), (4, -8)])
        p.ellipse((-5.5, -1.5, .5, 4.5))
        p.line([(3, -1), (6, -1)], width=1)
        p.ellipse((4, 2, 6, 4), fill=True, width=1)
    elif glyph == "letter":
        p.rect((-8, -5, 8, 6), radius=.8)
        p.line([(-8, -5), (0, 1), (8, -5)])
        p.line([(-8, 6), (-3, 1)], width=1)
        p.line([(8, 6), (3, 1)], width=1)
    elif glyph == "bath":
        p.line([(-8, -1), (8, -1)])
        p.line([(-7, -1), (-5, 5), (5, 5), (7, -1)])
        p.line([(-4, 5), (-4, 7)])
        p.line([(4, 5), (4, 7)])
        p.line([(-5, -1), (-5, -6), (-2, -6), (-2, -4)])
        p.ellipse((2, -6, 5, -3), width=1.1)
    elif glyph == "ingredients":
        p.polygon([(-7, -2), (7, -2), (5, 7), (-5, 7)])
        p.line([(-5, -2), (-3, -6), (3, -6), (5, -2)])
        p.line([(-2, 0), (-2, 4)], width=1)
        p.line([(2, 0), (2, 4)], width=1)
        p.ellipse((-2, -7.5, 2, -3.5), fill=True, width=1)
    elif glyph == "prepare":
        p.rect((-8, -2, 8, 7), radius=2)
        p.line([(-5, 4), (4, 4)], width=1)
        p.polygon([(-6, -5), (1, -7), (3, -4), (-4, -2)])
        p.line([(2, -6), (6, -8)], width=2)
    elif glyph == "cook":
        p.rect((-6, -1, 6, 6), radius=1)
        p.line([(-8, 0), (-6, 0)])
        p.line([(6, 0), (8, 0)])
        p.line([(-7, -2), (7, -2)])
        for x in (-3, 3):
            p.line([(x, -4), (x - 1, -6), (x, -8)], width=1.1)
    else:
        raise ValueError(f"unknown activity glyph {glyph}")


def icon_image(glyph):
    image = Image.new("RGBA", (104, 104))
    drawing = ImageDraw.Draw(image)
    drawing.ellipse((4, 4, 100, 100), fill=PALETTE["linen"],
                    outline=PALETTE["ink"], width=5)
    draw_glyph(Pen(drawing, PALETTE["ink"]), glyph)
    return image.resize((52, 52), Image.Resampling.LANCZOS)


def render_icons():
    return [(f"activity{suffix}", icon_image(glyph), 52, 52)
            for _, suffix, glyph in ICONS]
