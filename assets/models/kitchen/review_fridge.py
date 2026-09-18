"""Lay out immutable source renders without painting over geometry defects."""
import hashlib
import json
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont

FACINGS = ('SE','SW','NW','NE')


def load_views(folder):
    proof = json.loads((folder/'proof.json').read_text())
    if proof['state'] != 'complete':
        raise ValueError('incomplete batch')
    rows = proof['renders']
    if len(rows) != 4 or {row['facing'] for row in rows} != set(FACINGS):
        raise ValueError('need four distinct facings')
    images = {}
    for row in rows:
        path = folder/row['path']
        if path.resolve().parent != folder.resolve():
            raise ValueError('render path leaves review directory')
        if hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('source hash mismatch')
        with Image.open(path) as source:
            image = source.convert('RGBA')
        if image.size != (768,960):
            raise ValueError('incorrect source resolution')
        bounds = image.getchannel('A').getbbox()
        if not bounds or bounds[0]<8 or bounds[1]<8 or bounds[2]>760 or bounds[3]>952:
            raise ValueError('empty or clipped view')
        images[row['facing']] = image
    return images


def main(folder):
    images = load_views(folder)
    board = Image.new('RGBA',(1536,800),(235,230,218,255))
    draw = ImageDraw.Draw(board)
    title = ImageFont.load_default(size=22)
    label = ImageFont.load_default(size=18)
    for i,facing in enumerate(FACINGS):
        x = i*384
        draw.text((x+16,12),f'Refrigerator / {facing}',fill='#302d28',font=title)
        board.alpha_composite(images[facing].resize((384,480),Image.Resampling.LANCZOS),(x,44))
        draw.text((x+16,536),'2x texture sample (192 x 240)',fill='#302d28',font=label)
        board.alpha_composite(images[facing].resize((192,240),Image.Resampling.LANCZOS),(x+96,558))
    board.convert('RGB').save(folder/'four-facing-review.png')
    print('PASS: four hashed, padded source views; review sheet uses only resampling and layout.')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
