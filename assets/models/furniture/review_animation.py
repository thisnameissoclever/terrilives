"""Validate complete contact renders and prepare readable review sheets."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

FACINGS = ('SE','NW','SW','NE')
SAMPLES = {'bike':8,'chair':4}


def load_checked(directory):
    directory = Path(directory)
    proof = json.loads((directory/'proof.json').read_text())
    if proof['state'] != 'complete':
        raise ValueError('Animation render batch is incomplete')
    expected = {(kind,facing,index) for kind,count in SAMPLES.items()
                for facing in FACINGS for index in range(count)}
    images = {}
    for row in proof['renders']:
        key = (row['kind'],row['facing'],row['frame'])
        if key in images:
            raise ValueError('Duplicate animation sample')
        path = directory/row['path']
        if hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('Animation render hash changed')
        image = Image.open(path).convert('RGBA')
        if image.size != (768,960):
            raise ValueError('Animation source dimensions changed')
        bounds = image.getchannel('A').getbbox()
        if not bounds or min(bounds[:2]) < 4 or bounds[2] > 764 or bounds[3] > 956:
            raise ValueError('Animation sample is empty or clipped')
        images[key] = image
    if set(images) != expected:
        raise ValueError('Animation facing/sample coverage is incomplete')
    return images


def make_sheets(directory):
    directory = Path(directory)
    images = load_checked(directory)
    for kind,count in SAMPLES.items():
        sheet = Image.new('RGB',(count*192,4*262),(239,235,226))
        draw = ImageDraw.Draw(sheet)
        for row,facing in enumerate(FACINGS):
            for index in range(count):
                frame = images[kind,facing,index].resize((192,240),Image.Resampling.LANCZOS)
                sheet.paste(frame,(index*192,row*262+22),frame)
                draw.text((index*192+8,row*262+6),f'{facing} - frame {index}',fill=(42,44,43))
        sheet.save(directory/f'{kind}-complete-cycle.png')
        frames = []
        for index in range(count):
            frame = Image.new('RGB',(384,480),(239,235,226))
            for n,facing in enumerate(FACINGS):
                sample = images[kind,facing,index].resize((192,240),Image.Resampling.LANCZOS)
                frame.paste(sample,((n%2)*192,(n//2)*240),sample)
            frames.append(frame)
        frames[0].save(directory/f'{kind}-four-facing-loop.webp',save_all=True,
                       append_images=frames[1:],duration=125 if kind=='bike' else 500,
                       loop=0,lossless=True)
    print('PASS: 48 hash-validated, nonempty, padded contact views; sheets and loops written')


if __name__ == '__main__':
    import sys
    make_sheets(sys.argv[1])
