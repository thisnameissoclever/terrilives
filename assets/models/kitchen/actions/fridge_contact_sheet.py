"""Build review contact sheets from a fridge reach prototype or batch directory.

Usage: python fridge_contact_sheet.py DIRECTORY

Writes `contact-sheet.png` (half the source resolution, one row per facing and
one column per rendered sample) and `contact-sheet-game-scale.png` (the
2-pixel-per-logical-pixel export scale the game draws at zoom one, enlarged
two times with nearest-neighbour sampling so single pixels stay visible).
"""
import json
from pathlib import Path
import sys

from PIL import Image, ImageDraw

FACINGS = ('SE', 'SW', 'NE', 'NW')
BACKGROUND = (214, 210, 200, 255)


def sheet(directory, rows, scale, enlarge, name):
    first = Image.open(directory/rows[0][1][0]['path'])
    cell = (round(first.width*scale)*enlarge, round(first.height*scale)*enlarge)
    columns = max(len(items) for _, items in rows)
    label = 28
    canvas = Image.new('RGBA', (columns*cell[0], len(rows)*(cell[1]+label)), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    for r, (facing, items) in enumerate(rows):
        for c, row in enumerate(items):
            image = Image.open(directory/row['path']).convert('RGBA')
            small = image.resize((round(image.width*scale), round(image.height*scale)), Image.Resampling.BOX)
            if enlarge != 1:
                small = small.resize(cell, Image.Resampling.NEAREST)
            tile = Image.new('RGBA', cell, BACKGROUND)
            tile.alpha_composite(small)
            top = r*(cell[1]+label)
            canvas.alpha_composite(tile, (c*cell[0], top+label))
            draw.text((c*cell[0]+6, top+6), f"{facing} sample {row['frame']} door {row['door']} deg", fill=(20, 20, 20, 255))
    canvas.save(directory/name)
    return directory/name


def build(directory):
    directory = Path(directory)
    proof = json.loads((directory/'proof.json').read_text())
    doors = proof['action']['door_degrees']
    renders = [dict(r, door=doors[r['frame']]) for r in proof['renders']
               if r['owner'] == 'beauty' and r['variant'] == 'green']
    rows = [(facing, sorted((r for r in renders if r['facing'] == facing), key=lambda r: r['frame']))
            for facing in FACINGS]
    return (sheet(directory, rows, .5, 1, 'contact-sheet.png'),
            sheet(directory, rows, .25, 2, 'contact-sheet-game-scale.png'))


if __name__ == '__main__':
    for path in build(sys.argv[1]):
        print(path)
