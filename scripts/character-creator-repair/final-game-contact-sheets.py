"""Arrange retained screenshot crops for inspection without changing their pixels."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path('docs/evidence/2026-10-13-creator-repair/final-game-review')
for family in ['office-sit', 'office-read', 'ottoman-sit', 'ottoman-read', 'dining-sit', 'dining-read', 'sofa-read', 'recline']:
    files = [root / f'extra-{family}-{facing}-active.png' for facing in range(4)]
    if not all(file.exists() for file in files):
        continue
    sheet = Image.new('RGB', (1200, 370), '#191b20')
    draw = ImageDraw.Draw(sheet)
    for facing, file in enumerate(files):
        draw.text((facing * 300 + 8, 6), f'{family}, facing {facing}', fill='white')
        image = Image.open(file).convert('RGB')
        sheet.paste(image.crop((150, 110, 450, 450)), (facing * 300, 28))
    sheet.save(root / f'extra-{family}-inspection.png')
