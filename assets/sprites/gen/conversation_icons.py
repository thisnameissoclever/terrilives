"""Speech, activity and reaction in one tintable conversation bubble."""
from PIL import Image, ImageDraw, ImageOps
import hashlib
import json
from pathlib import Path
from activity_icons import ICONS, Pen, draw_glyph
from style import PALETTE


def glyph_image(glyph):
    image = Image.new('RGBA', (104, 104))
    draw_glyph(Pen(ImageDraw.Draw(image), PALETTE['ink']), glyph)
    return image


def thumb_image(positive):
    image = Image.new('RGBA', (104, 104))
    pen = Pen(ImageDraw.Draw(image), PALETTE['ink'])
    pen.rect((-9, 0, -5, 8), radius=0.6)
    pen.line([(-4, 7), (5, 7), (7, 5), (8, -1), (7, -3), (1, -3),
              (2, -7), (1, -9), (-1, -9), (-3, -3), (-5, 0)])
    return image if positive else ImageOps.flip(image)


def conversation_image(glyph, positive):
    image = Image.new('RGBA', (168, 168))
    drawing = ImageDraw.Draw(image)
    drawing.ellipse((4, 4, 164, 164), fill=PALETTE['linen'],
                    outline=PALETTE['ink'], width=5)
    for symbol, position, size in (
        (glyph_image('talk'), (12, 24), 72),
        (glyph_image(glyph), (84, 24), 72),
        (thumb_image(positive), (56, 96), 56),
    ):
        image.alpha_composite(symbol.resize((size, size), Image.Resampling.LANCZOS), position)
    return image.resize((84, 84), Image.Resampling.LANCZOS)


def render_icons():
    return [(f'conversation{suffix}{reaction}', conversation_image(glyph, positive), 84, 84)
            for code, suffix, glyph in ICONS if code not in (1, 2)
            for positive, reaction in ((True, 'Like'), (False, 'Dislike'))]


def load_reviewed_icons(path):
    """Verify authored pixels against the separately pinned review catalogue."""
    catalogue = json.loads(Path(path).read_text(encoding='utf-8'))
    sprites = render_icons()
    if any(image.mode != 'RGBA' or image.size != (width, height)
           for _, image, width, height in sprites):
        raise ValueError('reviewed conversation icon dimensions changed')
    actual = [{'name': name, 'width': width, 'height': height,
               'rgbaSha256': hashlib.sha256(image.tobytes()).hexdigest()}
              for name, image, width, height in sprites]
    if catalogue.get('version') != 1 or catalogue.get('sprites') != actual:
        raise ValueError('reviewed conversation icon pixels changed')
    return sprites
