"""Arrange wide source originals and atlas-size samples without repainting."""
import hashlib
import json
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont


def main(folder):
    proof = json.loads((folder/'proof.json').read_text())
    if (proof['state']!='complete' or proof['logical_canvas']!=[160,176]
            or proof['source_density']!=8):
        raise ValueError('Expected complete registered wide batch')
    rows = proof['renders']
    facings = ('SE','SW','NW','NE')
    if len(rows)!=4 or {row['facing'] for row in rows}!=set(facings):
        raise ValueError('Expected four distinct facings')
    board = Image.new('RGBA',(1600,870),(235,230,218,255))
    draw = ImageDraw.Draw(board)
    font = ImageFont.load_default(size=20)
    for i,facing in enumerate(facings):
        row = next(row for row in rows if row['facing']==facing)
        path = (folder/row['path']).resolve()
        if path.parent!=folder.resolve() or hashlib.sha256(path.read_bytes()).hexdigest()!=row['sha256']:
            raise ValueError('Source path or hash mismatch')
        with Image.open(path) as source:
            if source.mode!='RGBA' or source.size!=(1280,1408):
                raise ValueError('Expected 1280x1408 RGBA source')
            bounds = source.getchannel('A').getbbox()
            if not bounds or min(bounds[:2])<8 or bounds[2]>1272 or bounds[3]>1400:
                raise ValueError('Empty or clipped source')
            draw.text((i*400+12,10),f'Bathtub / {facing}',fill='#302d28',font=font)
            board.alpha_composite(source.resize((400,440),Image.Resampling.LANCZOS),(i*400,38))
            draw.text((i*400+12,492),'2x texture sample (320 x 352)',fill='#302d28',font=font)
            board.alpha_composite(source.resize((320,352),Image.Resampling.LANCZOS),(i*400+40,518))
    board.convert('RGB').save(folder/'four-facing-review.png')
    print('PASS: four padded hashed originals; layout and resampling only')


if __name__=='__main__':
    main(Path(sys.argv[1]))
