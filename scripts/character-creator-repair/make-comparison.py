"""Arrange unscaled crops from the actual matched-camera browser captures."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[2]
folder = root / 'docs/evidence/2026-10-13-creator-repair/comparison'
canvas = Image.new('RGB', (840, 950), '#17191f')
draw = ImageDraw.Draw(canvas)
font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 18)
versions = [('published', 'Published'), ('before', 'Before repair'), ('repaired', 'Repaired')]
cases = [('toilet', (265, 170, 435, 415), 'Toilet and bubble'),
         ('bookshelf', (270, 185, 430, 390), 'Bookcase'),
         ('stove', (145, 95, 285, 320), 'Kitchen wall')]
for col, (version, title) in enumerate(versions):
    draw.text((col * 280 + 20, 12), title, font=font, fill='white')
    for row, (model, box, label) in enumerate(cases):
        suffix = 'unused' if model == 'stove' else 'active'
        with Image.open(folder / f'{version}-{model}-{suffix}.png') as source:
            image = source.crop(box)
        x, y = col * 280 + (280 - image.width) // 2, 55 + row * 300
        draw.text((col * 280 + 20, y), label, font=font, fill='#acbfcc')
        canvas.paste(image, (x, y + 29))
canvas.save(folder / 'comparison-sheet.png')
