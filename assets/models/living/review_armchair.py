"""Arrange the immutable empty and occupied originals for visual review."""
import hashlib
import json
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont

FACINGS = ('SE', 'NE', 'SW', 'NW')


def run(candidate):
    board = Image.new('RGBA', (1280, 2160), (235, 230, 218, 255))
    draw = ImageDraw.Draw(board)
    font = ImageFont.load_default(size=20)
    for occupied in (False, True):
        folder = candidate/'occupied-review' if occupied else candidate
        proof = json.loads((folder/'proof.json').read_text())
        if proof['state'] != 'complete':
            raise ValueError('Incomplete source review batch')
        rows = {(row['facing'], row.get('frame', -1)): row for row in proof['renders']}
        frames = range(4) if occupied else (-1,)
        if set(rows) != {(facing, frame) for facing in FACINGS for frame in frames}:
            raise ValueError('Incorrect source review coverage')
        for (facing, frame), row in rows.items():
            path = folder/row['path']
            if path.resolve().parent != folder.resolve():
                raise ValueError('Source path leaves candidate')
            if hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']:
                raise ValueError('Source pixels changed')
            with Image.open(path) as image:
                image.load()
                if image.mode != 'RGBA' or image.size != (768, 960):
                    raise ValueError('Incorrect source format')
                bounds = image.getchannel('A').getbbox()
                if not bounds or min(bounds[:2]) < 8 or bounds[2] > 760 or bounds[3] > 952:
                    raise ValueError('Empty or clipped source')
                x, y = FACINGS.index(facing)*320, (frame+1)*432
                draw.text((x+12, y+8), f'{facing} / '+('empty' if frame == -1 else f'sit {frame}'),
                          font=font, fill='#302d28')
                board.alpha_composite(image.resize((320, 400), Image.Resampling.LANCZOS), (x, y+32))
    board.convert('RGB').save(candidate/'occupied-four-facing-review.png')
    print('PASS: 20 hashed and padded originals; sheet changes only layout and sampling.')


if __name__ == '__main__':
    run(Path(sys.argv[1]))
