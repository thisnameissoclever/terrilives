"""Arrange verified occupied originals; never repaint the source renders."""
import hashlib
import json
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont


def main(folder):
    proof = json.loads((folder/'proof.json').read_text())
    rows = proof['renders']
    facings = ('SE', 'NW', 'SW', 'NE')
    expected = {(facing, frame) for facing in facings for frame in range(4)}
    if proof['state'] != 'complete' or len(rows) != 16:
        raise ValueError('Expected a complete sixteen-image occupied pilot')
    if {(row['facing'], row['frame']) for row in rows} != expected:
        raise ValueError('Missing or repeated facing/frame')
    board = Image.new('RGBA', (1280, 1528), (235, 230, 218, 255))
    draw = ImageDraw.Draw(board)
    font = ImageFont.load_default(size=19)
    for row in rows:
        path = (folder/row['path']).resolve()
        if path.parent != folder.resolve() or hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('Source path or hash mismatch')
        with Image.open(path) as source:
            if source.mode != 'RGBA' or source.size != (1280, 1408):
                raise ValueError('Expected registered 1280x1408 RGBA source')
            bounds = source.getchannel('A').getbbox()
            if not bounds or min(bounds[:2]) < 8 or bounds[2] > 1272 or bounds[3] > 1400:
                raise ValueError('Empty or clipped occupied source')
            x, y = row['frame']*320, facings.index(row['facing'])*382
            draw.text((x+12, y+5), f"{row['facing']} / sample {row['frame']}", fill='#302d28', font=font)
            board.alpha_composite(source.resize((320, 352), Image.Resampling.LANCZOS), (x, y+30))
    board.convert('RGB').save(folder/'occupied-review.png')
    print('PASS: sixteen padded hashed originals; layout and resampling only')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
