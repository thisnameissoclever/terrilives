"""Build unedited reduced-size motion boards from the complete raw batch."""
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image, ImageDraw


def review(directory):
    images = {}
    receipts = []
    for frame in range(8):
        source = directory/f'frame-{frame}'
        proof = json.loads((source/'proof.json').read_text())
        if proof['state'] != 'complete' or len(proof['renders']) != 4:
            raise ValueError('The swimming batch is incomplete')
        receipts.append(proof)
        for row in proof['renders']:
            path = source/row['path']
            if hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']:
                raise ValueError('Swimming source pixels changed')
            with Image.open(path) as raw:
                raw.load()
                if raw.mode != 'RGBA' or raw.size != (768, 960):
                    raise ValueError('Swimming source registration changed')
                images[frame, row['facing']] = raw.resize((192, 240), Image.Resampling.LANCZOS)
    board = Image.new('RGB', (8*192, 4*264), '#e6dac3')
    draw = ImageDraw.Draw(board)
    for row, facing in enumerate(('SE','NW','SW','NE')):
        loop = []
        for frame in range(8):
            image = images[frame, facing]
            board.paste(image, (frame*192,row*264+24), image)
            draw.text((frame*192+8,row*264+5), f'{facing} / {frame}', fill='#242424')
            canvas = Image.new('RGBA', (192,240), '#e6dac3')
            canvas.alpha_composite(image)
            loop.append(canvas)
        loop[0].save(directory/f'loop-{facing}.webp', save_all=True,
                     append_images=loop[1:], duration=600, loop=0, lossless=True)
    board.save(directory/'motion-board.png')


if __name__ == '__main__':
    review(Path(sys.argv[1]))
