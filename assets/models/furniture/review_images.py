"""Validate and lay out actual Blender outputs; never retouch their geometry."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).resolve().parent
FOLDER = BASE / 'review/candidate-02'
BACKGROUND = (235,230,218,255)


def load_checked(folder):
    proof = json.loads((folder/'proof.json').read_text())
    if proof['state'] != 'complete':
        raise ValueError('render batch incomplete')
    images = {}
    for row in proof['renders']:
        path = folder / row['path']
        if path.parent.resolve() != folder.resolve():
            raise ValueError('render path leaves review directory')
        if hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('render hash mismatch')
        image = Image.open(path).convert('RGBA')
        if image.size != (768,960):
            raise ValueError('wrong registered canvas')
        bounds = image.getchannel('A').getbbox()
        if not bounds or bounds[0] <= 0 or bounds[1] <= 0 or bounds[2] >= 768 or bounds[3] >= 960:
            raise ValueError('empty or clipped render')
        key = (row['object'],row['facing'],row['occupied'])
        if key in images:
            raise ValueError('duplicate render')
        images[key] = image
    expected = {(kind,facing,occupied) for kind in ('bike','chair')
                for facing in ('SE','NW','SW','NE') for occupied in (False,True)}
    if set(images) != expected:
        raise ValueError('missing or unexpected view')
    return images


def label(draw, position, text):
    draw.text(position,text,fill=(40,37,32),font=ImageFont.load_default(size=20))


def main():
    images = load_checked(FOLDER)
    for kind in ('bike','chair'):
        board = Image.new('RGBA',(1536,1040),BACKGROUND)
        draw = ImageDraw.Draw(board)
        for col,facing in enumerate(('SE','SW','NW','NE')):
            for row,occupied in enumerate((False,True)):
                image = images[(kind,facing,occupied)].resize((384,480),Image.Resampling.LANCZOS)
                board.alpha_composite(image,(col*384,row*520+30))
                label(draw,(col*384+12,row*520+8),f'{facing} - {"occupied" if occupied else "empty"}')
        board.convert('RGB').save(FOLDER/f'{kind}-four-facing-review.png')
    source = images[('bike','SE',True)]
    board = Image.new('RGBA',(1152,520),BACKGROUND)
    draw = ImageDraw.Draw(board)
    for col,density in enumerate((1,2,4)):
        stored = source.resize((96*density,120*density),Image.Resampling.LANCZOS)
        shown = stored.resize((384,480),Image.Resampling.BILINEAR)
        board.alpha_composite(shown,(col*384,36))
        label(draw,(col*384+10,10),f'{density}x texture, same display size')
    board.convert('RGB').save(FOLDER/'texture-density-comparison.png')
    print('PASS: 16 hashed, nonempty, padded views. Review sheets and density comparison written.')


if __name__ == '__main__':
    main()
